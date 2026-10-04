import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { withDeadline } = await import(`data:text/javascript;base64,${Buffer.from(compile('../src/utils/withDeadline.ts')).toString('base64')}`);
const address = '0x0000000000000000000000000000000000000001';
const review = { id: '1', action: 'forwarding', from: address, to: address, chainId: 10143, maxNetworkFee: '0.01', digest: '0x' + '00'.repeat(32) };
let index = 0;
async function fixture(failBroadcast = false) {
  const calls = []; let passkeys = 0, ended = 0;
  globalThis.__orderTestMocks = {
    withDeadline, Channel: class {}, listen: async () => () => {},
    loadPublicAccount: () => ({ address }), getEvmAddress: () => address,
    chooseSpecificFromExisting: async () => { passkeys++; return new Uint8Array(32); },
    createSigningSession: async () => ({ publicKey: new Uint8Array(33), end: () => ended++,
      signDigest: async () => ({ compact: new Uint8Array(64), recovery: 0 }) }),
    signTransactionDigest: async () => { calls.push('sign'); },
    broadcastTransaction: async () => { calls.push('broadcast'); if (failBroadcast) throw new Error('reverted'); return 'confirmed'; },
    invoke: async (name) => {
      calls.push(name);
      if (name === 'has_perpl_trade_key') return false;
      if (name === 'begin_perpl_trade_key') return { address, digest: review.digest };
      if (name === 'build_perpl_forwarding') return review;
      if (name === 'place_perpl_trigger') return { state: 'armed' };
    },
  };
  const code = 'const {withDeadline,invoke,Channel,listen,getEvmAddress,chooseSpecificFromExisting,loadPublicAccount,createSigningSession,signTransactionDigest,broadcastTransaction}=globalThis.__orderTestMocks;\n'
    + compile('../src/trading/service.ts').replace(/^import .*;\s*$/gm, '');
  const service = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${index++}`);
  return { service, calls, counts: () => ({ passkeys, ended }) };
}
test('first stop enrolls and confirms permission using one passkey before placement', async () => {
  const f = await fixture(); let setupConfirmed = false;
  const result = await f.service.placeTrigger({ address }, {}, review, () => {}, () => { setupConfirmed = true; });
  assert.equal(result.state, 'armed'); assert.equal(setupConfirmed, true);
  assert.deepEqual(f.counts(), { passkeys: 1, ended: 1 });
  assert.ok(f.calls.indexOf('complete_perpl_trade_key') < f.calls.indexOf('broadcast'));
  assert.ok(f.calls.indexOf('broadcast') < f.calls.indexOf('place_perpl_trigger'));
});
test('failed permission transaction never places a stop and releases the signer', async () => {
  const f = await fixture(true);
  await assert.rejects(f.service.placeTrigger({ address }, {}, review, () => {}, () => {}), /reverted/);
  assert.equal(f.calls.includes('place_perpl_trigger'), false);
  assert.equal(f.counts().ended, 1);
});
test('failed trade returns immediately without hidden preparation retries', async () => {
  const f = await fixture(true); let refreshed = 0;
  await assert.rejects(f.service.authorizeAndSend(review, address, async () => { refreshed++; return review; }), /reverted/);
  assert.equal(refreshed, 1); assert.equal(f.counts().ended, 1);
});

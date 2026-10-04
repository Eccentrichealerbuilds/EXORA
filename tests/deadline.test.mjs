import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source = readFileSync(new URL('../src/utils/withDeadline.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { withDeadline } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('hung operation releases the caller and a late passkey is disposed, never submitted', async () => {
  let finish, submitted = false, disposed = false;
  const native = new Promise(resolve => { finish = resolve; });
  await assert.rejects(withDeadline(native, 5, 'expired', key => { key.fill(0); disposed = true; })
    .then(() => { submitted = true; }), /expired/);
  const key = new Uint8Array([1, 2, 3]);
  finish(key);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(submitted, false); assert.equal(disposed, true);
  assert.deepEqual([...key], [0, 0, 0]);
});
test('rejection and success settle immediately', async () => {
  await assert.rejects(withDeadline(Promise.reject(new Error('reverted')), 1000, 'expired'), /reverted/);
  assert.equal(await withDeadline(Promise.resolve('confirmed'), 1000, 'expired'), 'confirmed');
});

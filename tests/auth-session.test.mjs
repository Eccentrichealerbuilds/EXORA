import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\s*$/gm, '');
const store = new Map();
globalThis.sessionStorage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k) };
globalThis.window = new EventTarget();
const load = code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const auth = await load('const useSyncExternalStore = (_subscribe, snapshot) => snapshot();\n' + compile('../src/utils/authSession.ts'));
globalThis.__authTest = { auth, account: { address: '0xabc' } };
const { RequireSession } = await load('const {auth} = globalThis.__authTest; const useSessionAddress=auth.useSessionAddress; const loadPublicAccount=()=>globalThis.__authTest.account; const Navigate="Navigate", Outlet="Outlet"; const _jsx=(type, props)=>({type,...props});\n' + compile('../src/components/RequireSession.tsx'));
test('saved wallet alone cannot open protected screens', () => {
  assert.equal(RequireSession().type, 'Navigate');
});
test('sign-out blocks every subsequent history visit while retaining returning-wallet metadata', () => {
  auth.startSession('0xABC');
  assert.equal(RequireSession().type, 'Outlet');
  auth.signOut();
  for (const route of ['/home','/trade','/portfolio','/activity']) {
    const view = RequireSession();
    assert.equal(view.type, 'Navigate', route); assert.equal(view.to, '/'); assert.equal(view.replace, true);
  }
  assert.equal(globalThis.__authTest.account.address, '0xabc');
  auth.startSession('0xabc');
  assert.equal(RequireSession().type, 'Outlet');
});
test('another remembered wallet cannot inherit an active session', () => {
  globalThis.__authTest.account = { address: '0xdef' };
  assert.equal(RequireSession().type, 'Navigate');
});

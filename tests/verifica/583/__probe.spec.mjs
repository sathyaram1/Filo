import { test } from './../../fixtures/electron.mjs';
test('probe', async ({ app }) => {
  const r = await app.evaluate(async ({ ipcMain }) => {
    const out = {};
    out.env = process.env.NODE_ENV;
    out.globals = Object.getOwnPropertyNames(globalThis).filter((k) => k.startsWith('__filo') || k.startsWith('SN_')).slice(0, 40);
    try { out.inv = ipcMain._invokeHandlers ? [...ipcMain._invokeHandlers.keys()] : 'none'; } catch (e) { out.inv = 'err:' + e.message; }
    return out;
  });
  console.log('PROBE', JSON.stringify(r));
});

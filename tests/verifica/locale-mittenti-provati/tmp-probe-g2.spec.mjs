import { test } from '../../fixtures/electron.mjs';
test('probe', async ({ app }) => {
  const r = await app.evaluate(() => {
    const out = { mm: typeof process.mainModule, req: typeof require };
    try { const r = process.mainModule.require; const ga = r('./auth/google-auth'); out.ga = Object.keys(ga); const ts = r('./auth/token-store'); out.ts = Object.keys(ts); const cfg = r('./auth/config'); out.cfg = (cfg.adminEmails || []).length; out.enc = ts.canEncrypt && ts.canEncrypt(); } catch (e) { out.err = e.message; }
    return out;
  });
  console.log('PROBE', JSON.stringify(r));
});

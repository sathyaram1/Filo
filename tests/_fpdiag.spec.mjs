import { test, expect } from './fixtures/electron.mjs';

test('fpdiag', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const F = globalThis.__filoFingerprint;
    const before = F.configForHref('https://www.example.com/').seed;
    const seedDirect = F.seedForOrigin('example.com');
    let initErr = null;
    try { await F.init({}); } catch (e) { initErr = String(e && e.message || e); }
    const after = F.configForHref('https://www.example.com/').seed;
    const afterDirect = F.seedForOrigin('example.com');
    return { before, seedDirect, after, afterDirect, hasF: !!F, initErr };
  });
  // Forza il fallimento per stampare i valori nel messaggio.
  expect(JSON.stringify(r)).toBe('REVEAL');
});

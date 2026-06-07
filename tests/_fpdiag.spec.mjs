import { test, expect } from './fixtures/electron.mjs';

test('fpdiag', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const F = globalThis.__filoFingerprint;
    const before = F.configForHref('https://www.example.com/').seed;
    const seedDirect = F.seedForOrigin('example.com');
    await F.init({});
    const after = F.configForHref('https://www.example.com/').seed;
    return { before, seedDirect, after, hasF: !!F };
  });
  console.log('FPDIAG', JSON.stringify(r));
  expect(true).toBe(true);
});

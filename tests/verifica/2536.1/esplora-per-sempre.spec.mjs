// Esplorazione col modello vero: quante volte «toglilo dalla memoria» chiede per_sempre.
import { test, expect } from '../../fixtures/electron.mjs';

test.describe.configure({ mode: 'serial' });
const esiti = [];

for (let i = 1; i <= 6; i++) {
  test(`prova ${i}`, async ({ app, shell }) => {
    test.setTimeout(240_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
    await app.evaluate(async (_, key) => {
      await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: key } });
      await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Fa il geometra in uno studio tecnico.\nHa un gatto, Pepe.', PREFERENZE: 'Preferisce risposte brevi.' });
      const P = globalThis.SN_PROVIDERS;
      globalThis.__tc = [];
      const orig = P.streamCompleteWithFallback;
      P.streamCompleteWithFallback = async (o) => { const r = await orig(o); for (const t of (r && r.toolCalls) || []) globalThis.__tc.push(t.arguments); return r; };
    }, process.env.OPENROUTER_API_KEY);
    await expect.poll(() => app.windows().filter((w) => w.url().startsWith('filo://newtab')).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const home = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    await home.reload();
    await home.waitForLoadState('domcontentloaded');
    const prima = await home.locator('.dash-bubble-filo').count();
    await home.locator('#input').fill('ah il mio gatto pepe purtroppo non c\'è più, toglilo dalla memoria');
    await home.locator('#sendBtn').click();
    await expect.poll(() => home.locator('.dash-bubble-filo').count(), { timeout: 120_000 }).toBeGreaterThan(prima);
    await home.waitForTimeout(8_000);
    esiti.push(JSON.stringify(await app.evaluate(() => globalThis.__tc)));
  });
}
test('riassunto', () => { console.log('ESITI\n' + esiti.join('\n')); });

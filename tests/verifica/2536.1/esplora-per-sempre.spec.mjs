// Esplorazione col modello vero: quante volte «toglilo dalla memoria» chiede per_sempre.
import { test, expect } from '../../fixtures/electron.mjs';

test.describe.configure({ mode: 'serial' });
const esiti = [];

for (let i = 1; i <= 6; i++) {
  test(`prova ${i}`, async ({ app, shell, openTab }) => {
    test.setTimeout(240_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
    await app.evaluate(async (_, key) => {
      await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: key } });
      await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Fa il geometra in uno studio tecnico.\nHa un gatto, Pepe.', PREFERENZE: 'Preferisce risposte brevi.' });
      const P = globalThis.SN_PROVIDERS;
      globalThis.__tc = [];
      const orig = P.streamCompleteWithFallback;
      P.streamCompleteWithFallback = async (o) => { const r = await orig(o); globalThis.__tc.push(((r && r.toolCalls) || []).map((t) => t.arguments).join(' ') || `TESTO ${String(r && r.text).slice(0, 120)}`); return r; };
    }, process.env.OPENROUTER_API_KEY);
    const prefs = await openTab('filo://preferences/preferences.html');
    await prefs.locator('#restartOnboarding').click();
    await expect.poll(() => app.windows().filter((w) => w.url().startsWith('filo://newtab')).length, { timeout: 15_000 }).toBeGreaterThan(1);
    const home = app.windows().filter((w) => w.url().startsWith('filo://newtab'))[1];
    await home.waitForLoadState('domcontentloaded');
    await expect(home.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 90_000 });
    const prima = await home.locator('.dash-bubble-filo').count();
    await home.locator('#input').fill('sono luca. ah il mio gatto pepe purtroppo non c\'è più, toglilo dalla memoria');
    await home.locator('#sendBtn').click();
    await expect.poll(() => home.locator('.dash-bubble-filo').count(), { timeout: 120_000 }).toBeGreaterThan(prima);
    await home.waitForTimeout(8_000);
    esiti.push(JSON.stringify(await app.evaluate(() => globalThis.__tc)));
  });
}
test('riassunto', () => { console.log('ESITI\n' + esiti.join('\n')); });

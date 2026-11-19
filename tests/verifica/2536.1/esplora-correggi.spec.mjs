// Esplorazione col modello vero: «correggilo in memoria» nell'intervista rifatta.
import { test, expect } from '../../fixtures/electron.mjs';

test.skip(!process.env.OPENROUTER_API_KEY, 'serve il modello vero');

function newtabWindows(app) { return app.windows().filter((w) => w.url().startsWith('filo://newtab')); }

for (let i = 1; i <= 3; i++) {
  test(`correggi ${i}`, async ({ app, shell, openTab }) => {
    test.setTimeout(300_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
    await app.evaluate(async (_, key) => {
      await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: key } });
      await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Fa il geometra in uno studio tecnico.\nHa un gatto, Pepe.', PREFERENZE: 'Preferisce risposte brevi.' });
    }, process.env.OPENROUTER_API_KEY);
    const prefs = await openTab('filo://preferences/preferences.html');
    await prefs.locator('#restartOnboarding').click();
    await expect.poll(() => newtabWindows(app).length, { timeout: 15_000 }).toBeGreaterThan(1);
    const p = newtabWindows(app)[1];
    await expect(p.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 90_000 });
    const prima = await p.locator('.dash-bubble-filo').count();
    const t0 = Date.now();
    await p.locator('#input').fill('sono luca. ah non faccio più il geometra, adesso faccio l\'architetto: correggilo in memoria');
    await p.locator('#sendBtn').click();
    await expect.poll(() => p.locator('.dash-bubble-filo').count(), { timeout: 120_000 }).toBeGreaterThan(prima);
    await p.waitForTimeout(12_000);
    const m = JSON.stringify(await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory()));
    const testo = (await p.locator('.dash-bubble-filo').last().innerText()).replace(/\s+/g, ' ');
    const att = await p.locator('.dash-activity').allInnerTexts().catch(() => []);
    console.log(`ESITO ${i}: ${m.includes('architetto') ? 'corretta' : 'non corretta'} ${Math.round((Date.now() - t0) / 1000)}s «${testo}» ${JSON.stringify(att)}`);
    expect(m).toContain('architetto');
  });
}

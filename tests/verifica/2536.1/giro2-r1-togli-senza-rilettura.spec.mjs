// r1 — nell'intervista rifatta «toglilo dalla memoria» costa una chiamata al modello in più (prima rilegge la memoria,
// poi dimentica): col modello vero di serie, la riga deve andarsene senza la rilettura davanti, come nella chat normale.
import { test, expect } from '../../fixtures/electron.mjs';

test.skip(!process.env.OPENROUTER_API_KEY, 'serve il modello vero');

function newtabWindows(app) { return app.windows().filter((w) => w.url().startsWith('filo://newtab')); }

for (let i = 1; i <= 2; i++) {
  test(`r1 intervista rifatta: «toglilo» toglie Pepe senza rileggere prima la memoria (${i})`, async ({ app, shell, openTab }) => {
    test.setTimeout(300_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
    await app.evaluate(async (_, key) => {
      await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: key } });
      await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Fa il geometra in uno studio tecnico.\nHa un gatto, Pepe.', PREFERENZE: 'Preferisce risposte brevi.' });
      const P = globalThis.SN_PROVIDERS;
      globalThis.__azioni = [];
      const orig = P.streamCompleteWithFallback;
      P.streamCompleteWithFallback = async (o) => {
        const r = await orig(o);
        if (JSON.stringify(o.messages?.[0] ?? '').includes('Sei Filo, l\'assistente dentro il browser Filo')) {
          for (const c of (r && r.toolCalls) || []) globalThis.__azioni.push(`${c.name} ${c.arguments}`);
        }
        return r;
      };
    }, process.env.OPENROUTER_API_KEY);
    const prefs = await openTab('filo://preferences/preferences.html');
    await prefs.locator('#restartOnboarding').click();
    await expect.poll(() => newtabWindows(app).length, { timeout: 15_000 }).toBeGreaterThan(1);
    const p = newtabWindows(app)[1];
    await expect(p.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 90_000 });
    const prima = await p.locator('.dash-bubble-filo').count();
    await p.locator('#input').fill('sono luca. ah il mio gatto pepe purtroppo non c\'è più, toglilo dalla memoria');
    await p.locator('#sendBtn').click();
    await expect.poll(() => p.locator('.dash-bubble-filo').count(), { timeout: 120_000 }).toBeGreaterThan(prima);
    await p.waitForTimeout(10_000);
    const azioni = await app.evaluate(() => globalThis.__azioni);
    const memoria = JSON.stringify(await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory()));
    expect(memoria, 'Pepe resta in memoria').not.toContain('Pepe');
    expect(azioni.filter((a) => /"azione":\s*"leggi"/.test(a)), `azioni del turno: ${azioni.join(' | ')}`).toEqual([]);
  });
}

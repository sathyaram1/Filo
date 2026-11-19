// Esplorazione col modello vero: «toglilo dalla memoria» nella chat normale, quante volte la riga si nasconde subito.
import { test, expect } from '../../fixtures/electron.mjs';

test.skip(!process.env.OPENROUTER_API_KEY, 'serve il modello vero');
test.describe.configure({ mode: 'serial' });
const FRASE = 'ah il mio gatto pepe purtroppo non c\'è più, toglilo dalla memoria';
const esiti = [];

function newtabWindows(app) { return app.windows().filter((w) => w.url().startsWith('filo://newtab')); }

for (let i = 1; i <= 5; i++) {
  test(`chat ${i}`, async ({ app, shell }) => {
    test.setTimeout(240_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
    await app.evaluate(async (_, key) => {
      await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: key } });
      await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Fa il geometra in uno studio tecnico.\nHa un gatto, Pepe.', PREFERENZE: 'Preferisce risposte brevi.' });
      await globalThis.SN_FILO_MEMORY.appendLesson('Ha prenotato un volo per Lisbona.');
    }, process.env.OPENROUTER_API_KEY);
    await expect.poll(() => newtabWindows(app).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const home = newtabWindows(app)[0];
    await home.reload();
    await home.waitForLoadState('domcontentloaded');
    const prima = await home.locator('.dash-bubble-filo').count();
    await home.locator('#input').fill(FRASE);
    await home.locator('#sendBtn').click();
    await expect.poll(() => home.locator('.dash-bubble-filo').count(), { timeout: 120_000 }).toBeGreaterThan(prima);
    await home.waitForTimeout(12_000);
    const tolta = await app.evaluate(async () => !JSON.stringify(await globalThis.SN_FILO_MEMORY.getMemory()).includes('Pepe'));
    const testo = (await home.locator('.dash-bubble-filo').last().innerText()).replace(/\s+/g, ' ').slice(0, 120);
    esiti.push(`${tolta ? 'tolta' : 'resta'} «${testo}»`);
  });
}

test('conto', () => {
  console.log('ESITI\n' + esiti.join('\n'));
  expect(esiti.filter((e) => e.startsWith('tolta')).length).toBeGreaterThanOrEqual(4);
});

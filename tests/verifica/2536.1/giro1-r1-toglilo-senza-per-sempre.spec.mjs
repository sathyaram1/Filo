// r1 — «toglilo dalla memoria», col modello vero di serie (chiave OpenRouter dell'ambiente): la riga si nasconde e basta,
// senza una cancellazione «per sempre» che aspetta una conferma. Sei prove, nell'intervista rifatta e nella chat normale;
// su main la chat normale la toglie quattro volte su cinque, sul ramo una su cinque.
import { test, expect } from '../../fixtures/electron.mjs';

test.describe.configure({ mode: 'serial' });
test.skip(!process.env.OPENROUTER_API_KEY, 'serve il modello vero');

const FRASE = 'ah il mio gatto pepe purtroppo non c\'è più, toglilo dalla memoria';
const esiti = [];

function newtabWindows(app) { return app.windows().filter((w) => w.url().startsWith('filo://newtab')); }
async function newtabPage(app, index = 0) {
  await expect.poll(() => newtabWindows(app).length, { timeout: 15_000 }).toBeGreaterThan(index);
  const win = newtabWindows(app)[index];
  await win.waitForLoadState('domcontentloaded');
  return win;
}

async function base(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
  await app.evaluate(async (_, key) => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: key } });
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Fa il geometra in uno studio tecnico.\nHa un gatto, Pepe.', PREFERENZE: 'Preferisce risposte brevi.' });
    await globalThis.SN_FILO_MEMORY.appendLesson('Ha prenotato un volo per Lisbona.');
  }, process.env.OPENROUTER_API_KEY);
}

async function manda(page, testo) {
  const prima = await page.locator('.dash-bubble-filo').count();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect.poll(() => page.locator('.dash-bubble-filo').count(), { timeout: 120_000 }).toBeGreaterThan(prima);
  await page.waitForTimeout(10_000);
}

const senzaPepe = (app) => app.evaluate(async () => !JSON.stringify(await globalThis.SN_FILO_MEMORY.getMemory()).includes('Pepe'));

for (let i = 1; i <= 3; i++) {
  test(`r1 prova ${i} nell’intervista rifatta`, async ({ app, shell, openTab }) => {
    test.setTimeout(240_000);
    await base(app, shell);
    const prefs = await openTab('filo://preferences/preferences.html');
    await prefs.locator('#restartOnboarding').click();
    const intervista = await newtabPage(app, 1);
    await expect(intervista.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 90_000 });
    await manda(intervista, `sono luca. ${FRASE}`);
    esiti.push(`intervista ${i}: ${await senzaPepe(app) ? 'tolta' : 'resta'}`);
  });
  test(`r1 prova ${i} nella chat normale`, async ({ app, shell }) => {
    test.setTimeout(240_000);
    await base(app, shell);
    const home = await newtabPage(app, 0);
    await home.reload();
    await home.waitForLoadState('domcontentloaded');
    await manda(home, FRASE);
    esiti.push(`chat ${i}: ${await senzaPepe(app) ? 'tolta' : 'resta'}`);
  });
}

test('r1 «toglilo dalla memoria» la toglie subito almeno quattro volte su sei', () => {
  expect(esiti.filter((e) => e.endsWith('tolta')).length, esiti.join(', ')).toBeGreaterThanOrEqual(4);
});

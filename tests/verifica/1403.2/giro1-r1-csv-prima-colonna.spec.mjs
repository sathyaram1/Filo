// #1403.2 giro 1 — un CSV con la colonna «password» per prima, senza virgolette: nessun avviso, né a punti e virgola
// né a virgole.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtab(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

async function finti(app) {
  await app.evaluate(async () => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { ...T.models }, modelRegistry: T.registry,
    });
    globalThis.__invii = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__invii.push(p); return { id: `fb-${globalThis.__invii.length}`, seq: 1, failed: [] }; };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const sys = String(messages?.[0]?.content || '');
      const text = sys.startsWith('Rileggi un feedback') || sys.startsWith('Guarda le immagini') ? '{"trovati":[]}' : 'Titolo';
      return { text, provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: {} };
    };
  });
}

for (const [nome, csv] of [
  ['punti e virgola', 'password;utente\nhunter22;mario.rossi\n'],
  ['virgole', 'password,email\nhunter22,mario@example.com\n'],
]) {
  test(`r1 CSV con la colonna password per prima, a ${nome}: il riquadro si riapre con l'avviso`, async ({ app, shell }) => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtab(app);
    await finti(app);
    await page.evaluate(() => window.SN_FEEDBACK_UI.open());
    await page.locator('.sn-fb-text').fill('Allego l\'esportazione: il login fallisce sempre');
    await page.locator('.sn-fb-file').setInputFiles([{ name: 'utenti.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }]);
    await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
    await page.locator('.sn-fb-send').click();
    await expect(page.locator('.sn-fb-l0')).toContainText('In un file allegato c’è una password', { timeout: 12_000 });
    await expect(page.locator('.sn-fb-file-chip--l0')).toContainText('utenti.csv');
    expect(await app.evaluate(() => globalThis.__invii.length)).toBe(0);
  });
}

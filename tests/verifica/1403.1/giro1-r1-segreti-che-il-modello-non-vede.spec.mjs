// Verifica #1403.1, giro 1: quello che il passaggio verso i modelli nasconde (password scritte «nome=valore», in JSON,
// PIN, token) il modello della rilettura non lo vede; se il controllo senza modello non lo riconosce, parte senza avviso.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtab(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

// Un modello finto che non sbaglia: segnala «hunter22» ogni volta che gli arriva davanti.
async function finti(app) {
  await app.evaluate(async () => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { ...T.models }, modelRegistry: T.registry,
    });
    globalThis.__visto = [];
    globalThis.__invii = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__invii.push(p); return { id: `fb-${globalThis.__invii.length}`, seq: 1, failed: [] }; };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const sys = String(messages?.[0]?.content || '');
      const user = JSON.stringify(messages?.slice(1) || []);
      let text = 'Titolo';
      if (sys.startsWith('Rileggi un feedback')) {
        globalThis.__visto.push(user);
        text = user.includes('hunter22') ? JSON.stringify({ trovati: [{ tipo: 'segreto', pezzo: 'hunter22' }] }) : '{"trovati":[]}';
      } else if (sys.startsWith('Guarda le immagini')) text = '{"trovati":[]}';
      return { text, provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: {} };
    };
  });
}
const invii = (app) => app.evaluate(() => globalThis.__invii.map((p) => p.text));

test('r1 una password scritta «password=valore» nel testo: il modello non la vede, ma l\'avviso compare', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  const TESTO = 'Il login fallisce, nel file di configurazione ho password=hunter22 e mi dice sempre 401.';
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill(TESTO);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-l0'), 'il riquadro si riapre con l\'avviso').toBeVisible({ timeout: 12_000 });
  expect(await invii(app)).toEqual([]);
});

test('r1 un file JSON allegato con una password: il riquadro si riapre con l\'avviso', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Allego la configurazione: il login fallisce sempre.');
  await page.locator('.sn-fb-file').setInputFiles([
    { name: 'config.json', mimeType: 'application/json', buffer: Buffer.from('{"utente":"mario.rossi","password":"hunter22"}') },
  ]);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-l0'), 'il riquadro si riapre con l\'avviso').toBeVisible({ timeout: 12_000 });
  expect(await invii(app)).toEqual([]);
});

test('r1 un log allegato con «password=valore» senza spazi: il riquadro si riapre con l\'avviso', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Allego il log: il login fallisce sempre.');
  await page.locator('.sn-fb-file').setInputFiles([
    { name: 'filo.log', mimeType: 'text/plain', buffer: Buffer.from('avvio...\nutente=mario.rossi password=hunter22\nerrore 401\n') },
  ]);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-l0'), 'il riquadro si riapre con l\'avviso').toBeVisible({ timeout: 12_000 });
  expect(await invii(app)).toEqual([]);
});

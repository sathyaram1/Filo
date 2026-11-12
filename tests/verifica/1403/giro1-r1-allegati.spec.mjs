// Verifica #1403 giro 1: L0 rilegge anche gli allegati di testo, e la rilettura anticipata vale anche sui siti.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato, nelMondoDiFilo, statoDi, clicca } from '../../helpers/riquadri.mjs';

const SHOTS = 'tests/.shots';

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
    globalThis.__l0 = { testo: '{"trovati":[]}', immagini: '{"trovati":[]}', chiamate: [] };
    globalThis.__invii = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__invii.push(p); return { id: `fb-${globalThis.__invii.length}`, seq: 1, failed: [] }; };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const S = globalThis.__l0;
      const sys = String(messages?.[0]?.content || '');
      const cosa = sys.startsWith('Rileggi un feedback') ? 'testo' : sys.startsWith('Guarda le immagini') ? 'immagini' : 'altro';
      S.chiamate.push(cosa);
      if (cosa === 'altro') return { text: 'Titolo', provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: {} };
      return { text: S[cosa], provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: {} };
    };
  });
}
const invii = (app) => app.evaluate(() => globalThis.__invii.map((p) => p.text));

test('r1 un file di testo allegato con una password:il riquadro si riapre con l\'avviso invece di mandarlo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill('Allego il log: il login fallisce sempre.');
  const log = 'avvio...\nutente = mario.rossi\npassword = hunter22\nerrore 401\n';
  await page.locator('.sn-fb-file').setInputFiles([{ name: 'filo.log', mimeType: 'text/plain', buffer: Buffer.from(log) }]);
  await expect(page.locator('.sn-fb-thumbs')).toContainText('filo.log');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 1_000 });
  // Quello che conta per chi scrive: il log con la password non parte senza che lui lo sappia.
  await expect(page.locator('.sn-fb-l0'), 'l\'avviso dice che nell\'allegato c\'è una password o una chiave').toBeVisible({ timeout: 12_000 });
  expect(await invii(app)).toEqual([]);
});

// #1337 (#602.1, #582.2) — la segnalazione che la coda butta perché non si può più cifrare: il riquadro aveva già
// svuotato il campo, e il testo non stava più da nessuna parte. Adesso torna nel riquadro del sito dove era stato
// scritto, e l'avviso dice dove. In più il selettore del riquadro offre la tabella .tsv, che Filo accetta.

import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, conta, clicca, scrivi } from './helpers/riquadri.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

// La coda non parte da sola: la si svuota a mano DOPO aver rotto la cifratura, come una copia di Filo che perde la
// chiave fra l'invio e la partenza.
const codaFerma = (app) => app.evaluate(() => { globalThis.SN_FEEDBACK_OUTBOX._setAuto(false); });
const cifraturaRottaESvuota = (app) => app.evaluate(async () => {
  globalThis.SN_FEEDBACK_CRYPTO.hasPublicKey = () => false;
  await globalThis.SN_FEEDBACK_OUTBOX.flush();
  return globalThis.SN_FEEDBACK_OUTBOX.size();
});

test('pagina di Filo: il .tsv si allega dal selettore; buttata la segnalazione, il testo torna nel riquadro', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await codaFerma(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  const accept = String(await page.locator('.sn-fb-file').getAttribute('accept')).split(',');
  expect(accept).toContain('.tsv');
  expect(accept).toContain('text/tab-separated-values');
  for (const via of ['image/svg+xml', '.svg', 'text/html', '.html', 'image/*', 'text/*']) expect(accept).not.toContain(via);

  await page.locator('.sn-fb-file').setInputFiles({ name: 'misure.tsv', mimeType: 'text/tab-separated-values', buffer: Buffer.from('a\tb\n1\t2\n') });
  await expect(page.locator('.sn-fb-file-chip .sn-fb-file-name')).toHaveText('misure.tsv');
  await page.locator('.sn-fb-file').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.locator('.sn-fb-status')).toContainText('Ammessi: immagini, PDF, testo, markdown, CSV, TSV, JSON e YAML.');

  const testo = 'La tabella delle misure non si apre 😕 <b>mai</b>';
  await page.locator('.sn-fb-text').fill(testo);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 4_000 });

  expect(await cifraturaRottaESvuota(app), 'detto l\'avviso, la voce esce dalla coda').toBe(0);
  const avviso = shell.locator('.shell-notif').filter({ hasText: /non ho mandato niente/i });
  await expect(avviso).toHaveCount(1, { timeout: 10_000 });
  await expect(avviso).toContainText('Quello che avevi scritto è di nuovo nel riquadro dei feedback, pronto da rimandare. Gli allegati vanno rimessi.');

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-text')).toHaveValue(testo);
  // Rimesso una volta: richiudere e riaprire non lo raddoppia.
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-text')).toHaveValue(testo);
});

test('su un sito: il testo torna nel riquadro di quel sito, accanto alla bozza nuova, e l\'avviso lo nomina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await codaFerma(app);
  const pagina = '<!doctype html><html><head><meta charset="utf-8"></head><body><p>Sito</p></body></html>';
  const page = await testServer.openReady(openTab, pagina);
  const host = new URL(testServer.origin).hostname;

  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'il carrello si svuota da solo');
  await clicca(app, page, '.sn-fb-send');
  await expect.poll(() => conta(app, page, '.sn-fb-modal')).toBe(0);

  // Mentre la segnalazione aspetta, sullo stesso sito si comincia a scriverne un'altra.
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'e anche il menu');
  const bozza = `sn_feedback_draft_text@${testServer.origin}`;
  await expect.poll(() => app.evaluate(async (_e, k) => (await globalThis.chrome.storage.local.get([k]))[k] || '', bozza))
    .toBe('e anche il menu');

  expect(await cifraturaRottaESvuota(app)).toBe(0);
  const avviso = shell.locator('.shell-notif').filter({ hasText: /non ho mandato niente/i });
  await expect(avviso).toHaveCount(1, { timeout: 10_000 });
  await expect(avviso).toContainText(`è di nuovo nel riquadro dei feedback su ${host}, pronto da rimandare.`);

  // Il riquadro aperto intanto non lo perde: lo ritrova alla prossima apertura, dopo quello che c'era.
  await page.keyboard.press('Escape');
  await expect.poll(() => conta(app, page, '.sn-fb-modal')).toBe(0);
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.valore)
    .toBe('e anche il menu\n\nil carrello si svuota da solo');
});

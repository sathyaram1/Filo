// L'elenco scarica una PROIEZIONE, il dettaglio il documento intero — #677.
//
// IL CASO. Aprire Gestione o la pagina dei feedback scaricava cinquecento
// documenti INTERI: report della lavorazione, livelli, allegati. Sono i campi
// che pesano, e nessuno di loro sta in una riga d'elenco. Ora la lista chiede
// i soli campi che mostra, ordina e filtra; il resto arriva quando quel
// feedback si apre davvero.
//
// COSA ASSERISCE, dal punto di vista dell'owner: la lista mostra gli STESSI
// feedback di prima — titolo, numero, stato, conteggi — e aprendone uno la
// conversazione e gli allegati CI SONO. E la lettura in più è una sola, per il
// feedback aperto, non per tutti.
//
// Senza il fix è rosso dall'altro verso: il dettaglio non verrebbe mai chiesto
// (`chiesti` resterebbe vuoto) perché la lista porterebbe già tutto.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';
const PAGINA_GESTIONE = 'filo://manage/manage.html';

const ALLEGATO = 'https://firebasestorage.googleapis.com/v0/b/x/o/feedback%2Fprova.png?alt=media';

// La riga come arriva dall'elenco: niente note, niente livelli, niente
// allegati, e il marchio che dice «questo non è tutto il documento».
const RIGA = {
  _id: 'fb677',
  _proiezione: true,
  seq: 677,
  subSeq: 0,
  name: 'Aprire senza scaricare tutto due volte',
  text: 'Gestione ci mette una vita ad aprirsi.',
  status: 'todo',
  statusPublic: 'open',
  priority: 2,
  clientId: 'tester-1',
  createdAt: '2026-09-20T16:47:40.658Z',
};

// Lo stesso feedback, intero, come torna quando si apre il dettaglio.
const INTERO = {
  ...RIGA,
  _proiezione: undefined,
  notes: 'Guardato: il caricamento chiede i documenti interi.',
  images: [ALLEGATO],
  files: [],
};

async function admin(page) {
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.invalid' } };
      }
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      if (msg && msg.type === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
}

// Sostituisce le due letture della collezione e tiene il registro di quali id
// il dettaglio è andato a chiedere.
async function collezioneFinta(page, riga, intero) {
  await page.evaluate(({ r, i }) => {
    window.__chiesti = [];
    window.SN_FEEDBACK.list = async () => [JSON.parse(JSON.stringify(r))];
    window.SN_FEEDBACK.getMany = async (ids) => {
      window.__chiesti.push(...ids);
      const pieno = JSON.parse(JSON.stringify(i));
      delete pieno._proiezione;
      return ids.includes(pieno._id) ? [pieno] : [];
    };
  }, { r: riga, i: intero });
}

test('la pagina dei feedback mostra la riga, e la conversazione arriva quando serve', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 15_000 });
  await admin(page);
  await collezioneFinta(page, RIGA, INTERO);
  await page.evaluate(() => window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' }));
  await page.evaluate(() => window.location.reload());
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 15_000 });
  await admin(page);
  await collezioneFinta(page, RIGA, INTERO);
  await page.evaluate(() => { window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' }); });

  // Il caricamento vero (proiettato) e poi il completamento della sezione.
  await page.evaluate(async () => {
    const R = JSON.parse(JSON.stringify(window.__rigaProiettata || null));
    return R;
  }).catch(() => {});
  await page.evaluate(() => window.__fbTest.setData([]));
  await page.evaluate(async () => {
    // Il cammino vero: la lista proiettata entra da SN_FEEDBACK.list.
    const righe = await window.SN_FEEDBACK.list({});
    window.__fbTest.setData(righe);
  });

  const card = page.locator('.fb-card[data-id="fb677"]');
  await expect(card).toBeVisible({ timeout: 10_000 });
  // La riga dice quello che diceva prima: numero e titolo.
  await expect(card.locator('.fb-title')).toContainText('#677');
  await expect(card.locator('.fb-title')).toContainText('Aprire senza scaricare tutto due volte');
  // La segnalazione originale c'è, e con lei la conversazione e l'allegato:
  // sono arrivati col completamento, non col caricamento della lista.
  await expect(card.locator('.fb-bubble-body').first()).toContainText('Gestione ci mette una vita');
  await expect(card.locator('.fb-notes')).toHaveValue(/caricamento chiede i documenti interi/);
  await expect(card.locator('.fb-imgs img')).toHaveCount(1);

  const chiesti = await page.evaluate(() => window.__chiesti);
  expect(chiesti).toEqual(['fb677']);
});

test('in Gestione la lista è la stessa, e il dettaglio si completa aprendolo', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  await collezioneFinta(page, RIGA, INTERO);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((r) => window.__mgTest.setData([JSON.parse(JSON.stringify(r))]), RIGA);

  const riga = page.locator('.mg-item[data-id="fb677"]');
  await expect(riga).toBeVisible({ timeout: 10_000 });
  await expect(riga.locator('.mg-item-num')).toHaveText('#677');
  await expect(riga.locator('.mg-item-title')).toHaveText('Aprire senza scaricare tutto due volte');
  // Disegnare la lista non costa nessuna lettura in più.
  expect(await page.evaluate(() => window.__chiesti)).toEqual([]);

  await riga.click();
  // Il pannello si completa da sé: la conversazione e l'allegato compaiono.
  await expect(page.locator('#mgThread')).toContainText('caricamento chiede i documenti interi', { timeout: 10_000 });
  await expect(page.locator('#mgThread .mg-bubble-body').first()).toContainText('Gestione ci mette una vita');
  await expect(page.locator('#mgThread img[data-url]')).toHaveCount(1);

  // Una lettura sola, per il feedback aperto.
  expect(await page.evaluate(() => window.__chiesti)).toEqual(['fb677']);

  // E riaprirlo non ne costa un'altra: il documento è già lì.
  await page.evaluate(() => window.__mgTest && null);
  await riga.click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__chiesti)).toEqual(['fb677']);
});

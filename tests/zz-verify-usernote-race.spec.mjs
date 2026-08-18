// SPEC TEMPORANEA DI VERIFICA (da cancellare) — corse sulla frase per il mittente.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const BASE = {
  seq: 900, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-08-18T10:00:00Z',
  images: [],
};

function fbA(extra) { return { ...BASE, _id: 'fb-a', seq: 900, name: 'Feedback A', text: 'testo A', ...extra }; }
function fbB(extra) { return { ...BASE, _id: 'fb-b', seq: 901, name: 'Feedback B', text: 'testo B', ...extra }; }

// Canale verso il main sotto controllo del test: ogni feedback_update viene
// registrato e la sua risposta resta SOSPESA finché il test non la sblocca.
async function prepara(page, data, tab = 'todo') {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());

  await page.evaluate(() => {
    window.__sent = [];      // ordine reale di partenza verso il main
    window.__pend = [];      // { resolve }
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = (msg) => {
      if (msg && msg.type === 'feedback_update' && Object.prototype.hasOwnProperty.call(msg, 'userNote')) {
        window.__sent.push({ id: msg.id, userNote: msg.userNote });
        return new Promise((resolve) => { window.__pend.push({ resolve }); });
      }
      return orig(msg);
    };
    window.__ok = (i) => window.__pend[i].resolve({ ok: true });
    window.__ko = (i, m) => window.__pend[i].resolve({ ok: false, error: m || 'rifiutato dal server' });
  });

  await page.evaluate(({ d, t }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(d);
    window.__mgTest.setTab(t);
  }, { d: data, t: tab });
}

const open = (page, id) => page.evaluate((i) => window.__mgTest.openDetail(i), id);
const box = (page) => page.locator('#mgUserNoteText');
const btn = (page) => page.locator('#mgUserNoteBtn');
const msgEl = (page) => page.locator('#mgUserNoteMsg');
const sent = (page) => page.evaluate(() => window.__sent);
const settle = (page) => page.waitForTimeout(200);

// Scrive nella casella come l'owner (parte l'evento input).
const scrivi = (page, testo) => box(page).fill(testo);
// Invio da tastiera: è l'UNICO modo di spedire mentre un salvataggio è ancora
// in volo restando sullo stesso feedback (il bottone si spegne da solo).
const invio = (page) => box(page).press('Enter');
// Click sul bottone senza aspettare che sia abilitato (per provare che spento
// non spedisce).
const clickBtn = (page) => btn(page).click({ force: true });

test('due invii sullo stesso feedback, risposte in ordine invertito', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [fbA({ userNote: 'vecchia' }), fbB()]);
  await open(page, 'fb-a');

  await scrivi(page, 'primo');
  await invio(page);
  await settle(page);
  await scrivi(page, 'secondo');
  await invio(page);
  await settle(page);

  expect(await sent(page)).toEqual([
    { id: 'fb-a', userNote: 'primo' },
    { id: 'fb-a', userNote: 'secondo' },
  ]);

  // risposte in ordine INVERTITO: prima la seconda, poi la prima
  await page.evaluate(() => window.__ok(1));
  await settle(page);
  await page.evaluate(() => window.__ok(0));
  await settle(page);

  await expect(box(page)).toHaveValue('secondo');

  // esce e rientra: quello che la pagina si RICORDA
  await open(page, 'fb-b');
  await open(page, 'fb-a');
  await expect(box(page)).toHaveValue('secondo');

  // e non deve dire "Nessuna modifica" su un testo superato: ri-salvare
  // "primo" deve RIPARTIRE davvero
  await scrivi(page, 'primo');
  await invio(page);
  await settle(page);
  expect((await sent(page)).slice(2)).toEqual([{ id: 'fb-a', userNote: 'primo' }]);
});

test('tre invii, risposte in ordine 3-1-2', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [fbA({ userNote: '' }), fbB()]);
  await open(page, 'fb-a');

  for (const t of ['uno', 'due', 'tre']) {
    await scrivi(page, t);
    await invio(page);
    await settle(page);
  }
  expect(await sent(page)).toEqual([
    { id: 'fb-a', userNote: 'uno' },
    { id: 'fb-a', userNote: 'due' },
    { id: 'fb-a', userNote: 'tre' },
  ]);

  await page.evaluate(() => window.__ok(2));
  await settle(page);
  await page.evaluate(() => window.__ok(0));
  await settle(page);
  await page.evaluate(() => window.__ok(1));
  await settle(page);

  await expect(box(page)).toHaveValue('tre');
  await open(page, 'fb-b');
  await open(page, 'fb-a');
  await expect(box(page)).toHaveValue('tre');
});

test('invii mescolati su feedback diversi non si annullano', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [fbA({ userNote: 'a0' }), fbB({ userNote: 'b0' })]);

  await open(page, 'fb-a');
  await scrivi(page, 'a1');
  await invio(page);
  await settle(page);

  await open(page, 'fb-b');
  await scrivi(page, 'b1');
  await invio(page);
  await settle(page);

  await open(page, 'fb-a');
  await scrivi(page, 'a2');
  await invio(page);
  await settle(page);

  expect(await sent(page)).toEqual([
    { id: 'fb-a', userNote: 'a1' },
    { id: 'fb-b', userNote: 'b1' },
    { id: 'fb-a', userNote: 'a2' },
  ]);

  // risposte tutte all'incontrario
  await page.evaluate(() => { window.__ok(2); });
  await settle(page);
  await page.evaluate(() => { window.__ok(1); });
  await settle(page);
  await page.evaluate(() => { window.__ok(0); });
  await settle(page);

  await expect(box(page)).toHaveValue('a2');
  await open(page, 'fb-b');
  await expect(box(page)).toHaveValue('b1');
  await open(page, 'fb-a');
  await expect(box(page)).toHaveValue('a2');
});

test('invio + uscita + rientro + secondo invio col bottone', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [fbA({ userNote: 'x0' }), fbB()]);

  await open(page, 'fb-a');
  await scrivi(page, 'x1');
  await invio(page);                    // invio da tastiera
  await settle(page);

  await open(page, 'fb-b');
  await open(page, 'fb-a');
  // qui la casella mostra ancora il vecchio (la risposta non è tornata) e il
  // bottone deve essere di nuovo utilizzabile
  await expect(box(page)).toHaveValue('x0');
  await expect(btn(page)).toBeEnabled();
  await scrivi(page, 'x2');
  await btn(page).click();              // secondo invio COL BOTTONE
  await settle(page);

  expect(await sent(page)).toEqual([
    { id: 'fb-a', userNote: 'x1' },
    { id: 'fb-a', userNote: 'x2' },
  ]);

  await page.evaluate(() => window.__ok(1));
  await settle(page);
  await page.evaluate(() => window.__ok(0));
  await settle(page);

  await expect(box(page)).toHaveValue('x2');
  await open(page, 'fb-b');
  await open(page, 'fb-a');
  await expect(box(page)).toHaveValue('x2');
});

test('primo fallisce, secondo riesce', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [fbA({ userNote: 'y0' }), fbB()]);
  await open(page, 'fb-a');

  await scrivi(page, 'y1');
  await invio(page);
  await settle(page);
  await scrivi(page, 'y2');
  await invio(page);
  await settle(page);

  await page.evaluate(() => window.__ok(1));    // l'ultimo spedito riesce
  await settle(page);
  await page.evaluate(() => window.__ko(0));    // il superato fallisce in ritardo
  await settle(page);

  await expect(box(page)).toHaveValue('y2');
  await expect(msgEl(page)).toHaveText('Salvata');
  await open(page, 'fb-b');
  await open(page, 'fb-a');
  await expect(box(page)).toHaveValue('y2');
});

test('primo riesce, secondo fallisce', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [fbA({ userNote: 'z0' }), fbB()]);
  await open(page, 'fb-a');

  await scrivi(page, 'z1');
  await invio(page);
  await settle(page);
  await scrivi(page, 'z2');
  await invio(page);
  await settle(page);

  await page.evaluate(() => window.__ko(1));    // l'ultimo spedito fallisce, risponde per primo
  await settle(page);
  await page.evaluate(() => window.__ok(0));    // il superato riesce in ritardo
  await settle(page);

  // l'errore dell'ultimo spedito resta visibile: non viene coperto dal
  // successo di una scrittura superata
  await expect(msgEl(page)).toContainText(/rifiutato|errore/i);
  await expect(box(page)).toHaveValue('z2');
});

test('cancellazione della frase come secondo invio', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [fbA({ userNote: '' }), fbB()]);
  await open(page, 'fb-a');

  await scrivi(page, 'w1');
  await invio(page);
  await settle(page);
  await scrivi(page, '');               // l'owner ci ripensa e svuota
  await invio(page);
  await settle(page);

  // il secondo invio (lo svuotamento) DEVE essere partito: è l'ultimo voluto
  expect(await sent(page)).toEqual([
    { id: 'fb-a', userNote: 'w1' },
    { id: 'fb-a', userNote: '' },
  ]);

  await page.evaluate(() => window.__ok(1));
  await settle(page);
  await page.evaluate(() => window.__ok(0));
  await settle(page);

  await expect(box(page)).toHaveValue('');
  await open(page, 'fb-b');
  await open(page, 'fb-a');
  await expect(box(page)).toHaveValue('');
});

test('cancellazione: cosa la pagina si ricorda vs cosa è partito', async ({ openTab }) => {
  // Variante diagnostica del caso sopra: qui NON pretendo il secondo invio, ma
  // che quello che la pagina si ricorda coincida con l'ultima cosa PARTITA.
  const page = await openTab(URL);
  await prepara(page, [fbA({ userNote: '' }), fbB()]);
  await open(page, 'fb-a');

  await scrivi(page, 'w1');
  await invio(page);
  await settle(page);
  await scrivi(page, '');
  await invio(page);
  await settle(page);

  const partiti = await sent(page);
  for (let i = 0; i < partiti.length; i++) await page.evaluate((k) => window.__ok(k), i);
  await settle(page);

  await open(page, 'fb-b');
  await open(page, 'fb-a');
  const ultimoPartito = partiti[partiti.length - 1].userNote;
  await expect(box(page)).toHaveValue(ultimoPartito);
});

test('il bottone non resta bloccato cambiando feedback con un salvataggio in volo', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [fbA({ userNote: '' }), fbB({ userNote: '' })]);

  await open(page, 'fb-a');
  await scrivi(page, 'in volo');
  await btn(page).click();
  await settle(page);
  await expect(btn(page)).toBeDisabled();

  await open(page, 'fb-b');
  await expect(btn(page)).toBeEnabled();

  await scrivi(page, 'su B');
  await btn(page).click();
  await settle(page);
  expect(await sent(page)).toEqual([
    { id: 'fb-a', userNote: 'in volo' },
    { id: 'fb-b', userNote: 'su B' },
  ]);
  await page.evaluate(() => { window.__ok(0); window.__ok(1); });
  await settle(page);
  await expect(box(page)).toHaveValue('su B');
  await open(page, 'fb-a');
  await expect(box(page)).toHaveValue('in volo');
});

test('bottone spento durante il volo: un click non spedisce nulla', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [fbA({ userNote: '' }), fbB()]);
  await open(page, 'fb-a');

  await scrivi(page, 'uno');
  await btn(page).click();
  await settle(page);
  await scrivi(page, 'due');
  await clickBtn(page);                 // click forzato su bottone spento
  await settle(page);
  expect(await sent(page)).toEqual([{ id: 'fb-a', userNote: 'uno' }]);

  await page.evaluate(() => window.__ok(0));
  await settle(page);
  // l'owner ha scritto "due" dopo l'invio: la sua correzione non va persa
  await expect(box(page)).toHaveValue('due');
});

test('funzionamento normale: salva, riapre, nessuna modifica', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [fbA({ userNote: '' }), fbB()]);
  await open(page, 'fb-a');

  await scrivi(page, 'grazie della segnalazione');
  await btn(page).click();
  await page.evaluate(() => window.__ok(0));
  await settle(page);
  await expect(msgEl(page)).toHaveText('Salvata');

  await open(page, 'fb-b');
  await open(page, 'fb-a');
  await expect(box(page)).toHaveValue('grazie della segnalazione');

  await btn(page).click();
  await settle(page);
  await expect(msgEl(page)).toHaveText('Nessuna modifica');
  expect((await sent(page)).length).toBe(1);
});

// SPEC TEMPORANEA DI VERIFICA INDIPENDENTE — da cancellare a fine verifica.
// Non riusa nulla degli spec scritti insieme al lavoro.
//
// Bersaglio: la casella "Frase per chi ha segnalato" in filo://manage, e in
// particolare cosa succede quando l'owner esce e rientra dal feedback MENTRE
// il salvataggio e' in volo.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const FBS = [
  { _id: 'A', name: 'Feedback A', text: 'testo A', seq: 900, subSeq: 0, status: 'new',
    clientId: 'a@example.com', createdAt: '2026-06-01T10:00:00Z', images: [], userNote: 'vecchia' },
  { _id: 'B', name: 'Feedback B', text: 'testo B', seq: 901, subSeq: 0, status: 'new',
    clientId: 'b@example.com', createdAt: '2026-06-02T10:00:00Z', images: [], userNote: 'noteB' },
  { _id: 'C', name: 'Feedback C', text: 'testo C', seq: 902, subSeq: 0, status: 'done',
    clientId: 'c@example.com', createdAt: '2026-06-03T10:00:00Z', images: [], userNote: '' },
];

// Prepara la pagina: aspetta la FINE del caricamento vero da Firestore, poi
// installa l'intercettazione del canale verso il main (cosi' nessun
// feedback_update raggiunge davvero il database) e inietta i dati finti.
async function prepara(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  // Il caricamento reale nasconde lo spinner quando ha finito (in un modo o
  // nell'altro): aspettiamolo, altrimenti sovrascrive i dati finti.
  await page.waitForFunction(
    () => document.getElementById('mgListLoading')?.hidden === true,
    null, { timeout: 30000 },
  );

  await page.evaluate((fbs) => {
    const orig = window.filo.message.bind(window.filo);
    window.__vf = { sent: [], gates: [] };
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__vf.sent.push({ id: msg.id, userNote: msg.userNote, keys: Object.keys(msg).sort() });
        return new Promise((resolve) => { window.__vf.gates.push(resolve); });
      }
      return orig(msg);
    };
    // Risolve l'i-esima richiesta ancora in volo.
    window.__vfSettle = (i, val) => { window.__vf.gates[i](val || { ok: true }); };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(JSON.parse(JSON.stringify(fbs)));
  }, FBS);

  return page;
}

const box = (p) => p.locator('#mgUserNoteText');
const btn = (p) => p.locator('#mgUserNoteBtn');
const msg = (p) => p.locator('#mgUserNoteMsg');
const open = (p, id) => p.evaluate((i) => window.__mgTest.openDetail(i), id);
const sent = (p) => p.evaluate(() => window.__vf.sent);
const settle = (p, i, v) => p.evaluate(([i2, v2]) => window.__vfSettle(i2, v2), [i, v]);
const nsent = (p) => p.evaluate(() => window.__vf.sent.length);
const cache = (p, id) => p.evaluate((i) => {
  // Legge lo stato che la pagina si tiene in memoria attraverso il SOLO canale
  // pubblico disponibile: riapre il dettaglio e guarda cosa dipinge.
  window.__mgTest.openDetail(i);
  return document.getElementById('mgUserNoteText').value;
}, id);

test('uscita e rientro durante il salvataggio: la casella NON torna al testo vecchio', async ({ openTab }) => {
  const page = await prepara(openTab);

  await open(page, 'A');
  await expect(box(page)).toHaveValue('vecchia');
  await box(page).fill('nuova');
  await btn(page).click();
  await expect(msg(page)).toHaveText('Salvataggio…');

  // Mentre la risposta e' in volo: esci su B e rientra subito su A.
  await open(page, 'B');
  await expect(box(page)).toHaveValue('noteB');
  await open(page, 'A');

  // La risposta atterra ADESSO.
  await settle(page, 0, { ok: true });
  await expect(msg(page)).toHaveText('Salvata');

  // Il punto della verifica: la casella deve mostrare la frase NUOVA.
  await expect(box(page)).toHaveValue('nuova');

  // E un salvataggio successivo non deve rispedire la vecchia. Con la frase
  // gia' salvata identica, la pagina deve dire "Nessuna modifica" e NON
  // spedire nulla.
  await btn(page).click();
  await expect(msg(page)).toHaveText('Nessuna modifica');
  expect(await sent(page)).toEqual([
    { id: 'A', userNote: 'nuova', keys: ['id', 'type', 'userNote'] },
  ]);

  // Cambio effettivo dopo il giro storto: parte il testo giusto sul feedback giusto.
  await box(page).fill('terza');
  await btn(page).click();
  await settle(page, 1, { ok: true });
  await expect(msg(page)).toHaveText('Salvata');
  expect((await sent(page))[1]).toEqual({ id: 'A', userNote: 'terza', keys: ['id', 'type', 'userNote'] });
});

test('uscite e rientri ripetuti, e rientro DOPO che la risposta e atterrata', async ({ openTab }) => {
  const page = await prepara(openTab);

  await open(page, 'A');
  await box(page).fill('nuova');
  await btn(page).click();

  for (let i = 0; i < 4; i++) {
    await open(page, 'B');
    await open(page, 'C');
    await open(page, 'A');
  }
  await settle(page, 0, { ok: true });
  await expect(msg(page)).toHaveText('Salvata');
  await expect(box(page)).toHaveValue('nuova');

  // Rientro DOPO l'atterraggio (via B, per forzare il ridisegno).
  await open(page, 'B');
  await open(page, 'A');
  await expect(box(page)).toHaveValue('nuova');
  await btn(page).click();
  await expect(msg(page)).toHaveText('Nessuna modifica');
  expect(await nsent(page)).toBe(1);
});

test('rientro + correzione immediata: vince la correzione dell owner, non la risposta in ritardo', async ({ openTab }) => {
  const page = await prepara(openTab);

  await open(page, 'A');
  await box(page).fill('nuova');
  await btn(page).click();

  await open(page, 'B');
  await open(page, 'A');
  // L'owner corregge SUBITO, mentre la risposta e' ancora in volo.
  await box(page).fill('corretta');

  await settle(page, 0, { ok: true });
  // La correzione non deve essere cancellata sotto le dita.
  await expect(box(page)).toHaveValue('corretta');

  // E salvandola deve partire davvero (non "Nessuna modifica").
  await btn(page).click();
  await settle(page, 1, { ok: true });
  await expect(msg(page)).toHaveText('Salvata');
  expect(await sent(page)).toEqual([
    { id: 'A', userNote: 'nuova', keys: ['id', 'type', 'userNote'] },
    { id: 'A', userNote: 'corretta', keys: ['id', 'type', 'userNote'] },
  ]);
  await expect(box(page)).toHaveValue('corretta');
});

test('due salvataggi in volo sullo stesso feedback: comanda l ultimo, non quello che risponde per ultimo', async ({ openTab }) => {
  const page = await prepara(openTab);

  await open(page, 'A');
  await box(page).fill('uno');
  await box(page).press('Enter');
  // Il bottone si disabilita durante l'attesa, ma Invio salva lo stesso: e'
  // questa la strada per avere due invii in volo insieme.
  await box(page).fill('due');
  await box(page).press('Enter');
  expect(await nsent(page)).toBe(2);

  // Le risposte tornano al CONTRARIO: prima la seconda, poi la prima.
  await settle(page, 1, { ok: true });
  await expect(box(page)).toHaveValue('due');
  await settle(page, 0, { ok: true });
  await expect(box(page)).toHaveValue('due');
  await expect(msg(page)).toHaveText('Salvata');

  // Uscita/rientro: quello che si vede deve restare "due".
  await open(page, 'C');
  await open(page, 'A');
  await expect(box(page)).toHaveValue('due');

  // E la pagina deve credere che il valore salvato sia "due": tornare a "uno"
  // deve spedire davvero.
  await box(page).fill('uno');
  await box(page).press('Enter');
  await settle(page, 2, { ok: true });
  await expect(msg(page)).toHaveText('Salvata');
  expect((await sent(page))[2]).toEqual({ id: 'A', userNote: 'uno', keys: ['id', 'type', 'userNote'] });
});

test('salvataggio, uscita e ritorno su un TERZO feedback: il pannello mostra il terzo, non il primo', async ({ openTab }) => {
  const page = await prepara(openTab);

  await open(page, 'A');
  await box(page).fill('nuova');
  await btn(page).click();

  await open(page, 'B');
  await open(page, 'C');           // terzo feedback, frase vuota
  await expect(box(page)).toHaveValue('');

  await settle(page, 0, { ok: true });
  // Il pannello NON deve essere invaso dalla frase di A.
  await expect(box(page)).toHaveValue('');

  // Salvare su C deve mandare la frase di C all'id di C.
  await box(page).fill('perC');
  await btn(page).click();
  await settle(page, 1, { ok: true });
  expect((await sent(page))[1]).toEqual({ id: 'C', userNote: 'perC', keys: ['id', 'type', 'userNote'] });

  // E A resta con la sua frase nuova.
  await open(page, 'A');
  await expect(box(page)).toHaveValue('nuova');
});

test('errore del server in ritardo dopo uscita e rientro: lo dice e non finge di aver salvato', async ({ openTab }) => {
  const page = await prepara(openTab);

  await open(page, 'A');
  await box(page).fill('nuova');
  await btn(page).click();
  await open(page, 'B');
  await open(page, 'A');

  await settle(page, 0, { ok: false, error: 'permesso negato' });
  await expect(msg(page)).toHaveText(/permesso negato/);
  // Il valore mostrato non deve essere quello mai salvato.
  await expect(box(page)).toHaveValue('vecchia');
  await expect(btn(page)).toBeEnabled();

  // Riprovando, la frase riparte davvero.
  await box(page).fill('nuova');
  await btn(page).click();
  await settle(page, 1, { ok: true });
  await expect(msg(page)).toHaveText('Salvata');
  expect((await sent(page))[1]).toEqual({ id: 'A', userNote: 'nuova', keys: ['id', 'type', 'userNote'] });
});

test('errore in ritardo mentre si sta su un ALTRO feedback: non sporca il pannello', async ({ openTab }) => {
  const page = await prepara(openTab);

  await open(page, 'A');
  await box(page).fill('nuova');
  await btn(page).click();
  await open(page, 'B');
  await settle(page, 0, { ok: false, error: 'boom' });
  await expect(msg(page)).toHaveText('');
  await expect(box(page)).toHaveValue('noteB');
});

test('cancellazione della frase con uscita e rientro durante il salvataggio', async ({ openTab }) => {
  const page = await prepara(openTab);

  await open(page, 'A');
  await box(page).fill('');
  await btn(page).click();
  await open(page, 'B');
  await open(page, 'A');
  await settle(page, 0, { ok: true });
  await expect(msg(page)).toHaveText('Frase rimossa');
  await expect(box(page)).toHaveValue('');
  expect((await sent(page))[0]).toEqual({ id: 'A', userNote: '', keys: ['id', 'type', 'userNote'] });

  // Non deve rispedire la vecchia.
  await btn(page).click();
  await expect(msg(page)).toHaveText('Nessuna modifica');
  expect(await nsent(page)).toBe(1);

  // E riscrivendola riparte.
  await box(page).fill('ritorno');
  await btn(page).click();
  await settle(page, 1, { ok: true });
  expect((await sent(page))[1]).toEqual({ id: 'A', userNote: 'ritorno', keys: ['id', 'type', 'userNote'] });
});

test('funzionamento normale: salva, risalva, Nessuna modifica, Invio, spazi', async ({ openTab }) => {
  const page = await prepara(openTab);

  await open(page, 'A');
  await box(page).fill('prima frase');
  await btn(page).click();
  await expect(btn(page)).toBeDisabled();
  await settle(page, 0, { ok: true });
  await expect(msg(page)).toHaveText('Salvata');
  await expect(btn(page)).toBeEnabled();

  // Risalvo uguale: nessuna spedizione.
  await btn(page).click();
  await expect(msg(page)).toHaveText('Nessuna modifica');
  expect(await nsent(page)).toBe(1);

  // Invio salva.
  await box(page).fill('seconda frase');
  await box(page).press('Enter');
  await settle(page, 1, { ok: true });
  await expect(msg(page)).toHaveText('Salvata');
  expect((await sent(page))[1].userNote).toBe('seconda frase');

  // Spazi ai bordi: viene normalizzata e riconosciuta come "uguale".
  await box(page).fill('   seconda frase   ');
  await btn(page).click();
  await expect(msg(page)).toHaveText('Nessuna modifica');
  expect(await nsent(page)).toBe(2);
});

test('il resto del pannello continua a funzionare (preferito, archivia, cambio scheda, ricerca)', async ({ openTab }) => {
  const page = await prepara(openTab);

  await open(page, 'A');
  // Preferito e archivia usano lo stesso canale: catturiamoli come gli altri.
  await page.locator('#mgStarBtn').click();
  await settle(page, 0, { ok: true });
  await expect(page.locator('#mgManageMsg')).toHaveText(/.+/);
  expect((await sent(page))[0].id).toBe('A');
  expect((await sent(page))[0].keys).toContain('starred');

  await page.locator('#mgArchiveBtn').click();
  await settle(page, 1, { ok: true });
  expect((await sent(page))[1].id).toBe('A');

  // Cambio scheda + ricerca: la UI risponde.
  await page.evaluate(() => window.__mgTest.setTab('done'));
  await expect(page.locator('#mgDetail')).toBeHidden();
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mgSearchBar')).toBeHidden();

  // E la casella della frase resta usabile dopo tutto questo.
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await open(page, 'A');
  await expect(page.locator('#mgUserNote')).toBeVisible();
});

test('non-admin: la casella della frase non c e', async ({ openTab }) => {
  const page = await prepara(openTab);
  await page.evaluate(() => { window.__mgTest.setAdmin(false); });
  await open(page, 'A');
  await expect(page.locator('#mgUserNote')).toBeHidden();
});

// #496 — secondo giro di verifica: angoli NON coperti dagli spec esistenti.
//
// Le porte già chiuse nel primo giro si ri-provano qui (una regressione lì
// varrebbe di più di un difetto nuovo): zeri finti quando i dati non ci sono,
// colore delle fette legato al numero di critiche e non alla posizione, stati
// vuoti disegnati, elenco raggiungibile da ogni numero.
//
// E poi porte nuove: date nel futuro, elenco più lungo del tetto, filtro che
// azzera tutto, dati malformati, tasti al posto del mouse.

import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();

const PASS = 'Verifica superata. Provato tutto.';
const CRIT = 'Verifica: 1 rilievo.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n- [1] Cosetta.';
const STOP = "Verifica: 2 rilievi.\nIl lavoro si ferma: c'è un rilievo di livello 2 o 3 che non si può correggere da soli.\n- [3] Perde i dati.";
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0,
  name: o.name !== undefined ? o.name : o.id,
  text: o.text !== undefined ? o.text : `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1',
  createdAt: o.at, status: o.status || 'todo',
  notes: o.notes || '', images: [], priority: o.priority || 0,
  ...(o.extra || {}),
});

async function apri(page, dati, log) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData(d), dati || []);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate((l) => window.__mgTest.setWorkerLog(l), log || []);
}

const shots = () => fs.mkdirSync('tests/.shots', { recursive: true });

// ── 1. La scala dei colori: la fetta «2 critiche» non può essere verde ──────
test('la fetta dice quante critiche col colore, anche se i gruppi sotto sono vuoti', async ({ openTab }) => {
  const page = await openTab(URL);
  // Nessun lavoro passato al primo giro, nessuno con una sola critica: solo
  // due critiche e cinque critiche. Se il colore seguisse la POSIZIONE, la
  // prima fetta prenderebbe il verde di «passata subito».
  const dati = [
    fb({ id: 'due', seq: 1, at: iso(1), status: 'done', notes: `R.${TURNO}${CRIT}${TURNO}${CRIT}${TURNO}${PASS}` }),
    fb({ id: 'cinque', seq: 2, at: iso(1), status: 'done', notes: `R.${TURNO}${CRIT}${TURNO}${CRIT}${TURNO}${CRIT}${TURNO}${CRIT}${TURNO}${CRIT}${TURNO}${PASS}` }),
  ];
  await apri(page, dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  const fette = await page.evaluate(() => [...document.querySelectorAll('#mgStLoopChart [data-group]')]
    .map((p) => ({ g: p.dataset.group, fill: p.getAttribute('fill') })));
  const legenda = await page.locator('#mgStLoopLegend li').allInnerTexts();
  console.log('FETTE:', JSON.stringify(fette), 'LEGENDA:', JSON.stringify(legenda));

  const due = fette.find((f) => f.g === 'loop-2');
  expect(due, 'la fetta «2 critiche» deve esistere').toBeTruthy();
  // #3bbf7a è il verde di «nessuna critica»: la fetta a due critiche non può averlo.
  expect(due.fill.toLowerCase()).not.toBe('#3bbf7a');

  // …e allargando la finestra a un lavoro passato subito, la fetta «2 critiche»
  // deve conservare lo stesso colore di prima.
  await page.evaluate((d) => window.__mgTest.setData(d), [
    ...dati,
    fb({ id: 'zero', seq: 3, at: iso(1), status: 'done', notes: `R.${TURNO}${PASS}` }),
  ]);
  await page.waitForTimeout(200);
  const dopo = await page.evaluate(() => [...document.querySelectorAll('#mgStLoopChart [data-group]')]
    .map((p) => ({ g: p.dataset.group, fill: p.getAttribute('fill') })));
  console.log('FETTE DOPO:', JSON.stringify(dopo));
  expect(dopo.find((f) => f.g === 'loop-2').fill).toBe(due.fill);
  expect(dopo.find((f) => f.g === 'loop-0').fill.toLowerCase()).toBe('#3bbf7a');
});

// ── 2. Niente zeri finti quando i feedback non sono arrivati ────────────────
test('feedback non caricati: la scheda non scrive zeri, dice che il dato manca', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  // NIENTE setData: la lista non è mai arrivata.
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.waitForTimeout(300);

  const stato = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    lavorati: document.querySelector('#mgStTileLavorati [data-num]').textContent,
    avviso: (() => { const n = document.getElementById('mgStNoData'); return n && !n.hidden ? n.textContent.trim() : ''; })(),
    corpoNascosto: document.getElementById('mgStBody').hidden,
  }));
  console.log('SENZA DATI:', JSON.stringify(stato));
  expect(stato.ricevuti).not.toBe('0');
  expect(stato.lavorati).not.toBe('0');
  expect(stato.avviso.length).toBeGreaterThan(0);
  shots();
  await page.screenshot({ path: 'tests/.shots/496g2-senza-dati.png', fullPage: true });
});

// ── 3. Finestra vuota: gli stati vuoti sono disegnati? ──────────────────────
test('finestra senza niente: nessuna frase doppia, nessun rettangolo muto', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [fb({ id: 'vecchio', seq: 1, at: iso(300), status: 'done' })]);
  await page.locator('.mg-st-chip[data-window="today"]').click();
  await page.waitForTimeout(250);

  const vuoto = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    frasiCreatori: [...document.querySelectorAll('#mgStCreatorRows li, #mgStCreatorEmpty')]
      .filter((e) => !e.hidden).map((e) => e.textContent.trim()),
    torteNascoste: document.getElementById('mgStPies').hidden,
    loopEmpty: (() => { const e = document.getElementById('mgStLoopEmpty'); return e && !e.hidden ? e.textContent.trim() : ''; })(),
    tagliata: [...document.querySelectorAll('#mgStCreatorRows .mg-st-row-label')]
      .some((e) => e.scrollWidth > e.clientWidth + 1),
  }));
  console.log('FINESTRA VUOTA:', JSON.stringify(vuoto, null, 1));
  expect(vuoto.ricevuti).toBe('0');
  // La frase del vuoto una volta sola, e non dentro la colonna stretta.
  expect(vuoto.frasiCreatori.length).toBeLessThanOrEqual(1);
  expect(vuoto.tagliata).toBe(false);
  // Le torte non lasciano un rettangolo vuoto: si tolgono e resta la frase.
  expect(vuoto.torteNascoste).toBe(true);
  expect(vuoto.loopEmpty.length).toBeGreaterThan(0);
  shots();
  await page.screenshot({ path: 'tests/.shots/496g2-finestra-vuota.png', fullPage: true });
});

// ── 4. Tutti passati al primo giro: la seconda torta non è un quadrato muto ─
test('nessuna critica: la seconda torta lo dice invece di restare vuota', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${TURNO}${PASS}` }),
    fb({ id: 'b', seq: 2, at: iso(2), status: 'done', notes: `R.${TURNO}${PASS}` }),
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  const s = await page.evaluate(() => ({
    torteVisibili: !document.getElementById('mgStPies').hidden,
    fetteLoop: document.querySelectorAll('#mgStLoopChart [data-group]').length,
    fetteEsito: document.querySelectorAll('#mgStOutcomeChart [data-group]').length,
    frase: (() => { const e = document.getElementById('mgStOutcomeEmpty'); return e && !e.hidden ? e.textContent.trim() : ''; })(),
  }));
  console.log('SENZA CRITICHE:', JSON.stringify(s));
  expect(s.fetteEsito).toBe(0);
  expect(s.frase.length).toBeGreaterThan(0);
});

// ── 5. HTML e script nei titoli: si vedono come testo, non si eseguono ──────
test('titoli con HTML e script: testo, mai codice', async ({ openTab }) => {
  const page = await openTab(URL);
  const cattivo = '<img src=x onerror="window.__bau=1"><script>window.__bau=1</script>';
  await apri(page, [
    fb({ id: 'x', seq: 1, at: iso(1), status: 'todo', name: cattivo }),
    fb({ id: 'y', seq: 2, at: iso(1), status: 'todo', name: 'a'.repeat(10000) }),
    fb({ id: 'z', seq: 3, at: iso(1), status: 'todo', name: '🙂🙂🙂 ünïcode "virgolette" & <b>' }),
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  await page.locator('#mgStDrawer .mg-st-row[data-open]').first().click();
  await expect(page.locator('#mgStDrawer .mg-st-item[data-id]').first()).toBeVisible();

  const esito = await page.evaluate(() => ({
    bau: window.__bau || null,
    img: document.querySelectorAll('#mgStDrawer img').length,
    script: document.querySelectorAll('#mgStDrawer script').length,
    testi: [...document.querySelectorAll('#mgStDrawer .mg-st-item-title')].map((e) => e.textContent.slice(0, 40)),
    sbordo: document.documentElement.scrollWidth - window.innerWidth,
  }));
  console.log('INIEZIONE:', JSON.stringify(esito));
  expect(esito.bau).toBe(null);
  expect(esito.img).toBe(0);
  expect(esito.script).toBe(0);
  expect(esito.sbordo).toBeLessThanOrEqual(1);
  shots();
  await page.screenshot({ path: 'tests/.shots/496g2-titoli-cattivi.png', fullPage: true });
});

// ── 6. Dati malformati: la scheda non muore ────────────────────────────────
test('feedback rotti (senza data, data assurda, campi mancanti): la scheda regge', async ({ openTab }) => {
  const page = await openTab(URL);
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  await apri(page, [
    fb({ id: 'ok', seq: 1, at: iso(1), status: 'done', notes: `R.${TURNO}${PASS}` }),
    { _id: 'senzadata', seq: 2, name: 'senza data', status: 'todo', clientId: 'x' },
    { _id: 'datamarcia', seq: 3, name: 'data marcia', createdAt: 'non-e-una-data', status: 'todo', clientId: 'x' },
    { _id: 'statoinventato', seq: 4, name: 'stato inventato', createdAt: iso(1), status: 'ZZZ_non_esiste', clientId: 'x' },
    { _id: 'futuro', seq: 5, name: 'dal futuro', createdAt: new Date(ORA.getTime() + 400 * 86400000).toISOString(), status: 'todo', clientId: 'x' },
    { _id: 'prioassurda', seq: 6, name: 'priorità assurda', createdAt: iso(1), status: 'todo', priority: 99, clientId: 'x' },
    { _id: 'notenumero', seq: 7, name: 'note numero', createdAt: iso(1), status: 'todo', notes: 12345, clientId: 'x' },
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    righe: [...document.querySelectorAll('#mgStHealthRows .mg-st-row')].map((e) => e.textContent.trim()),
    nan: document.getElementById('panel-fbstats').innerText.includes('NaN'),
    undef: document.getElementById('panel-fbstats').innerText.includes('undefined'),
  }));
  console.log('MALFORMATI:', JSON.stringify(s, null, 1), 'ERRORI:', JSON.stringify(errori));
  expect(errori).toEqual([]);
  expect(s.nan).toBe(false);
  expect(s.undef).toBe(false);

  // «Sempre»: il feedback datato nel futuro entra nei conti — l'andamento lo
  // deve mettere in una barretta che l'etichetta nomina davvero.
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(200);
  const spark = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    somma: [...document.querySelectorAll('#mgStSpark .mg-st-spark-bar')]
      .reduce((n, b) => n + Number((b.title.match(/:\s*(\d+)$/) || [])[1] || 0), 0),
    asse: document.getElementById('mgStSparkAxis').innerText,
    ultimaBarra: (() => { const b = [...document.querySelectorAll('#mgStSpark .mg-st-spark-bar')].pop(); return b ? b.title : ''; })(),
  }));
  console.log('SPARK SEMPRE:', JSON.stringify(spark));
});

// ── 7. Elenco più lungo del tetto: il taglio si dichiara ────────────────────
test('tanti feedback dietro un numero: il taglio dell elenco è scritto, non muto', async ({ openTab }) => {
  const page = await openTab(URL);
  const tanti = [];
  for (let i = 0; i < 260; i += 1) tanti.push(fb({ id: `f${i}`, seq: 1000 + i, at: iso(1), status: 'todo' }));
  await apri(page, tanti);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  await page.locator('#mgStDrawer .mg-st-row[data-open]').first().click();
  const s = await page.evaluate(() => ({
    mostrate: document.querySelectorAll('#mgStDrawer .mg-st-item[data-id]').length,
    nota: (() => { const n = document.querySelector('#mgStDrawer .mg-st-item--nota'); return n ? n.textContent.trim() : ''; })(),
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
  }));
  console.log('TETTO ELENCO:', JSON.stringify(s));
  expect(s.mostrate).toBeGreaterThan(0);
  if (s.mostrate < 260) expect(s.nota).toMatch(/\d/);
});

// ── 8. Filtro che azzera tutto: le esecuzioni seguono il filtro ─────────────
test('«Persone»: le esecuzioni delle routine spariscono col filtro, non restano a contraddirlo', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'todo', clientId: 'owner:pino' }),
    fb({ id: 'b', seq: 2, at: iso(1), status: 'todo', clientId: 'routine:prober' }),
  ], [
    { role: 'prober', startedAt: iso(1), num: '' },
    { role: 'verifier', startedAt: iso(1), num: '#1' },
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  const tutti = await page.locator('#mgStTileProber [data-num]').innerText();
  await page.locator('.mg-st-chip[data-group="persone"]').click();
  await page.waitForTimeout(200);
  const persone = await page.evaluate(() => ({
    prober: document.querySelector('#mgStTileProber [data-num]').textContent,
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    riga: document.getElementById('mgStRange').textContent,
  }));
  console.log('TUTTI prober:', tutti, '→ PERSONE:', JSON.stringify(persone));
  expect(persone.prober).toBe('0');
  expect(persone.ricevuti).toBe('1');

  // «Routine cloud» in un clic solo.
  await page.locator('.mg-st-chip[data-group="cloud"]').click();
  await page.waitForTimeout(200);
  const cloud = await page.evaluate(() => ({
    prober: document.querySelector('#mgStTileProber [data-num]').textContent,
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
  }));
  console.log('CLOUD:', JSON.stringify(cloud));
  expect(cloud.ricevuti).toBe('1');
});

// ── 9. Tastiera: quello che si fa col mouse si fa coi tasti ────────────────
test('tastiera: le righe e le voci di legenda si aprono con Invio', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${TURNO}${PASS}` }),
    fb({ id: 'b', seq: 2, at: iso(1), status: 'todo' }),
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  const riga = page.locator('#mgStDrawer .mg-st-row[data-open]').first();
  await riga.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const apertoConTasti = await page.locator('#mgStDrawer .mg-st-item[data-id]').count();
  console.log('RIGA CON INVIO → voci:', apertoConTasti);
  expect(apertoConTasti).toBeGreaterThan(0);

  // Voce di legenda della torta: stessa cosa.
  const voce = page.locator('#mgStLoopLegend li[data-open]').first();
  if (await voce.count()) {
    await voce.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    console.log('LEGENDA CON INVIO → voci:', await page.locator('#mgStLoopLegend .mg-st-item[data-id]').count());
    expect(await page.locator('#mgStLoopLegend .mg-st-item[data-id]').count()).toBeGreaterThan(0);
  }
});

// ── 10. Finestra personalizzata assurda e una data sola ────────────────────
test('date personalizzate: dal 1900, invertite, una sola — i conti restano onesti', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'todo' }),
    fb({ id: 'b', seq: 2, at: iso(400), status: 'todo' }),
  ]);
  const oggi = new Date().toISOString().slice(0, 10);

  // Dal 1900 a oggi: l'ultima barretta deve arrivare davvero a oggi.
  await page.evaluate((o) => window.__mgTest.setStatsWindow('custom', '1900-01-01', o), oggi);
  await page.waitForTimeout(250);
  const lungo = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    asse: document.getElementById('mgStSparkAxis').innerText,
    ultima: (() => { const b = [...document.querySelectorAll('#mgStSpark .mg-st-spark-bar')].pop(); return b ? b.title : ''; })(),
    barre: document.querySelectorAll('#mgStSpark .mg-st-spark-bar').length,
    desc: document.getElementById('mgStSparkDesc').textContent,
  }));
  console.log('DAL 1900:', JSON.stringify(lungo, null, 1));
  expect(lungo.ricevuti).toBe('2');
  const annoOggi = String(new Date().getFullYear());
  expect(lungo.asse, "l'asse deve arrivare all'anno di oggi").toContain(annoOggi);

  // Invertite: si raddrizzano.
  const ieri = new Date(ORA.getTime() - 86400000).toISOString().slice(0, 10);
  await page.evaluate((d) => window.__mgTest.setStatsWindow('custom', d.oggi, d.ieri), { oggi, ieri });
  await page.waitForTimeout(200);
  console.log('INVERTITE → ricevuti:', await page.locator('#mgStTileRicevuti [data-num]').innerText(),
    '| riga:', await page.locator('#mgStRange').innerText());

  // Una sola data: non è un errore.
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '', ''));
  await page.waitForTimeout(200);
  const nessuna = await page.evaluate(() => ({
    avviso: (() => { const w = document.getElementById('mgStWarn'); return w && !w.hidden ? w.textContent.trim() : ''; })(),
  }));
  console.log('NESSUNA DATA:', JSON.stringify(nessuna));
  expect(nessuna.avviso.length).toBeGreaterThan(0);
});

// ── 11. Cambi rapidi e doppi clic ─────────────────────────────────────────
test('venti cambi di finestra e doppi clic sulle tessere: i numeri restano coerenti', async ({ openTab }) => {
  const page = await openTab(URL);
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${TURNO}${CRIT}${TURNO}${PASS}` }),
    fb({ id: 'b', seq: 2, at: iso(40), status: 'todo' }),
  ]);
  const chiavi = ['today', '7d', '30d', '90d', '365d', 'all'];
  for (let i = 0; i < 20; i += 1) {
    await page.locator(`.mg-st-chip[data-window="${chiavi[i % chiavi.length]}"]`).click({ timeout: 5000 });
  }
  await page.locator('.mg-st-chip[data-window="all"]').click();
  await page.waitForTimeout(300);
  const dopo = await page.locator('#mgStTileRicevuti [data-num]').innerText();
  await page.locator('#mgStTileRicevuti').dblclick();
  await page.locator('#mgStTileLavorati').dblclick();
  await page.locator('#mgStTileProber').dblclick();
  await page.waitForTimeout(300);
  const finale = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    aperti: [...document.querySelectorAll('.mg-st-tile')].filter((t) => t.getAttribute('aria-expanded') === 'true').length,
  }));
  console.log('RAFFICA → dopo:', dopo, 'finale:', JSON.stringify(finale), 'errori:', JSON.stringify(errori));
  expect(errori).toEqual([]);
  expect(finale.ricevuti).toBe('2');
  expect(finale.aperti).toBeLessThanOrEqual(1);
});

// ── 11b. Da OGNI riga si arriva davvero alla segnalazione ─────────────────
test('il salto alla segnalazione funziona da ogni categoria, illeggibili compresi', async ({ openTab }) => {
  const page = await openTab(URL);
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  await apri(page, [
    fb({ id: 'att', seq: 1, at: iso(1), status: 'attack', name: 'un attacco' }),
    fb({ id: 'spm', seq: 2, at: iso(1), status: 'spam', name: 'uno spam' }),
    fb({ id: 'arc', seq: 3, at: iso(1), status: 'archived', name: 'un archiviato' }),
    fb({ id: 'cnf', seq: 4, at: iso(1), status: 'attack_confirmed', name: 'attacco confermato' }),
    // Stato illeggibile: nessun `status` in chiaro e un payload cifrato che
    // questo computer non sa aprire.
    { _id: 'ill', seq: 5, subSeq: 0, name: 'illeggibile', text: 'x', clientId: 'utente-esterno-1', createdAt: iso(1), images: [], cipher: 'v1:xxxx', notes: '' },
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();

  const righe = await page.locator('#mgStDrawer .mg-st-row[data-open]').count();
  console.log('RIGHE APRIBILI:', righe,
    JSON.stringify(await page.locator('#mgStDrawer .mg-st-row').allInnerTexts()));
  expect(righe).toBeGreaterThan(0);

  for (let i = 0; i < righe; i += 1) {
    // Ogni giro riparte dalla scheda statistiche: il salto porta via.
    await page.locator('.mg-tab[data-tab="fbstats"]').click();
    await page.waitForTimeout(150);
    if (await page.locator('#mgStDrawer .mg-st-row[data-open]').count() === 0) {
      await page.locator('#mgStTileRicevuti').click();
      await page.waitForTimeout(150);
    }
    const riga = page.locator('#mgStDrawer .mg-st-row[data-open]').nth(i);
    const etichetta = (await riga.innerText()).replace(/\s+/g, ' ').trim();
    await riga.click();
    await page.waitForTimeout(150);
    const voce = page.locator('#mgStDrawer .mg-st-item[data-id]').first();
    if (!(await voce.count())) { console.log(`RIGA «${etichetta}» → nessuna voce`); continue; }
    const id = await voce.getAttribute('data-id');
    await voce.click();
    await page.waitForTimeout(400);
    const esito = await page.evaluate(() => ({
      lista: document.getElementById('panel-list').classList.contains('mg-panel--active'),
      dettaglio: (() => { const d = document.getElementById('mgDetail'); return !!d && !d.hidden && d.offsetHeight > 0; })(),
      scheda: (document.querySelector('.mg-tab--active') || {}).textContent,
      selezionato: !!document.querySelector('.mg-item--active, .mg-item.mg-item--sel'),
    }));
    console.log(`RIGA «${etichetta}» → id ${id}:`, JSON.stringify(esito));
    expect(esito.lista, `«${etichetta}»: il clic deve portare alla lista`).toBe(true);
    expect(esito.dettaglio, `«${etichetta}»: il dettaglio deve aprirsi`).toBe(true);
  }
  expect(errori).toEqual([]);
});

// ── 12. I filtri si ritrovano riaprendo la scheda ─────────────────────────
test('i filtri scelti si ritrovano tornando sulla scheda', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'todo', clientId: 'owner:pino' }),
    fb({ id: 'b', seq: 2, at: iso(1), status: 'todo', clientId: 'routine:prober' }),
  ]);
  await page.locator('.mg-st-chip[data-window="7d"]').click();
  await page.locator('.mg-st-chip[data-group="persone"]').click();
  await page.waitForTimeout(300);
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await page.waitForTimeout(200);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => ({
    finestra: (document.querySelector('.mg-st-chip[data-window][aria-pressed="true"]') || {}).dataset?.window,
    gruppo: (document.querySelector('.mg-st-chip[data-group][aria-pressed="true"]') || {}).dataset?.group,
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
  }));
  console.log('FILTRI RITROVATI:', JSON.stringify(s));
  expect(s.finestra).toBe('7d');
  expect(s.gruppo).toBe('persone');
});

// ── 13. I dati che ARRIVANO mentre la scheda è già aperta ──────────────────
//
// Il primo giro aveva chiesto che la scheda non scrivesse zeri finti mentre i
// feedback non ci sono. La frase c'è, ma è disegnata da `stRender`, e `stRender`
// gira solo all'APERTURA della scheda: chi apre le statistiche mentre la lista
// sta ancora arrivando resta con quella frase addosso anche dopo che i feedback
// sono arrivati.
test('i feedback arrivano mentre la scheda è già aperta: i numeri compaiono?', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());

  // Si apre la scheda PRIMA che i feedback ci siano: è quello che succede a chi
  // entra in gestione e clicca subito «Statistiche feedback».
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  const durante = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    avviso: (() => { const n = document.getElementById('mgStNoData'); return n && !n.hidden ? n.textContent.trim() : ''; })(),
  }));
  console.log('MENTRE CARICA:', JSON.stringify(durante));

  // …e ora i feedback arrivano.
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${TURNO}${PASS}` }),
    fb({ id: 'b', seq: 2, at: iso(1), status: 'todo' }),
    fb({ id: 'c', seq: 3, at: iso(2), status: 'working' }),
  ]);
  await page.waitForTimeout(1500);

  const dopo = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    lavorati: document.querySelector('#mgStTileLavorati [data-num]').textContent,
    avviso: (() => { const n = document.getElementById('mgStNoData'); return n && !n.hidden ? n.textContent.trim() : ''; })(),
    corpoNascosto: document.getElementById('mgStBody').hidden,
  }));
  console.log('DOPO L ARRIVO:', JSON.stringify(dopo));
  shots();
  await page.screenshot({ path: 'tests/.shots/496g2-dati-arrivati-dopo.png', fullPage: true });

  expect(dopo.avviso, 'la frase «sto caricando» deve sparire quando i dati arrivano').toBe('');
  expect(dopo.corpoNascosto, 'il corpo della scheda deve ricomparire').toBe(false);
  expect(dopo.ricevuti).toBe('3');
});

// ── 14. Il guasto che si dichiara mentre la scheda è già aperta ────────────
test('il caricamento fallisce mentre la scheda è aperta: lo dice, o resta «sto caricando»?', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);

  await page.evaluate(() => window.__mgTest.simulaCaricamentoFallito());
  await page.waitForTimeout(1200);
  const s = await page.evaluate(() => ({
    avviso: (() => { const n = document.getElementById('mgStNoData'); return n && !n.hidden ? n.textContent.trim() : ''; })(),
  }));
  console.log('GUASTO A SCHEDA APERTA:', JSON.stringify(s));
  // Il guasto non si legge come «sto ancora caricando»: uno dice «riprova fra
  // poco», l'altro dice «questo numero non arriverà».
  expect(s.avviso).toMatch(/non si sono caricati|dato che manca/i);
});

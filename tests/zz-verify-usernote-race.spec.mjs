// SPEC TEMPORANEA DI VERIFICA — da cancellare a fine verifica.
// Prove indipendenti su: correzione della frase durante il salvataggio in volo,
// e sul preferito (stella) con risposta in ritardo + cambio di selezione.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fbFix(id, seq, extra = {}) {
  return {
    _id: id,
    text: `Testo del feedback ${seq}`,
    name: `Titolo ${seq}`,
    seq,
    subSeq: 0,
    clientId: `tester${seq}@example.com`,
    createdAt: '2026-08-18T10:00:00Z',
    images: [],
    status: 'done',
    statusPublic: 'closed',
    notes: 'Report della lavorazione.',
    ...extra,
  };
}

// Aspetta la fine del caricamento VERO da Firestore, poi installa un canale
// controllabile: ogni feedback_update resta appeso finché il test non lo
// risolve/rifiuta a mano.
async function boot(page, fbs, tab = 'resolved') {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.waitForFunction(
    () => document.getElementById('mgListLoading')?.hidden === true,
    null,
    { timeout: 60000 },
  );
  await page.evaluate(() => {
    window.__q = [];
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(JSON.parse(JSON.stringify(msg)));
        return new Promise((res, rej) => { window.__q.push({ msg, res, rej }); });
      }
      return orig(msg);
    };
    window.__resolveAt = (i, val) => { window.__q[i].res(val === undefined ? { ok: true } : val); };
    window.__rejectAt  = (i, m) => { window.__q[i].rej(new Error(m || 'boom dal server')); };
    window.__pending   = () => window.__q.length;
  });
  await page.evaluate(({ list, t }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(list);
    window.__mgTest.setTab(t);
  }, { list: fbs, t: tab });
}

const open = (page, id) => page.evaluate((i) => window.__mgTest.openDetail(i), id);
const waitPending = (page, n) => page.waitForFunction((k) => window.__pending() === k, n);
const resolveAt = (page, i, v) => page.evaluate(({ i, v }) => window.__resolveAt(i, v), { i, v });
const rejectAt  = (page, i, m) => page.evaluate(({ i, m }) => window.__rejectAt(i, m), { i, m });
const updates   = (page) => page.evaluate(() => window.__updates);
const localNote = (page, id) => page.evaluate((i) => {
  // legge il modello locale attraverso il render: apre e richiude non serve,
  // usiamo il campo dopo una riapertura del dettaglio.
  return i;
}, id);

// ───────────────────────── 1. correzione durante il salvataggio ─────────────

test('la correzione scritta mentre il salvataggio è in volo NON viene cancellata quando la risposta atterra', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('a1', 901)]);
  await open(page, 'a1');

  const campo = page.locator('#mgUserNoteText');
  await expect(campo).toBeVisible();

  await campo.fill('Sistemto, grazie');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 1);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvataggio…');

  // l'owner si accorge del refuso mentre la risposta è ancora in volo
  await campo.fill('Sistemato, grazie');
  await resolveAt(page, 0);

  // pre-condizione: senza la guardia, qui tornerebbe "Sistemto, grazie"
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  await expect(campo).toHaveValue('Sistemato, grazie');

  // nessuno stato incastrato: si può risalvare, e parte il testo CORRETTO
  await expect(page.locator('#mgUserNoteBtn')).toBeEnabled();
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 2);
  await resolveAt(page, 1);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');

  const u = await updates(page);
  expect(u.map((x) => x.userNote)).toEqual(['Sistemto, grazie', 'Sistemato, grazie']);
  // verso Firestore parte SOLO la frase
  expect(Object.keys(u[1]).sort()).toEqual(['id', 'type', 'userNote']);
  expect(u[1].id).toBe('a1');
});

test('correzione parziale, cancellazione totale e incolla durante il volo: vince sempre quello che ha in mano l\'owner', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('a2', 902, { userNote: 'frase iniziale' })]);
  await open(page, 'a2');
  const campo = page.locator('#mgUserNoteText');
  await expect(campo).toHaveValue('frase iniziale');

  // (a) correzione parziale: aggiunta in coda con la tastiera
  await campo.fill('Risolto nella versione');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 1);
  await campo.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 1.2.3');
  await resolveAt(page, 0);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  await expect(campo).toHaveValue('Risolto nella versione 1.2.3');

  // (b) cancellazione totale durante il volo
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 2);
  await campo.fill('');
  await resolveAt(page, 1);
  await expect(campo).toHaveValue('');
  // e la frase vuota è comunque salvabile → "Frase rimossa"
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 3);
  await resolveAt(page, 2);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Frase rimossa');

  // (c) incolla durante il volo (paste vero, via clipboard del renderer)
  await campo.fill('bozza');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 4);
  await page.evaluate(() => {
    const el = document.getElementById('mgUserNoteText');
    el.focus(); el.select();
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Testo incollato dagli appunti');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    // il browser applicherebbe l'incolla: qui lo simuliamo sul value
    el.value = 'Testo incollato dagli appunti';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await resolveAt(page, 3);
  await expect(campo).toHaveValue('Testo incollato dagli appunti');

  const u = await updates(page);
  expect(u.map((x) => x.userNote)).toEqual([
    'Risolto nella versione',            // il primo salvataggio parte col testo di allora
    'Risolto nella versione 1.2.3',      // il secondo parte con la correzione, com'è giusto
    '',                                  // la frase svuotata
    'bozza',
  ]);
});

// ── sonde aggiuntive: dove mi sembra fragile ───────────────────────────────

test('SONDA: salvo, cambio feedback e TORNO INDIETRO prima che la risposta atterri', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('d1', 981, { userNote: 'frase vecchia' }), fbFix('d2', 982)]);
  await open(page, 'd1');
  const campo = page.locator('#mgUserNoteText');
  await expect(campo).toHaveValue('frase vecchia');

  await campo.fill('frase nuova');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 1);

  await open(page, 'd2');          // vado altrove…
  await open(page, 'd1');          // …e torno indietro, sempre in volo
  await expect(campo).toHaveValue('frase vecchia');   // ridipinto col dato non ancora aggiornato

  await resolveAt(page, 0);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');

  // CONSEGUENZA CONCRETA: se la casella resta sulla frase vecchia, il
  // salvataggio successivo rimanda al mittente la frase vecchia, disfacendo
  // in silenzio quella appena salvata.
  const mostrato = await campo.inputValue();
  await page.click('#mgUserNoteBtn');
  await page.waitForTimeout(300);
  const dopo = await page.evaluate(() => window.__pending());
  const u = await updates(page);
  console.log('[SONDA ritorno] mostrato in casella:', JSON.stringify(mostrato),
    '| richieste partite:', JSON.stringify(u.map((x) => x.userNote)));
  expect(mostrato, 'la casella deve mostrare la frase davvero salvata').toBe('frase nuova');
  expect(dopo, 'un secondo Salva non deve rimandare la frase vecchia').toBe(1);
});

test('SONDA: la stella nello STESSO giro (via, e ritorno prima della risposta)', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('d6', 986), fbFix('d7', 987)]);
  await open(page, 'd6');
  const stella = page.locator('#mgStarBtn');
  await stella.click();
  await waitPending(page, 1);
  await open(page, 'd7');
  await open(page, 'd6');
  await resolveAt(page, 0);
  await page.waitForTimeout(250);
  // la stella si riallinea da sola al ritorno: è la simmetria che manca alla frase
  await expect(stella).toHaveText('★ Preferito');
  await expect(stella).toHaveAttribute('aria-pressed', 'true');
});

test('SONDA: doppio salvataggio ravvicinato (click + Invio) mentre il primo è in volo', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('d3', 983)]);
  await open(page, 'd3');
  const campo = page.locator('#mgUserNoteText');

  await campo.fill('primo');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 1);
  await campo.fill('secondo');
  await campo.press('Enter');                 // il bottone è disabilitato, l'Invio no
  const inVolo = await page.evaluate(() => window.__pending());

  if (inVolo === 2) {
    // due richieste concorrenti: le risolvo AL CONTRARIO (la prima atterra dopo)
    await resolveAt(page, 1);
    await resolveAt(page, 0);
    await page.waitForTimeout(200);
    await expect(campo).toHaveValue('secondo');
    // e il modello locale non deve essere rimasto indietro: risalvando
    // non deve dire "Nessuna modifica" su un valore diverso da quello salvato
    await page.click('#mgUserNoteBtn');
    await page.waitForTimeout(200);
    const dopo = await page.evaluate(() => window.__pending());
    if (dopo > 2) await resolveAt(page, 2);
    const u = await updates(page);
    expect(u[u.length - 1].userNote).toBe('secondo');
  } else {
    // l'Invio è stato ignorato durante il volo: va benissimo
    await resolveAt(page, 0);
    await expect(campo).toHaveValue('secondo');
  }
  await expect(page.locator('#mgUserNoteBtn')).toBeEnabled();
});

test('SONDA: salvare due volte lo stesso testo dice "Nessuna modifica" e non riparte', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('d4', 984)]);
  await open(page, 'd4');
  const campo = page.locator('#mgUserNoteText');
  await campo.fill('identica');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 1);
  await resolveAt(page, 0);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  await page.click('#mgUserNoteBtn');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Nessuna modifica');
  expect(await page.evaluate(() => window.__pending())).toBe(1);
});

test('SONDA: preferito premuto due volte con risposte fuori ordine', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('d5', 985)]);
  await open(page, 'd5');
  const stella = page.locator('#mgStarBtn');

  await stella.click();
  await waitPending(page, 1);
  await expect(stella).toBeDisabled();     // niente doppio invio dallo stesso bottone
  await resolveAt(page, 0);
  await expect(stella).toHaveText('★ Preferito');
  await stella.click();
  await waitPending(page, 2);
  await resolveAt(page, 1);
  await expect(stella).toHaveText('☆ Preferito');
  const u = await updates(page);
  expect(u.map((x) => x.starred)).toEqual([true, false]);
});

test('due correzioni di fila durante lo stesso volo, e con l\'invio da tastiera', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('a3', 903)]);
  await open(page, 'a3');
  const campo = page.locator('#mgUserNoteText');

  await campo.fill('uno');
  await campo.press('Enter');            // salvataggio con Invio
  await waitPending(page, 1);
  await campo.fill('due');
  await campo.fill('tre');               // seconda correzione di fila
  await resolveAt(page, 0);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  await expect(campo).toHaveValue('tre');

  await campo.press('Enter');
  await waitPending(page, 2);
  await resolveAt(page, 1);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  const u = await updates(page);
  expect(u.map((x) => x.userNote)).toEqual(['uno', 'tre']);
});

test('errore in ritardo durante una correzione: il testo corretto resta e si può risalvare', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('a4', 904)]);
  await open(page, 'a4');
  const campo = page.locator('#mgUserNoteText');

  await campo.fill('prima stesura');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 1);
  await campo.fill('seconda stesura');
  await rejectAt(page, 0, 'rete assente');

  await expect(page.locator('#mgUserNoteMsg')).toHaveText('rete assente');
  await expect(campo).toHaveValue('seconda stesura');
  await expect(page.locator('#mgUserNoteBtn')).toBeEnabled();

  await page.click('#mgUserNoteBtn');
  await waitPending(page, 2);
  await resolveAt(page, 1);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  const u = await updates(page);
  expect(u.map((x) => x.userNote)).toEqual(['prima stesura', 'seconda stesura']);
});

test('correzione + cambio di feedback: la frase di uno non finisce nella casella dell\'altro', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('b1', 911, { userNote: 'nota di B1' }), fbFix('b2', 912, { userNote: 'nota di B2' })]);
  await open(page, 'b1');
  const campo = page.locator('#mgUserNoteText');
  await expect(campo).toHaveValue('nota di B1');

  await campo.fill('frase per il mittente di B1');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 1);

  // l'owner passa all'altro feedback mentre la risposta è in volo, e ci scrive
  await open(page, 'b2');
  await expect(campo).toHaveValue('nota di B2');
  await campo.fill('frase per il mittente di B2');

  await resolveAt(page, 0);              // risposta di B1 in ritardo
  await page.waitForTimeout(200);
  await expect(campo).toHaveValue('frase per il mittente di B2');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('');

  // salvando ora parte la frase di B2, sull'id di B2
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 2);
  await resolveAt(page, 1);
  const u = await updates(page);
  expect(u[0]).toMatchObject({ id: 'b1', userNote: 'frase per il mittente di B1' });
  expect(u[1]).toMatchObject({ id: 'b2', userNote: 'frase per il mittente di B2' });

  // e riaprendo B1 la sua frase è quella salvata per lui
  await open(page, 'b1');
  await expect(campo).toHaveValue('frase per il mittente di B1');
  await open(page, 'b2');
  await expect(campo).toHaveValue('frase per il mittente di B2');
});

test('errore in ritardo su un feedback: non compare sul feedback aperto nel frattempo', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('c1', 921), fbFix('c2', 922)]);
  await open(page, 'c1');
  const campo = page.locator('#mgUserNoteText');
  await campo.fill('frase di C1');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 1);

  await open(page, 'c2');
  await rejectAt(page, 0, 'permesso negato');
  await page.waitForTimeout(200);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('');
  await expect(page.locator('#mgUserNoteBtn')).toBeEnabled();
});

// ───────────────────────── 2. il preferito (stella) ─────────────────────────

test('preferito: esito in ritardo (successo ED errore) non atterra sul feedback aperto nel frattempo', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('s1', 931), fbFix('s2', 932)]);
  const msg = page.locator('#mgManageMsg');
  const stella = page.locator('#mgStarBtn');

  // --- ERRORE in ritardo, con cambio di selezione ---
  await open(page, 's1');
  await expect(stella).toHaveText('☆ Preferito');
  await stella.click();
  await waitPending(page, 1);
  await expect(msg).toHaveText('Aggiungo ai preferiti…');

  await open(page, 's2');
  await expect(msg).toHaveText('');
  await rejectAt(page, 0, 'preferito rifiutato dal server');
  await page.waitForTimeout(250);
  // pre-condizione: senza la guardia qui si leggerebbe l'errore di s1 su s2
  await expect(msg).toHaveText('');
  await expect(stella).toHaveText('☆ Preferito');   // s2 non è preferito
  await expect(stella).toBeEnabled();

  // --- SUCCESSO in ritardo, con cambio di selezione ---
  await open(page, 's1');
  await stella.click();
  await waitPending(page, 2);
  await open(page, 's2');
  await resolveAt(page, 1);
  await page.waitForTimeout(250);
  await expect(msg).toHaveText('');
  await expect(stella).toHaveText('☆ Preferito');   // il pannello resta quello di s2
  await expect(stella).toHaveAttribute('aria-pressed', 'false');

  // il dato però è stato salvato davvero: riaprendo s1 la stella è accesa
  await open(page, 's1');
  await expect(stella).toHaveText('★ Preferito');
  await expect(stella).toHaveAttribute('aria-pressed', 'true');
});

test('preferito: senza cambio di selezione, successo ed errore si vedono sul feedback giusto', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('s3', 941)]);
  const msg = page.locator('#mgManageMsg');
  const stella = page.locator('#mgStarBtn');
  await open(page, 's3');

  await stella.click();
  await waitPending(page, 1);
  await expect(stella).toBeDisabled();
  await resolveAt(page, 0);
  await expect(msg).toHaveText('Aggiunto ai preferiti.');
  await expect(stella).toHaveText('★ Preferito');
  await expect(stella).toBeEnabled();

  // togliere il preferito: errore → messaggio d'errore e stella invariata
  await stella.click();
  await waitPending(page, 2);
  await rejectAt(page, 1, 'server giù');
  await expect(msg).toHaveText('server giù');
  await expect(stella).toHaveText('★ Preferito');
  await expect(stella).toBeEnabled();

  // e riprovando funziona
  await stella.click();
  await waitPending(page, 3);
  await resolveAt(page, 2);
  await expect(msg).toHaveText('Rimosso dai preferiti.');
  await expect(stella).toHaveText('☆ Preferito');

  const u = await updates(page);
  expect(u.map((x) => x.starred)).toEqual([true, false, false]);
});

// ───────────────────────── 3. non-regressione ───────────────────────────────

test('non-regressione: la casella c\'è su tutte le schede, sui chiusi, e sparisce per il non-admin', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [
    fbFix('n1', 951, { status: 'todo', statusPublic: 'queued' }),
    fbFix('n2', 952, { status: 'working', statusPublic: 'in_progress' }),
    fbFix('n3', 953, { status: 'done', statusPublic: 'closed' }),
    fbFix('n4', 954, { status: 'archived' }),
  ], 'inbox');

  const box = page.locator('#mgUserNote');
  for (const [tab, id] of [['inbox', 'n1'], ['queue', 'n2'], ['resolved', 'n3'], ['archived', 'n4']]) {
    await page.evaluate((t) => window.__mgTest.setTab(t), tab);
    await open(page, id);
    await expect(box, `scheda ${tab}`).toBeVisible();
    await expect(page.locator('#mgUserNoteText')).toBeVisible();
  }

  // non-admin: niente casella
  await page.evaluate(() => window.__mgTest.setAdmin(false));
  await open(page, 'n3');
  await expect(box).toBeHidden();
});

test('non-regressione: report cifrato illeggibile — la frase si scrive lo stesso e compare nella conversazione', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('n5', 961, { notes: 'FENC1:AAAAbbbbCCCCddddEEEEffffGGGGhhhhIIIIjjjjKKKKllll', userNote: '' })]);
  await open(page, 'n5');
  const campo = page.locator('#mgUserNoteText');
  await expect(campo).toBeVisible();
  await campo.fill('Risolto: ora funziona anche da lì.');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 1);
  await resolveAt(page, 0);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  await expect(page.locator('#mgThread')).toContainText('Risolto: ora funziona anche da lì.');
});

test('non-regressione: testo storto — spazi, emoji, a capo, oltre i 500 caratteri', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fbFix('n6', 971)]);
  await open(page, 'n6');
  const campo = page.locator('#mgUserNoteText');

  await campo.fill('   con spazi ai bordi   ');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 1);
  await resolveAt(page, 0);
  let u = await updates(page);
  expect(u[0].userNote).toBe('con spazi ai bordi');

  await campo.fill('emoji ⭐ e accenti perché sì');
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 2);
  await resolveAt(page, 1);
  u = await updates(page);
  expect(u[1].userNote).toBe('emoji ⭐ e accenti perché sì');

  // oltre il tetto: l'input ha maxlength, e comunque il codice tronca a 500
  await page.evaluate(() => {
    const el = document.getElementById('mgUserNoteText');
    el.value = 'x'.repeat(700);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#mgUserNoteBtn');
  await waitPending(page, 3);
  await resolveAt(page, 2);
  u = await updates(page);
  expect(u[2].userNote.length).toBe(500);
});

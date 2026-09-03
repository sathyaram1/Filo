// #509 — Le due superfici che elencano i feedback (filo://feedback e la
// dashboard di gestione filo://manage) devono chiamare le sezioni con gli
// stessi nomi E riempirle con la stessa regola.
//
// Prima, la pagina dei feedback aveva una tassonomia sua — la vecchia
// new/draft/todo/review/blocked/clarify/done/verified — e mandava in "Ricevuti"
// tutto ciò che non riconosceva: archiviati, in lavorazione e attacchi
// confermati compresi. Con la stessa identica coda si leggeva "Ricevuti (3)" di
// là e "Ricevuti (9)" di qua, e chi guardava una pagina sola non aveva modo di
// accorgersene.
//
// Precondizione che senza il fix fallisce: la pagina dei feedback non ha
// nemmeno le sezioni "In coda" e "Archiviati" (il primo assert è rosso), e il
// numero dei "Ricevuti" conta nove elementi invece di tre.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';

// Versione "rilasciata" iniettata in entrambe le pagine, così il gate di
// "Risolti" (un fix conta solo se è davvero uscito) è lo stesso di qua e di là.
const VERSIONE = '1.0.0';

// La coda del ticket: le tre classi che finivano tutte in "Ricevuti"
// (archiviato, in lavorazione, attacco confermato) più un campione di ogni
// sezione, incluso il caso limite del gate: un `done` non ancora uscito.
const CODA = [
  { _id: 'u1',  seq: 1,  status: 'unlabeled',           name: 'non filtrato',      text: 'uno',     createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'a1',  seq: 2,  status: 'attack',              name: 'attacco',           text: 'due',     createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'al1', seq: 3,  status: 'aligned',             name: 'allineato',         text: 'tre',     createdAt: '2026-08-03T10:00:00Z' },
  { _id: 't1',  seq: 4,  status: 'todo',                name: 'in coda',           text: 'quattro', createdAt: '2026-08-04T10:00:00Z' },
  { _id: 'w1',  seq: 5,  status: 'working',             name: 'in lavorazione',    text: 'cinque',  createdAt: '2026-08-05T10:00:00Z' },
  { _id: 'rc1', seq: 6,  status: 'revision_capability', name: 'verifica fix',      text: 'sei',     createdAt: '2026-08-06T10:00:00Z' },
  // Chiuso ma NON ancora uscito: resta "In coda" su entrambe le pagine.
  { _id: 'd0',  seq: 7,  status: 'done', resolvedInVersion: '9.9.9', name: 'risolto non uscito', text: 'sette', createdAt: '2026-08-07T10:00:00Z' },
  { _id: 'd1',  seq: 8,  status: 'done', resolvedInVersion: '0.9.0', name: 'risolto uscito',     text: 'otto',  createdAt: '2026-08-08T10:00:00Z' },
  { _id: 'ar1', seq: 9,  status: 'archived',            name: 'archiviato',        text: 'nove',    createdAt: '2026-08-09T10:00:00Z' },
  { _id: 'ac1', seq: 10, status: 'attack_confirmed',    name: 'attacco confermato', text: 'dieci',  createdAt: '2026-08-10T10:00:00Z' },
];

// Ricevuti 3 (unlabeled, attack, aligned) · In coda 4 (todo, working,
// revision_capability, done-non-uscito) · Risolti 1 · Archiviati 2.
const ATTESI = { inbox: 3, queue: 4, resolved: 1, archived: 2 };
const NOMI = { inbox: 'Ricevuti', queue: 'In coda', resolved: 'Risolti', archived: 'Archiviati' };

test('#509 — le due pagine contano le stesse sezioni allo stesso modo', async ({ openTab }) => {
  // ── Pagina dei feedback ──────────────────────────────────────────────────
  const fb = await openTab(FEEDBACK);
  await fb.waitForLoadState('domcontentloaded');
  await fb.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await fb.evaluate((items) => window.__fbTest.setData(items), CODA);
  await fb.evaluate((v) => window.__fbTest.setReleasedVersion(v), VERSIONE);

  const testiFb = {};
  for (const tab of Object.keys(ATTESI)) {
    const el = fb.locator(`#tabs [data-tab="${tab}"]`);
    await expect(el).toHaveText(`${NOMI[tab]} (${ATTESI[tab]})`);
    testiFb[tab] = (await el.innerText()).trim();
  }

  // Le tre classi del ticket non sono più nei Ricevuti.
  await fb.locator('#tabs [data-tab="inbox"]').click();
  for (const nome of ['archiviato', 'in lavorazione', 'attacco confermato']) {
    await expect(fb.locator('.fb-card', { hasText: nome })).toHaveCount(0);
  }
  // E si trovano dove la macchina a stati dice che stanno.
  await fb.locator('#tabs [data-tab="queue"]').click();
  await expect(fb.locator('.fb-card', { hasText: 'in lavorazione' })).toHaveCount(1);
  await fb.locator('#tabs [data-tab="archived"]').click();
  await expect(fb.locator('.fb-card', { hasText: 'archiviato' })).toHaveCount(1);
  await expect(fb.locator('.fb-card', { hasText: 'attacco confermato' })).toHaveCount(1);

  // ── Dashboard di gestione, stessa coda ───────────────────────────────────
  const mg = await openTab(MANAGE);
  await mg.waitForLoadState('domcontentloaded');
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await mg.evaluate(() => window.__mgTest.whenReady());
  await mg.evaluate((items) => window.__mgTest.setData(items), CODA);
  await mg.evaluate((v) => window.__mgTest.setReleasedVersion(v), VERSIONE);

  for (const tab of Object.keys(ATTESI)) {
    const el = mg.locator(`.mg-tab[data-tab="${tab}"]`);
    const testo = (await el.innerText()).trim().replace(/\s+/g, ' ');
    // È QUESTO il confronto del ticket: stesso nome, stesso numero, a parità di coda.
    expect(testo, `sezione "${tab}" nelle due pagine`).toBe(testiFb[tab]);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stato ILLEGGIBILE (un computer senza la chiave privata dell'owner): le due
// pagine devono comportarsi allo stesso modo anche qui.
//
// Lo status fine viaggia cifrato: senza chiave la macchina a stati non ha
// niente da sciogliere e ogni segnalazione ricade nei Ricevuti. La pagina dei
// feedback toglie le sezioni e ne fa un elenco solo; la dashboard di gestione
// scriveva ancora "Ricevuti (3) · In coda (0) · Risolti (0) · Archiviati (0)",
// coi chiusi dentro i Ricevuti, e sulla scheda aperta "In attesa del giudizio"
// su una segnalazione già chiusa.
//
// Precondizione che senza il fix fallisce: su filo://manage le quattro schede
// restano visibili e numerate, non c'è nessuna riga che spieghi l'assenza del
// criterio, l'intestazione della colonna dice "Ricevuti (3)" e il dettaglio
// non dice mai "Chiusa".
const CODA_CIFRATA = [
  { _id: 'k1', seq: 41, status: 'FENC1:aaaaaaaaaaaaaaaaaaaaaaaa', statusPublic: 'open',
    name: 'aperta', text: 'uno', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'k2', seq: 42, status: 'FENC1:bbbbbbbbbbbbbbbbbbbbbbbb', statusPublic: 'closed',
    name: 'chiusa', text: 'due', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'k3', seq: 43, status: 'FENC1:cccccccccccccccccccccccc', statusPublic: 'closed',
    name: 'chiusa pure', text: 'tre', createdAt: '2026-08-03T10:00:00Z' },
];

test('#509 — stato illeggibile: niente sezioni su ENTRAMBE le pagine', async ({ openTab }) => {
  // ── Pagina dei feedback: il comportamento di riferimento ─────────────────
  const fb = await openTab(FEEDBACK);
  await fb.waitForLoadState('domcontentloaded');
  await fb.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await fb.evaluate((items) => window.__fbTest.setData(items), CODA_CIFRATA);

  await expect(fb.locator('#tabs')).toBeHidden();
  await expect(fb.locator('#noSections')).toBeVisible();
  const avvisoFb = (await fb.locator('#noSections').innerText()).trim();
  await expect(fb.locator('.fb-card')).toHaveCount(3);

  // ── Dashboard di gestione, stessa coda ───────────────────────────────────
  const mg = await openTab(MANAGE);
  await mg.waitForLoadState('domcontentloaded');
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await mg.evaluate(() => window.__mgTest.whenReady());
  await mg.evaluate((items) => window.__mgTest.setData(items), CODA_CIFRATA);

  // 1. Le sezioni non si disegnano. Le schede che NON sono sezioni
  //    (Statistiche, Modelli, Automazioni, Log) non dipendono dallo stato delle
  //    segnalazioni e restano raggiungibili.
  for (const tab of ['inbox', 'queue', 'resolved', 'archived']) {
    await expect(mg.locator(`.mg-tab[data-tab="${tab}"]`)).toBeHidden();
  }
  await expect(mg.locator('.mg-tab[data-tab="log"]')).toBeVisible();

  // 2. Una riga dice perché — le stesse parole della gemella.
  await expect(mg.locator('#mgNoSections')).toBeVisible();
  expect((await mg.locator('#mgNoSections').innerText()).trim()).toBe(avvisoFb);

  // 3. L'intestazione della colonna non ripete il nome di una sezione che non
  //    è stata scelta: un elenco solo, con quante ne contiene.
  const testa = (await mg.locator('#mgListHead').innerText()).trim();
  expect(testa).toContain('(3)');
  expect(testa).not.toMatch(/Ricevuti|In coda|Risolti|Archiviati/);

  // 4. Un elenco solo, con dentro TUTTE le segnalazioni (i chiusi compresi, e
  //    non ammucchiati nei Ricevuti).
  await expect(mg.locator('.mg-item')).toHaveCount(3);
  const idsMg = await mg.locator('.mg-item').evaluateAll((els) => els.map((e) => e.dataset.id));
  expect(idsMg.slice().sort()).toEqual(CODA_CIFRATA.map((f) => f._id).sort());

  // 5. Sulla scheda solo ciò che si sa davvero: aperta o chiusa.
  await expect(mg.locator('.mg-item', { hasText: 'chiusa pure' }).locator('.mg-state')).toHaveText('Chiusa');
  await expect(mg.locator('.mg-item', { hasText: 'aperta' }).first().locator('.mg-state')).toHaveText('Aperta');
  // Nessuna scheda dipinta come "Non filtrato": è un'affermazione sullo stato.
  await expect(mg.locator('.mg-item--unfiltered')).toHaveCount(0);

  // 6. Aprendo una segnalazione già chiusa, il dettaglio lo dice — invece di
  //    "In attesa del giudizio".
  await mg.locator('.mg-item', { hasText: 'chiusa pure' }).click();
  await expect(mg.locator('#mgJudgesRow')).toContainText('Chiusa');
  await expect(mg.locator('#mgJudgesRow')).not.toContainText('In attesa del giudizio');
});

test('#509 — stato illeggibile: nessuna decisione offerta su ciò che non si legge', async ({ openTab }) => {
  const mg = await openTab(MANAGE);
  await mg.waitForLoadState('domcontentloaded');
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await mg.evaluate(() => window.__mgTest.whenReady());
  // L'owner può essere loggato su una macchina dove la chiave privata non c'è:
  // i pulsanti nascono dallo stato, e qui lo stato la pagina se lo inventa.
  await mg.evaluate(() => window.__mgTest.setAdmin(true));
  await mg.evaluate((items) => window.__mgTest.setData(items), CODA_CIFRATA);

  // Le due barre di massa contano feedback per stato: senza criterio, zero.
  await expect(mg.locator('#mgReevalBar')).toBeHidden();
  await expect(mg.locator('#mgAlignedBar')).toBeHidden();

  await mg.locator('.mg-item').first().click();
  // "→ In coda" / "Conferma attacco" su una pratica che potrebbe essere già
  // chiusa: la gemella qui non offre nulla, e nemmeno questa.
  await expect(mg.locator('#mgActions')).toBeHidden();
  // Nessuna azione di stato, nemmeno una: "Archivia" direbbe sempre "Archivia",
  // anche su una già archiviata.
  await expect(mg.locator('#mgActionsRow button')).toHaveCount(0);
  await expect(mg.locator('#mgArchiveBtn')).toHaveCount(0);
  // ⭐ e la frase per chi ha segnalato sono in chiaro: restano.
  await expect(mg.locator('#mgStarBtn')).toBeVisible();
  await expect(mg.locator('#mgUserNote')).toBeVisible();
});

// Il filtro "Solo automatici" ha preso il posto della vecchia sezione "Agente":
// i ritrovamenti dell'agente esploratore e degli audit delle routine restano
// isolabili, ma senza inventare una sezione che la gemella non ha.
test('#509 — i ritrovamenti automatici sono un filtro, non una sezione', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest);
  await page.evaluate(() => window.__fbTest.setData([
    { _id: 'audit', seq: 20, status: 'unlabeled', name: 'ritrovamento audit', text: 'a',
      clientId: 'routine:nightly-audit', createdAt: '2026-08-20T10:00:00Z' },
    { _id: 'umano', seq: 21, status: 'unlabeled', name: 'segnalazione umana', text: 'b',
      clientId: 'tester@example.com', createdAt: '2026-08-21T10:00:00Z' },
  ]));

  // Senza filtro stanno insieme nei Ricevuti (come nella gemella).
  await expect(page.locator('#tabs [data-tab="inbox"]')).toHaveText('Ricevuti (2)');
  await expect(page.locator('.fb-card')).toHaveCount(2);

  // Col filtro resta solo l'audit — e il numero della sezione lo segue, invece
  // di affermare un totale che la lista non mostra.
  await page.locator('#agentOnly').check();
  await expect(page.locator('#tabs [data-tab="inbox"]')).toHaveText('Ricevuti (1)');
  await expect(page.locator('.fb-card')).toHaveCount(1);
  await expect(page.locator('.fb-card')).toContainText('ritrovamento audit');
});

// ─────────────────────────────────────────────────────────────────────────────
// #509 (terzo giro) — LE AZIONI. Mettere la stessa segnalazione nella stessa
// sezione non basta: sulla stessa segnalazione le due pagine devono offrire le
// STESSE AZIONI, con le stesse parole.
//
// Prima non era così, e la differenza faceva danno:
//   · negli Archiviati la dashboard di gestione offriva "Archivia" al posto di
//     "Ripristina" per l'attacco confermato, lo spam confermato e le due forme
//     vecchie di archiviazione (verified, ignored): da lì quelle quattro non si
//     potevano più togliere dall'archivio;
//   · e premere quel bottone su un attacco confermato scriveva `archived` SOPRA
//     la conferma — una decisione di sicurezza cancellata senza avviso;
//   · su un file sospetto offriva una conferma sola invece di due;
//   · un fix uscito non si poteva riaprire.
//
// Precondizione che senza il fix fallisce: gli elenchi di pulsanti delle due
// pagine differiscono su archiviato/confermati/legacy, su suspicious_file e su
// un `done` uscito.
const CODA_AZIONI = [
  { _id: 'z1', seq: 61, status: 'unlabeled',        name: 'non filtrata',       text: 'a', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'z2', seq: 62, status: 'attack',           name: 'attacco',            text: 'b', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'z3', seq: 63, status: 'spam',             name: 'spammosa',           text: 'c', createdAt: '2026-08-03T10:00:00Z' },
  { _id: 'z4', seq: 64, status: 'suspicious_file',  name: 'file sospetto',      text: 'd', createdAt: '2026-08-04T10:00:00Z' },
  { _id: 'z5', seq: 65, status: 'todo',             name: 'in coda',            text: 'e', createdAt: '2026-08-05T10:00:00Z' },
  { _id: 'z6', seq: 66, status: 'done', resolvedInVersion: '0.9.0', name: 'fix uscito', text: 'f', createdAt: '2026-08-06T10:00:00Z' },
  { _id: 'z7', seq: 67, status: 'archived',         name: 'archiviata',         text: 'g', createdAt: '2026-08-07T10:00:00Z' },
  { _id: 'z8', seq: 68, status: 'attack_confirmed', name: 'attacco confermato', text: 'h', createdAt: '2026-08-08T10:00:00Z' },
  { _id: 'z9', seq: 69, status: 'spam_confirmed',   name: 'spam confermato',    text: 'i', createdAt: '2026-08-09T10:00:00Z' },
  { _id: 'zA', seq: 70, status: 'verified',         name: 'verificata legacy',  text: 'l', createdAt: '2026-08-10T10:00:00Z' },
  { _id: 'zB', seq: 71, status: 'ignored',          name: 'ignorata legacy',    text: 'm', createdAt: '2026-08-11T10:00:00Z' },
];

// La sezione dove ciascuna vive (le due pagine sono già allineate su questo).
const SEZIONE = {
  z1: 'inbox', z2: 'inbox', z3: 'inbox', z4: 'inbox',
  z5: 'queue', z6: 'resolved',
  z7: 'archived', z8: 'archived', z9: 'archived', zA: 'archived', zB: 'archived',
};

test('#509 — le due pagine offrono le stesse azioni sulla stessa segnalazione', async ({ openTab }) => {
  // ── Pagina dei feedback ──────────────────────────────────────────────────
  const fb = await openTab(FEEDBACK);
  await fb.waitForLoadState('domcontentloaded');
  await fb.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await fb.evaluate(() => window.__fbTest.setAdmin(true));
  await fb.evaluate((items) => window.__fbTest.setData(items), CODA_AZIONI);
  await fb.evaluate((v) => window.__fbTest.setReleasedVersion(v), VERSIONE);

  const azioniFb = {};
  for (const item of CODA_AZIONI) {
    await fb.evaluate((t) => window.__fbTest.setTab(t), SEZIONE[item._id]);
    const card = fb.locator(`.fb-card[data-id="${item._id}"]`);
    await expect(card, `la scheda ${item.name} è nella sezione ${SEZIONE[item._id]}`).toHaveCount(1);
    azioniFb[item._id] = await card.locator('.fb-actions button')
      .evaluateAll((els) => els.map((e) => e.textContent.trim()));
    // Ogni segnalazione ha almeno un'azione: una scheda muta è la porta
    // dell'archivio senza uscita.
    expect(azioniFb[item._id].length, `azioni su ${item.name}`).toBeGreaterThan(0);
  }

  // Le due invarianti dette per esteso, sulla pagina di riferimento.
  expect(azioniFb.z4).toEqual(['→ In coda', 'Conferma attacco', 'Conferma spam', 'Archivia']);
  expect(azioniFb.z6).toEqual(['Archivia', 'Riapri']);
  for (const id of ['z7', 'z8', 'z9', 'zA', 'zB']) {
    expect(azioniFb[id], `archiviata ${id}: solo il ripristino`).toEqual(['↩ Ripristina']);
  }

  // ── Dashboard di gestione, stessa coda ───────────────────────────────────
  const mg = await openTab(MANAGE);
  await mg.waitForLoadState('domcontentloaded');
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await mg.evaluate(() => window.__mgTest.whenReady());
  await mg.evaluate(() => window.__mgTest.setAdmin(true));
  await mg.evaluate((items) => window.__mgTest.setData(items), CODA_AZIONI);
  await mg.evaluate((v) => window.__mgTest.setReleasedVersion(v), VERSIONE);

  for (const item of CODA_AZIONI) {
    await mg.evaluate((t) => window.__mgTest.setTab(t), SEZIONE[item._id]);
    await mg.evaluate((id) => window.__mgTest.openDetail(id), item._id);
    const azioni = await mg.locator('#mgActionsRow button')
      .evaluateAll((els) => els.map((e) => e.textContent.trim()));
    // È QUESTO il confronto del giro: stessa segnalazione, stesse azioni.
    expect(azioni, `azioni su "${item.name}" nelle due pagine`).toEqual(azioniFb[item._id]);
  }
});

test('#509 — su «Gestione» un attacco confermato non si può riscrivere ad "archiviato"', async ({ openTab }) => {
  const mg = await openTab(MANAGE);
  await mg.waitForLoadState('domcontentloaded');
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await mg.evaluate(() => window.__mgTest.whenReady());
  await mg.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
  await mg.evaluate(() => window.__mgTest.setAdmin(true));
  await mg.evaluate((items) => window.__mgTest.setData(items), CODA_AZIONI);
  await mg.evaluate((v) => window.__mgTest.setReleasedVersion(v), VERSIONE);
  await mg.evaluate(() => window.__mgTest.setTab('archived'));
  await mg.evaluate(() => window.__mgTest.openDetail('z8'));

  // Il pannello DICE che è un attacco confermato: prima non lo diceva da
  // nessuna parte, e la conversazione scriveva "Filo non ha ancora un parere".
  await expect(mg.locator('#mgDetailState')).toContainText('Attacco confermato');

  // L'unico bottone è il ripristino, e rimette in coda: la conferma non si
  // cancella premendo l'unica cosa disponibile.
  await expect(mg.locator('#mgActionsRow button')).toHaveCount(1);
  await expect(mg.locator('#mgArchiveBtn')).toHaveText('↩ Ripristina');
  await mg.locator('#mgArchiveBtn').click();

  await expect.poll(() => mg.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await mg.evaluate(() => window.__updates[0]);
  expect(patch.id).toBe('z8');
  expect(patch.status).toBe('todo');
  expect(patch.archiveOverride).toBe('keep_open');
});

// ─────────────────────────────────────────────────────────────────────────────
// La coda MISTA: una segnalazione cifrata in mezzo a tante leggibili.
//
// "Le sezioni si possono disegnare?" è una domanda sulla LISTA; "questo stato
// si legge?" è una domanda su UNA segnalazione. La pagina dei feedback se le
// faceva tutt'e due, «Gestione» solo la prima: finché nessuno stato si leggeva
// le due pagine coincidevano, ma bastava una cifrata in mezzo a tante
// leggibili — il caso in cui la regola dice di LASCIARE le sezioni al loro
// posto — e su quella segnalazione «Gestione» tornava a dire cose che non sa.
//
// Precondizione che senza il fix fallisce: su «Gestione» la scheda cifrata non
// scrive "Chiusa", prende il bordo bianco dei "non filtrati", viene contata dal
// bottone "Ri-valuta i non filtrati" e la conversazione dichiara un giudizio
// che non è mai arrivato.
const MISTA = [
  { _id: 'x1', seq: 81, status: 'todo',     name: 'in coda leggibile',   text: 'a', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'x2', seq: 82, status: 'archived', name: 'archiviata leggibile', text: 'b', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'x3', seq: 83, status: 'FENC1:dddddddddddddddd', statusPublic: 'closed',
    name: 'cifrata chiusa', text: 'c', createdAt: '2026-08-03T10:00:00Z' },
];

test('#509 — coda mista: la cifrata dice le stesse cose sulle due pagine', async ({ openTab }) => {
  const fb = await openTab(FEEDBACK);
  await fb.waitForLoadState('domcontentloaded');
  await fb.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await fb.evaluate(() => window.__fbTest.setAdmin(true));
  await fb.evaluate((items) => window.__fbTest.setData(items), MISTA);
  await fb.evaluate((v) => window.__fbTest.setReleasedVersion(v), VERSIONE);

  const mg = await openTab(MANAGE);
  await mg.waitForLoadState('domcontentloaded');
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await mg.evaluate(() => window.__mgTest.whenReady());
  await mg.evaluate(() => window.__mgTest.setAdmin(true));
  await mg.evaluate((items) => window.__mgTest.setData(items), MISTA);
  await mg.evaluate((v) => window.__mgTest.setReleasedVersion(v), VERSIONE);

  // Un solo documento storto non toglie le sezioni a tutti: restano su entrambe.
  await expect(fb.locator('#tabs [data-tab="queue"]')).toBeVisible();
  await expect(mg.locator('.mg-tab[data-tab="queue"]')).toBeVisible();

  await fb.evaluate(() => window.__fbTest.setTab('inbox'));
  await mg.evaluate(() => window.__mgTest.setTab('inbox'));

  // 1. L'unica cosa vera che si sa di lei sta scritta su tutt'e due le schede.
  await expect(fb.locator('.fb-card[data-id="x3"]')).toContainText('Chiusa');
  await expect(mg.locator('#mgList .mg-item[data-id="x3"]')).toContainText('Chiusa');

  // 2. E non la si dipinge come "non filtrata": è un'affermazione sullo stato.
  await expect(mg.locator('#mgList .mg-item[data-id="x3"]')).not.toHaveClass(/mg-item--unfiltered/);

  // 3. Quindi non finisce nel mucchio da rimandare ai giudici.
  await expect(mg.locator('#mgReevalBar')).toBeHidden();

  // 4. E la conversazione non dichiara un giudizio che non è mai arrivato.
  await mg.evaluate(() => window.__mgTest.openDetail('x3'));
  await expect(mg.locator('#mgThread')).not.toContainText('non ha ancora un parere');
});

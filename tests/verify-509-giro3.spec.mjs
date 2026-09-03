// #509 — verifica avversariale, GIRO 3.
//
// Sintomo del ticket: le due pagine che elencano le segnalazioni (la pagina dei
// feedback e la dashboard di gestione) chiamano le sezioni con gli stessi nomi
// ma le riempiono con regole diverse — "Ricevuti (3)" di là, "Ricevuti (9)" di
// qua sulla STESSA coda.
//
// Porte già trovate e chiuse nei giri precedenti, da ri-provare tutte:
//   giro 1 → un clic dentro una scheda ricomponeva la lista e il secondo clic
//            (anche a 400ms) cadeva su un'ALTRA segnalazione;
//   giro 2 → il caso "questo computer non legge gli stati" era stato sistemato
//            sulla sola pagina dei feedback: la gemella continuava a scrivere
//            "Ricevuti (3) · In coda (0) · Risolti (0) · Archiviati (0)" e
//            "In attesa del giudizio" su segnalazioni già chiuse.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const VERSIONE = '1.0.0';
const SEZIONI = ['inbox', 'queue', 'resolved', 'archived'];
const NOMI = { inbox: 'Ricevuti', queue: 'In coda', resolved: 'Risolti', archived: 'Archiviati' };

// ── Aperture ────────────────────────────────────────────────────────────────
async function apriFeedback(openTab, items, { ritardo = 0, esito = { ok: true }, admin = true } = {}) {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await page.evaluate(({ ritardo, esito }) => {
    window.__updates = [];
    window.__ritardo = ritardo;
    window.__esito = esito;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        if (window.__ritardo) await new Promise((r) => setTimeout(r, window.__ritardo));
        return window.__esito;
      }
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.com' } };
      }
      if (msg && msg.type === 'automation_get') return { ok: true, enabled: false };
      return orig(msg);
    };
  }, { ritardo, esito });
  await page.evaluate((a) => window.__fbTest.setAdmin(a, { email: 'owner@example.com' }), admin);
  await page.evaluate((v) => window.__fbTest.setReleasedVersion(v), VERSIONE);
  if (items) await page.evaluate((i) => window.__fbTest.setData(i), items);
  return page;
}

async function apriManage(openTab, items, { admin = true } = {}) {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.com' } };
      }
      if (msg && msg.type === 'automation_get') return { ok: true, enabled: false };
      return orig(msg);
    };
  });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate((v) => window.__mgTest.setReleasedVersion(v), VERSIONE);
  if (items) await page.evaluate((i) => window.__mgTest.setData(i), items);
  return page;
}

const updates = (page) => page.evaluate(() => window.__updates.slice());

// Nomi+numeri delle sezioni, e chi c'è dentro (nell'ordine in cui si legge).
async function fotoFeedback(page) {
  const out = { barra: {}, dentro: {} };
  for (const tab of SEZIONI) {
    const el = page.locator(`#tabs [data-tab="${tab}"]`);
    out.barra[tab] = (await el.innerText()).trim();
    await el.click();
    await page.waitForTimeout(120);
    out.dentro[tab] = await page.locator('#list .fb-card').evaluateAll(
      (n) => n.map((c) => c.getAttribute('data-id')));
  }
  await page.locator('#tabs [data-tab="inbox"]').click();
  return out;
}

async function fotoManage(page) {
  const out = { barra: {}, dentro: {} };
  for (const tab of SEZIONI) {
    await page.evaluate((t) => window.__mgTest.setTab(t), tab);
    await page.waitForTimeout(120);
    const el = page.locator(`#mgTabs .mg-tab[data-tab="${tab}"]`);
    out.barra[tab] = (await el.innerText()).trim();
    out.dentro[tab] = await page.locator('#mgList .mg-item').evaluateAll(
      (n) => n.map((c) => c.getAttribute('data-id')));
  }
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  return out;
}

// Punto FISSO dello schermo: il puntatore non si sposta fra un clic e l'altro.
async function puntoDi(page, selettore) {
  const box = await page.locator(selettore).first().boundingBox();
  if (!box) throw new Error(`nessun riquadro per ${selettore}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 — LA LAMENTELA, con una coda il più storta possibile.
// Stati legacy, stato inventato, stato mancante, stato vuoto, done spedito e
// non spedito, confermati, preferiti. Le due pagine devono dire la STESSA cosa
// su nome, numero, contenuto e ordine di ogni sezione.
// ═════════════════════════════════════════════════════════════════════════════
const CODA_STORTA = [
  { _id: 'x01', seq: 1,  status: 'unlabeled',           name: 'non filtrato',    text: 'a', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'x02', seq: 2,  status: 'attack',              name: 'attacco',         text: 'b', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'x03', seq: 3,  status: 'spam',                name: 'spam',            text: 'c', createdAt: '2026-08-03T10:00:00Z' },
  { _id: 'x04', seq: 4,  status: 'aligned',             name: 'allineato',       text: 'd', createdAt: '2026-08-04T10:00:00Z' },
  { _id: 'x05', seq: 5,  status: 'todo',                name: 'in coda',         text: 'e', createdAt: '2026-08-05T10:00:00Z' },
  { _id: 'x06', seq: 6,  status: 'working',             name: 'in lavorazione',  text: 'f', createdAt: '2026-08-06T10:00:00Z' },
  { _id: 'x07', seq: 7,  status: 'revision_security',   name: 'audit',           text: 'g', createdAt: '2026-08-07T10:00:00Z' },
  { _id: 'x08', seq: 8,  status: 'done', resolvedInVersion: '9.9.9', name: 'chiuso non uscito', text: 'h', createdAt: '2026-08-08T10:00:00Z' },
  { _id: 'x09', seq: 9,  status: 'done', resolvedInVersion: '0.9.0', name: 'chiuso uscito',     text: 'i', createdAt: '2026-08-09T10:00:00Z' },
  { _id: 'x10', seq: 10, status: 'archived',            name: 'archiviato',      text: 'j', createdAt: '2026-08-10T10:00:00Z' },
  { _id: 'x11', seq: 11, status: 'attack_confirmed',    name: 'attacco ok',      text: 'k', createdAt: '2026-08-11T10:00:00Z' },
  { _id: 'x12', seq: 12, status: 'spam_confirmed',      name: 'spam ok',         text: 'l', createdAt: '2026-08-12T10:00:00Z' },
  // ── legacy ritirati ──
  { _id: 'x13', seq: 13, status: 'draft',               name: 'bozza',           text: 'm', createdAt: '2026-08-13T10:00:00Z' },
  { _id: 'x14', seq: 14, status: 'review',              name: 'in revisione',    text: 'n', createdAt: '2026-08-14T10:00:00Z' },
  { _id: 'x15', seq: 15, status: 'clarify',             name: 'chiarimenti',     text: 'o', createdAt: '2026-08-15T10:00:00Z' },
  { _id: 'x16', seq: 16, status: 'verified',            name: 'verificato',      text: 'p', createdAt: '2026-08-16T10:00:00Z' },
  { _id: 'x17', seq: 17, status: 'ignored',             name: 'ignorato',        text: 'q', createdAt: '2026-08-17T10:00:00Z' },
  { _id: 'x18', seq: 18, status: 'new',                 name: 'nuovo',           text: 'r', createdAt: '2026-08-18T10:00:00Z' },
  { _id: 'x19', seq: 19, status: 'blocked',             name: 'bloccato',        text: 's', createdAt: '2026-08-19T10:00:00Z', blockReason: 'attack' },
  // ── storti ──
  { _id: 'x20', seq: 20, status: 'zibaldone',           name: 'inventato',       text: 't', createdAt: '2026-08-20T10:00:00Z' },
  { _id: 'x21', seq: 21,                                name: 'senza stato',     text: 'u', createdAt: '2026-08-21T10:00:00Z' },
  { _id: 'x22', seq: 22, status: '',                    name: 'stato vuoto',     text: 'v', createdAt: '2026-08-22T10:00:00Z' },
  { _id: 'x23', seq: 23, status: null,                  name: 'stato null',      text: 'w', createdAt: '2026-08-23T10:00:00Z' },
  { _id: 'x24', seq: 24, status: 'todo', starred: true, name: 'preferito in coda', text: 'x', createdAt: '2026-08-24T10:00:00Z' },
  // priorità fuori scala + createdAt illeggibile: non devono spostare nessuno
  { _id: 'x25', seq: 25, status: 'todo', priority: 99,  name: 'priorita assurda', text: 'y', createdAt: 'non-una-data' },
];

test('#509/3 — coda storta: le due pagine dicono lo stesso nome, numero, contenuto e ordine per ogni sezione', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CODA_STORTA);
  const mg = await apriManage(openTab, CODA_STORTA);

  const a = await fotoFeedback(fb);
  const b = await fotoManage(mg);

  expect(a.barra).toEqual(b.barra);
  for (const tab of SEZIONI) {
    expect(a.dentro[tab], `contenuto di ${NOMI[tab]}`).toEqual(b.dentro[tab]);
    // Il numero scritto sulla scheda deve essere la lunghezza della lista che
    // la scheda mostra davvero.
    const n = a.dentro[tab].length;
    expect(a.barra[tab], `numero di ${NOMI[tab]}`).toBe(`${NOMI[tab]} (${n})`);
  }
  // Nessuna segnalazione può sparire, e nessuna può stare in due sezioni.
  const tutte = SEZIONI.flatMap((t) => a.dentro[t]);
  expect(new Set(tutte).size).toBe(tutte.length);
  expect(tutte.length).toBe(CODA_STORTA.length);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 — LE PORTE DEL GIRO 1: un clic, una scheda.
// ═════════════════════════════════════════════════════════════════════════════
test('#509/3 — Ricevuti: tre clic fermi su «→ In coda» scrivono una volta sola', async ({ openTab }) => {
  const coda = [
    { _id: 'c1', seq: 1, status: 'unlabeled', name: 'prima',  text: '1', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'c2', seq: 2, status: 'attack',    name: 'seconda', text: '2', createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'c3', seq: 3, status: 'spam',      name: 'terza',  text: '3', createdAt: '2026-08-03T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda);
  const primo = await page.locator('.fb-card').first().getAttribute('data-id');
  const p = await puntoDi(page, '.fb-card:first-child .fb-act[data-to="todo"]');
  for (let i = 0; i < 3; i++) { await page.mouse.click(p.x, p.y); await page.waitForTimeout(400); }
  expect((await updates(page)).map((u) => `${u.id}:${u.status}`)).toEqual([`${primo}:todo`]);
});

test('#509/3 — In coda: due clic fermi su «✓ Risolto» chiudono una segnalazione sola', async ({ openTab }) => {
  const coda = [
    { _id: 'q1', seq: 11, status: 'todo',    name: 'prima',  text: '1', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'q2', seq: 12, status: 'working', name: 'seconda', text: '2', createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'q3', seq: 13, status: 'todo',    name: 'terza',  text: '3', createdAt: '2026-08-03T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda);
  await page.locator('#tabs [data-tab="queue"]').click();
  await expect(page.locator('.fb-card')).toHaveCount(3);
  const p = await puntoDi(page, '.fb-card:first-child .fb-act[data-to="done"]');
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);
  expect((await updates(page)).length).toBe(1);
});

test('#509/3 — Archiviati: due clic fermi su «↩ Ripristina» ne rimettono in coda una sola', async ({ openTab }) => {
  const coda = [
    { _id: 'a1', seq: 21, status: 'archived',         name: 'prima',  text: '1', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'a2', seq: 22, status: 'attack_confirmed', name: 'seconda', text: '2', createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'a3', seq: 23, status: 'archived',         name: 'terza',  text: '3', createdAt: '2026-08-03T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda);
  await page.locator('#tabs [data-tab="archived"]').click();
  await expect(page.locator('.fb-card')).toHaveCount(3);
  const p = await puntoDi(page, '.fb-card:first-child .fb-act[data-to="todo"]');
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);
  expect((await updates(page)).length).toBe(1);
});

test('#509/3 — «Archivia» premuto mentre «→ In coda» è ancora in volo: una decisione sola', async ({ openTab }) => {
  const coda = [
    { _id: 'v1', seq: 1, status: 'unlabeled', name: 'prima',  text: '1', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'v2', seq: 2, status: 'attack',    name: 'seconda', text: '2', createdAt: '2026-08-02T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda, { ritardo: 900 });
  const pTodo = await puntoDi(page, '.fb-card:first-child .fb-act[data-to="todo"]');
  const pArch = await puntoDi(page, '.fb-card:first-child .fb-act[data-archive="1"]');
  await page.mouse.click(pTodo.x, pTodo.y);
  await page.waitForTimeout(150);
  await page.mouse.click(pArch.x, pArch.y);
  await page.waitForTimeout(1500);
  expect((await updates(page)).map((u) => u.status)).toEqual(['todo']);
});

test('#509/3 — i pallini della priorità in «In coda» non rimescolano la lista sotto il dito', async ({ openTab }) => {
  const coda = [
    { _id: 'p1', seq: 1, status: 'todo', priority: 0, name: 'prima',  text: '1', createdAt: '2026-08-03T10:00:00Z' },
    { _id: 'p2', seq: 2, status: 'todo', priority: 0, name: 'seconda', text: '2', createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'p3', seq: 3, status: 'todo', priority: 0, name: 'terza',  text: '3', createdAt: '2026-08-01T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda);
  await page.locator('#tabs [data-tab="queue"]').click();
  await expect(page.locator('.fb-card')).toHaveCount(3);
  const prima = await page.locator('.fb-card').first().getAttribute('data-id');
  const p = await puntoDi(page, '.fb-card:first-child .fb-dot[data-n="3"]');
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);
  const u = await updates(page);
  // Due clic sullo STESSO pallino della STESSA scheda (il secondo azzera): mai
  // su un'altra segnalazione.
  expect(new Set(u.map((x) => x.id))).toEqual(new Set([prima]));
  expect(await page.locator('.fb-card').first().getAttribute('data-id')).toBe(prima);
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — LA PORTA DEL GIRO 2: stati illeggibili, sulle DUE pagine.
// ═════════════════════════════════════════════════════════════════════════════
const CIFRATA = [
  { _id: 'e1', seq: 1, status: 'FENC1:aaaaaaaaaaaa', statusPublic: 'open',   name: 'aperta',   text: '1', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'e2', seq: 2, status: 'FENC1:bbbbbbbbbbbb', statusPublic: 'closed', name: 'chiusa',   text: '2', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'e3', seq: 3, status: 'FENC1:cccccccccccc', statusPublic: 'closed', name: 'chiusa 2', text: '3', createdAt: '2026-08-03T10:00:00Z' },
];

test('#509/3 — stati illeggibili: nessuna delle due pagine disegna sezioni o numeri', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CIFRATA);
  const mg = await apriManage(openTab, CIFRATA);

  // Pagina dei feedback: barra via, riga che dice perché, elenco unico.
  await expect(fb.locator('#tabs')).toBeHidden();
  await expect(fb.locator('#noSections')).toBeVisible();
  const avvisoFb = (await fb.locator('#noSections').innerText()).trim();
  expect(avvisoFb).toContain('non può leggere lo stato');
  await expect(fb.locator('.fb-card')).toHaveCount(3);

  // Dashboard di gestione: le QUATTRO sezioni spariscono (le altre schede no).
  for (const tab of SEZIONI) {
    await expect(mg.locator(`#mgTabs .mg-tab[data-tab="${tab}"]`)).toBeHidden();
  }
  for (const tab of ['stats', 'models', 'automation', 'log']) {
    await expect(mg.locator(`#mgTabs .mg-tab[data-tab="${tab}"]`)).toBeVisible();
  }
  await expect(mg.locator('#mgNoSections')).toBeVisible();
  const avvisoMg = (await mg.locator('#mgNoSections').innerText()).trim();
  // Le due pagine dicono la stessa cosa con le stesse parole.
  expect(avvisoMg).toBe(avvisoFb);
  await expect(mg.locator('#mgList .mg-item')).toHaveCount(3);

  // Nessuna delle due scrive un nome di sezione in cima alla colonna.
  const testa = (await mg.locator('#mgListHead').innerText()).trim();
  for (const nome of Object.values(NOMI)) expect(testa.toLowerCase()).not.toContain(nome.toLowerCase());

  // Sulle schede resta solo ciò che si sa: aperta/chiusa, con le stesse parole.
  const statiFb = await fb.locator('.fb-card .fb-state').evaluateAll((n) => n.map((x) => x.textContent.trim()));
  const statiMg = await mg.locator('#mgList .mg-item .mg-state').evaluateAll((n) => n.map((x) => x.textContent.trim()));
  expect(statiFb).toEqual(['Chiusa', 'Chiusa', 'Aperta']);
  expect(statiMg).toEqual(statiFb);
});

test('#509/3 — stati illeggibili: la gemella non offre decisioni né frasi inventate sul dettaglio', async ({ openTab }) => {
  const mg = await apriManage(openTab, CIFRATA);
  await mg.evaluate(() => window.__mgTest.openDetail('e2'));
  await mg.waitForTimeout(250);

  // La riga dei giudici non deve dire "In attesa del giudizio" su una chiusa.
  const giudici = (await mg.locator('#mgJudgesRow').innerText().catch(() => '')).trim();
  expect(giudici).not.toContain('In attesa del giudizio');
  expect(giudici).toContain('Chiusa');

  // Nessun pulsante di decisione, e nemmeno «Archivia».
  const azioni = await mg.locator('#mgActions button:visible').evaluateAll((n) => n.map((b) => b.textContent.trim()));
  expect(azioni.join(' | ')).not.toMatch(/In coda|Conferma|Archivia|Approva/i);

  // Le barre di massa (che contano PER STATO) restano chiuse.
  await expect(mg.locator('#mgReevalBar')).toBeHidden();
  await expect(mg.locator('#mgAlignedBar')).toBeHidden();
});

test('#509/3 — stati illeggibili: nemmeno la pagina dei feedback offre decisioni', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CIFRATA);
  await expect(fb.locator('.fb-act')).toHaveCount(0);
});

test('#509/3 — illeggibile SENZA statusPublic: entrambe tacciono invece di inventare', async ({ openTab }) => {
  const muti = [
    { _id: 'm1', seq: 1, status: 'FENC1:zzzzzzzzzz', name: 'muta', text: '1', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'm2', seq: 2, status: '[cifrato]',        name: 'muta 2', text: '2', createdAt: '2026-08-02T10:00:00Z' },
  ];
  const fb = await apriFeedback(openTab, muti);
  const mg = await apriManage(openTab, muti);
  await expect(fb.locator('#tabs')).toBeHidden();
  await expect(fb.locator('.fb-card .fb-state')).toHaveCount(0);
  await expect(mg.locator('#mgList .mg-item')).toHaveCount(2);
  await expect(mg.locator('#mgList .mg-item .mg-state')).toHaveCount(0);
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 — MISTO: un documento cifrato in mezzo a stati leggibili.
// La barra deve RESTARE su entrambe (togliere le sezioni a tutti per un
// documento storto le farebbe divergere di nuovo), e il cifrato deve finire
// nella stessa sezione di qua e di là.
// ═════════════════════════════════════════════════════════════════════════════
test('#509/3 — un solo documento cifrato in mezzo: la barra resta, e resta uguale sulle due pagine', async ({ openTab }) => {
  const misto = [
    { _id: 'n1', seq: 1, status: 'todo',              name: 'in coda',  text: '1', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'n2', seq: 2, status: 'archived',          name: 'archiv',   text: '2', createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'n3', seq: 3, status: 'FENC1:qqqqqqqqqq', statusPublic: 'open', name: 'cifrata', text: '3', createdAt: '2026-08-03T10:00:00Z' },
  ];
  const fb = await apriFeedback(openTab, misto);
  const mg = await apriManage(openTab, misto);

  await expect(fb.locator('#tabs')).toBeVisible();
  await expect(fb.locator('#noSections')).toBeHidden();
  await expect(mg.locator('#mgTabs .mg-tab[data-tab="inbox"]')).toBeVisible();
  await expect(mg.locator('#mgNoSections')).toBeHidden();

  const a = await fotoFeedback(fb);
  const b = await fotoManage(mg);
  expect(a.barra).toEqual(b.barra);
  for (const tab of SEZIONI) expect(a.dentro[tab]).toEqual(b.dentro[tab]);
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 — LA CHIAVE CHE VA E VIENE: nessun numero rimasto appiccicato.
// ═════════════════════════════════════════════════════════════════════════════
test('#509/3 — da leggibile a illeggibile e ritorno: nessun numero vecchio resta sulle schede', async ({ openTab }) => {
  const leggibile = [
    { _id: 'r1', seq: 1, status: 'unlabeled', name: 'a', text: '1', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'r2', seq: 2, status: 'todo',      name: 'b', text: '2', createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'r3', seq: 3, status: 'archived',  name: 'c', text: '3', createdAt: '2026-08-03T10:00:00Z' },
  ];
  for (const [pagina, apri, setData, selBarra, selAvviso] of [
    ['feedback', apriFeedback, (p, d) => p.evaluate((x) => window.__fbTest.setData(x), d), '#tabs [data-tab="inbox"]', '#noSections'],
    ['manage',   apriManage,   (p, d) => p.evaluate((x) => window.__mgTest.setData(x), d), '#mgTabs .mg-tab[data-tab="inbox"]', '#mgNoSections'],
  ]) {
    const page = await apri(openTab, leggibile);
    await expect(page.locator(selBarra)).toHaveText(`Ricevuti (1)`);
    // Arriva una coda che questo computer non sa leggere.
    await setData(page, CIFRATA);
    await page.waitForTimeout(200);
    await expect(page.locator(selAvviso), `${pagina}: avviso`).toBeVisible();
    await expect(page.locator(selBarra), `${pagina}: la scheda deve sparire`).toBeHidden();
    // …e poi torna leggibile: le sezioni tornano, col numero GIUSTO.
    await setData(page, leggibile);
    await page.waitForTimeout(200);
    await expect(page.locator(selAvviso), `${pagina}: avviso via`).toBeHidden();
    await expect(page.locator(selBarra), `${pagina}: numero giusto`).toHaveText('Ricevuti (1)');
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 — Coda vuota: le due pagine devono dire la stessa cosa.
// ═════════════════════════════════════════════════════════════════════════════
test('#509/3 — coda vuota: stesse sezioni, stessi zeri sulle due pagine', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, []);
  const mg = await apriManage(openTab, []);
  for (const tab of SEZIONI) {
    await expect(fb.locator(`#tabs [data-tab="${tab}"]`)).toHaveText(`${NOMI[tab]} (0)`);
    await expect(mg.locator(`#mgTabs .mg-tab[data-tab="${tab}"]`)).toHaveText(`${NOMI[tab]} (0)`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 7 — Testo ostile: niente esecuzione, niente sezione sbagliata.
// ═════════════════════════════════════════════════════════════════════════════
test('#509/3 — testo ostile (HTML, javascript:, emoji, 10.000 caratteri) non sposta né esegue niente', async ({ openTab }) => {
  const lungo = 'x'.repeat(10000);
  const ostile = [
    { _id: 'h1', seq: 1, status: 'unlabeled', name: '<img src=x onerror="window.__pwn=1">', text: '<script>window.__pwn=1</script>', url: 'javascript:window.__pwn=1', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'h2', seq: 2, status: 'todo', name: '🧨🔥 emoji', text: lungo, createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'h3', seq: 3, status: 'archived', name: '   ', text: '   ', createdAt: '2026-08-03T10:00:00Z' },
  ];
  const fb = await apriFeedback(openTab, ostile);
  const mg = await apriManage(openTab, ostile);
  await fb.waitForTimeout(400);
  await mg.waitForTimeout(400);
  expect(await fb.evaluate(() => window.__pwn)).toBeUndefined();
  expect(await mg.evaluate(() => window.__pwn)).toBeUndefined();
  const a = await fotoFeedback(fb);
  const b = await fotoManage(mg);
  expect(a.barra).toEqual(b.barra);
  for (const tab of SEZIONI) expect(a.dentro[tab]).toEqual(b.dentro[tab]);
  // Nessun link eseguibile costruito dall'URL ostile.
  const hrefs = await fb.locator('.fb-card a').evaluateAll((n) => n.map((x) => x.getAttribute('href') || ''));
  expect(hrefs.some((h) => h.toLowerCase().startsWith('javascript:'))).toBe(false);
});

// ═════════════════════════════════════════════════════════════════════════════
// 8 — Il filtro ⭐ della gemella: il numero di «Archiviati» lo segue anche
// quando il filtro non si vede più (si sta guardando un'altra sezione).
// ═════════════════════════════════════════════════════════════════════════════
test('#509/3 — filtro ⭐ acceso e poi lasciato: che numero legge «Archiviati» dalle altre sezioni', async ({ openTab }) => {
  const coda = [
    { _id: 's1', seq: 1, status: 'archived', name: 'archiviato',        text: '1', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 's2', seq: 2, status: 'todo', starred: true, name: 'preferito in coda', text: '2', createdAt: '2026-08-02T10:00:00Z' },
    { _id: 's3', seq: 3, status: 'unlabeled', name: 'ricevuto',         text: '3', createdAt: '2026-08-03T10:00:00Z' },
  ];
  const mg = await apriManage(openTab, coda);
  const fb = await apriFeedback(openTab, coda);
  await expect(mg.locator('#mgTabs .mg-tab[data-tab="archived"]')).toHaveText('Archiviati (1)');
  await expect(fb.locator('#tabs [data-tab="archived"]')).toHaveText('Archiviati (1)');

  await mg.evaluate(() => window.__mgTest.setTab('archived'));
  await mg.locator('#mgStarFilter').check();
  await mg.waitForTimeout(200);
  // Con il filtro acceso il numero segue la lista mostrata (PATTERNS.md).
  await expect(mg.locator('#mgTabs .mg-tab[data-tab="archived"]')).toHaveText('Archiviati (1)');
  const conFiltro = await mg.locator('#mgList .mg-item').evaluateAll((n) => n.map((x) => x.getAttribute('data-id')));
  expect(conFiltro).toEqual(['s2']);

  // Ora si cambia sezione: il filtro sparisce dalla vista ma resta acceso.
  await mg.evaluate(() => window.__mgTest.setTab('inbox'));
  await mg.waitForTimeout(200);
  const filtroVisibile = await mg.locator('#mgArchiveFilter').isVisible();
  const numeroArchiviati = (await mg.locator('#mgTabs .mg-tab[data-tab="archived"]').innerText()).trim();
  const numeroGemella = (await fb.locator('#tabs [data-tab="archived"]').innerText()).trim();
  // Traccia per il verificatore: il filtro non si vede più, ma il numero è
  // ancora il suo — e la gemella non ha modo di seguirlo.
  test.info().annotations.push({
    type: 'filtro-stella',
    description: `filtro visibile: ${filtroVisibile} · gestione: "${numeroArchiviati}" · feedback: "${numeroGemella}"`,
  });
  expect(numeroArchiviati).toBe(numeroGemella);
});

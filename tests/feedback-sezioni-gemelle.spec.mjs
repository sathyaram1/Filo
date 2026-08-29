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

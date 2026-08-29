// #509 — Un clic, una scheda.
//
// PERCHÉ QUESTI CONTROLLI
//   Sulla pagina dei feedback i pulsanti stanno DENTRO la scheda, in una lista
//   che si riordina da sé. Finché ogni azione ridisegnava la lista, al primo
//   clic la scheda usciva dalla sezione, le altre risalivano e sotto il
//   puntatore FERMO arrivava il pulsante della scheda successiva: il secondo
//   clic cadeva su un ALTRO feedback. Due volte «→ In coda» nei Ricevuti
//   mettevano in coda il primo e marcavano il SECONDO come attacco confermato —
//   la decisione più pesante della pagina, presa per sbaglio e senza avviso.
//   E cliccare due volte veniva naturale proprio perché al primo clic non si
//   vedeva succedere niente.
//
//   Non è un problema di doppio clic veloce: succede anche a quattro decimi di
//   secondo di distanza, ed è per questo che i controlli qui sotto aspettano
//   400 ms tra un clic e l'altro e cliccano alle STESSE COORDINATE (mouse.click),
//   non sul locator — che seguirebbe il pulsante ovunque vada.
//
// PRECONDIZIONE CHE SENZA IL LAVORO FALLISCE
//   Il primo controllo vede due scritture invece di una, e la seconda è uno
//   `attack_confirmed` su un feedback che nessuno voleva toccare.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// Due schede di altezza uguale (stessa lunghezza di testo e titolo): tolta la
// prima, la seconda sale ESATTAMENTE dove stava lei. È la geometria del guasto.
const RICEVUTI = [
  { _id: 'r1', seq: 1, status: 'unlabeled', name: 'Prima segnalazione xx',
    text: 'Testo della prima segnalazione, lungo uguale al secondo.',
    clientId: 'tester-uno', createdAt: '2026-08-20T10:00:00Z' },
  { _id: 'r2', seq: 2, status: 'attack', name: 'Seconda segnalazione',
    text: 'Testo della seconda segnalazione, lungo uguale al primo.',
    clientId: 'tester-due', createdAt: '2026-08-19T10:00:00Z' },
];

async function setupAdmin(page, items, tab) {
  await page.waitForFunction(() => Boolean(window.__fbTest), null, { timeout: 10_000 });
  await page.evaluate(({ list, t }) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.com' });
    window.__fbTest.setData(list);
    if (t) window.__fbTest.setTab(t);
  }, { list: items, t: tab });
  await page.waitForFunction(() => document.querySelectorAll('.fb-card').length > 0, null, { timeout: 10_000 });
}

// Due clic nello STESSO PUNTO, con la pausa che rende la manovra deliberata.
async function clicDueVolteStessoPunto(page, locator) {
  const box = await locator.boundingBox();
  expect(box, 'il pulsante deve essere a schermo').not.toBeNull();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await page.waitForTimeout(400);
  await page.mouse.click(x, y);
  await page.waitForTimeout(300);
  return { x, y };
}

test('#509 — due clic su «→ In coda» spostano un feedback solo, e nessuno finisce marcato come attacco', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(page, RICEVUTI, 'inbox');

  await clicDueVolteStessoPunto(page, page.locator('.fb-act[data-id="r1"][data-to="todo"]'));

  const updates = await page.evaluate(() => window.__updates);
  // Una decisione, una sola: il secondo clic non deve trovare niente da premere.
  expect(updates).toHaveLength(1);
  expect(updates[0].id).toBe('r1');
  expect(updates[0].status).toBe('todo');
  // E soprattutto: la decisione più pesante della pagina non è stata presa da
  // sola su una segnalazione che nessuno aveva scelto.
  expect(updates.some((u) => String(u.status).endsWith('_confirmed'))).toBe(false);
});

test('#509 — due clic su «✓ Risolto» chiudono un feedback solo', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(page, [
    { _id: 'q1', seq: 11, status: 'todo', name: 'In coda uno', text: 'Primo in coda, testo lungo uguale.', createdAt: '2026-08-20T10:00:00Z' },
    { _id: 'q2', seq: 12, status: 'todo', name: 'In coda due', text: 'Secondo in coda, testo lungo uguale.', createdAt: '2026-08-19T10:00:00Z' },
  ], 'queue');

  await clicDueVolteStessoPunto(page, page.locator('.fb-act[data-id="q1"][data-to="done"]'));

  const chiusure = await page.evaluate(() => window.__updates.filter((u) => u.status === 'done'));
  expect(chiusure).toHaveLength(1);
  expect(chiusure[0].id).toBe('q1');
});

test('#509 — due clic su «↩ Ripristina» rimettono in coda un feedback solo', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(page, [
    { _id: 'a1', seq: 21, status: 'archived', name: 'Archiviato uno', text: 'Primo archiviato, testo lungo uguale.', createdAt: '2026-08-20T10:00:00Z' },
    { _id: 'a2', seq: 22, status: 'archived', name: 'Archiviato due', text: 'Secondo archiviato, testo lungo uguale.', createdAt: '2026-08-19T10:00:00Z' },
  ], 'archived');

  await clicDueVolteStessoPunto(page, page.locator('.fb-act[data-id="a1"][data-to="todo"]'));

  const ripristini = await page.evaluate(() => window.__updates);
  expect(ripristini).toHaveLength(1);
  expect(ripristini[0].id).toBe('a1');
  expect(ripristini[0].archiveOverride).toBe('keep_open');
});

test('#509 — al clic si vede cosa è successo, e la scheda non sparisce da sotto il cursore', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(page, RICEVUTI, 'inbox');

  const prima = page.locator('.fb-card[data-id="r1"]');
  const box = await prima.boundingBox();
  await page.locator('.fb-act[data-id="r1"][data-to="todo"]').click();

  // La scheda resta al suo posto e DICE dove è andata.
  await expect(prima).toBeVisible();
  await expect(prima.locator('.fb-esito')).toContainText('In coda');
  const dopo = await prima.boundingBox();
  expect(Math.round(dopo.y)).toBe(Math.round(box.y));
  // Nessun pulsante suo resta premibile.
  await expect(prima.locator('.fb-act')).toHaveCount(0);
  // Il numero della sezione, invece, dice subito la verità: la scheda non è
  // più fra i Ricevuti.
  await expect(page.locator('#tabs [data-tab="inbox"]')).toHaveText('Ricevuti (1)');
  await expect(page.locator('#tabs [data-tab="queue"]')).toHaveText('In coda (1)');

  // La lista si ricompone quando lo chiedi tu: cambiare sezione e tornare
  // indietro toglie la scheda decisa.
  await page.locator('#tabs [data-tab="queue"]').click();
  await page.locator('#tabs [data-tab="inbox"]').click();
  await expect(page.locator('.fb-card[data-id="r1"]')).toHaveCount(0);
});

test('#509 — se gli stati non si leggono la pagina tace invece di scrivere «(0)»', async ({ openTab }) => {
  // Chi non è l'owner riceve lo status CIFRATO: la macchina a stati non ha
  // niente da sciogliere e faceva ricadere tutto in "Ricevuti", risolti
  // compresi, mentre le altre tre sezioni dichiaravano "(0)" — tre numeri che
  // affermano il vuoto dove la verità è che non lo sappiamo.
  const page = await openTab(FEEDBACK_URL);
  await page.waitForFunction(() => Boolean(window.__fbTest), null, { timeout: 10_000 });
  await page.evaluate(() => window.__fbTest.setData([
    { _id: 'c1', seq: 31, status: 'FENC1:blob-illeggibile-su-questa-macchina', statusPublic: 'closed',
      name: 'Una cosa già sistemata', text: 'Prima segnalazione', createdAt: '2026-08-20T10:00:00Z' },
    { _id: 'c2', seq: 32, status: 'FENC1:blob-illeggibile-su-questa-macchina', statusPublic: 'open',
      name: 'Una cosa ancora aperta', text: 'Seconda segnalazione', createdAt: '2026-08-19T10:00:00Z' },
  ]));

  // Niente barra delle sezioni: senza gli stati non c'è nessuna sezione da
  // riempire, e nessun numero da scrivere.
  await expect(page.locator('#tabs')).toBeHidden();
  await expect(page.locator('#noSections')).toBeVisible();
  const testoPagina = await page.locator('main').innerText();
  expect(testoPagina).not.toContain('In coda (0)');
  expect(testoPagina).not.toContain('Risolti (0)');
  expect(testoPagina).not.toContain('Archiviati (0)');

  // Le segnalazioni ci sono tutte, in un elenco solo, e quella chiusa non viene
  // spacciata per "non filtrata": l'unica cosa vera che questa macchina ha in
  // mano è aperta/chiusa.
  await expect(page.locator('.fb-card')).toHaveCount(2);
  await expect(page.locator('.fb-card[data-id="c1"] .fb-state')).toHaveText('Chiusa');
  await expect(page.locator('.fb-card[data-id="c2"] .fb-state')).toHaveText('Aperta');
});

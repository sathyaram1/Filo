// #252 — Le pagine interne ("Aperti per dopo", Cronologia AI, Archivio,
// Scaricamenti, Impostazioni…) hanno UN SOLO indirizzo canonico e UNA SOLA
// scheda: riaprirle mentre sono già aperte riporta l'utente sulla scheda
// esistente invece di creare un doppione. Prima del fix, aprire la stessa
// pagina due volte (o dalla forma legacy `filo://src/pages/…`) generava due o
// tre schede identiche con URL diversi.
//
// ASSERISCE il successo (una sola scheda, riportata a fuoco), non l'assenza di
// un errore. Rimuovendo la deduplica in openTab questi test diventano rossi.

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(30_000);

const openTab = (shell, url) =>
  shell.evaluate((u) => window.filoShell.tabs.open(u), url);
const snapshot = (shell) =>
  shell.evaluate(() => window.filoShell.tabs.snapshot());
const countUrl = (snap, url) =>
  snap.tabs.filter((t) => t.url === url).length;

test('#252 riaprire una pagina interna riporta sulla scheda esistente, non la duplica', async ({ shell }) => {
  await shell.waitForLoadState('domcontentloaded');

  const HOME = 'filo://home/home.html';

  const r1 = await openTab(shell, HOME);
  expect(r1.ok).toBe(true);
  const id1 = r1.id;

  let snap = await snapshot(shell);
  expect(countUrl(snap, HOME)).toBe(1);
  expect(snap.activeId).toBe(id1);

  // Seconda apertura della STESSA pagina → nessun doppione, stessa scheda.
  const r2 = await openTab(shell, HOME);
  expect(r2.ok).toBe(true);
  expect(r2.id).toBe(id1);

  snap = await snapshot(shell);
  expect(countUrl(snap, HOME)).toBe(1);       // ancora UNA sola scheda
  expect(snap.activeId).toBe(id1);            // riportata a fuoco
});

test('#252 la forma legacy filo://src/pages/… collassa sullo stesso indirizzo canonico', async ({ shell }) => {
  await shell.waitForLoadState('domcontentloaded');

  const HOME = 'filo://home/home.html';
  const LEGACY = 'filo://src/pages/home/home.html';

  const r1 = await openTab(shell, HOME);
  const id1 = r1.id;

  // Stessa pagina, ma con l'URL "legacy" prodotto dallo shim getURL: deve
  // riportare alla scheda già aperta, non aprirne una nuova con un altro URL.
  const r2 = await openTab(shell, LEGACY);
  expect(r2.id).toBe(id1);

  const snap = await snapshot(shell);
  expect(countUrl(snap, HOME)).toBe(1);       // una sola scheda "Aperti per dopo"
  expect(countUrl(snap, LEGACY)).toBe(0);     // nessuna scheda con l'URL legacy
});

test('#252 pagine interne diverse restano schede distinte', async ({ shell }) => {
  await shell.waitForLoadState('domcontentloaded');

  const r1 = await openTab(shell, 'filo://home/home.html');
  const r2 = await openTab(shell, 'filo://history/history.html');
  expect(r2.id).not.toBe(r1.id);

  const snap = await snapshot(shell);
  expect(countUrl(snap, 'filo://home/home.html')).toBe(1);
  expect(countUrl(snap, 'filo://history/history.html')).toBe(1);
});

test('#252 la nuova scheda NON è singleton: se ne aprono quante se ne vuole', async ({ shell }) => {
  await shell.waitForLoadState('domcontentloaded');

  const before = countUrl(await snapshot(shell), 'filo://newtab/');
  const r1 = await openTab(shell, 'filo://newtab/');
  const r2 = await openTab(shell, 'filo://newtab/');
  expect(r2.id).not.toBe(r1.id);

  const after = countUrl(await snapshot(shell), 'filo://newtab/');
  expect(after).toBe(before + 2);
});

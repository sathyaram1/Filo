// Unit test per src/shared/downloadTabs.js — la decisione "questa scheda
// esisteva solo per far partire uno scaricamento?".
//
// #412 (scheda mai riempita) e #441 (pagina-ponte "il download partirà a
// breve…"). Il caso #441 chiude una pagina CON contenuto: qui si sorveglia che
// la firma resti stretta — se una sola delle condizioni cade, la scheda resta
// aperta. Pura logica → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'downloadTabs.js'));
const { decideCloseOnDownload, BRIDGE_MAX_AGE_MS } = globalThis.SN_DOWNLOAD_TABS;

const NOW = 1_000_000;
// Scheda-ponte da manuale: aperta da un link, pagina caricata un attimo fa,
// mai toccata, nessuna navigazione fatta dentro.
const bridge = (over = {}) => ({
  isInternal: false,
  everNavigated: true,
  openedByLink: true,
  canBack: false,
  userInputAt: null,
  navigatedAt: NOW - 2000,
  now: NOW,
  ...over,
});

test('#412 — scheda che non ha mai committato una pagina: si chiude', () => {
  const r = decideCloseOnDownload(bridge({ everNavigated: false, openedByLink: false, navigatedAt: null }));
  assert.equal(r.close, true);
  assert.equal(r.reason, 'blank');
});

test('#441 — pagina-ponte con contenuto: si chiude', () => {
  const r = decideCloseOnDownload(bridge());
  assert.equal(r.close, true);
  assert.equal(r.reason, 'bridge');
});

test('#441 — la scheda resta aperta se l’utente ci è arrivato da sé (non da un link)', () => {
  assert.equal(decideCloseOnDownload(bridge({ openedByLink: false })).close, false);
});

test('#441 — la scheda resta aperta se l’utente l’ha toccata', () => {
  assert.equal(decideCloseOnDownload(bridge({ userInputAt: NOW - 500 })).close, false);
});

test('#441 — la scheda resta aperta se ci si è navigato dentro (ha un indietro)', () => {
  assert.equal(decideCloseOnDownload(bridge({ canBack: true })).close, false);
});

test('#441 — la scheda resta aperta se lo scaricamento parte molto dopo il caricamento', () => {
  const late = bridge({ navigatedAt: NOW - (BRIDGE_MAX_AGE_MS + 1000) });
  assert.equal(decideCloseOnDownload(late).close, false);
  // …ma dentro la finestra si chiude ancora.
  assert.equal(decideCloseOnDownload(bridge({ navigatedAt: NOW - (BRIDGE_MAX_AGE_MS - 1000) })).close, true);
});

test('#441 — senza il momento del caricamento non si chiude niente', () => {
  assert.equal(decideCloseOnDownload(bridge({ navigatedAt: null })).close, false);
});

test('le pagine interne di Filo non vengono mai chiuse', () => {
  assert.equal(decideCloseOnDownload(bridge({ isInternal: true })).close, false);
  assert.equal(decideCloseOnDownload(bridge({ isInternal: true, everNavigated: false })).close, false);
});

test('segnali assenti/malformati: non si chiude niente per sbaglio', () => {
  assert.equal(decideCloseOnDownload({ everNavigated: true }).close, false);
  assert.equal(decideCloseOnDownload(undefined).close, true, 'nessun segnale = contenitore vuoto (#412)');
});

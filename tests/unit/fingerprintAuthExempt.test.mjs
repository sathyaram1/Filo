// Le pagine dei provider di identità (Google, Microsoft, GitHub, …) non devono
// ricevere il rumore anti-fingerprint: i motori antifrode di questi provider
// usano proprio i segnali canvas/WebGL/audio per riconoscere un browser
// genuino, e alterarli fa scattare il blocco "Si è verificato un errore
// durante l'accesso" al login (feedback #209 — l'utente non riusciva ad
// accedere a claude.ai via "Continua con Google" anche dopo la pulizia della
// user-agent e lo sblocco del popup OAuth).
//
// Precondizione di regressione: senza l'esenzione, configForHref('https://
// accounts.google.com/...') tornerebbe { level: 1 (o 2), seed: <diverso da 0> }
// come qualunque altro sito — questo test diventa rosso se quel ramo sparisce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FP = require('../../src/main/services/fingerprint.js');

test('accounts.google.com (login OAuth) è esente dal rumore anti-fingerprint in modalità default', () => {
  FP.setMode({ security: { fingerprint: { mode: 'default' } } });
  const cfg = FP.configForHref('https://accounts.google.com/o/oauth2/v2/auth?client_id=x&response_type=code&redirect_uri=https://claude.ai/api/auth/callback');
  assert.equal(cfg.level, 0, 'il login Google deve avere livello 0 (nessun rumore)');
  assert.equal(cfg.seed, 0);
});

test('accounts.google.com è esente anche in modalità privacy (livello 2)', () => {
  FP.setMode({ security: { fingerprint: { mode: 'privacy' } } });
  const cfg = FP.configForHref('https://accounts.google.com/signin/oauth');
  assert.equal(cfg.level, 0);
});

test('login.microsoftonline.com e github.com/login sono esenti (stessi provider noti a authPopup)', () => {
  FP.setMode({ security: { fingerprint: { mode: 'default' } } });
  assert.equal(FP.configForHref('https://login.microsoftonline.com/common/oauth2/authorize').level, 0);
  assert.equal(FP.configForHref('https://github.com/login').level, 0);
});

test('un sito normale (non provider di identità) continua a ricevere il rumore', () => {
  FP.setMode({ security: { fingerprint: { mode: 'default' } } });
  const cfg = FP.configForHref('https://example.com/');
  assert.equal(cfg.level, 1, 'un sito qualunque deve restare protetto');
  assert.notEqual(cfg.seed, 0);
});

test('una pagina normale di claude.ai (non di login/auth) resta protetta normalmente', () => {
  FP.setMode({ security: { fingerprint: { mode: 'default' } } });
  const cfg = FP.configForHref('https://claude.ai/chat/abc123');
  assert.equal(cfg.level, 1);
});

// Regressione: l'esenzione deve valere SOLO per gli host noti (stessa lista di
// authPopup.js), non per l'euristica "questo path/query somiglia a un login
// OAuth". Quell'euristica va bene per decidere se consentire un popup (un falso
// positivo è innocuo), ma qui un falso positivo spegnerebbe la protezione
// anti-fingerprint su un host qualunque — un tracker potrebbe attivarlo apposta
// scegliendo un path "/login" o aggiungendo client_id/redirect_uri in query.
test('un host sconosciuto con path "/login" NON è esente (solo gli host noti lo sono)', () => {
  FP.setMode({ security: { fingerprint: { mode: 'default' } } });
  const cfg = FP.configForHref('https://esempio-qualsiasi.com/login');
  assert.equal(cfg.level, 1, 'un host non elencato non deve poter disattivare la protezione via path');
  assert.notEqual(cfg.seed, 0);
});

test('un host sconosciuto con client_id+redirect_uri in query NON è esente', () => {
  FP.setMode({ security: { fingerprint: { mode: 'default' } } });
  const cfg = FP.configForHref('https://evil.com/track?client_id=1&redirect_uri=2');
  assert.equal(cfg.level, 1, 'un host non elencato non deve poter disattivare la protezione via query');
  assert.notEqual(cfg.seed, 0);
});

// Feedback #299: le app Google in cui l'utente è loggato (Documenti, Drive,
// Gmail…) sono esenti dal rumore anti-fingerprint. Lì il rumore non protegge
// nulla (sei identificato dall'account) ma può alterare i segnali che i
// controlli di sicurezza di Google campionano, facendo scattare il blocco
// "questo browser potrebbe non essere sicuro". Precondizione di regressione:
// senza l'esenzione questi host tornerebbero { level: 1, seed: ≠0 }.
test('Google Documenti (docs.google.com) è esente dal rumore anti-fingerprint', () => {
  FP.setMode({ security: { fingerprint: { mode: 'default' } } });
  const cfg = FP.configForHref('https://docs.google.com/document/d/abc123/edit');
  assert.equal(cfg.level, 0, 'Google Documenti deve avere livello 0 (nessun rumore)');
  assert.equal(cfg.seed, 0);
});

test('Drive, Gmail, Calendar sono esenti (stesse app Google loggate)', () => {
  FP.setMode({ security: { fingerprint: { mode: 'default' } } });
  assert.equal(FP.configForHref('https://drive.google.com/drive/my-drive').level, 0);
  assert.equal(FP.configForHref('https://mail.google.com/mail/u/0/#inbox').level, 0);
  assert.equal(FP.configForHref('https://calendar.google.com/calendar/u/0/r').level, 0);
});

test('le app Google sono esenti anche in modalità privacy (livello 2)', () => {
  FP.setMode({ security: { fingerprint: { mode: 'privacy' } } });
  assert.equal(FP.configForHref('https://docs.google.com/spreadsheets/d/xyz/edit').level, 0);
});

// Regressione: l'esenzione vale SOLO per le app-prodotto elencate, NON per tutto
// il dominio google.com. La ricerca (www.google.com), dove l'utente può NON
// essere loggato, deve restare protetta col rumore.
test('la ricerca Google (www.google.com) NON è esente: resta protetta', () => {
  FP.setMode({ security: { fingerprint: { mode: 'default' } } });
  const cfg = FP.configForHref('https://www.google.com/search?q=filo');
  assert.equal(cfg.level, 1, 'la ricerca Google non deve perdere la protezione anti-fingerprint');
  assert.notEqual(cfg.seed, 0);
});

// Regressione: un host che finge di essere un sottodominio (docs.google.com.evil.com)
// NON deve essere esente. Il match per suffisso è ancorato al punto ('.docs.google.com').
test('un host che imita docs.google.com come sottodominio-esca NON è esente', () => {
  FP.setMode({ security: { fingerprint: { mode: 'default' } } });
  const cfg = FP.configForHref('https://docs.google.com.evil.com/');
  assert.equal(cfg.level, 1, 'un host-esca non deve poter disattivare la protezione');
  assert.notEqual(cfg.seed, 0);
});

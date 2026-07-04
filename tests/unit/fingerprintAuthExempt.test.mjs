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

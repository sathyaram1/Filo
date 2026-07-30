// Unit test per src/shared/authPopup.js — riconoscimento dei popup di login
// (OAuth / "Continua con Google") che il blocco-popup non deve negare (#209).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'authPopup.js'));

const { isAuthPopup, isIdentityAuthSurface } = globalThis.SN_AUTH_POPUP;

test('riconosce i popup dei provider di identità noti', () => {
  // È il caso esatto del feedback: claude.ai apre accounts.google.com.
  assert.equal(isAuthPopup('https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=y'), true);
  assert.equal(isAuthPopup('https://appleid.apple.com/auth/authorize?client_id=x'), true);
  assert.equal(isAuthPopup('https://login.microsoftonline.com/common/oauth2/authorize'), true);
  assert.equal(isAuthPopup('https://github.com/login/oauth/authorize?client_id=x'), true);
});

test('riconosce i provider self-hosted via suffisso host (Auth0/Okta/…)', () => {
  assert.equal(isAuthPopup('https://acme.auth0.com/authorize?client_id=x'), true);
  assert.equal(isAuthPopup('https://dev-123.okta.com/oauth2/v1/authorize'), true);
});

test('riconosce gli endpoint OAuth via path o parametri, su host arbitrari', () => {
  assert.equal(isAuthPopup('https://example.com/oauth2/authorize?client_id=abc&redirect_uri=z'), true);
  assert.equal(isAuthPopup('https://shop.example.com/signin?next=/account'), true);
  // Solo i parametri OAuth, senza path rivelatore.
  assert.equal(isAuthPopup('https://idp.example.org/x?client_id=abc&response_type=code'), true);
});

test('NON scambia per login i popup pubblicitari / link random', () => {
  assert.equal(isAuthPopup('https://ads.tracker.example/redirect?to=spam'), false);
  assert.equal(isAuthPopup('https://example.com/promo?utm_source=popup'), false);
  assert.equal(isAuthPopup('https://news.site/article/12345'), false);
});

test('input non validi → false (nessun crash, nessun falso positivo)', () => {
  assert.equal(isAuthPopup(''), false);
  assert.equal(isAuthPopup(null), false);
  assert.equal(isAuthPopup('javascript:alert(1)'), false);
  assert.equal(isAuthPopup('about:blank'), false);
});

// isIdentityAuthSurface — decide COSA esentare dal rumore anti-fingerprint (#209).
// A differenza di isAuthPopup, sugli host PRODOTTO (github, x, discord, facebook…)
// esenta solo la superficie di accesso; sugli host dedicati esenta l'intero host.

test('host dedicati all\'autenticazione: intero host è superficie di accesso', () => {
  assert.equal(isIdentityAuthSurface('https://accounts.google.com/o/oauth2/v2/auth?client_id=x'), true);
  assert.equal(isIdentityAuthSurface('https://accounts.google.com/ManageAccount'), true);
  assert.equal(isIdentityAuthSurface('https://login.microsoftonline.com/common/oauth2/authorize'), true);
  assert.equal(isIdentityAuthSurface('https://appleid.apple.com/'), true);
  assert.equal(isIdentityAuthSurface('https://auth.openai.com/log-in'), true);
  // Infra auth via suffisso (Auth0/Okta/…): intero host esente.
  assert.equal(isIdentityAuthSurface('https://acme.auth0.com/u/login'), true);
  assert.equal(isIdentityAuthSurface('https://tenant.b2clogin.com/anything'), true);
});

test('host prodotto: esente SOLO sulla superficie di accesso (login/OAuth)', () => {
  // Accesso → esente.
  assert.equal(isIdentityAuthSurface('https://github.com/login'), true);
  assert.equal(isIdentityAuthSurface('https://github.com/login/oauth/authorize?client_id=x'), true);
  assert.equal(isIdentityAuthSurface('https://x.com/i/flow/login'), true);
  assert.equal(isIdentityAuthSurface('https://discord.com/oauth2/authorize?client_id=1&redirect_uri=2'), true);
  assert.equal(isIdentityAuthSurface('https://slack.com/signin'), true);
  assert.equal(isIdentityAuthSurface('https://gitlab.com/users/sign_in'), true);
  // Navigazione pubblica → NON esente (torna protetta dal rumore).
  assert.equal(isIdentityAuthSurface('https://github.com/torvalds/linux'), false);
  assert.equal(isIdentityAuthSurface('https://x.com/home'), false);
  assert.equal(isIdentityAuthSurface('https://discord.com/channels/@me'), false);
  assert.equal(isIdentityAuthSurface('https://www.facebook.com/marketplace'), false);
});

test('host prodotto: parametri OAuth in query bastano a esentare la superficie di accesso', () => {
  assert.equal(isIdentityAuthSurface('https://github.com/x?client_id=1&redirect_uri=2'), true);
});

test('host sconosciuti non sono mai esenti, nemmeno con path/query da login', () => {
  assert.equal(isIdentityAuthSurface('https://esempio-qualsiasi.com/login'), false);
  assert.equal(isIdentityAuthSurface('https://evil.com/track?client_id=1&redirect_uri=2'), false);
});

test('isIdentityAuthSurface: input non validi → false', () => {
  assert.equal(isIdentityAuthSurface(''), false);
  assert.equal(isIdentityAuthSurface(null), false);
  assert.equal(isIdentityAuthSurface('javascript:alert(1)'), false);
  assert.equal(isIdentityAuthSurface('about:blank'), false);
});

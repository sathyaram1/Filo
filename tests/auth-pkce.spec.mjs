// Test delle fondamenta auth che NON richiedono Google né Electron:
//  - PKCE: challenge = base64url(sha256(verifier)), charset/lunghezza, no padding
//  - loopback OAuth: il parametro `state` sbagliato viene rifiutato (anti-CSRF)
//
// Il login dal vivo (round-trip col consenso Google) non è testabile qui:
// richiede il Google OAuth Client ID e un'interazione utente reale.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import http from 'node:http';

const require = createRequire(import.meta.url);
const pkce = require('../src/main/auth/pkce.js');
const { _internals } = require('../src/main/auth/google-auth.js');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

test('PKCE: challenge è base64url(sha256(verifier)) senza padding', () => {
  const { verifier, challenge, method, state } = pkce.createPkce();
  expect(method).toBe('S256');
  // verifier nel charset RFC 7636 e lunghezza 43..128
  expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  expect(verifier.length).toBeGreaterThanOrEqual(43);
  expect(verifier.length).toBeLessThanOrEqual(128);
  // challenge ricalcolato in modo indipendente
  const expected = b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
  expect(challenge).toBe(expected);
  expect(challenge).not.toContain('='); // niente padding
  expect(state.length).toBeGreaterThan(0);
});

test('PKCE: verifier e state sono unici a ogni chiamata', () => {
  expect(pkce.createVerifier()).not.toBe(pkce.createVerifier());
  expect(pkce.createState()).not.toBe(pkce.createState());
});

test('loopback OAuth: code valido col giusto state viene accettato', async () => {
  const expectedState = pkce.createState();
  const { redirectUri, waitForCode } = await _internals.startLoopback(expectedState);
  // simula il redirect di Google verso il loopback
  await fetch(`${redirectUri}/?code=abc123&state=${encodeURIComponent(expectedState)}`);
  const code = await waitForCode();
  expect(code).toBe('abc123');
});

test('loopback OAuth: state errato viene RIFIUTATO (anti-CSRF)', async () => {
  const expectedState = pkce.createState();
  const { redirectUri, waitForCode } = await _internals.startLoopback(expectedState);
  await fetch(`${redirectUri}/?code=abc123&state=stato-falso`);
  await expect(waitForCode()).rejects.toThrow(/state/i);
});

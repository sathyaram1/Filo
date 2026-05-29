#!/usr/bin/env node
// Minta un Firebase ID token (valido ~1h) a partire dal refresh token del
// "robot" delle routine, da usare come `Authorization: Bearer <token>` nelle
// PATCH a Firestore per il triage dei feedback.
//
// Contesto: dall'alpha le Firestore rules richiedono un'identità autenticata
// (utente nell'allowlist `routines`/`admins`) per modificare i feedback. La
// routine cloud non può fare login interattivo, quindi custodisce un refresh
// token di un utente Firebase Auth email/password (il Gmail-robot) e lo scambia
// a ogni esecuzione per un id_token fresco. Vedi CLAUDE.md → "Feedback alpha
// tester" per il setup una-tantum del refresh token.
//
// Uso:
//   TOKEN=$(node scripts/routine-fs-auth.mjs)
//   curl ... -H "Authorization: Bearer $TOKEN"
//
// Env richieste:
//   FILO_ROUTINE_REFRESH_TOKEN  (obbligatoria) refresh token del Gmail-robot
//   FILO_FIREBASE_API_KEY       (opzionale)    override della Web API key
//
// Exit codes: 0 ok (id_token su stdout) · 1 manca refresh token ·
//   2 scambio fallito · 3 risposta senza id_token · 4 errore di rete.

// Stessa Web API key pubblica usata in src/shared/feedback.js (progetto filo-8b9cb).
// È una chiave client, non un segreto: può stare in chiaro.
const API_KEY = process.env.FILO_FIREBASE_API_KEY || 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';

const refreshToken = process.env.FILO_ROUTINE_REFRESH_TOKEN;
if (!refreshToken) {
  console.error('[routine-fs-auth] manca la env-var FILO_ROUTINE_REFRESH_TOKEN');
  process.exit(1);
}

const endpoint = `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`;

try {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json).slice(0, 300);
    console.error(`[routine-fs-auth] scambio refresh token fallito (${res.status}): ${msg}`);
    process.exit(2);
  }
  // L'endpoint securetoken usa snake_case (id_token, refresh_token, ...).
  const idToken = json.id_token || json.access_token;
  if (!idToken) {
    console.error('[routine-fs-auth] risposta senza id_token');
    process.exit(3);
  }
  // Solo il token su stdout, niente newline, così $(...) lo cattura pulito.
  process.stdout.write(idToken);
} catch (e) {
  console.error('[routine-fs-auth] errore di rete: ' + (e?.message || e));
  process.exit(4);
}

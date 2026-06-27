// Un 403 di Firestore sul triage feedback deve diventare un messaggio
// AZIONABILE, non il JSON grezzo "Missing or insufficient permissions".
//
// Sintomo (screenshot utente): admin loggato → sposta una card → alert opaco
// "PERMISSION_DENIED". Causa: l'allowlist client (cfg.adminEmails) dice "admin"
// ma il server (Firestore rules) richiede un documento admins/<email> che manca.
// Il messaggio nuovo deve dire QUALE email e DOVE crearla.
//
// Pre-condizione che senza il fix fallirebbe: prima `permissionDeniedHelp` non
// esisteva e l'handler ritornava la stringa grezza. Questi assert diventano
// rossi se si rimuove l'helper (la guida "admins"/email sparisce).

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { permissionDeniedHelp } = require('../src/main/services/feedbackError.js');

test('403 Firestore → messaggio azionabile con email e collezione admins', () => {
  const raw = '{ "error": { "code": 403, "message": "Missing or insufficient permissions.", "status": "PERMISSION_DENIED" } }';
  const msg = permissionDeniedHelp(raw, { email: 'tester@example.com', email_verified: true });

  // Deve citare l'email reale dell'utente e dirgli di crearla in admins.
  expect(msg).toContain('tester@example.com');
  expect(msg).toMatch(/admins/i);
  // Non deve restare il JSON grezzo incomprensibile.
  expect(msg).not.toContain('insufficient permissions');
});

test('403 con email non verificata → avvisa del requisito email verificata', () => {
  const raw = 'firestore update fallito (403): PERMISSION_DENIED';
  const msg = permissionDeniedHelp(raw, { email: 'nv@example.com', email_verified: false });
  expect(msg).toContain('nv@example.com');
  expect(msg).toMatch(/verificat/i); // "email NON verificata"
});

test('errori non-403 passano invariati (nessun falso positivo)', () => {
  const raw = 'Sessione scaduta: rifai l\'accesso.';
  const msg = permissionDeniedHelp(raw, { email: 'x@example.com', email_verified: true });
  expect(msg).toBe(raw); // invariato
});

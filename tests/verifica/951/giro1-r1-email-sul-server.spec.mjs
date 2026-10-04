// Verifica #951, giro 1, rilievo 1: col login Google l'app scrive sul server email, nome, consumi per funzione e
// feedback premiati in un documento per account; il documento sulla privacy dice il contrario.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leggi = (rel) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');
const unaRiga = (s) => s.replace(/\s+/g, ' ');

test('se l\'app manda email e nome al server, il documento sulla privacy non dice che il server ti conosce solo per un codice', () => {
  const crediti = leggi('src/main/services/handlers/credits.js');
  const privacy = unaRiga(leggi('transparency/privacy.md'));
  const mandaEmail = /fields\.email\s*=/.test(crediti) && /fields\.name\s*=/.test(crediti);
  test.skip(!mandaEmail, 'l\'app non scrive più email e nome sul server');
  expect(privacy).not.toContain('ti conoscono solo per un codice interno');
});

test('se l\'app manda al server i consumi per funzione, il documento non dice che i contatori d\'uso restano sul computer', () => {
  const crediti = leggi('src/main/services/handlers/credits.js');
  const privacy = unaRiga(leggi('transparency/privacy.md'));
  const mandaConsumi = /SYNC_FIELDS\s*=\s*\[[^\]]*'byAction'/.test(crediti);
  test.skip(!mandaConsumi, 'l\'app non sincronizza più i consumi per funzione');
  expect(privacy).not.toContain('Oggi Filo non manda al server contatori d\'uso');
});

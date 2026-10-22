// Verifica #1505 giro 1: una risposta con più collegamenti di quanti l'archivio ne tenga fra quelli da confermare.
// Riaperta la chat dopo un riavvio, nessuno dei collegamenti oltre il tetto deve aprirsi senza OK.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r3 riaperta dopo un riavvio, un collegamento oltre il tetto della risposta chiede ancora l\'OK', async () => {
  require(join(REPO, 'src', 'shared', 'chatArchive.js'));
  const V = require(join(REPO, 'src', 'main', 'services', 'verdettiUscite.js'));
  const A = globalThis.SN_CHAT_ARCHIVE;
  V.svuota();
  const indirizzi = Array.from({ length: 5600 }, (_, i) => `https://sito${i}.example/p`);
  const testo = indirizzi.join('\n');
  // La porta lascia passare tutto: i primi 200 sono giudicati, gli altri chiedono l'OK perché nessuno li ha guardati.
  const chiedono = await V.giudica(indirizzi, { porta: async () => ({ blocca: false, exfil: false }) });
  expect(chiedono.length).toBe(5400);
  const archiviato = A.toStoredMessage({ role: 'filo', text: testo, linkDaConfermare: chiedono });
  // Riavvio: il registro riparte vuoto e la chat riaperta lo riempie dall'archivio.
  V.svuota();
  V.ricordaArchiviati([archiviato], (t) => t.split('\n'));
  const ultimo = indirizzi[indirizzi.length - 1];
  const v = V.alClic(ultimo, { proposta: true });
  expect(v.daChiedere, 'l\'ultimo collegamento, mai guardato dalla porta, si apre senza OK').toBe(true);
});

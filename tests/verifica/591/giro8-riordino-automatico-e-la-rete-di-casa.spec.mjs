// Verifica #591 — giro 8. Il riordino automatico delle schede manda al modello
// il testo delle pagine della rete di casa.
//
// Il giro 5 ha chiuso questa porta sul riconoscimento del blocco geografico:
// quella funzione parte da sola e si porta dietro il CONTENUTO della pagina,
// quindi sugli indirizzi della rete di casa — il pannello del router, il NAS,
// l'applicazione in prova sulla propria macchina — non deve partire. La stessa
// domanda vale per il riordino automatico delle schede, che è acceso di serie,
// parte da solo dopo qualche ora di inattività e manda al modello indirizzo,
// titolo ed estratto del testo di ogni scheda non attiva.
//
// L'esclusione esiste già ed è una domanda sola (isHostPrivato): qui non la
// legge nessuno. Logica pura: nessun Electron, nessuna rete.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const T = require_(join(REPO, 'src/shared/tabTriage.js'));
const GB = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));
const psl = require_(join(REPO, 'src/main/services/safebrowse/psl.js'));

// Gli stessi indirizzi con cui i giri 2, 5 e 6 hanno chiuso la porta altrove.
const CASA = [
  'http://192.168.1.1/admin',
  'http://10.0.0.5/setup',
  'http://172.16.4.2/status',
  'http://127.0.0.1:3000/',
  'http://localhost:8080/',
  'http://mio-nas.local/files',
  'http://stampante.lan/',
];

test('le pagine della rete di casa non entrano nel riordino automatico', () => {
  for (const url of CASA) {
    const host = new URL(url).hostname;
    expect(psl.isHostPrivato(host), `${host} è un indirizzo della rete di casa`).toBe(true);
    expect(
      T.isTriageableUrl(url),
      `il riordino automatico manda al modello indirizzo, titolo ed estratto di ogni scheda che prende: ${url} non deve entrarci`,
    ).toBe(false);
  }
});

test('caso di riscontro: fuori casa il riordino prende le schede, e l\'esclusione esiste già', () => {
  expect(T.isTriageableUrl('https://www.esempio.com/articolo')).toBe(true);
  // La funzione gemella la stessa domanda se la fa dal quinto giro.
  expect(GB.shouldClassify({ statusCode: 403, text: 'Access denied', host: '192.168.1.1' })).toBe(false);
  expect(GB.shouldClassify({ statusCode: 403, text: 'Access denied', host: 'www.esempio.com' })).toBe(true);
});

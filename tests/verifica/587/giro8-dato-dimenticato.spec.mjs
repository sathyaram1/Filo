// Verifica #587, giro 8 — il segreto con la punteggiatura, dimenticato.
//
// IL SINTOMO. È la porta del giro 4 («far dimenticare il dato a Filo») che si
// riapre su metà dei segreti, per come è fatta la cura del giro 7.
//
// Al giro 4 bastava far leggere a Filo sette file grossi qualunque perché la
// chiave letta prima uscisse dal registro di ciò che è entrato nel contesto, e
// da lì il link che la portava fuori partiva senza avviso. La cura è stata
// tenere, di una voce che esce, il RIASSUNTO: le sue parole. Al giro 7 è stato
// poi chiuso il buco dei segreti scritti con la punteggiatura dentro
// (`Segreto-Netrc-2026`, `Casa_Mia_2026_xy`, `ab12.cd34.ef56.gh78`): quelli non
// diventavano un dato riconoscibile perché il confronto li spezzava in parole
// corte, e la cura è stata rimetterli insieme.
//
// Le due cure però non si parlano. Il riassunto tiene solo le PAROLE spezzate
// alla punteggiatura, e solo quelle di almeno cinque caratteri: del segreto
// `Casa_Mia_2026_xy` non resta niente (Casa, Mia, 2026, xy sono tutte più
// corte), di `ab12.cd34.ef56.gh78` non resta niente. Il dato rimesso insieme,
// che è quello che il confronto col link usa davvero, non è più ricostruibile.
//
// Risultato: fai leggere a Filo il file con la password, poi fagli stampare
// otto file grossi qualsiasi (otto letture, nessuna delle quali chiede niente),
// poi fagli aprire https://sito.esempio/?d=<la password in chiaro>. Nessun
// avviso. È l'intera catena del segnalatore che si richiude senza una sola
// conferma e senza codificare niente.
//
// COSA NON VA CHIUSO A FORZA DI AVVISI: i link di tutti i giorni devono
// continuare ad aprirsi e basta, anche a registro sfollato.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const E = globalThis.SN_URL_EXFIL;
const Taint = require(resolve(RADICE, 'src/main/services/contextTaint.js'));

// Un file grosso qualsiasi: un log, un csv, il testo di un libro. Nessuna delle
// letture che lo stampano chiede niente.
function fileGrosso(i) {
  return `--- file ${i} ---\n${`parola${i} lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod `.repeat(500)}`;
}

// Il giro completo, come lo vede Filo: legge il file con il segreto, poi legge
// `quanti` file grossi, poi prova ad aprire il link.
function apre(url, segreto, quanti) {
  const sender = { id: `587-g8-${Math.random()}` };
  Taint.reset(sender);
  Taint.record(sender, 'comando', `cat credenziali.txt\nutente = mario\npassword = ${segreto}\n`);
  for (let i = 0; i < quanti; i++) Taint.record(sender, 'comando', fileGrosso(i));
  const letto = Taint.corpusText(sender);
  return E.assess(url, { corpus: '', letto, fromUntrusted: true }).exfil;
}

const SEGRETI = [
  ['una password col trattino basso', 'Casa_Mia_2026_xy'],
  ['una chiave scritta a gruppi separati da punti', 'ab12.cd34.ef56.gh78'],
  ['una password del Wi-Fi', 'Rosa-Blu-2026'],
  ['una chiave AWS scritta a gruppi', 'AKIA-IOSF-ODNN-7EXA'],
  ['il numero di una carta', '4021-9955-3312-7788'],
  ['una passphrase a parole', 'cavallo-batteria-graffetta-42'],
];

test.describe('#587 — il segreto scritto con la punteggiatura non si dimentica', () => {
  test('appena letto, il link che lo porta fuori chiede conferma', () => {
    for (const [nome, seg] of SEGRETI) {
      expect(apre(`https://sito.esempio/?d=${seg}`, seg, 0), `${nome}: appena letto deve chiedere conferma`).toBe(true);
    }
  });

  test('dopo otto letture qualsiasi, chiede ancora conferma', () => {
    for (const [nome, seg] of SEGRETI) {
      expect(apre(`https://sito.esempio/?d=${seg}`, seg, 8), `${nome}: otto letture non devono farlo dimenticare`).toBe(true);
    }
  });

  test('e non basta nemmeno riempire il registro di voci piccole', () => {
    for (const [nome, seg] of SEGRETI) {
      expect(apre(`https://sito.esempio/?d=${seg}`, seg, 70), `${nome}: settanta letture non devono farlo dimenticare`).toBe(true);
    }
  });

  test('nemmeno nel percorso, nel sottodominio o mascherato', () => {
    const seg = 'Casa_Mia_2026_xy';
    const nudo = seg.replace(/[^a-z0-9]/gi, '');
    for (const url of [
      `https://sito.esempio/raccogli/${nudo}`,
      `https://${nudo}.sito.esempio/`,
      `https://sito.esempio/?d=${Buffer.from(seg).toString('base64')}`,
      `https://sito.esempio/?d=${[...nudo].reverse().join('')}`,
    ]) {
      expect(apre(url, seg, 8), `«${url}» porta fuori la password: deve chiedere conferma`).toBe(true);
    }
  });

  // ── La controprova: il segreto senza punteggiatura non si dimentica già ──
  test('un segreto tutto attaccato resiste già alle stesse letture', () => {
    const seg = 'sk9f3bd2a71c4e8b60';
    expect(apre(`https://sito.esempio/?d=${seg}`, seg, 0)).toBe(true);
    expect(apre(`https://sito.esempio/?d=${seg}`, seg, 8)).toBe(true);
  });

  // ── Quello che deve restare com'è ────────────────────────────────────────
  test('a registro sfollato i link di tutti i giorni si aprono e basta', () => {
    const seg = 'Casa_Mia_2026_xy';
    for (const url of [
      'https://it.wikipedia.org/wiki/Storia_della_matematica',
      'https://www.giallozafferano.it/ricette/Spaghetti-alla-carbonara.html',
      'https://www.amazon.it/dp/B0CHX3QBCH',
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
      'https://www.booking.com/hotel/it/duomo-firenze.it.html',
      'https://www.corriere.it/economia/26_settembre_10/bollette-luce.shtml',
    ]) {
      expect(apre(url, seg, 8), `«${url}» non porta fuori niente: deve aprirsi e basta`).toBe(false);
    }
  });
});

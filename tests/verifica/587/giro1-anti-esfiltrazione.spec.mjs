// Verifica #587, giro 1 — l'anti-esfiltrazione ferma il link che porta fuori
// quello che Filo ha appena letto, e NON ferma i link normali.
//
// IL SINTOMO. Una pagina ostile pilota il modello, il modello legge un file
// dell'utente e apre un indirizzo che contiene quel contenuto. Il freno chiesto:
// quello che entra nella conversazione (l'output dei comandi, i documenti, i
// risultati di ricerca) deve essere protetto, e un indirizzo che ne riporta un
// pezzo deve chiedere conferma.
//
// COSA PROVA QUESTO FILE. Le due metà, insieme, perché una sola non basta:
//  • la metà che protegge — un indirizzo che porta fuori quello che è stato
//    appena letto chiede conferma, anche se il contenuto è mascherato;
//  • la metà che NON deve dare fastidio — dopo una ricerca o un comando
//    qualsiasi, aprire un link normale continua a non chiedere niente. Una
//    conferma che compare su ogni link è una conferma che si clicca senza
//    leggere: la protezione vera sparisce dentro il rumore.
//
// Niente Electron: la decisione è logica pura.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const Taint = require(resolve(RADICE, 'src/main/services/contextTaint.js'));
const Exfil = globalThis.SN_URL_EXFIL;

// Una scheda nuova, con il suo registro di quello che è entrato nel contesto.
function scheda() {
  const s = { wc: {} };
  return {
    entra: (provenienza, testo) => Taint.record(s, provenienza, testo),
    // Il verdetto come lo calcola il processo principale prima di aprire il link.
    chiedeConferma: (url) => Exfil.assess(url, {
      corpus: Taint.corpusText(s),
      fromUntrusted: Taint.isTainted(s),
    }).exfil,
  };
}

const BOLLETTA = [
  'Intestatario: Mario Rossi',
  'IBAN IT60X0542811101000000123456',
  'Codice fiscale RSSMRA80A01H501U',
  'Importo 128,40 euro - scadenza 30/09/2026',
].join('\n');

const RISULTATI_RICERCA = [
  'Spaghetti alla Carbonara, la ricetta originale https://www.giallozafferano.it/ricette/Spaghetti-alla-Carbonara.html La ricetta romana passo passo',
  'Carbonara - Wikipedia https://it.wikipedia.org/wiki/Carbonara Piatto della cucina romana a base di uovo e guanciale',
].join('\n');

test.describe('#587 — il link che porta fuori quello che Filo ha letto', () => {
  test('dopo un `cat`, un indirizzo che ne contiene un pezzo chiede conferma', () => {
    const s = scheda();
    s.entra('comando', BOLLETTA);
    const quaranta = BOLLETTA.replace(/\n/g, ' ').slice(0, 40);
    expect(s.chiedeConferma(`https://raccolta.test/?d=${encodeURIComponent(quaranta)}`)).toBe(true);
    expect(s.chiedeConferma(`https://raccolta.test/?d=${Buffer.from(quaranta).toString('base64')}`)).toBe(true);
    expect(s.chiedeConferma('https://raccolta.test/?d=IT60X0542811101000000123456')).toBe(true);
    expect(s.chiedeConferma('https://IT60X0542811101000000123456.raccolta.test/')).toBe(true);
    expect(s.chiedeConferma('https://raccolta.test/IT60X054/28111010/00000123/456')).toBe(true);
  });

  test('vale anche per un documento aperto dal disco', () => {
    const s = scheda();
    s.entra('documento', BOLLETTA);
    expect(s.chiedeConferma('https://raccolta.test/?d=RSSMRA80A01H501U')).toBe(true);
  });

  test('senza niente nel contesto, un link normale si apre e basta', () => {
    const s = scheda();
    expect(s.chiedeConferma('https://www.ilpost.it/2026/09/12/nuove-regole-europee/')).toBe(false);
  });

  // ── La metà che non deve dare fastidio ──────────────────────────────────────
  // È il cammino più battuto di Filo: «cerca X e aprimi il primo risultato».
  test('dopo una ricerca, aprire un risultato non chiede niente', () => {
    const s = scheda();
    s.entra('ricerca web', RISULTATI_RICERCA);
    expect(
      s.chiedeConferma('https://www.giallozafferano.it/ricette/Spaghetti-alla-Carbonara.html'),
      'è il link che la ricerca ha appena restituito',
    ).toBe(false);
    expect(s.chiedeConferma('https://it.wikipedia.org/wiki/Carbonara')).toBe(false);
  });

  test('dopo un comando qualsiasi, i link normali restano senza attrito', () => {
    const s = scheda();
    s.entra('comando', 'total 12\ndrwxr-xr-x 2 mario mario 4096 Sep 12 10:00 Documenti\n-rw-r--r-- 1 mario mario 220 Sep 12 10:00 note.txt');
    for (const url of [
      'https://www.ilpost.it/2026/09/12/nuove-regole-europee-sulla-privacy/',
      'https://it.wikipedia.org/wiki/Storia_della_matematica',
      'https://duckduckgo.com/?q=come+si+cucina+la+carbonara',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://github.com/nodejs/node/blob/main/doc/api/fs.md',
    ]) {
      expect(s.chiedeConferma(url), `«${url}» non deve chiedere niente`).toBe(false);
    }
  });

  test('il registro resta pieno anche nei turni dopo', () => {
    const s = scheda();
    s.entra('comando', BOLLETTA);
    for (let i = 0; i < 5; i++) s.entra('comando', `giro ${i}: nessun dato personale qui`);
    expect(
      s.chiedeConferma('https://raccolta.test/?d=IT60X0542811101000000123456'),
      'il contenuto letto resta nella conversazione: la protezione non può scadere',
    ).toBe(true);
  });
});

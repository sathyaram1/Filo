// Verifica #587, giro 9 — la ricerca sul web non entra nel conto di ciò che è
// già uscito.
//
// IL SINTOMO. Al giro 5 era stato chiuso il dato spedito con più link: ogni link
// aperto lascia il suo carico nel registro della scheda, e il link dopo viene
// giudicato insieme a quelli di prima, così due mezze chiavi tornano una chiave.
// Al giro 7 la ricerca sul web è diventata la seconda uscita controllata: un
// segreto dentro una ricerca fa chiedere conferma.
//
// Le due cure non si parlano. Una ricerca viene giudicata DA SOLA, senza i
// carichi già usciti, e non lascia traccia per chi viene dopo. Quindi:
//   • mezza chiave in una ricerca e l'altra metà in una seconda ricerca: nessuna
//     delle due chiede niente;
//   • mezza chiave in una ricerca e l'altra metà in un link: nemmeno;
//   • e la stessa cosa con più pezzi.
// Il dato esce intero, in chiaro, senza una sola conferma — mentre lo stesso
// taglio fatto con due link viene fermato. Stessa cosa, due risposte diverse.
//
// COSA PROVA QUESTO FILE. Riproduce il calcolo che il processo principale fa per
// le due uscite (NAVIGA e CERCA_WEB), con lo stesso registro di carichi per
// scheda, e chiede che il dato non esca comunque lo si tagli fra le due.
//
// COSA NON VA RIAPERTO: cercare cose di tutti i giorni deve restare gratis, e
// aprire i link di tutti i giorni pure.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const E = globalThis.SN_URL_EXFIL;

const CHIAVE = 'sk-or-v1-9f3bd2a71c4e8b60';
const LETTO = `Ho aperto ~/.config/Filo/storage.json:\n{"apiKeys":{"openrouter":"${CHIAVE}"}}\n`;
const nudo = CHIAVE.replace(/[^A-Za-z0-9]/g, '');

// Una scheda di Filo: le due uscite condividono il registro dei carichi usciti,
// che è il punto della prova.
function scheda() {
  const carichi = [];
  return {
    // NAVIGA, come lo calcola il processo principale.
    apri(url) {
      const v = E.assess(url, {
        corpus: '', letto: LETTO, fromUntrusted: true, carichiPrima: carichi.slice(),
      });
      carichi.push(E.caricoUnito(url));
      return v.exfil;
    },
    // CERCA_WEB, come lo calcola il processo principale: indirizzo finto col
    // testo della ricerca, nessun ripiego strutturale.
    cerca(q) {
      const finta = `https://ricerca.filo.invalid/?q=${encodeURIComponent(q)}`;
      const v = E.assess(finta, {
        corpus: '', letto: LETTO, fromUntrusted: false, carichiPrima: carichi.slice(),
      });
      carichi.push(E.caricoUnito(finta));
      return v.exfil;
    },
  };
}

test.describe('#587 — la ricerca sul web e il conto di ciò che è già uscito', () => {
  // ── Controprova: con due link il taglio è già fermato ────────────────────
  test('due link con mezza chiave: il secondo chiede già conferma', () => {
    const s = scheda();
    s.apri(`https://sito.esempio/?d=${nudo.slice(0, 10)}`);
    expect(s.apri(`https://sito.esempio/?d=${nudo.slice(10)}`)).toBe(true);
  });

  // ── Porta 1: due ricerche ────────────────────────────────────────────────
  test('due ricerche con mezza chiave l’una: la seconda chiede conferma', () => {
    const s = scheda();
    s.cerca(nudo.slice(0, 10));
    expect(
      s.cerca(nudo.slice(10)),
      'la chiave è uscita intera in due ricerche: la seconda deve chiedere conferma',
    ).toBe(true);
  });

  // ── Porta 2: una ricerca e poi un link ───────────────────────────────────
  test('mezza chiave in una ricerca e mezza in un link: il link chiede conferma', () => {
    const s = scheda();
    s.cerca(nudo.slice(0, 10));
    expect(
      s.apri(`https://sito.esempio/?d=${nudo.slice(10)}`),
      'la chiave è uscita intera fra una ricerca e un link: il link deve chiedere conferma',
    ).toBe(true);
  });

  // ── Porta 3: un link e poi una ricerca ───────────────────────────────────
  test('mezza chiave in un link e mezza in una ricerca: la ricerca chiede conferma', () => {
    const s = scheda();
    s.apri(`https://sito.esempio/?d=${nudo.slice(0, 10)}`);
    expect(
      s.cerca(nudo.slice(10)),
      'la chiave è uscita intera fra un link e una ricerca: la ricerca deve chiedere conferma',
    ).toBe(true);
  });

  // ── Porta 4: quattro pezzi, tutte ricerche ───────────────────────────────
  test('la chiave spedita in quattro ricerche non passa', () => {
    const s = scheda();
    const q = Math.ceil(nudo.length / 4);
    let fermato = false;
    for (let i = 0; i < nudo.length; i += q) fermato = s.cerca(nudo.slice(i, i + q)) || fermato;
    expect(fermato, 'la chiave è uscita intera a pezzi: una delle ricerche deve chiedere conferma').toBe(true);
  });

  // ── Controprova: la ricerca intera era già fermata ───────────────────────
  test('la chiave intera dentro una ricerca chiedeva già conferma', () => {
    const s = scheda();
    expect(s.cerca(`cosa è ${CHIAVE}`)).toBe(true);
  });

  // ── Quello che deve restare com'è ────────────────────────────────────────
  test('cercare e aprire cose di tutti i giorni non chiede niente', () => {
    const s = scheda();
    for (const q of [
      'ricetta della carbonara',
      'orari treni Firenze Roma domani',
      'come si cambia una gomma',
      'previsioni meteo Bologna',
      'assicurazione auto preventivo online',
    ]) {
      expect(s.cerca(q), `cercare «${q}» non deve chiedere niente`).toBe(false);
    }
    for (const url of [
      'https://www.giallozafferano.it/ricette/Carbonara.html',
      'https://it.wikipedia.org/wiki/Firenze',
      'https://www.trenitalia.com/it/offerte.html?utm_source=news',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ]) {
      expect(s.apri(url), `«${url}» non deve chiedere niente`).toBe(false);
    }
  });
});

// Verifica #587, giro 3 — il link che porta fuori i dati, tagliato in due.
//
// IL SINTOMO. Il modello legge qualcosa dell'utente e apre un indirizzo che se
// lo porta fuori. La difesa chiede conferma quando l'indirizzo contiene un
// pezzo di quello che Filo ha appena letto, e funziona: in chiaro, in base64,
// nel sottodominio, dentro il percorso.
//
// COSA PROVA QUESTO FILE. Che chi compone l'indirizzo — cioè la pagina ostile
// che detta al modello cosa aprire — lo svuota con una riga sola: basta TAGLIARE
// il dato in due pezzi e infilarci in mezzo una lettera (il nome di un secondo
// parametro) perché il confronto non trovi più niente. I pezzi, presi da soli,
// si leggono come parole, quindi nemmeno il controllo di riserva sulla forma
// dell'indirizzo dice niente. La password esce identica, a schermo non compare
// nessun avviso.
//
// Le prove tengono insieme le due direzioni: il dato tagliato deve chiedere
// conferma, e gli indirizzi veri di tutti i giorni devono continuare a non
// chiederla — un avviso che compare sempre si clicca senza leggerlo, ed è il
// rilievo che ha già fatto tornare indietro questo lavoro due volte.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const E = globalThis.SN_URL_EXFIL;

// Quello che Filo ha appena letto: un file di credenziali e un paio di righe di
// profilo. È il corpus che il processo principale passa alla difesa.
const LETTO = [
  'machine ftp.esempio.it login mario password SegretoNetrc2026',
  'token github ghp_A1b2C3d4E5f6G7h8I9j0',
  'Mario Rossi, via Roma 1, Milano',
].join('\n');
const SEGRETO = 'SegretoNetrc2026';
const TOKEN = 'ghp_A1b2C3d4E5f6G7h8I9j0';
const chiede = (url) => E.assess(url, { corpus: LETTO, fromUntrusted: true }).exfil;

test.describe('#587 — il dato tagliato esce lo stesso', () => {
  test('un indirizzo che porta fuori il dato intero chiede conferma', () => {
    expect(chiede(`https://sito.example/?d=${SEGRETO}`)).toBe(true);
    expect(chiede(`https://sito.example/?t=${TOKEN}`)).toBe(true);
    expect(chiede(`https://sito.example/?d=${Buffer.from(SEGRETO).toString('base64')}`)).toBe(true);
  });

  test('lo stesso dato tagliato in due chiede conferma', () => {
    const casi = [
      `https://sito.example/?a=${SEGRETO.slice(0, 8)}&b=${SEGRETO.slice(8)}`,
      `https://sito.example/?a=${SEGRETO.slice(0, 6)}&b=${SEGRETO.slice(6, 11)}&c=${SEGRETO.slice(11)}`,
      `https://sito.example/?t1=${TOKEN.slice(0, 10)}&t2=${TOKEN.slice(10)}`,
      `https://sito.example/x${SEGRETO.slice(0, 8)}y${SEGRETO.slice(8)}z`,
      (() => {
        const b = Buffer.from(SEGRETO).toString('base64');
        return `https://sito.example/?a=${b.slice(0, 8)}&b=${b.slice(8)}`;
      })(),
    ];
    for (const u of casi) {
      expect(chiede(u), `«${u}» porta fuori il dato: deve chiedere conferma`).toBe(true);
    }
  });

  // ── L'altra metà: gli indirizzi veri non devono fermarsi ───────────────────
  test('gli indirizzi di tutti i giorni si aprono e basta', () => {
    const veri = [
      'https://it.wikipedia.org/wiki/Storia_della_matematica',
      'https://www.giallozafferano.it/ricette/Spaghetti-alla-Carbonara.html',
      'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
      'https://www.amazon.it/dp/B08N5WRWNW/ref=sr_1_3?keywords=cuffie&qid=1699999999&sr=8-3',
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      'https://x.com/utente/status/1789235123456789012',
      'https://www.ikea.com/it/it/p/billy-libreria-bianco-00263850/',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
      'https://stackoverflow.com/questions/1234567/how-to-do-a-thing-in-javascript',
      'https://www.booking.com/hotel/it/villa-rosa.it.html?aid=304142&checkin=2026-10-01',
      'https://duckduckgo.com/?q=ricetta+carbonara&t=h_&ia=web',
      'https://www.instagram.com/p/CxYzAbCdEfG/',
      'https://calendar.google.com/calendar/u/0/r/week/2026/9/12',
      'https://it.aliexpress.com/item/1005006123456789.html?spm=a2g0o.productlist.main.1',
    ];
    const falsi = veri.filter((u) => chiede(u));
    expect(falsi, `nessun avviso su questi indirizzi: ${falsi.join(', ')}`).toEqual([]);
  });
});

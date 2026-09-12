// Verifica #587, giro 9 — il dato riscritto con le lettere «a larghezza piena».
//
// IL SINTOMO. I travestimenti chiusi nei giri passati sono base64, esadecimale,
// base32, il dato scritto all'indietro e l'alfabeto scorso. Ne resta uno che non
// è nemmeno una codifica: riscrivere le stesse lettere con i loro gemelli
// Unicode a larghezza piena (Ｓ invece di S). Chi riceve l'indirizzo legge la
// stessa identica password; il confronto no, perché prima di guardare tiene solo
// i caratteri da «a» a «z» e da «0» a «9», e quei gemelli non sono nessuno dei
// due: della password non resta niente da confrontare.
//
//   https://sito.esempio/?d=<la chiave>                → chiede conferma
//   https://sito.esempio/?d=<la chiave a larghezza piena> → non chiede niente
//
// È un miglioramento senza contropartita: gli indirizzi veri sono scritti in
// ASCII, quindi ricondurre quei gemelli alle lettere normali non può far
// comparire nessun avviso nuovo — le prove qui sotto lo pretendono.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const E = globalThis.SN_URL_EXFIL;

const CHIAVE = 'sk-or-v1-9f3bd2a71c4e8b60';
const PASSWORD = 'Segreto-Netrc-2026';
const LETTO = `chiave API: ${CHIAVE}\nmachine ftp.casa.it password ${PASSWORD}\n`;

const chiede = (url) => E.assess(url, { corpus: '', letto: LETTO, fromUntrusted: true }).exfil;
// I gemelli Unicode «a larghezza piena» delle lettere e delle cifre ASCII.
const largo = (s) => [...s].map((c) => (/[!-~]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xFEE0) : c)).join('');

test.describe('#587 — le lettere a larghezza piena', () => {
  test('la chiave riscritta a larghezza piena fa chiedere conferma', () => {
    for (const url of [
      `https://sito.esempio/?d=${encodeURIComponent(largo(CHIAVE))}`,
      `https://sito.esempio/?d=${encodeURIComponent(largo(CHIAVE.replace(/-/g, '')))}`,
      `https://sito.esempio/${encodeURIComponent(largo(CHIAVE))}`,
      `https://sito.esempio/?d=${encodeURIComponent(largo(PASSWORD))}`,
    ]) {
      expect(chiede(url), `«${url}» porta fuori un segreto: deve chiedere conferma`).toBe(true);
    }
  });

  test('lo stesso dato in lettere normali chiedeva già conferma', () => {
    for (const url of [
      `https://sito.esempio/?d=${CHIAVE}`,
      `https://sito.esempio/?d=${PASSWORD}`,
    ]) {
      expect(chiede(url), `«${url}» chiedeva già conferma`).toBe(true);
    }
  });

  test('gli indirizzi di tutti i giorni restano muti', () => {
    for (const url of [
      'https://it.wikipedia.org/wiki/Storia_della_matematica',
      'https://www.giallozafferano.it/ricette/Carbonara.html',
      'https://www.amazon.it/dp/B0CHX3QBCH',
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      'https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC',
      'https://www.google.com/search?q=%E3%82%AB%E3%83%AB%E3%83%9C%E3%83%8A%E3%83%BC%E3%83%A9',
    ]) {
      expect(chiede(url), `«${url}» non porta fuori niente`).toBe(false);
    }
  });
});

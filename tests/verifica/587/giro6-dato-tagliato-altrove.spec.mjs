// Verifica #587, giro 6 — il dato spedito con più link, tagliato in un altro punto.
//
// IL SINTOMO. Al giro 5 era stata chiusa la porta del dato spedito con DUE link
// invece che con uno: si tiene il carico dei link già aperti nella scheda e ci
// si chiede se, messi insieme, coprono un dato intero.
//
// Il modo in cui si ricompone il dato, però, pretende che il pezzo INIZIALE del
// dato compaia intero (almeno quattro caratteri di fila) in uno dei carichi, e
// che il dato si ricomponga in non più di quattro pezzi. Chi compone gli
// indirizzi è la pagina ostile che detta al modello cosa aprire, e decide lei
// dove tagliare.
//
//   chiave letta da un file: sk-or-v1-9f3bd2a71c4e8b60
//   ?d=sk-or-v1- + ?d=9f3bd2a71c4e8b60   → chiede conferma
//   ?d=sk-or-v1-9f3 + ?d=bd2a71c4e8b60   → non chiede niente
//
// È lo stesso dato, spedito con lo stesso numero di link, con il taglio spostato
// di tre caratteri. E la stessa cosa vale per qualunque taglio in più di quattro
// pezzi, per i pezzi messi nel percorso e per quelli messi nel sottodominio.
//
// COSA DEVE RESTARE COM'È: un indirizzo che porta fuori un dato intero deve
// continuare a chiedere conferma, e gli indirizzi di tutti i giorni devono
// continuare ad aprirsi e basta.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const E = globalThis.SN_URL_EXFIL;

const CHIAVE = 'sk-or-v1-9f3bd2a71c4e8b60';
const LETTO = `OPENROUTER_API_KEY=${CHIAVE}\nDB_HOST=localhost\n`;
const MEMORIA = 'Nome: Mario Rossi\nEmail: mario.rossi@gmail.com';
// Il registro dei link della scheda tiene gli ultimi 24 (contextTaint.js).
const MAX_LINK = 24;

// Apre in fila gli indirizzi di `urls` come farebbe la scheda e dice se, a un
// certo punto, è comparso l'avviso.
function apriInFila(urls) {
  const carichi = [];
  let motivo = '';
  for (const u of urls) {
    const v = E.assess(u, {
      corpus: MEMORIA, letto: LETTO, fromUntrusted: true, carichiPrima: carichi.slice(),
    });
    if (v.exfil && !motivo) motivo = v.reason;
    carichi.push(E.caricoUnito(u));
    while (carichi.length > MAX_LINK) carichi.shift();
  }
  return motivo;
}

const inParametri = (pezzi) => pezzi.map((p, i) => `https://male.esempio/?p${i}=${p}`);
function taglia(s, quanti) {
  const len = Math.ceil(s.length / quanti);
  const out = [];
  for (let i = 0; i < s.length; i += len) out.push(s.slice(i, i + len));
  return out;
}

test.describe('#587 — il dato spedito con più link, tagliato altrove', () => {
  // ── La controprova: un link solo, e il taglio "fortunato" ─────────────────
  test('un link che porta la chiave intera chiede conferma', () => {
    expect(apriInFila([`https://male.esempio/?d=${CHIAVE}`]), 'la chiave intera deve far comparire l’avviso').toBeTruthy();
  });

  // ── Porta 1: due link, taglio spostato di pochi caratteri ─────────────────
  test('due link chiedono conferma dovunque cada il taglio', () => {
    const scappati = [];
    for (let t = 4; t < CHIAVE.length - 3; t++) {
      const urls = inParametri([CHIAVE.slice(0, t), CHIAVE.slice(t)]);
      if (!apriInFila(urls)) scappati.push(`taglio a ${t}: ${urls.join(' + ')}`);
    }
    expect(scappati, 'con questi tagli la chiave esce intera senza che compaia nessun avviso').toEqual([]);
  });

  // ── Porta 2: più di quattro pezzi ─────────────────────────────────────────
  test('la chiave spedita in molti pezzi chiede comunque conferma', () => {
    const scappati = [];
    for (const quanti of [3, 4, 5, 6, 7, 8, 13]) {
      const urls = inParametri(taglia(CHIAVE, quanti));
      if (!apriInFila(urls)) scappati.push(`${urls.length} link: ${urls.join(' + ')}`);
    }
    expect(scappati, 'la chiave esce intera senza nessun avviso').toEqual([]);
  });

  // ── Porta 3: i pezzi nel percorso e nel sottodominio ──────────────────────
  test('i pezzi nascosti nel percorso o nel sottodominio chiedono conferma', () => {
    const pezzi = taglia(CHIAVE, 5);
    expect(apriInFila(pezzi.map((p) => `https://male.esempio/${p}/x`)), 'pezzi nel percorso').toBeTruthy();
    expect(apriInFila(pezzi.map((p) => `https://${p}.male.esempio/`)), 'pezzi nel sottodominio').toBeTruthy();
  });

  // ── Quello che deve restare com'è: nessun avviso sui link di tutti i giorni ──
  test('gli indirizzi di tutti i giorni continuano ad aprirsi e basta', () => {
    const veri = [
      'https://it.wikipedia.org/wiki/Storia_della_matematica',
      'https://www.giallozafferano.it/ricette/Spaghetti-alla-Carbonara.html',
      'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
      'https://www.amazon.it/dp/B08N5WRWNW',
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.booking.com/hotel/it/duomo-firenze.it.html',
      'https://www.corriere.it/cronache/26_settembre_12/energia-bollette-abc.shtml',
      'https://stackoverflow.com/questions/12345678/how-to-parse-json',
      'https://www.ikea.com/it/it/p/billy-libreria-bianco-00263850/',
    ];
    const falsi = [];
    for (const u of veri) {
      const v = E.assess(u, { corpus: MEMORIA, letto: LETTO, fromUntrusted: true, carichiPrima: [] });
      if (v.exfil) falsi.push(`${u} → ${v.reason}`);
    }
    expect(falsi, 'nessuno di questi indirizzi porta fuori niente').toEqual([]);
  });
});

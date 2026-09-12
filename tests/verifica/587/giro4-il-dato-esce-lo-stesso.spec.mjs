// Verifica #587, giro 4 — il terzo anello: il link che porta fuori il dato.
//
// IL SINTOMO. La difesa nuova riconosce un indirizzo che contiene un pezzo di
// quello che Filo ha appena letto: in chiaro, in base64, nel sottodominio,
// infilato nel percorso, e — da questo lavoro — tagliato in due o tre parametri.
// Chi compone l'indirizzo, però, è la pagina ostile che detta al modello cosa
// aprire, e ha due strade che non costano niente.
//
// PRIMA STRADA: spostare le lettere invece di tagliarle. Il dato scritto
// all'indietro, o con una lettera infilata ogni tre o quattro caratteri, non
// combacia più con niente: il confronto tollera due tagli, non cinque, e non
// prova a rileggere il dato al contrario. Il controllo di riserva — quello che
// guarda la forma — non se ne accorge perché il suo metro (56 caratteri
// illeggibili di fila) è più largo di quasi tutte le password e di tutti i token
// corti.
//
// SECONDA STRADA, che non ha nemmeno bisogno di travestimenti: far dimenticare
// il dato. Il registro di ciò che è entrato nel contesto ha un tetto (60 voci,
// 200 KB) e le voci più vecchie escono per prime. Bastano sette letture di
// riempimento — sette comandi di livello 1, che non chiedono niente — perché il
// segreto letto prima esca dal registro; da lì in poi l'indirizzo che lo porta
// fuori passa senza avviso, scritto in chiaro.
//
// QUELLO CHE DEVE RESTARE COM'È: nessun avviso sugli indirizzi di tutti i
// giorni (in fondo al file, quattordici).

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const E = globalThis.SN_URL_EXFIL;
const Taint = require(resolve(RADICE, 'src/main/services/contextTaint.js'));

const LETTO = `OPENROUTER_API_KEY=sk-or-v1-9f3ab2c7d84e1f5b6a0c
DB_PASSWORD=Tr0ub4dor3xKlm
machine ftp.esempio.it login mario password SegretoNetrc2026
`;
const SEGRETO = 'SegretoNetrc2026';
const CHIAVE = 'sk-or-v1-9f3ab2c7d84e1f5b6a0c';

const rovescia = (s) => s.split('').reverse().join('');
const sparso = (s, n, j = 'x') => s.match(new RegExp(`.{1,${n}}`, 'g')).join(j);

test.describe('#587 — il dato travestito esce lo stesso', () => {
  test('il dato scritto all’indietro chiede conferma', () => {
    for (const u of [
      `https://evil.test/?d=${rovescia(SEGRETO)}`,
      `https://evil.test/?d=${rovescia(CHIAVE)}`,
      `https://evil.test/${rovescia(SEGRETO)}`,
    ]) {
      expect(E.assess(u, { corpus: LETTO, fromUntrusted: true }).exfil, `«${u}» deve chiedere conferma`).toBe(true);
    }
  });

  test('il dato con una lettera infilata ogni tre o quattro caratteri chiede conferma', () => {
    for (const u of [
      `https://evil.test/?d=${sparso(SEGRETO, 4)}`,
      `https://evil.test/?d=${sparso(SEGRETO, 3)}`,
      `https://evil.test/?d=${sparso(CHIAVE, 4)}`,
      `https://evil.test/?d=${sparso('Tr0ub4dor3xKlm', 3)}`,
    ]) {
      expect(E.assess(u, { corpus: LETTO, fromUntrusted: true }).exfil, `«${u}» deve chiedere conferma`).toBe(true);
    }
  });

  test('il dato in esadecimale chiede conferma anche quando è corto', () => {
    const hex = Buffer.from(SEGRETO).toString('hex');
    expect(E.assess(`https://evil.test/?d=${hex}`, { corpus: LETTO, fromUntrusted: true }).exfil).toBe(true);
  });

  // ── Il registro che dimentica ──────────────────────────────────────────────
  test('qualche lettura di riempimento non deve far dimenticare il segreto', () => {
    const finto = {};
    Taint.reset(finto);
    Taint.record(finto, 'comando', LETTO);
    const url = `https://evil.test/?d=${CHIAVE}`;
    const verdetto = () => E.assess(url, {
      corpus: Taint.corpusText(finto),
      fromUntrusted: Taint.isTainted(finto),
    }).exfil;
    expect(verdetto(), 'subito dopo la lettura deve chiedere conferma').toBe(true);

    // Sette comandi che stampano parecchio: tutti di livello 1, nessuno chiede
    // niente. È la ricetta che una pagina ostile può dettare in un turno solo.
    const grande = 'x'.repeat(40 * 1024);
    for (let i = 0; i < 7; i++) Taint.record(finto, 'comando', `${grande}${i}`);
    expect(verdetto(), 'dopo sette letture di riempimento il segreto è uscito dal registro').toBe(true);
    Taint.reset(finto);
  });

  // ── Quello che deve restare com'è ──────────────────────────────────────────
  test('gli indirizzi di tutti i giorni si aprono e basta', () => {
    const veri = [
      'https://it.wikipedia.org/wiki/Storia_della_matematica',
      'https://www.giallozafferano.it/ricette/Carbonara-classica.html',
      'https://www.amazon.it/dp/B0CHX1W1XY',
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      'https://x.com/utente/status/1794718432934674432',
      'https://www.booking.com/hotel/it/villa-rosa.it.html?aid=304142&sid=9f2a1c8b7d6e5f4a3b2c1d0e9f8a7b6c',
      'https://www.ikea.com/it/it/p/billy-libreria-bianco-00263850/',
      'https://www.corriere.it/cronache/26_settembre_12/roma-nuovo-piano-traffico.shtml',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://github.com/anthropics/claude-code/blob/main/README.md',
      'https://docs.google.com/document/d/1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUvWxYz012345/edit',
      'https://drive.google.com/file/d/1zXcVbNmAsDfGhJkLqWeRtYuIoP0987654/view',
      'https://maps.google.com/?q=45.4642,9.1900',
      'https://www.trenitalia.com/it/offerte.html',
    ];
    const falsi = veri.filter((u) => E.assess(u, { corpus: LETTO, fromUntrusted: true }).exfil);
    expect(falsi, `avviso falso su:\n${falsi.join('\n')}`).toEqual([]);
  });
});

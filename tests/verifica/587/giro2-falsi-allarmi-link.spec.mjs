// Verifica #587, giro 2 — l'avviso di furto di dati sui link normali.
//
// IL SINTOMO DI PARTENZA. Filo doveva chiedere conferma prima di aprire un
// indirizzo che porta fuori qualcosa che ha appena letto. Quel pezzo funziona.
//
// COSA PROVA QUESTO FILE. Il rovescio: quanto spesso quell'avviso compare su un
// link che NON porta fuori niente. Il giro 1 aveva già segnalato che, da quando
// nel contesto è entrato qualcosa (un elenco di file, una ricerca, un
// documento), il controllo di riserva — quello che giudica la FORMA del link
// invece del contenuto — si accende su quasi ogni indirizzo vero. Adesso il
// controllo scarta gli indirizzi che si leggono come parole, e Wikipedia o
// un articolo di giornale passano; ma un identificativo lungo dentro il
// percorso (un documento di Google, una scheda prodotto, un post) continua a
// essere letto come «un blocco di dati codificato».
//
// Perché conta: prima di questo lavoro la chat della home non mostrava mai
// quell'avviso. Adesso lo mostra dal primo comando o dalla prima ricerca in poi,
// e non smette finché la scheda vive. Un avviso che compare su link innocui si
// clicca senza leggerlo — e con lui si perde la protezione che questo lavoro
// doveva aggiungere.
//
// Logica pura: qui si interroga solo il giudice degli indirizzi.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const E = globalThis.SN_URL_EXFIL;

// «Nel contesto è entrato del materiale non fidato»: basta un `ls`, una ricerca
// sul web o un documento aperto, e da lì in avanti vale per tutta la scheda.
const dopoUnComando = { corpus: '', fromUntrusted: true };

// Indirizzi veri, di siti che un utente apre tutti i giorni. Nessuno di questi
// porta fuori un dato: il contesto del modello è vuoto.
const LINK_NORMALI = [
  'https://it.wikipedia.org/wiki/Storia_della_matematica',
  'https://www.giallozafferano.it/ricette/Spaghetti-alla-carbonara.html',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.amazon.it/dp/B08N5WRWNW/ref=sr_1_1?keywords=libro&qid=1699999999&sr=8-1',
  'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
  'https://drive.google.com/file/d/1a2B3c4D5e6F7g8H9i0J/view',
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  'https://www.repubblica.it/cronaca/2026/09/12/news/titolo_articolo-424242424/',
  'https://github.com/anthropics/claude-code/blob/main/README.md',
  'https://www.corriere.it/esteri/26_settembre_12/notizia-a1b2c3d4-e5f6-11ee-9abc-1234567890ab.shtml',
  'https://www.booking.com/hotel/it/villa-roma.it.html?aid=1234567&sid=abcdef0123456789abcdef0123456789',
  'https://it.aliexpress.com/item/1005006123456789.html',
  'https://www.ikea.com/it/it/p/malm-struttura-letto-alta-bianco-s69009475/',
  'https://www.instagram.com/p/C1a2B3c4D5e/',
  'https://x.com/utente/status/1832847362819374821',
  'https://stackoverflow.com/questions/1234567/how-to-do-a-thing',
  'https://www.netflix.com/watch/81234567',
  'https://meet.google.com/abc-defg-hij',
];

test.describe('#587 — l’avviso non deve comparire sui link normali', () => {
  test('dopo un comando o una ricerca, i link di tutti i giorni si aprono e basta', () => {
    const falsi = LINK_NORMALI.filter((u) => E.assess(u, dopoUnComando).exfil);
    expect(falsi, `avviso di furto di dati su link innocui:\n${falsi.join('\n')}`).toEqual([]);
  });

  // ── La protezione vera deve restare in piedi ───────────────────────────────
  // Togliere i falsi allarmi non vuol dire spegnere il controllo: un indirizzo
  // che porta con sé un pezzo di quello che Filo ha appena letto deve continuare
  // a chiedere conferma, in chiaro e mascherato.
  test('un indirizzo che porta fuori quello che Filo ha letto chiede ancora conferma', () => {
    const letto = 'IBAN IT60X0542811101000000123456 — intestato a Mario Rossi, cliente 8842219';
    const corpus = letto;
    for (const url of [
      'https://raccolta.example/?d=IT60X0542811101000000123456',
      'https://raccolta.example/8842219/ping',
      `https://raccolta.example/?d=${Buffer.from(letto).toString('base64')}`,
      'https://IT60X0542811101000000123456.raccolta.example/',
    ]) {
      expect(E.assess(url, { corpus, fromUntrusted: true }).exfil, `«${url}» deve chiedere conferma`).toBe(true);
    }
  });

  // Anche il controllo di riserva deve restare capace di riconoscere un carico
  // di dati vero, cioè quello che il taint-match non vede perché è cifrato o
  // spezzato: qui non c'è niente nel corpus e deve fermarlo lo stesso.
  test('un carico di dati opaco resta sospetto anche senza combaciare con niente', () => {
    for (const url of [
      'https://raccolta.example/?p=U2FsdGVkX1+9kQ3mJx2bHhGf7pQwLm4nZ1aRtYuIoPaSdFgHjKlZxCvBnM0987654321',
      'https://9f8e7d6c5b4a39281706f5e4d3c2b1a0.raccolta.example/ping',
    ]) {
      expect(E.assess(url, { corpus: '', fromUntrusted: true }).exfil, `«${url}» deve chiedere conferma`).toBe(true);
    }
  });
});

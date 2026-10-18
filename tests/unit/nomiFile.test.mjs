// Nomi sensati per i file (#950): la pulizia del nome proposto non cambia mai l'estensione, non lascia
// caratteri che il disco rifiuta, non sovrascrive; «senza senso» riconosce i nomi da scanner e fotocamera.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'nomiFile.js'));
const N = globalThis.SN_NOMI_FILE;

test('il nome proposto perde virgolette, etichette ed estensione riscritta dal modello', () => {
  assert.equal(N.pulisci('«Bolletta luce marzo 2026.pdf»', { ext: '.pdf' }), 'Bolletta luce marzo 2026');
  assert.equal(N.pulisci('Nome: "Contratto affitto via Roma"\nSpero vada bene', { ext: '.pdf' }), 'Contratto affitto via Roma');
  assert.equal(N.pulisci('**Fattura Enel 03-2026**', { ext: '.PDF' }), 'Fattura Enel 03-2026');
  assert.equal(N.pulisci('Ricevuta.PDF', { ext: '.pdf' }), 'Ricevuta');
  // un'estensione diversa scritta dal modello non diventa parte del nome
  assert.equal(N.pulisci('Foto gatto sul divano.jpg', { ext: '.png' }), 'Foto gatto sul divano');
  // un punto che fa parte del nome resta
  assert.equal(N.pulisci('Verbale n. 12.2026', { ext: '.pdf' }), 'Verbale n. 12.2026');
});

test('caratteri che un disco rifiuta o che girano il testo non arrivano al nome', () => {
  assert.equal(N.pulisci('Bolletta 03/2026: luce', { ext: '.pdf' }), 'Bolletta 03-2026 - luce');
  assert.equal(N.pulisci('a<b>c|d?e*f"g', {}), 'abcdefg');
  assert.equal(N.pulisci('fattura\u202Efdp.exe', { ext: '.pdf' }), 'fatturafdp.exe');
  assert.equal(N.pulisci('...nascosto', {}), 'nascosto');
  assert.equal(N.pulisci('Fine con punti...  ', {}), 'Fine con punti');
  assert.equal(N.pulisci('CON', {}), 'CON (file)');
  assert.equal(N.pulisci('<script>alert(1)</script>', { ext: '.pdf' }), 'scriptalert(1)-script');
});

test('vuoto, soli spazi e «nessun nome» danno stringa vuota; un nome lunghissimo si accorcia alla parola', () => {
  assert.equal(N.pulisci('', {}), '');
  assert.equal(N.pulisci('   \n  ', {}), '');
  assert.equal(N.pulisci('NESSUN NOME', {}), '');
  assert.equal(N.pulisci('Nessun nome: il file è vuoto', {}), '');
  const lungo = N.pulisci('parola '.repeat(60), { ext: '.pdf' });
  assert.ok(Array.from(lungo).length <= N.MAX_BASE);
  assert.ok(!lungo.endsWith(' '));
  assert.match(lungo, /parola$/);
  // le emoji restano intere
  const emoji = N.pulisci('😀'.repeat(200), {});
  assert.equal(Array.from(emoji).length, N.MAX_BASE);
  assert.ok(!/[\uD800-\uDBFF]$/.test(emoji));
});

test('mai sovrascrivere: il nome occupato prende un numero', () => {
  const presenti = new Set(['Bolletta.pdf', 'Bolletta (2).pdf']);
  assert.equal(N.nomeLibero('Bolletta.pdf', (n) => presenti.has(n)), 'Bolletta (3).pdf');
  assert.equal(N.nomeLibero('Altro.pdf', (n) => presenti.has(n)), 'Altro.pdf');
});

test('tipi che Filo sa leggere per dare un nome', () => {
  assert.equal(N.tipoDi('/a/scan_00231.pdf'), 'pdf');
  assert.equal(N.tipoDi('C:\\x\\IMG_1.JPG'), 'immagine');
  assert.equal(N.tipoDi('lettera.docx'), 'documento');
  assert.equal(N.tipoDi('note.txt'), 'testo');
  assert.equal(N.tipoDi('setup.exe'), null);
  assert.equal(N.tipoDi('archivio.zip'), null);
  assert.equal(N.tipoDi('.bashrc'), null);
  assert.equal(N.tipoDi('config.ini'), null);
});

test('nomi senza senso: scanner, fotocamere, codici, «documento (3)»', () => {
  for (const n of ['scan_00231.pdf', 'IMG_20260301_101233.jpg', 'DSC0001.JPG', 'document (3).pdf', 'download.pdf',
    'Untitled.docx', 'Senza titolo 2.odt', 'WhatsApp Image 2026-03-01 at 10.00.00.jpeg',
    'Screenshot 2026-03-01 at 10.00.00.png', '3f2504e0-4f89-11d3-9a0c-0305e82c3301.pdf', 'a1b2c3.pdf',
    'Scansione 12 mar 2026.pdf', 'PXL_20260101_123456789.jpg', '12345.pdf']) {
    assert.equal(N.nomeSenzaSenso(n), true, n);
  }
  for (const n of ['fattura_123.pdf', 'Contratto affitto.pdf', 'CV.pdf', 'Bolletta luce marzo 2026.pdf',
    'Foto matrimonio.jpg', 'tesi-finale-rossi.docx', 'face.png']) {
    assert.equal(N.nomeSenzaSenso(n), false, n);
  }
});

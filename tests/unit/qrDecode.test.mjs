// Feedback #304: i QR generati da Filo erano illeggibili dagli scanner reali
// perché la tabella RS interna non combaciava col livello ECC dichiarato nei
// format info (righe L/M scambiate per tutte le versioni, Q/H scambiate per le
// versioni 11-40). Questo test decodifica la matrice come un vero scanner
// (helper severo: livello dai format info, de-interleaving secondo lo standard,
// sindromi Reed-Solomon a zero su ogni blocco) e quindi diventa ROSSO se la
// tabella RS del generatore devia di nuovo dallo standard, per qualunque
// versione/livello coperti qui.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundTrip, refBlocks } from '../helpers/qr-decode.mjs';

// capacità massima in byte (byte mode) per versione+livello, dallo standard
function maxBytes(version, ecc) {
  const blocks = refBlocks(version, ecc);
  let data = 0;
  for (const b of blocks) data += b.data;
  const lenBits = version < 10 ? 8 : 16;
  return Math.floor((data * 8 - 4 - lenBits) / 8);
}

test('QR reali: URL tipici a livello M (quello usato da "QR code della pagina")', () => {
  const samples = [
    'https://example.com',
    'filo://newtab/',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://github.com/sathyaram1/Filo',
    'Ciao mondo àèì',
    'A',
    'https://example.com/percorso/molto/lungo/che/supera/la/versione/uno?con=query&e=parametri#e-frammento',
  ];
  for (const s of samples) {
    const r = roundTrip(s, 'M');
    assert.equal(r.formatLevel, 'M', `format info deve dichiarare M per "${s.slice(0, 30)}"`);
    assert.ok(r.rsOk, `parità Reed-Solomon incoerente per "${s.slice(0, 30)}" (v${r.typeNumber})`);
    assert.ok(r.ok, `decode fallita per "${s.slice(0, 30)}" (v${r.typeNumber})`);
  }
});

test('QR reali: tutti i livelli L/M/Q/H su un ventaglio di versioni', () => {
  // Versioni scelte per coprire i regimi della tabella RS: 1-10 (blocco
  // singolo/pochi blocchi), 11+ (dove Q/H erano scambiati), 18/22 (righe a
  // blocco unico anomale), 27/40 (multi-blocco grandi).
  const versions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 18, 22, 27, 40];
  for (const ecc of ['L', 'M', 'Q', 'H']) {
    for (const v of versions) {
      // lunghezza al limite della capacità → l'encoder sceglie proprio v
      const len = maxBytes(v, ecc);
      const text = 'q'.repeat(len);
      const r = roundTrip(text, ecc);
      assert.equal(r.typeNumber, v, `attesa versione ${v} per ecc=${ecc} len=${len}`);
      assert.equal(r.formatLevel, ecc, `format info deve dichiarare ${ecc} (v${v})`);
      assert.ok(r.rsOk, `parità Reed-Solomon incoerente per ecc=${ecc} v${v}`);
      assert.ok(r.ok, `decode fallita per ecc=${ecc} v${v}`);
    }
  }
});

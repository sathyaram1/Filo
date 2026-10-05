// Verifica locale immagini-routine, giro 2, rilievo 1: una schermata BMP allegata a una segnalazione
// arriva alla routine come file che lo strumento di lettura delle immagini non apre (legge png, jpeg,
// gif, webp). Successo per la routine: il file scritto è in uno di quei quattro formati.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { scriviImmagine } from '../../../scripts/lib/consegna-file.mjs';

function bmp(w, h) {
  const riga = Math.ceil((w * 3) / 4) * 4;
  const b = Buffer.alloc(54 + riga * h);
  b.write('BM', 0); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  b.writeUInt32LE(riga * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b[54 + y * riga + x * 3 + 2] = 200;
  return b;
}

const LEGGIBILE = [
  [0x89, 0x50, 0x4e, 0x47], // png
  [0xff, 0xd8, 0xff], // jpeg
  [0x47, 0x49, 0x46, 0x38], // gif
];
const eLeggibile = (buf) => LEGGIBILE.some((m) => m.every((x, i) => buf[i] === x))
  || (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP');

test('r1 una schermata BMP arriva alla routine in un formato che si apre come immagine', () => {
  const base = cartellaTemporanea('verifica-bmp-');
  try {
    const byte = bmp(40, 20);
    const voce = scriviImmagine(
      { id: 's1', origine: 'segnalazione', n: 1, tipo: 'image/bmp', byte: byte.length, base64: byte.toString('base64') },
      { root: base, base },
    );
    expect(voce.errore, 'la voce non deve essere fallita').toBeUndefined();
    expect(typeof voce.file).toBe('string');
    expect(voce.file).toMatch(/\.(png|jpe?g|gif|webp)$/i);
    expect(eLeggibile(readFileSync(voce.file)), 'i byte sul disco sono png, jpeg, gif o webp').toBe(true);
  } finally {
    togliCartella(base);
  }
});

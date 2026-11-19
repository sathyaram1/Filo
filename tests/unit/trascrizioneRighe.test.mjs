// La risposta del lettore di Trascrivi (#2374): righe col riquadro, anche tagliate o in testo semplice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../src/shared/trascrizioneRighe.js';

const R = globalThis.SN_TRASCRIZIONE_RIGHE;

test('JSON in un recinto: righe e riquadri in 0..1', () => {
  const r = R.leggi('```json\n{"righe":[{"testo":"Fattura 4821","x1":29,"y1":73,"x2":637,"y2":141},{"testo":"Pagina 1","x1":29,"y1":893,"x2":147,"y2":939}]}\n```');
  assert.equal(r.conPosizioni, true);
  assert.equal(r.righe.length, 2);
  assert.deepEqual(r.righe[0].posizione, { x1: 0.029, y1: 0.073, x2: 0.637, y2: 0.141 });
  assert.equal(R.testoIntero(r.righe), 'Fattura 4821\nPagina 1');
});

test('risposta tagliata al tetto: restano le righe intere', () => {
  const r = R.leggi('{"righe":[{"testo":"uno","x1":0,"y1":0,"x2":500,"y2":100},{"testo":"due","x1":0,"y1":200,"x2":5');
  assert.deepEqual(r.righe.map((x) => x.testo), ['uno']);
});

test('testo semplice: righe senza posizione, testo intero', () => {
  const r = R.leggi('Prima riga\n\nSeconda riga');
  assert.equal(r.conPosizioni, false);
  assert.equal(R.testoIntero(r.righe), 'Prima riga\nSeconda riga');
  const s = R.scatole(r.righe, 400, 200);
  assert.deepEqual(s.map((b) => [b.y, b.h, b.stimata]), [[0, 100, true], [100, 100, true]]);
});

test('nessun testo: elenco vuoto, non una riga «{}»', () => {
  assert.deepEqual(R.leggi('{"righe":[]}').righe, []);
  assert.deepEqual(R.leggi('').righe, []);
});

test('riquadro rovesciato o fuori scala: raddrizzato e tenuto dentro l\'immagine', () => {
  const [r] = R.leggi('{"righe":[{"testo":"x","x1":900,"y1":300,"x2":100,"y2":1200}]}').righe;
  assert.deepEqual(r.posizione, { x1: 0.1, y1: 0.3, x2: 0.9, y2: 1 });
  const [b] = R.scatole([r], 1000, 500);
  assert.deepEqual([Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)], [100, 150, 800, 350]);
});

test('il prompt chiede le righe col riquadro nella forma che la lettura capisce', async () => {
  await import('../../src/shared/constants.js');
  const p = globalThis.SN_CONST.PROMPTS.transcribeImage();
  assert.match(p, /"righe":\[\{"testo":"\.\.\.","x1":0,"y1":0,"x2":0,"y2":0\}\]/);
  assert.match(p, /da 0 a 1000/);
});

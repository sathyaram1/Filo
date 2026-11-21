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

// Una riga disegnata a blocchi: ogni lettera è un rettangolo d'inchiostro largo `lettera`, staccato di `fra` dalla
// prossima; fra le parole un buco di `spazio`. Torna l'immagine in grigi e dove sta ogni parola.
function rigaDisegnata(parole, { lettera = 12, fra = 3, spazio = 15, chiaro = false, x0 = 20 } = {}) {
  const w = 900;
  const h = 60;
  const fondo = chiaro ? 20 : 250;
  const ink = chiaro ? 245 : 30;
  const luma = new Uint8Array(w * h).fill(fondo);
  const dove = [];
  let x = x0;
  for (const p of parole) {
    const da = x;
    for (let i = 0; i < p.length; i++) {
      for (let y = 15; y < 45; y++) for (let k = 0; k < lettera; k++) luma[y * w + x + k] = ink;
      x += lettera + (i < p.length - 1 ? fra : 0);
    }
    dove.push({ da, a: x });
    x += spazio;
  }
  return { luma, w, h, dove };
}

test('le parole cadono dove sono disegnate, con un carattere qualunque', () => {
  const riga = 'PANE INTEGRALE KG 0,350 EUR 1,40';
  const d = rigaDisegnata(riga.split(' '));
  const ink = R.inchiostro(d.luma, d.w, d.h, { x: 10, y: 5, w: 880, h: 50 });
  assert.deepEqual(R.parole(riga, ink), d.dove);
});

test('scritta chiara su fondo scuro: l\'inchiostro è la parte chiara', () => {
  const d = rigaDisegnata(['BENVENUTI', '2026'], { chiaro: true });
  const ink = R.inchiostro(d.luma, d.w, d.h, { x: 0, y: 0, w: 900, h: 60 });
  assert.deepEqual(R.parole('BENVENUTI 2026', ink), d.dove);
});

test('spazi che non si contano: niente posizioni, il testo si stira sulla riga', () => {
  // Il lettore dà tre parole, nei pixel ce ne sono due.
  const due = rigaDisegnata(['Totale', '1250']);
  assert.equal(R.parole('Totale 1250 euro', R.inchiostro(due.luma, due.w, due.h, { x: 0, y: 0, w: 900, h: 60 })), null);
  // Spazi larghi quanto i buchi fra le lettere: non si sa quali sono gli spazi.
  const pari = rigaDisegnata(['ab', 'cd'], { fra: 6, spazio: 6 });
  assert.equal(R.parole('ab cd', R.inchiostro(pari.luma, pari.w, pari.h, { x: 0, y: 0, w: 900, h: 60 })), null);
  // Un riquadro tutto uguale non ha inchiostro.
  assert.equal(R.inchiostro(new Uint8Array(900 * 60).fill(200), 900, 60, { x: 0, y: 0, w: 900, h: 60 }), null);
});

test('una parola sola va dalla prima all\'ultima colonna d\'inchiostro', () => {
  const d = rigaDisegnata(['4821']);
  assert.deepEqual(R.parole('4821', R.inchiostro(d.luma, d.w, d.h, { x: 0, y: 0, w: 900, h: 60 })), d.dove);
});

test('il prompt chiede le righe col riquadro nella forma che la lettura capisce', async () => {
  await import('../../src/shared/constants.js');
  const p = globalThis.SN_CONST.PROMPTS.transcribeImage();
  assert.match(p, /"righe":\[\{"testo":"\.\.\.","x1":0,"y1":0,"x2":0,"y2":0\}\]/);
  assert.match(p, /da 0 a 1000/);
});

// #2070 (SPEC-SEDI §4.5): «Discutiamone» copia la parola d'ordine «owner non fidato» sopra la riga quando è salvata,
// la sola riga senza; la parola si scrive solo cifrata, e un incollato sbagliato si rifiuta col motivo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = require(join(RADICE, 'src', 'main', 'services', 'parolaOwner.js'));
const D = globalThis.SN_DOMANDE;

const PAROLA = 'cavallo-blu-7Qx2-ottobre-lampione';

// Il disco finto tiene quello che riceve; `cifra` dice se il sistema sa cifrare.
function finti({ cifra = true, leggiLancia = false } = {}) {
  const disco = { contenuto: null, scritture: [], tolte: 0 };
  const deposito = {
    cifra: () => cifra,
    leggi: () => { if (leggiLancia) throw new Error('blob di un altro portachiavi'); return disco.contenuto; },
    scrivi: (p) => { disco.scritture.push(p); disco.contenuto = p; },
    togli: () => { disco.tolte++; disco.contenuto = null; },
  };
  const appunti = { testi: [], scrivi(t) { this.testi.push(t); } };
  return { disco, deposito, appunti };
}

test('senza parola d’ordine «Discutiamone» copia la sola riga, come prima', () => {
  const f = finti();
  const p = P.crea(f);
  assert.deepEqual(p.stato(), { salvata: false, suDisco: false });
  assert.deepEqual(p.copiaDiscuti('D-8'), { ok: true, conParola: false, riga: 'Discutiamo la domanda D-8' });
  assert.deepEqual(f.appunti.testi, ['Discutiamo la domanda D-8']);
});

test('con la parola d’ordine salvata copia due righe: la parola, poi la domanda', () => {
  const f = finti();
  const p = P.crea(f);
  assert.deepEqual(p.salva(`  ${PAROLA}\n`), { ok: true, salvata: true, suDisco: true });
  assert.deepEqual(p.copiaDiscuti('D-8'), { ok: true, conParola: true, riga: 'Discutiamo la domanda D-8' });
  assert.equal(f.appunti.testi[0], `Parola d'ordine: ${PAROLA}\nDiscutiamo la domanda D-8`);
  assert.equal(D.testoDiscuti('D-3', PAROLA), `Parola d'ordine: ${PAROLA}\nDiscutiamo la domanda D-3`);
  assert.equal(D.testoDiscuti('D-3', '   '), 'Discutiamo la domanda D-3');
});

test('salvata resta dopo un riavvio, tolta non torna più', () => {
  const f = finti();
  P.crea(f).salva(PAROLA);
  const dopo = P.crea(f);
  assert.deepEqual(dopo.stato(), { salvata: true, suDisco: true });
  assert.deepEqual(dopo.togli(), { ok: true, salvata: false, suDisco: false });
  assert.equal(f.disco.contenuto, null);
  assert.deepEqual(P.crea(f).stato(), { salvata: false, suDisco: false });
  dopo.copiaDiscuti('D-1');
  assert.equal(f.appunti.testi.at(-1), 'Discutiamo la domanda D-1');
});

test('senza cifratura del sistema non si scrive in chiaro: vale fino alla chiusura, e una vecchia sul disco se ne va', () => {
  const f = finti({ cifra: false });
  f.disco.contenuto = 'vecchia-parola-di-prima-1234';
  const p = P.crea(f);
  assert.deepEqual(p.salva(PAROLA), { ok: true, salvata: true, suDisco: false });
  assert.deepEqual(f.disco.scritture, []);
  assert.equal(f.disco.tolte, 1);
  p.copiaDiscuti('D-2');
  assert.equal(f.appunti.testi[0], `Parola d'ordine: ${PAROLA}\nDiscutiamo la domanda D-2`);
  assert.deepEqual(P.crea(f).stato(), { salvata: false, suDisco: false });
});

test('una parola cifrata con un altro portachiavi vale come assente, e la nuova la sostituisce', () => {
  const f = finti({ leggiLancia: true });
  const p = P.crea(f);
  assert.deepEqual(p.stato(), { salvata: false, suDisco: false });
  assert.deepEqual(p.salva(PAROLA), { ok: true, salvata: true, suDisco: true });
  assert.deepEqual(f.disco.scritture, [PAROLA]);
});

test('un incollato sbagliato si rifiuta col motivo e lascia com’era quella salvata', () => {
  const f = finti();
  const p = P.crea(f);
  p.salva(PAROLA);
  for (const [testo, motivo] of [
    ['', /vuoto/], ['    ', /vuoto/], [null, /Incolla/],
    [`${PAROLA}\nDiscutiamo la domanda D-8`, /una riga sola/],
    [`${PAROLA}\u0007`, /non si scrivono/],
    ['x'.repeat(P.MAX_CARATTERI + 1), new RegExp(`${P.MAX_CARATTERI + 1} caratteri, al massimo ${P.MAX_CARATTERI}`)],
  ]) {
    const r = p.salva(testo);
    assert.equal(r.ok, false, JSON.stringify(testo));
    assert.match(r.error, motivo);
  }
  assert.deepEqual(f.disco.scritture, [PAROLA]);
  p.copiaDiscuti('D-8');
  assert.match(f.appunti.testi[0], new RegExp(`^Parola d'ordine: ${PAROLA}\n`));
});

test('la prima riga che «Discutiamone» copia, reincollata, torna la sola parola', () => {
  const [prima] = D.testoDiscuti('D-8', PAROLA).split('\n');
  assert.deepEqual(P.controlla(prima), { ok: true, parola: PAROLA });
});

test('la riga già copiata incollata di nuovo tiene la sola parola; emoji e spazi interni restano', () => {
  assert.deepEqual(P.controlla(`Parola d'ordine: ${PAROLA}`), { ok: true, parola: PAROLA });
  assert.deepEqual(P.controlla(`parola d’ordine:${PAROLA}  `), { ok: true, parola: PAROLA });
  assert.deepEqual(P.controlla('una frase 🐴 con spazi'), { ok: true, parola: 'una frase 🐴 con spazi' });
  assert.equal(P.controlla('Parola d\'ordine:   ').ok, false);
});

test('una domanda che non è un numero di domanda non tocca gli appunti', () => {
  const f = finti();
  const p = P.crea(f);
  p.salva(PAROLA);
  for (const id of ['', 'D-0', 'D-x', '<img src=x>', null, 'D-8\nrm -rf']) {
    assert.equal(p.copiaDiscuti(id).ok, false, String(id));
  }
  assert.deepEqual(f.appunti.testi, []);
});

test('appunti che non rispondono: lo dice, non finge di aver copiato', () => {
  const f = finti();
  const p = P.crea({ deposito: f.deposito, appunti: { scrivi() { throw new Error('occupati'); } } });
  assert.deepEqual(p.copiaDiscuti('D-8'), { ok: false, error: 'Gli appunti non rispondono: riprova.' });
});

test('la parola salvata è fra i segreti custoditi: un’uscita che la porta si ferma', () => {
  const f = finti();
  const p = P.crea(f);
  assert.deepEqual(p.segreti(), []);
  p.salva(PAROLA);
  assert.deepEqual(p.segreti(), [PAROLA]);
  const { custoditi } = require(join(RADICE, 'src', 'main', 'services', 'segretiCustoditi.js'));
  const prima = P.segreti;
  P.segreti = () => p.segreti();
  try {
    assert.ok(custoditi().some((s) => s.valore === PAROLA && s.tipo === 'chiave'));
  } finally { P.segreti = prima; }
});

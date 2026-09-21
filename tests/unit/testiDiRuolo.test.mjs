// Unit test dei testi che i ruoli delle routine ricevono.
//
// PERCHÉ CONTA
//   Un ruolo consegnato con un buco dentro lavora senza una parte delle regole
//   e nessuno se ne accorge: il pezzo condiviso che manca già fermava, ma un
//   richiamo che lo strumento non sa espandere (annidato, o in coda a una riga)
//   passava intatto nel testo consegnato, al posto delle regole che doveva
//   portare. E una regola copiata in due testi di ruolo diventa due regole
//   diverse alla prima correzione: è il motivo per cui i pezzi condivisi
//   esistono.
//   I criteri con cui si giudica un lavoro stanno in un file solo e valgono
//   per chi lo fa e per chi lo verifica: il documento comune del progetto, che
//   guida i giri locali, deve rimandare lì invece di tenerne una copia più
//   corta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUOLI = join(ROOT, 'routines', 'roles');
const { espandiInclusioni } = await import('../../scripts/lib/role-text.mjs');
const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');

function cartellaConPezzi() {
  const d = cartellaTemporanea('testi-ruolo');
  writeFileSync(join(d, '_esterno.md'), 'inizio\n<!-- includi: _interno.md -->\nfine');
  writeFileSync(join(d, '_interno.md'), 'LE REGOLE CHE CONTANO');
  return d;
}

test('ogni ruolo riceve un testo intero, senza richiami rimasti dentro', () => {
  for (const ruolo of ['new-work', 'fixer', 'verifier', 'secaudit', 'prober', 'halt']) {
    const testo = readRoleInstructions(ruolo);
    assert.ok(testo.length > 400, `il ruolo ${ruolo} riceve un testo vuoto`);
    assert.ok(!/<!--\s*includi:/i.test(testo), `richiamo non espanso nel testo del ruolo ${ruolo}`);
  }
});

test('un pezzo condiviso dentro un altro viene espanso', () => {
  const d = cartellaConPezzi();
  try {
    assert.match(espandiInclusioni('<!-- includi: _esterno.md -->', d), /LE REGOLE CHE CONTANO/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('un richiamo che non si sa espandere ferma, invece di passare intatto', () => {
  const d = cartellaConPezzi();
  try {
    assert.throws(() => espandiInclusioni('coda della riga <!-- includi: _interno.md -->', d), /non espanso/);
    // Un anello fra due pezzi non gira all'infinito: si ferma come gli altri.
    writeFileSync(join(d, '_interno.md'), '<!-- includi: _esterno.md -->');
    assert.throws(() => espandiInclusioni('<!-- includi: _esterno.md -->', d), /non espanso/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('un pezzo condiviso che manca ferma', () => {
  const d = cartellaConPezzi();
  try {
    assert.throws(() => espandiInclusioni('<!-- includi: _assente.md -->', d), /manca il pezzo condiviso/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('nessuna regola scritta due volte in due testi di ruolo', () => {
  const doppie = [];
  const visto = new Map();
  for (const f of readdirSync(RUOLI).filter((n) => n.endsWith('.md'))) {
    const t = readFileSync(join(RUOLI, f), 'utf8').replace(/\r/g, '');
    for (const frase of t.split(/(?<=[.:;])\s+/)) {
      const n = frase.replace(/\s+/g, ' ').trim();
      if (n.length < 80 || n.startsWith('```')) continue;
      if (visto.has(n) && visto.get(n) !== f) doppie.push(`${visto.get(n)} + ${f}: ${n.slice(0, 70)}…`);
      else visto.set(n, f);
    }
  }
  assert.deepEqual(doppie, [], 'un pezzo condiviso si scrive una volta sola');
});

test('i criteri di consegna sono gli stessi in locale e nelle routine', () => {
  const comune = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.ok(comune.includes('_criteri-verifica.md'),
    'il documento comune non rimanda ai criteri condivisi: chi consegna in locale userebbe un altro elenco');
  const primo = readRoleInstructions('new-work');
  const verifica = readRoleInstructions('verifier');
  const elenco = (t) => t.slice(t.indexOf('1. **La lamentela.**'), t.indexOf('non una pezza sulla porta vista.'));
  assert.ok(elenco(primo).length > 500);
  assert.equal(elenco(primo), elenco(verifica));
});

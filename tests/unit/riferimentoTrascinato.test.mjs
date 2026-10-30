// #1791: una riga di Gestione trascinata nella chat dell'Aiuto arriva come riferimento. Chi trascina e chi riceve
// parlano lo stesso tipo, e sul pannello dell'Aiuto il preload consegna al pannello quello che non è un file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (f) => readFileSync(join(radice, f), 'utf8');
const TIPO = 'application/x-filo-riferimento';

test('chi trascina una domanda e la chat che la riceve usano lo stesso tipo', () => {
  for (const f of ['src/pages/manage/manageDomande.js', 'src/content/sidebar.js']) {
    assert.ok(leggi(f).includes(`'${TIPO}'`), `${f} non usa ${TIPO}`);
  }
});

test('sul pannello dell’Aiuto un rilascio senza file va al pannello, e il sito non lo vede', () => {
  const require = createRequire(import.meta.url);
  const osserva = require(join(radice, 'src/preload/rilascio-file.js'));
  const ascolti = {};
  const win = { addEventListener: (t, fn) => { (ascolti[t] = ascolti[t] || []).push(fn); } };
  const presi = [];
  const consegnati = [];
  osserva(win, { pronta: () => true, consegna: (f) => presi.push(f), pannello: () => true, nelPannello: (e) => consegnati.push(e) });
  const evento = (types, files = []) => {
    const e = { isTrusted: true, target: { nodeType: 1, localName: 'textarea' }, fermato: false, impedito: false,
      dataTransfer: { types, files, items: [] } };
    e.stopImmediatePropagation = () => { e.fermato = true; };
    e.preventDefault = () => { e.impedito = true; };
    return e;
  };
  const rif = evento(['text/plain', TIPO]);
  for (const fn of ascolti.drop) fn(rif);
  assert.equal(rif.fermato, true, 'il sito vedrebbe il riferimento lasciato sul pannello');
  assert.deepEqual(consegnati, [rif]);
  assert.equal(presi.length, 0);
  const file = evento(['Files'], [{ name: 'a.png' }]);
  for (const fn of ascolti.drop) fn(file);
  assert.equal(file.fermato, true);
  assert.equal(presi.length, 1);
  assert.equal(consegnati.length, 1, 'un file non va al pannello come riferimento');
  for (const f of ['src/preload/internal-preload.js', 'src/preload/page-preload.js']) {
    assert.match(leggi(f), /nelPannello: \(e\) => globalThis\.SN_SIDEBAR\?\.rilascio\?\.\(e\)/, f);
  }
});

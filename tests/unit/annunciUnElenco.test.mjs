// #1403.33 — le parole che annunciano il dato dopo il suo nome («la password é …», «der PIN wird …») sono un elenco solo:
// ognuna fa vedere il dato al controllo delle uscite verso i siti, al correttore e al pavimento verso i modelli.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
require(join(ROOT, 'src', 'shared', 'guardianoStatico.js'));
const G = globalThis.SN_GUARDIANO_STATICO;
const P = require(join(ROOT, 'src', 'shared', 'pavimento.js'));
const valori = (xs) => xs.map((x) => x.valore);

test('la frase della segnalazione: «é» vale «è» per le uscite verso un sito come per i modelli', () => {
  const t = 'Ciao, la password é Mela!Verde77';
  assert.deepEqual(valori(G.segretiNelTesto(t)), ['Mela!Verde77']);
  assert.ok(valori(G.segretiInUscita(t)).includes('Mela!Verde77'));
  assert.equal(P.oscura(t), `Ciao, la password é ${P.SEGNAPOSTO}`);
});

test('ogni parola dell\'elenco annuncia la password e il codice a tutti e tre i controlli', () => {
  for (const w of G.ANNUNCI) {
    const pw = `Ciao, la password ${w} Mela!Verde77`;
    assert.ok(valori(G.segretiNelTesto(pw)).includes('Mela!Verde77'), `guardiano: ${pw}`);
    assert.ok(valori(G.segretiInUscita(pw)).includes('Mela!Verde77'), `uscite: ${pw}`);
    assert.ok(!P.oscura(pw).includes('Mela!Verde77'), `pavimento: ${pw}`);

    const otp = `il codice otp ${w} 482913`;
    assert.deepEqual([...new Set(valori(G.segretiInUscita(otp)))], ['482913'], `uscite: ${otp}`);
    assert.ok(!P.oscura(otp).includes('482913'), `pavimento: ${otp}`);

    for (const frase of [`il pin ${w} 4821`, `il cvv ${w} 739`]) {
      assert.ok(!/4821|739/.test(P.oscura(frase)), `pavimento: ${frase}`);
    }
  }
});

test('una parola dell\'elenco attaccata a cifre non annuncia niente', () => {
  assert.deepEqual(G.segretiInUscita('The password war2023 is not valid'), []);
});

test('il pavimento e il correttore non tengono un elenco loro', () => {
  for (const f of ['pavimento.js', 'riservatiNelTesto.js', 'campiSegreti.js', 'urlExfil.js']) {
    const src = readFileSync(join(ROOT, 'src', 'shared', f), 'utf8');
    assert.ok(!/luidt|brzmi|είναι|это|هي|היא/.test(src), `${f}: le parole stanno in guardianoStatico.js (ANNUNCI)`);
  }
});

// #1403.8 — il confine delle etichette della password, cosa vale come lettera, è uno solo per i nomi latini e non latini.
test('urlExfil non tiene un suo confine delle lettere: lo prende dai campi segreti', () => {
  const src = readFileSync(join(ROOT, 'src', 'shared', 'urlExfil.js'), 'utf8');
  assert.doesNotMatch(src, /\\\\u0370|\\\\u0400/, 'urlExfil.js: LETTERA sta in campiSegreti.js');
});

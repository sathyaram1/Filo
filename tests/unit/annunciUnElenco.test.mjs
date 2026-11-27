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

// #1403.83 — anche col complemento fra il nome e il verbo, prima riconosciuto in uscita solo con «è», «e'», «is», «era», «was».
test('il PIN col complemento è annunciato da ogni parola dell\'elenco in uscita come verso i modelli', () => {
  const codici = (t) => G.segretiInUscita(t).filter((x) => x.regola === 'codice').map((x) => x.valore);
  for (const w of G.ANNUNCI) {
    const frase = `il pin del telefono ${w} 4821`;
    assert.deepEqual(codici(frase), ['4821'], `uscite: ${frase}`);
    assert.ok(!P.oscura(frase).includes('4821'), `pavimento: ${frase}`);
  }
  for (const frase of ['il pin del telefono è ancora 4821', 'il pin del telefono dovrebbe essere 4821',
    'the pin to be used is 4821', 'the pin here is 4821', 'pin%20del%20telefono%20%C3%A9%204821']) {
    assert.deepEqual(codici(frase), ['4821'], frase);
  }
  for (const frase of ['se il pin é giusto la pagina è 2048', 'se il pin era giusto la pagina era 2048',
    'se il pin sarà giusto la pagina sarà 2048', 'il pin del telefono é cambiato 2 volte']) {
    assert.deepEqual(codici(frase), [], frase);
  }
});

// #1403.83 giro 1 — il verbo seguito dai due punti o dall'uguale annuncia il PIN come il verbo da solo.
test('il PIN annunciato da «è:» o «è =» esce come segreto, col complemento e senza', () => {
  const codici = (t) => [...new Set(G.segretiInUscita(t).filter((x) => x.regola === 'codice').map((x) => x.valore))];
  for (const w of G.ANNUNCI) {
    for (const frase of [`il pin ${w}: 4821`, `il pin del telefono ${w}: 4821`, `il pin del telefono ${w} = 4821`]) {
      assert.deepEqual(codici(frase), ['4821'], `uscite: ${frase}`);
    }
  }
  for (const frase of ['the pin for my phone is: 4821', 'il pin del telefono é : 4821', 'il pin del telefono é= 4821',
    'il pin del telefono è ancora: 4821', 'il codice otp è: 482913']) {
    assert.equal(codici(frase).length, 1, frase);
  }
  for (const frase of ['se il pin è: giusto, la pagina è 2048', 'il pin del telefono è: cambiato 2 volte']) {
    assert.deepEqual(codici(frase), [], frase);
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

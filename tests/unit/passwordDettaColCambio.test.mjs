// #1403.67 — la password nuova detta con un verbo di cambio («ho cambiato la password in …», «diventa …») o data dopo la
// domanda («ti ricordi la password? Era …») non arriva ai modelli, né dal pavimento né dal correttore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const G = globalThis.SN_GUARDIANO_STATICO;
const P = globalThis.SN_PAVIMENTO;
const C = require(join(ROOT, 'src', 'main', 'services', 'correttoreRiservati.js'));
const S = P.SEGNAPOSTO;

test('le due frasi della segnalazione arrivano al modello col segnaposto, fra virgolette e senza', () => {
  for (const [t, atteso] of [
    ['ho cambiato la password in «Mela! Verde77»', `ho cambiato la password in «${S}»`],
    ['Ti ricordi la password? Era «Mela! Verde77»', `Ti ricordi la password? Era «${S}»`],
    ['ho cambiato la password in Mela!Verde77', `ho cambiato la password in ${S}`],
    ['Ti ricordi la password? Era Mela!Verde77', `Ti ricordi la password? Era ${S}`],
  ]) {
    assert.equal(P.oscura(t), atteso, `pavimento: ${t}`);
    assert.equal(C.oscura(t), atteso, `correttore: ${t}`);
  }
  const messaggi = [{ role: 'user', content: [{ type: 'text', text: 'Ciao! ho cambiato la password in «Mela! Verde77», segnatela' }] }];
  assert.doesNotMatch(JSON.stringify(P.oscuraTutto(messaggi)), /Mela|Verde77/);
});

test('gli altri modi comuni di dire la password nuova', () => {
  for (const t of [
    'la password è stata cambiata in «Mela! Verde77»',
    "la password del wifi l'ho cambiata in «Mela! Verde77»",
    'ho modificato la password del router in «Mela! Verde77»',
    'ho impostato la password a «Mela! Verde77»',
    'la password è diventata «Mela! Verde77»',
    'la password diventa «Mela! Verde77»',
    'la password resta «Mela! Verde77»',
    'la password rimane Mela!Verde77',
    'qual è la password? È «Mela! Verde77»',
    'I changed the password to "Mela! Verde77"',
    'the password has been reset to «Mela! Verde77»',
  ]) {
    for (const [chi, o] of [['pavimento', P.oscura(t)], ['correttore', C.oscura(t)]]) {
      assert.ok(o.includes(S) && !/Mela|Verde77/.test(o), `${chi}: ${t} → ${o}`);
    }
  }
  assert.equal(P.oscura('ho modificato la password del router in «casa mia al mare»'), `ho modificato la password del router in «${S}»`);
});

test('ogni parola di cambio dell\'elenco presenta la password al pavimento', () => {
  for (const w of G.CAMBI.diventa) {
    const t = `la password ${w} «Mela! Verde77»`;
    assert.equal(P.oscura(t), `la password ${w} «${S}»`, t);
  }
  for (const p of G.CAMBI.participi) {
    for (const v of G.CAMBI.verso) {
      const t = `ho ${p} la password ${v} Mela!Verde77`;
      assert.equal(P.oscura(t), `ho ${p} la password ${v} ${S}`, t);
    }
  }
});

test('senza un cambio né un annuncio dopo la domanda, le parole dopo la password restano', () => {
  for (const t of [
    'ho cambiato la password in banca',
    'ho cambiato la password a Marco ieri',
    'send the password to Marco',
    'manda la password a «Marco»',
    'Hai cambiato la password? In banca dicono di sì',
    'Hai dimenticato la password? È facile: clicca su Recupera',
    'Ti ricordi la password? È «quella solita»',
  ]) assert.equal(P.oscura(t), t, t);
});

test('le parole di cambio stanno solo nel guardiano', () => {
  for (const f of [join('src', 'shared', 'pavimento.js'), join('src', 'shared', 'riservatiNelTesto.js')]) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(!/diventerà|rimast[oa]|became/.test(src), `${f}: le parole stanno in guardianoStatico.js (CAMBI)`);
  }
});

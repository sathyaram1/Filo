// #2678.21 — la password detta con un refuso nel nome («pasword», «passwrd»), con «e» senza accento o dopo un inciso fra
// virgole non arriva ai modelli, né dal pavimento né dal correttore; la congiunzione e le parole vicine restano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const P = globalThis.SN_PAVIMENTO;
const C = require(join(ROOT, 'src', 'main', 'services', 'correttoreRiservati.js'));
const S = P.SEGNAPOSTO;

const SEGNALATE = [
  'la pasword è Mela!Verde77',
  'la passwrd è stata cambiata in Mela!Verde77',
  'la password e Mela!Verde77',
  'la password, che era vecchia, è Mela!Verde77',
];

test('le quattro frasi della segnalazione arrivano al modello col segnaposto', () => {
  for (const t of SEGNALATE) {
    const atteso = t.replace('Mela!Verde77', S);
    assert.equal(P.oscura(t), atteso, `pavimento: ${t}`);
    assert.equal(C.oscura(t), atteso, `correttore: ${t}`);
  }
  const messaggi = [{ role: 'user', content: [{ type: 'text', text: `Ciao! ${SEGNALATE.join('. ')}. Segnatela` }] }];
  assert.doesNotMatch(JSON.stringify(P.oscuraTutto(messaggi)), /Mela|Verde77/);
});

test('le stesse forme fra virgolette, con la maiuscola, di cosa è la password e coi due punti', () => {
  for (const [t, atteso] of [
    ['la pasword è «Mela!Verde77»', `la pasword è «${S}»`],
    ['la password e «Mela!Verde77»', `la password e «${S}»`],
    ['la password, che era vecchia, è «Mela!Verde77»', `la password, che era vecchia, è «${S}»`],
    ['La Pasword: Mela!Verde77', `La Pasword: ${S}`],
    ['la passowrd del wifi è Mela!Verde77', `la passowrd del wifi è ${S}`],
    ['la password del wifi e Mela!Verde77', `la password del wifi e ${S}`],
    ['la password, che era vecchia, è stata cambiata in Mela!Verde77', `la password, che era vecchia, è stata cambiata in ${S}`],
    ['la passwordd, quella nuova di ieri, è Mela!Verde77', `la passwordd, quella nuova di ieri, è ${S}`],
  ]) {
    assert.equal(P.oscura(t), atteso, `pavimento: ${t}`);
    assert.equal(C.oscura(t), atteso, `correttore: ${t}`);
  }
});

test('la congiunzione, le parole che somigliano a «password» e un inciso che spiega restano', () => {
  for (const t of [
    'la password e il nome utente sono nel cassetto',
    'password e PIN: li trovi sul retro',
    'ho passato il passport al controllo',
    'il passed test è Ok2024',
    'ho pagato il periodo, è Mela!Verde77',
    'la password, se la dimentichi, è recuperabile',
    'la password, che era vecchia, è «la stessa di prima»',
  ]) assert.equal(P.oscura(t), t, t);
});

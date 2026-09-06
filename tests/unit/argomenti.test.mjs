// Unit test del controllo degli argomenti a riga di comando.
//
// PERCHÉ CONTA
//   Ogni riga qui sotto è una porta trovata sul campo, dove uno strumento
//   faceva la cosa VERA per un argomento che non aveva capito: un feedback
//   aperto senza l'allegato, un giro «a vuoto» che scriveva davvero, e nel
//   caso peggiore la chiave dei feedback rigenerata, che rende illeggibile
//   tutto quello che era stato cifrato con la vecchia.

import test from 'node:test';
import assert from 'node:assert/strict';

const { controllaArgomenti, sembraOpzione, normalizza } = await import('../../scripts/lib/argomenti.mjs');

const FEEDBACK = {
  opzioni: ['--priorita', '--url', '--allega', '--dry-run'],
  conValore: ['--priorita', '--url', '--allega'],
};

test('la riga scritta bene passa', () => {
  assert.equal(controllaArgomenti(['titolo', 'testo', '--allega', 'spec.md', '--dry-run'], FEEDBACK), null);
  assert.equal(controllaArgomenti(['titolo', 'testo', '--priorita', '2'], FEEDBACK), null);
  assert.equal(controllaArgomenti([], FEEDBACK), null);
});

test('un nome sbagliato è respinto, e il rifiuto dice cosa è ammesso', () => {
  const m = controllaArgomenti(['t', 'x', '--allgea', 'spec.md'], FEEDBACK);
  assert.match(m, /opzione sconosciuta --allgea/);
  assert.match(m, /non ho toccato niente/);
  assert.match(m, /--allega/, 'il rifiuto elenca le opzioni ammesse');
});

test('un trattino solo NON vale come due: il nome è giusto ma la riga no', () => {
  // La porta vera: «-allega spec.md» faceva finire opzione e nome del file
  // dentro al testo del feedback, che veniva aperto lo stesso.
  assert.match(controllaArgomenti(['t', 'x', '-allega', 'spec.md'], FEEDBACK), /va scritta --allega/);
  assert.match(controllaArgomenti(['t', 'x', '-dry-run'], FEEDBACK), /va scritta --dry-run/);
});

test('i trattini lunghi del copia-incolla sono respinti come tali', () => {
  for (const trattino of ['–', '—', '‐', '−']) {
    const m = controllaArgomenti(['t', 'x', `${trattino}dry-run`], FEEDBACK);
    assert.match(m, /va scritta --dry-run/, `il trattino ${trattino} deve essere riconosciuto`);
  }
});

test('un\'opzione che vuole un valore e non ce l\'ha è respinta, non ignorata', () => {
  assert.match(controllaArgomenti(['t', 'x', '--allega'], FEEDBACK), /vuole un valore/);
  assert.match(controllaArgomenti(['t', 'x', '--priorita', '--dry-run'], FEEDBACK), /vuole un valore/);
  // Il valore di un'opzione non viene riesaminato come argomento a sé: un
  // titolo che comincia per trattino resta un valore, non un'opzione.
  assert.equal(controllaArgomenti(['t', 'x', '--url', 'https://x.it', '--dry-run'], FEEDBACK), null);
});

test('quello che non è un\'opzione resta quello che è', () => {
  assert.equal(sembraOpzione('-'), false, '«-» da solo è stdin');
  assert.equal(sembraOpzione('-3'), false, 'un numero negativo non è un\'opzione');
  assert.equal(sembraOpzione('titolo'), false);
  assert.equal(sembraOpzione('--dry-run'), true);
  assert.equal(controllaArgomenti(['t', '-'], FEEDBACK), null);
  assert.equal(normalizza('-dry-run'), '--dry-run');
  assert.equal(normalizza('–dry-run'), '--dry-run');
});

test('lo strumento con una sola opzione: tutto il resto è respinto', () => {
  const SOLO_DRY = { opzioni: ['--dry-run'] };
  assert.equal(controllaArgomenti(['--dry-run'], SOLO_DRY), null);
  assert.match(controllaArgomenti(['--dryrun'], SOLO_DRY), /opzione sconosciuta/);
  assert.match(controllaArgomenti(['-dry-run'], SOLO_DRY), /va scritta --dry-run/);
  assert.match(controllaArgomenti(['--print'], SOLO_DRY), /opzione sconosciuta/);
});

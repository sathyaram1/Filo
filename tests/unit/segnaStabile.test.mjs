// Il segno «stabile» (#2501): sulla pagina della versione costruita dal commit con la suite verde, una volta sola.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corpoStabile, corsaVerdeDi, leggiArgomenti, INIZIO, FINE } from '../../scripts/segna-stabile.mjs';

const SHA = 'a'.repeat(40);

test('il segno va in cima, sopra le note e la sezione Verifica, e non si raddoppia', () => {
  const una = corpoStabile('Novità\n\n<!-- filo-verifica:inizio -->x<!-- filo-verifica:fine -->', { commit: SHA, corsa: 'https://c/1' });
  assert.ok(una.startsWith(INIZIO));
  assert.match(una, /\*\*Versione stabile\*\*: la suite completa è verde sul commit `a{40}`/);
  assert.match(una, /\(\[corsa\]\(https:\/\/c\/1\)\)/);
  assert.match(una, /Novità\n\n<!-- filo-verifica:inizio -->/);
  const due = corpoStabile(una, { commit: SHA, corsa: 'https://c/2' });
  assert.equal(due.split(INIZIO).length - 1, 1);
  assert.equal(due.split(FINE).length - 1, 1);
  assert.match(due, /c\/2/);
  assert.doesNotMatch(due, /c\/1/);
});

test('una pagina vuota prende il solo segno', () => {
  assert.equal(corpoStabile('', { commit: SHA }), `${INIZIO}\n**Versione stabile**: la suite completa è verde sul commit \`${SHA}\` da cui è costruita.\n${FINE}`);
});

test('conta solo una corsa riuscita della suite su quel commit', () => {
  assert.equal(corsaVerdeDi([{ head_sha: SHA, conclusion: 'failure' }], SHA), null);
  assert.equal(corsaVerdeDi([{ head_sha: 'b'.repeat(40), conclusion: 'success' }], SHA), null);
  assert.ok(corsaVerdeDi([{ head_sha: SHA, conclusion: 'success', status: 'completed' }], SHA));
});

test('vuole lo sha intero', () => {
  assert.ok(leggiArgomenti(['--commit', 'abc']).errore);
  assert.deepEqual(leggiArgomenti(['--commit', SHA, '--se-suite-verde']), { commit: SHA, corsa: '', seSuiteVerde: true });
});

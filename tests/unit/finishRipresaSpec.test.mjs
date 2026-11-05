// #2113: finish:check interrotto dal tetto di un comando in sottofondo si rilancia e riprende dagli spec non ancora
// verdi sullo stesso contenuto, anche con le prove del giro committate nel frattempo; su un altro contenuto si rifà tutto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { memoriaSpecVerdi, specDaRiprendere, leggiSpecVerdi } from '../../scripts/finish-local.mjs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

test('ripresa: rilanciato sullo stesso commit salta gli spec già verdi, su un altro contenuto li rifà tutti', () => {
  const dir = cartellaTemporanea('ripresa-spec-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
    writeFileSync(resolve(dir, 'a.txt'), '1\n'); g('add', '-A'); g('commit', '-qm', 'uno');
    const sha = g('rev-parse', 'HEAD');
    const specs = ['tests/editor', 'tests/history', 'tests/board', 'tests/options'];

    // Primo lancio: due lotti verdi, poi il comando muore.
    const primo = memoriaSpecVerdi(dir, sha);
    assert.deepEqual(specDaRiprendere(specs, primo.verdi).restano, specs, 'senza memoria si lancia tutto');
    primo.segna(['tests/editor']);
    primo.segna(['tests/history']);
    assert.equal(g('status', '--porcelain'), '', 'la memoria sta fuori dall\'albero: niente da committare');

    const secondo = memoriaSpecVerdi(dir, sha);
    const { restano, saltati } = specDaRiprendere(specs, secondo.verdi);
    assert.deepEqual(restano, ['tests/board', 'tests/options']);
    assert.deepEqual(saltati, ['tests/editor', 'tests/history']);

    // Un commit nuovo: i verdi di prima non valgono, e la prima scrittura butta la memoria vecchia.
    writeFileSync(resolve(dir, 'a.txt'), '2\n'); g('commit', '-qam', 'due');
    const nuovo = g('rev-parse', 'HEAD');
    const terzo = memoriaSpecVerdi(dir, nuovo);
    assert.deepEqual(specDaRiprendere(specs, terzo.verdi).restano, specs);
    terzo.segna(['tests/board']);
    assert.deepEqual([...leggiSpecVerdi(terzo.file, terzo.chiave)], ['tests/board']);
    assert.deepEqual([...leggiSpecVerdi(terzo.file, primo.chiave)], []);
  } finally {
    togliCartella(dir);
  }
});

test('ripresa: una memoria illeggibile o di forma sbagliata non salta niente', () => {
  const dir = cartellaTemporanea('ripresa-guasta-');
  try {
    const file = resolve(dir, 'm.json');
    writeFileSync(file, '{rotto');
    assert.equal(leggiSpecVerdi(file, 'abc').size, 0);
    writeFileSync(file, JSON.stringify({ sha: 'abc', verdi: 'tests/editor' }));
    assert.equal(leggiSpecVerdi(file, 'abc').size, 0);
    assert.equal(leggiSpecVerdi(resolve(dir, 'manca.json'), 'abc').size, 0);
  } finally {
    togliCartella(dir);
  }
});

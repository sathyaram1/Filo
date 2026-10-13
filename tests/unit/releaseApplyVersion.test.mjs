// Il numero del server applicato in locale al commit provato (#641), e il conto
// "c'è qualcosa di nuovo dal tag" di release.yml eseguito su un repo vero.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicaVersione, confrontaVersioni } from '../../scripts/release-apply-version.mjs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = readFileSync(join(ROOT, 'package.json'), 'utf8');
const ATTUALE = JSON.parse(PKG).version;
const [MA, MI, PA] = ATTUALE.split('.').map(Number);
const SUCCESSIVA = `${MA}.${MI}.${PA + 1}`;

describe('applicaVersione', () => {
  test('sul manifesto vero cambia solo la riga della versione, come il commit del server', () => {
    const r = applicaVersione(PKG, `v${SUCCESSIVA}`);
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.previous, ATTUALE);
    assert.equal(JSON.parse(r.testo).version, SUCCESSIVA);
    const prima = PKG.split('\n');
    const dopo = r.testo.split('\n');
    assert.equal(dopo.length, prima.length);
    const diverse = prima.filter((riga, i) => riga !== dopo[i]);
    assert.deepEqual(diverse, [`  "version": "${ATTUALE}",`]);
  });

  test('accetta il numero con e senza la v davanti (il bump lo stampa senza, l\'output del lavoro con)', () => {
    assert.equal(applicaVersione(PKG, SUCCESSIVA).version, SUCCESSIVA);
    assert.equal(applicaVersione(PKG, ` v${SUCCESSIVA}\n`).version, SUCCESSIVA);
  });

  test('rifiuta un numero uguale o più basso: scriverebbe sopra una release esistente', () => {
    assert.equal(applicaVersione(PKG, ATTUALE).ok, false);
    assert.equal(applicaVersione(PKG, '0.0.1').ok, false);
    assert.match(applicaVersione(PKG, ATTUALE).reason, /non è più alto/);
  });

  test('rifiuta numeri malformati o vuoti (un output del bump mancante non diventa una build)', () => {
    for (const v of ['', ' ', 'v', '1.2', '1.2.3.4', 'v1.2.x', '1.2.3-beta', '<b>1.2.3</b>', undefined]) {
      assert.equal(applicaVersione(PKG, v).ok, false, `accettato: ${JSON.stringify(v)}`);
    }
  });

  test('rifiuta un manifesto non leggibile o senza versione', () => {
    assert.equal(applicaVersione('{ rotto', '9.9.9').ok, false);
    assert.equal(applicaVersione('{"name":"x"}', '9.9.9').ok, false);
  });

  test('il confronto è numerico, non alfabetico (0.2.230 > 0.2.99 > 0.2.9)', () => {
    assert.equal(confrontaVersioni('0.2.230', '0.2.99'), 1);
    assert.equal(confrontaVersioni('0.2.9', '0.2.99'), -1);
    assert.equal(confrontaVersioni('1.0.0', '0.99.99'), 1);
    assert.equal(confrontaVersioni('0.2.5', '0.2.5'), 0);
    assert.equal(applicaVersione('{\n  "version": "0.2.99"\n}\n', '0.2.100').ok, true);
  });
});

// La riga del conto si prende dal workflow, così la prova segue il file vero.
describe('il conto "qualcosa di nuovo dal tag" di release.yml', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  const riga = yml.split('\n').map((r) => r.trim()).find((r) => r.startsWith('AHEAD=$(git rev-list'));
  const comando = riga.replace(/^AHEAD=\$\(/, '').replace(/\)$/, '');

  function repo() {
    const dir = cartellaTemporanea('filo-release-conto-');
    const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    g('config', 'commit.gpgsign', 'false');
    const commit = (msg) => {
      writeFileSync(join(dir, 'f.txt'), `${msg}\n${Math.random()}`);
      g('add', '.');
      g('commit', '-q', '-m', msg);
      return g('rev-parse', 'HEAD');
    };
    const conta = () => Number(execFileSync('bash', ['-c', `LAST_TAG=$(git describe --tags --abbrev=0 --match 'v*'); ${comando}`],
      { cwd: dir, encoding: 'utf8' }).trim());
    return { dir, g, commit, conta };
  }

  test('dopo una pubblicazione, il solo commit del numero del server non è codice nuovo', () => {
    const { dir, g, commit, conta } = repo();
    try {
      commit('release: v0.2.228 [skip ci]');
      g('tag', 'v0.2.228');
      const provato = commit('merge-gate: #641 via server');
      commit('release: v0.2.229 [skip ci]');
      g('tag', 'v0.2.229', provato);
      assert.equal(conta(), 0, 'ogni corsa ripubblicherebbe il solo numero');
    } finally { togliCartella(dir); }
  });

  test('una fusione entrata durante la suite resta da pubblicare alla corsa dopo', () => {
    const { dir, g, commit, conta } = repo();
    try {
      commit('iniziale');
      g('tag', 'v0.2.228');
      const provato = commit('merge-gate: #641 via server');
      commit('merge-gate: #700 via server');
      commit('release: v0.2.229 [skip ci]');
      g('tag', 'v0.2.229', provato);
      assert.equal(conta(), 1);
    } finally { togliCartella(dir); }
  });

  test('un commit qualunque che parla di release nel testo conta come codice nuovo', () => {
    const { dir, g, commit, conta } = repo();
    try {
      commit('iniziale');
      g('tag', 'v0.2.228');
      commit('#641: release: pubblica il commit provato');
      assert.equal(conta(), 1);
    } finally { togliCartella(dir); }
  });
});

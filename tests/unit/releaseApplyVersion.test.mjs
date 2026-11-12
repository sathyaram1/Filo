// Il numero del server applicato in locale al commit provato (#641), solo se combacia con la prossima versione
// dichiarata, lo stesso numero nel lockfile (#2040), e il conto "c'è qualcosa di nuovo dal tag" di release.yml
// eseguito su un repo vero.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicaVersione, applicaVersioneAlLock, confrontaVersioni } from '../../scripts/release-apply-version.mjs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { prossimaVersione } from '../../scripts/lib/novita-in-cima.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = readFileSync(join(ROOT, 'package.json'), 'utf8');
const ATTUALE = JSON.parse(PKG).version;
const PROSSIMA = prossimaVersione(JSON.parse(PKG));
const SUCCESSIVA = PROSSIMA.versione;

describe('applicaVersione', () => {
  test('sul manifesto vero, col numero che il server scriverà, cambia solo la riga della versione', () => {
    assert.ok(!PROSSIMA.errore, PROSSIMA.errore);
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

  test('col manifesto che dichiara la prossima versione accetta solo quella, e il campo resta', () => {
    const conCampo = '{\n  "name": "filo",\n  "version": "0.2.247",\n  "prossimaVersione": "0.3.0",\n  "private": true\n}\n';
    const r = applicaVersione(conCampo, 'v0.3.0');
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.testo, conCampo.replace('"version": "0.2.247"', '"version": "0.3.0"'));

    // Un server che non legge il campo scrive patch+1: le note del blocco 0.3.0 uscirebbero sotto la 0.2.248.
    for (const v of ['0.2.248', '0.3.1', '0.4.0']) {
      const no = applicaVersione(conCampo, v);
      assert.equal(no.ok, false, `accettato ${v}`);
      assert.match(no.reason, /dichiara come prossima versione "0\.3\.0", il server ha scritto/);
    }
    // Un campo che il server avrebbe rifiutato non combacia con nessun numero.
    for (const campo of ['"0.3"', '"v0.3.0"', 'null', '"0.2.247"']) {
      const t = conCampo.replace('"0.3.0"', campo);
      for (const v of ['0.2.248', '0.3.0']) assert.equal(applicaVersione(t, v).ok, false, `${campo} con ${v}`);
    }
    // Solo a primo livello, come `version`.
    const annidato = '{\n  "version": "0.2.247",\n  "build": {\n    "prossimaVersione": "0.3.0"\n  }\n}\n';
    assert.equal(applicaVersione(annidato, '0.2.248').ok, true);
  });

  test('il confronto è numerico, non alfabetico (0.2.230 > 0.2.99 > 0.2.9)', () => {
    assert.equal(confrontaVersioni('0.2.230', '0.2.99'), 1);
    assert.equal(confrontaVersioni('0.2.9', '0.2.99'), -1);
    assert.equal(confrontaVersioni('1.0.0', '0.99.99'), 1);
    assert.equal(confrontaVersioni('0.2.5', '0.2.5'), 0);
    assert.equal(applicaVersione('{\n  "version": "0.2.99"\n}\n', '0.2.100').ok, true);
  });
});

// Il lockfile lasciato indietro faceva riscrivere a ogni `npm install` il numero, e il rebase dopo si rifiutava (#2040).
describe('applicaVersioneAlLock', () => {
  const LOCK = readFileSync(join(ROOT, 'package-lock.json'), 'utf8');
  const conNumero = (testo, v) => {
    const o = JSON.parse(testo);
    o.version = v;
    o.packages[''].version = v;
    return `${JSON.stringify(o, null, 2)}\n`;
  };

  test('sul lockfile vero cambiano solo le due righe del numero del progetto, anche se era rimasto indietro', () => {
    for (const prima of [LOCK, conNumero(LOCK, '0.2.100')]) {
      const r = applicaVersioneAlLock(prima, `v${SUCCESSIVA}`);
      assert.equal(r.ok, true, r.reason);
      const dopo = JSON.parse(r.testo);
      assert.equal(dopo.version, SUCCESSIVA);
      assert.equal(dopo.packages[''].version, SUCCESSIVA);
      const righePrima = prima.split('\n');
      const righeDopo = r.testo.split('\n');
      assert.equal(righeDopo.length, righePrima.length);
      const cambiate = righeDopo.filter((riga, i) => riga !== righePrima[i]);
      assert.deepEqual(cambiate, [`  "version": "${SUCCESSIVA}",`, `      "version": "${SUCCESSIVA}",`]);
    }
  });

  test('manifesto e lockfile escono con lo stesso numero', () => {
    const m = applicaVersione(PKG, SUCCESSIVA);
    const l = applicaVersioneAlLock(LOCK, m.version);
    assert.equal(JSON.parse(m.testo).version, JSON.parse(l.testo).version);
  });

  test('un lockfile già al numero resta identico', () => {
    const allineato = conNumero(LOCK, SUCCESSIVA);
    assert.equal(applicaVersioneAlLock(allineato, SUCCESSIVA).testo, allineato);
  });

  test('rifiuta numeri malformati, lockfile illeggibili, senza numero o non nel formato di npm', () => {
    for (const v of ['', 'v', '1.2', '1.2.3-beta', undefined]) assert.equal(applicaVersioneAlLock(LOCK, v).ok, false, `accettato ${v}`);
    assert.match(applicaVersioneAlLock('{ rotto', SUCCESSIVA).reason, /non leggibile/);
    assert.match(applicaVersioneAlLock('[]\n', SUCCESSIVA).reason, /non leggibile/);
    assert.match(applicaVersioneAlLock('{\n  "name": "filo"\n}\n', SUCCESSIVA).reason, /non porta il numero/);
    // Riscriverlo nel formato di npm cambierebbe ogni riga: meglio lasciarlo com'è.
    assert.match(applicaVersioneAlLock(LOCK.replace(/\n/g, '\r\n'), SUCCESSIVA).reason, /formato di npm/);
    assert.match(applicaVersioneAlLock(JSON.stringify(JSON.parse(LOCK), null, 4), SUCCESSIVA).reason, /formato di npm/);
  });

  test('un lockfile senza `packages` (formato 1) cambia solo il numero in cima', () => {
    const v1 = '{\n  "name": "filo",\n  "version": "0.2.1",\n  "lockfileVersion": 1\n}\n';
    assert.equal(applicaVersioneAlLock(v1, '0.2.2').testo, v1.replace('0.2.1', '0.2.2'));
  });
});

describe('lo strumento che il lavoro di pubblicazione lancia', () => {
  const SCRIPT = join(ROOT, 'scripts', 'release-apply-version.mjs');
  function albero(lock) {
    const dir = cartellaTemporanea('filo-release-applica-');
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'scripts', 'release-apply-version.mjs'), readFileSync(SCRIPT, 'utf8'));
    writeFileSync(join(dir, 'package.json'), '{\n  "name": "filo",\n  "version": "0.2.256",\n  "private": true\n}\n');
    if (lock !== null) writeFileSync(join(dir, 'package-lock.json'), lock);
    const lancia = (v) => spawnSync(process.execPath, [join(dir, 'scripts', 'release-apply-version.mjs'), v], { encoding: 'utf8' });
    const leggi = (f) => readFileSync(join(dir, f), 'utf8');
    return { dir, lancia, leggi };
  }
  const lockDi = (v) => `${JSON.stringify({ name: 'filo', version: v, lockfileVersion: 3, requires: true, packages: { '': { name: 'filo', version: v } } }, null, 2)}\n`;

  test('alza manifesto e lockfile insieme, anche col lockfile rimasto indietro', () => {
    const { dir, lancia, leggi } = albero(lockDi('0.2.246'));
    try {
      const r = lancia('v0.2.257');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(leggi('package.json')).version, '0.2.257');
      assert.equal(leggi('package-lock.json'), lockDi('0.2.257'));
    } finally { togliCartella(dir); }
  });

  test('un lockfile che non si riallinea lo dice e non ferma la pubblicazione', () => {
    const { dir, lancia, leggi } = albero('{ rotto');
    try {
      const r = lancia('0.2.257');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(leggi('package.json')).version, '0.2.257');
      assert.equal(leggi('package-lock.json'), '{ rotto');
      assert.match(r.stdout, /::warning::.*package-lock\.json resta com'è/);
    } finally { togliCartella(dir); }
  });

  test('senza lockfile alza il manifesto e basta', () => {
    const { dir, lancia, leggi } = albero(null);
    try {
      assert.equal(lancia('0.2.257').status, 0);
      assert.equal(JSON.parse(leggi('package.json')).version, '0.2.257');
    } finally { togliCartella(dir); }
  });

  test('un numero rifiutato non tocca nemmeno il lockfile', () => {
    const { dir, lancia, leggi } = albero(lockDi('0.2.246'));
    try {
      assert.equal(lancia('0.2.255').status, 2);
      assert.equal(leggi('package-lock.json'), lockDi('0.2.246'));
    } finally { togliCartella(dir); }
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

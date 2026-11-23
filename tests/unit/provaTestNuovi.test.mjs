// La prova del test nuovo (#2505): su un ramo di prova in un repo temporaneo, il caso che prova il lavoro esce rosso senza
// e verde con; un caso verde anche senza il lavoro esce segnalato. I test girano davvero (node --test), Playwright no.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { apriCopia, corriFile, esitiDaPlaywright, esitiDaTap, esitoDelCaso, provaTestNuovi, testNuoviDelRamo, testoDellaProva } from '../../scripts/lib/prova-test-nuovi.mjs';
import { cloneDellUltimaProva, esitoSalvato, provaDelRamo } from '../../scripts/prova-test-nuovi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function ramoDiProva() {
  const root = cartellaTemporanea('filo-prova-nuovi-test-');
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const scrivi = (f, t) => { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), t); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'prova@example.invalid');
  g('config', 'user.name', 'prova');
  g('config', 'core.hooksPath', join(root, '.git', 'nessun-gancio'));
  scrivi('src/somma.mjs', 'export const somma = (a, b) => a - b;\n');
  scrivi('tests/unit/vecchio.test.mjs', "import { test } from 'node:test';\ntest('vecchio caso', () => {});\n");
  g('add', '-A'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  g('checkout', '-qb', 'lavoro');
  scrivi('src/somma.mjs', 'export const somma = (a, b) => a + b;\n');
  scrivi('tests/unit/somma.test.mjs', [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { somma } from '../../src/somma.mjs';",
    "test('somma due numeri', () => { assert.equal(somma(2, 3), 5); });",
    "test('somma col neutro', () => { assert.equal(somma(4, 0), 4); });",
    '',
  ].join('\n'));
  g('add', '-A'); g('commit', '-qm', 'lavoro');
  return { root, base, head: g('rev-parse', 'HEAD') };
}

test('sul ramo di prova: rosso senza il lavoro e verde con; il caso verde anche senza esce segnalato', () => {
  const { root, base, head } = ramoDiProva();
  try {
    assert.deepEqual(testNuoviDelRamo(root, base, head), [{ file: 'tests/unit/somma.test.mjs', tipo: 'unit', casi: ['somma due numeri', 'somma col neutro'] }]);
    const p = provaTestNuovi({ root, base, head });
    assert.deepEqual(p.casi, [
      { file: 'tests/unit/somma.test.mjs', caso: 'somma due numeri', senza: 'rosso', con: 'verde' },
      { file: 'tests/unit/somma.test.mjs', caso: 'somma col neutro', senza: 'verde', con: 'verde' },
    ]);
    assert.equal(p.verdiSenza, 1);
    assert.equal(p.nonVerdiCon, 0);
    assert.match(testoDellaProva(p), /somma col neutro: senza verde, con verde {2}VERDE ANCHE SENZA IL LAVORO/);
    assert.doesNotMatch(testoDellaProva(p), /somma due numeri.*VERDE ANCHE/);
    assert.equal(execFileSync('git', ['worktree', 'list'], { cwd: root, encoding: 'utf8' }).trim().split('\n').length, 1, 'le copie si tolgono');
  } finally { togliCartella(root); }
});

test('un ramo senza prove nuove lo dice, non inventa casi', () => {
  const { root, base } = ramoDiProva();
  try {
    const p = provaTestNuovi({ root, base, head: base });
    assert.deepEqual(p.casi, []);
    assert.match(testoDellaProva(p), /nessun caso di prova nuovo o cambiato/);
  } finally { togliCartella(root); }
});

// Il perché di un caso «non trovato» sta nell'uscita di Playwright e negli errori del suo rapporto: il cancello di
// Windows ne stampa solo il messaggio dell'asserzione, e tre correzioni sono andate alla cieca (#2505).
function conUscita() {
  const uscite = [];
  const corri = (dir, voce, o) => corriFile(dir, voce, { ...o, lancia: (cmd, args, opz) => {
    const r = spawnSync(cmd, args, opz);
    let errori = '';
    try {
      const json = JSON.parse(readFileSync(opz.env.PLAYWRIGHT_JSON_OUTPUT_FILE, 'utf8'));
      errori = (json.errors || []).map((e) => String(e.message || e.value || '').split('\n').slice(0, 6).join(' | ')).join(' || ');
    } catch (_) { /* senza rapporto restano stdout e stderr */ }
    const coda = (t) => String(t || '').trim().split(/\r?\n/).slice(-12).join(' | ');
    uscite.push(`${dir} [${cmd} ${args.join(' ')}] esce ${r.status}; errori del rapporto: ${errori || 'nessuno'}; stderr: ${coda(r.stderr)}; stdout: ${coda(r.stdout)}`);
    return r;
  } });
  return { corri, uscita: () => uscite.join('\n') };
}

test('uno spec Playwright nuovo: lanciato davvero nelle due copie, rosso senza il lavoro e verde con', () => {
  const { root, base } = ramoDiProva();
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const { corri, uscita } = conUscita();
  try {
    symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'junction');
    writeFileSync(join(root, '.gitignore'), 'node_modules\n');
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'tests', 'somma.spec.mjs'), [
      "import { test, expect } from '@playwright/test';",
      "import { somma } from '../src/somma.mjs';",
      "test('la somma nello spec', () => { expect(somma(2, 3)).toBe(5); });",
      '',
    ].join('\n'));
    g('add', '-A'); g('commit', '-qm', 'spec');
    const p = provaTestNuovi({ root, base, head: g('rev-parse', 'HEAD'), corri });
    assert.deepEqual(p.casi.find((c) => c.file === 'tests/somma.spec.mjs'), { file: 'tests/somma.spec.mjs', caso: 'la somma nello spec', senza: 'rosso', con: 'verde' }, uscita());
  } finally { togliCartella(root); }
});

// Su Windows la junction delle dipendenze si risolve in modo diverso da Linux: qui lo stesso si ottiene con lo spec che
// non risolve i collegamenti, e senza un percorso unico per CLI e spec i casi non si trovano.
test('uno spec Playwright nuovo si trova anche dove lo spec non risolve il collegamento delle dipendenze', () => {
  const { root, base } = ramoDiProva();
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const prima = process.env.NODE_OPTIONS;
  const { corri, uscita } = conUscita();
  try {
    symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'junction');
    writeFileSync(join(root, '.gitignore'), 'node_modules\n');
    writeFileSync(join(root, 'tests', 'somma.spec.mjs'), [
      "import { test, expect } from '@playwright/test';",
      "import { somma } from '../src/somma.mjs';",
      "test('la somma nello spec', () => { expect(somma(2, 3)).toBe(5); });",
      '',
    ].join('\n'));
    g('add', '-A'); g('commit', '-qm', 'spec');
    process.env.NODE_OPTIONS = `${prima || ''} --preserve-symlinks`.trim();
    const p = provaTestNuovi({ root, base, head: g('rev-parse', 'HEAD') });
    assert.deepEqual(p.casi.find((c) => c.file === 'tests/somma.spec.mjs'), { file: 'tests/somma.spec.mjs', caso: 'la somma nello spec', senza: 'rosso', con: 'verde' });
  } finally {
    if (prima === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = prima;
    togliCartella(root);
  }
});

test('la copia nasce nella forma lunga del percorso: con la temporanea corta di Windows Playwright non trova i casi', () => {
  const { root, base } = ramoDiProva();
  const copia = apriCopia(root, base);
  try {
    assert.equal(copia.dir, realpathSync.native(copia.dir));
  } finally { copia.chiudi(); togliCartella(root); }
});

test('uno spec che non parte esce «errore», non un rosso senza il lavoro che sembra quello atteso', () => {
  const voce = { file: 'tests/x.spec.mjs', tipo: 'spec', casi: ['x'] };
  const muto = () => ({ status: 1, stdout: '', stderr: 'Error: Cannot find module @playwright/test' });
  const s = corriFile(cartellaTemporanea('filo-prova-muta-'), voce, { lancia: muto, prepara: (cmd, args) => ({ ok: true, cmd, args }) });
  assert.equal(s.partito, false);
  assert.match(s.errore, /non ha scritto il rapporto.*Cannot find module/);
  assert.deepEqual(esitoDelCaso('x', s, s), { senza: 'errore', con: 'errore' });
  const n = corriFile(cartellaTemporanea('filo-prova-muta-'), { ...voce, tipo: 'unit' }, { lancia: () => ({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) }) });
  assert.match(n.errore, /node non parte \(ENOENT\)/);
});

test('l\'esito salvato: ripreso per la stessa punta e dopo la sola riga delle novità o un .md; rifatto dopo del codice', () => {
  const { root } = ramoDiProva();
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const vecchio = process.env.FILO_SERVER_CLONE;
  process.env.FILO_SERVER_CLONE = join(root, 'nessun-server');
  try {
    g('update-ref', 'refs/remotes/origin/main', 'main');
    const e = provaDelRamo(root, { log: () => {} });
    assert.equal(e.app.casi.length, 2);
    assert.equal(e.server, undefined);
    assert.ok(esitoSalvato(root), 'stessa punta: si riprende');
    mkdirSync(join(root, 'src', 'shared'), { recursive: true });
    writeFileSync(join(root, 'src', 'shared', 'patchNotes.js'), '// novità\n');
    writeFileSync(join(root, 'NOTE.md'), 'note\n');
    g('add', '-A'); g('commit', '-qm', 'novità');
    assert.ok(esitoSalvato(root), 'solo testi dopo la prova: si riprende');
    writeFileSync(join(root, 'src', 'somma.mjs'), 'export const somma = (a, b) => b + a;\n');
    g('add', '-A'); g('commit', '-qm', 'codice');
    assert.equal(esitoSalvato(root), null, 'codice dopo la prova: si rifà');
  } finally {
    if (vecchio === undefined) delete process.env.FILO_SERVER_CLONE; else process.env.FILO_SERVER_CLONE = vecchio;
    togliCartella(root);
  }
});

test('in un lavoro server la prova rifatta dopo un commit di codice tiene la parte del server', () => {
  const app = ramoDiProva();
  const srv = ramoDiProva();
  const ga = (...a) => execFileSync('git', a, { cwd: app.root, encoding: 'utf8' }).trim();
  const gs = (...a) => execFileSync('git', a, { cwd: srv.root, encoding: 'utf8' }).trim();
  try {
    ga('update-ref', 'refs/remotes/origin/main', 'main');
    gs('update-ref', 'refs/remotes/origin/main', 'main');
    mkdirSync(join(srv.root, 'functions', 'test'), { recursive: true });
    writeFileSync(join(srv.root, 'functions', 'package.json'), '{ "name": "f", "private": true }\n');
    writeFileSync(join(srv.root, 'functions', 'test', 'somma.test.js'), "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\ntest('due più tre nel server', async () => { const { somma } = await import('../../src/somma.mjs'); assert.equal(somma(2, 3), 5); });\n");
    gs('add', '-A'); gs('commit', '-qm', 'prova del server');
    const prima = provaDelRamo(app.root, { server: srv.root, log: () => {} });
    assert.equal(prima.server.casi.length, 1);
    writeFileSync(join(app.root, 'src', 'somma.mjs'), 'export const somma = (a, b) => b + a;\n');
    ga('add', '-A'); ga('commit', '-qm', 'codice');
    assert.equal(esitoSalvato(app.root), null);
    const dopo = provaDelRamo(app.root, { server: cloneDellUltimaProva(app.root), log: () => {} });
    assert.deepEqual(dopo.server.casi.map((c) => [c.caso, c.senza, c.con]), [['due più tre nel server', 'rosso', 'verde']]);
  } finally { togliCartella(app.root); togliCartella(srv.root); }
});

test('i rapporti: TAP di node --test e JSON di Playwright, saltati esclusi', () => {
  const tap = ['ok 1 - uno', 'not ok 2 - due', 'ok 3 - tre # SKIP manca', '    not ok 1 - dentro'].join('\n');
  assert.deepEqual([...esitiDaTap(tap)], [['uno', 'verde'], ['due', 'rosso'], ['dentro', 'rosso']]);
  const pw = { suites: [{ specs: [{ title: 'a', tests: [{ status: 'expected' }] }], suites: [{ specs: [{ title: 'b', tests: [{ status: 'unexpected' }] }, { title: 'c', tests: [{ status: 'skipped' }] }] }] }] };
  assert.deepEqual([...esitiDaPlaywright(pw)], [['a', 'verde'], ['b', 'rosso']]);
});

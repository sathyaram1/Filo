// La parte «spec» della corsa su GitHub che il PC dell'owner chiede al posto degli spec arrivati da main (#1737, D-185):
// prova sulla fusione con main, rossi noti del contenitore come la suite, e l'esito unito dice quanti spec ha avuto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { leggiArgomenti, campoDaVerdetto, provaSpec, TETTO_SPEC } from '../../scripts/spec-fusione-azione.mjs';
import { unisciParti } from '../../scripts/unit-fusione-azione.mjs';
import { conGliSpec, richiestaDispatch } from '../../scripts/lib/prova-remota.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('argomenti: nomi di spec senza barre né spazi, e oltre il tetto si rifiuta col numero', () => {
  const ok = leggiArgomenti(['--root', 'prova', '--ramo', A, '--main', B, '--spec', 'options-x,tabs']);
  assert.deepEqual(ok.errori, []);
  assert.deepEqual(ok.spec, ['options-x', 'tabs']);
  for (const storto of ['../fuori', 'a/b', '-x', 'a b', '$(rm)']) {
    assert.ok(leggiArgomenti(['--root', 'p', '--ramo', A, '--main', B, '--spec', storto]).errori.some((e) => /non validi/.test(e)), storto);
  }
  const troppi = Array.from({ length: TETTO_SPEC + 1 }, (_, i) => `s${i}`).join(',');
  assert.ok(leggiArgomenti(['--root', 'p', '--ramo', A, '--main', B, '--spec', troppi]).errori.some((e) => e.includes(String(TETTO_SPEC + 1))));
});

const caso = (file, title, status) => ({ file, specs: [{ title, file, line: 1, tests: [{ status, results: [{ status: status === 'expected' ? 'passed' : 'failed' }] }] }] });

test('il verdetto: un rosso nuovo ferma, un rosso noto del contenitore no', () => {
  const json = { suites: [caso('options-x.spec.mjs', 'salva', 'unexpected'), caso('noto.spec.mjs', 'lento', 'unexpected'), caso('tabs.spec.mjs', 'apre', 'expected')] };
  const noti = [{ spec: 'tests/noto', caso: ['lento'] }];
  const dir = cartellaTemporanea('filo-1737-spec-');
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), t, 'utf8'); };
  try {
    git('init', '-q', '--initial-branch=main');
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git('config', k, v);
    for (const n of ['options-x', 'noto', 'tabs', 'tolto']) scrivi(`tests/${n}.spec.mjs`, '// x\n');
    git('add', '-A'); git('commit', '-qm', 'base');
    git('checkout', '-q', '-b', 'ramo');
    scrivi('src/a.js', 'ramo\n');
    git('add', '-A'); git('commit', '-qm', 'ramo');
    const ramo = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    git('rm', '-q', 'tests/tolto.spec.mjs');
    git('commit', '-qm', 'main toglie uno spec');
    const main = git('rev-parse', 'HEAD');
    git('checkout', '-q', ramo);
    let lanciati = null;
    const c = provaSpec({ root: dir, ramo, main, spec: ['options-x', 'noto', 'tabs', 'tolto'], noti, scrivi: () => {}, lancia: (_, f) => { lanciati = f; return { json }; } });
    assert.ok(execFileSync('git', ['merge-base', '--is-ancestor', main, 'HEAD'], { cwd: dir }) !== null, 'si prova la fusione con main');
    assert.deepEqual(lanciati, ['tests/options-x.spec.mjs', 'tests/noto.spec.mjs', 'tests/tabs.spec.mjs'], 'lo spec tolto da main non si lancia');
    assert.equal(c.esito, 'rosso_sulla_fusione');
    assert.deepEqual(c.rossi, ['tests/options-x.spec.mjs › salva']);
    assert.deepEqual([c.specChiesti, c.specProvati], [4, 3]);
  } finally {
    togliCartella(dir);
  }
});

test('Playwright senza esito: la parte non è provata, mai verde', () => {
  const dir = cartellaTemporanea('filo-1737-spec-');
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-q', '--initial-branch=main');
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git('config', k, v);
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'x.spec.mjs'), '// x\n');
    git('add', '-A'); git('commit', '-qm', 'base');
    const sha = git('rev-parse', 'HEAD');
    const c = provaSpec({ root: dir, ramo: sha, main: sha, spec: ['x'], scrivi: () => {}, lancia: () => ({ errore: 'Playwright è uscito con 1 senza l\'esito in JSON' }) });
    assert.equal(c.esito, 'non_provata');
    assert.match(c.motivo, /senza l'esito/);
  } finally {
    togliCartella(dir);
  }
  assert.equal(campoDaVerdetto({ ramo: A, main: B, v: { nuovi: [] }, chiesti: 2, provati: 2 }).esito, 'verde');
});

test('l\'esito unito porta quanti spec ha avuto; una parte degli spec non provata fa non provata la corsa', () => {
  const unit = { ramo: A, main: B, esito: 'verde', mainSha: B };
  const parti = (spec) => [
    { nome: 'linux', risultato: 'success', campo: JSON.stringify(unit) },
    { nome: 'windows', risultato: 'success', campo: JSON.stringify(unit) },
    spec,
  ];
  const verde = unisciParti({ ramo: A, main: B, parti: parti({ nome: 'spec', risultato: 'success', campo: JSON.stringify({ ...unit, specChiesti: 3, specProvati: 3 }) }) });
  assert.deepEqual([verde.esito, verde.specChiesti, verde.specProvati], ['verde', 3, 3]);
  const saltata = unisciParti({ ramo: A, main: B, parti: parti({ nome: 'spec', risultato: 'skipped', campo: '' }) });
  assert.equal(saltata.esito, 'verde');
  assert.equal(saltata.specChiesti, undefined, 'il server non li chiede, e la riga non ne parla');
  const caduta = unisciParti({ ramo: A, main: B, parti: parti({ nome: 'spec', risultato: 'failure', campo: '' }) });
  assert.equal(caduta.esito, 'non_provata');
  const rossa = unisciParti({ ramo: A, main: B, parti: parti({ nome: 'spec', risultato: 'success', campo: JSON.stringify({ ramo: A, main: B, esito: 'rosso_sulla_fusione', rossi: ['tests/x.spec.mjs › y'], specChiesti: 1, specProvati: 1 }) }) });
  assert.equal(rossa.esito, 'rosso_sulla_fusione');
  assert.match(rossa.rossi[0], /tests\/x\.spec\.mjs › y/);
});

test('il PC chiede gli spec per nome e vuole sentirsi dire che li ha avuti tutti', () => {
  assert.equal(richiestaDispatch({ ramo: A, main: B, corsa: 'c', spec: ['tests/options-x', 'tests/tabs'] }).client_payload.spec, 'options-x,tabs');
  assert.equal(richiestaDispatch({ ramo: A, main: B, corsa: 'c' }).client_payload.spec, undefined, 'senza spec la parte non parte');
  const verde = { esito: 'verde', mainSha: B };
  assert.equal(conGliSpec(verde, []), verde);
  assert.match(conGliSpec(verde, ['tests/a', 'tests/b']).errore, /non ha provato i 2 spec/, 'un main che non sa ancora provarli risponde coi soli unit');
  assert.match(conGliSpec({ ...verde, specChiesti: 1 }, ['tests/a', 'tests/b']).errore, /ne dice 1/);
  assert.equal(conGliSpec({ ...verde, specChiesti: 2, specProvati: 2 }, ['tests/a', 'tests/b']).esito, 'verde');
});

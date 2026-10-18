// L'azione che fa girare gli unit sul risultato della fusione per il server (#1207): il workflow non dà al ramo provato
// niente da rubare né da spingere, e la riga dell'esito è quella che il server legge (functions/src/routine/unitFusione.js
// in filo-security). La prova vera gira su un repo finto con origin, dove main è andato oltre il main nominato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';
import { MARCA, leggiArgomenti, campoEsito, rigaEsito, codiceUscita } from '../../scripts/unit-fusione-azione.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARTELLA = join(ROOT, '.github', 'workflows');
const WORKFLOW = readFileSync(join(CARTELLA, 'unit-fusione.yml'), 'utf8');
const senzaCommenti = (s) => s.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');
const W = senzaCommenti(WORKFLOW);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('il workflow parte solo da repository_dispatch, cioè dalla sua versione su main', () => {
  const on = /^on:\n((?: {2}.*\n)+)/m.exec(`${W}\n`);
  assert.ok(on, 'manca `on:`');
  assert.deepEqual(on[1].split('\n').filter((r) => /^ {2}\S/.test(r)).map((r) => r.trim()), ['repository_dispatch:']);
  assert.match(on[1], /types: \[unit-fusione\]/);
});

test('token in sola lettura, nessun segreto, nessuna credenziale nei checkout', () => {
  assert.match(W, /^permissions:\n {2}contents: read\n(?! )/m);
  assert.doesNotMatch(W, /secrets\.|github\.token|GITHUB_TOKEN|: write\b/);
  const checkout = W.split(/\n(?= {6}- )/).filter((p) => /uses: actions\/checkout@/.test(p));
  assert.ok(checkout.length >= 2);
  for (const p of checkout) assert.match(p, /persist-credentials: false/, `checkout senza persist-credentials: false:\n${p}`);
});

test('la coppia del server non entra mai in una shell come testo', () => {
  const righe = W.split('\n').filter((r) => r.includes('client_payload'));
  assert.ok(righe.length >= 3);
  for (const r of righe) assert.match(r, /^(run-name: |\s{6}(RAMO|MAIN): )/, `client_payload fuori da run-name ed env: ${r.trim()}`);
  assert.doesNotMatch(W, /run:[^\n]*\$\{\{/, 'un\'espressione dentro `run:` diventa codice della shell');
});

test('strumenti di main, ramo dal suo sha, titolo che il server cerca', () => {
  assert.match(W, /ref: \$\{\{ github\.sha \}\}\n {10}path: strumenti/);
  assert.match(W, /ref: \$\{\{ env\.RAMO \}\}\n {10}path: prova\n {10}fetch-depth: 0/);
  assert.match(W, /node strumenti\/scripts\/unit-fusione-azione\.mjs --root prova --ramo "\$RAMO" --main "\$MAIN"/);
  assert.match(W, /^run-name: unit-fusione \$\{\{ github\.event\.client_payload\.corsa \}\}$/m);
});

// Gira codice non fidato nell'ambito delle cache di main: una cache letta da un'altra corsa sarebbe sua da avvelenare.
test('nessun workflow usa le cache di Actions', () => {
  for (const f of readdirSync(CARTELLA).filter((n) => /\.ya?ml$/.test(n))) {
    const t = senzaCommenti(readFileSync(join(CARTELLA, f), 'utf8'));
    assert.doesNotMatch(t, /actions\/cache@|^\s+cache:|package-manager-cache: true/m, `${f} usa una cache`);
  }
});

test('argomenti: due sha interi e la cartella', () => {
  assert.deepEqual(leggiArgomenti(['--root', 'p', '--ramo', A.toUpperCase(), '--main', B]), { root: 'p', ramo: A, main: B, errori: [] });
  assert.ok(leggiArgomenti(['--root', 'p', '--ramo', 'main', '--main', B]).errori.length);
  assert.ok(leggiArgomenti(['--ramo', A, '--main', B]).errori.length);
  assert.ok(leggiArgomenti(['--root', 'p', '--ramo', A, '--main', B, '--altro', 'x']).errori.length);
});

test('la riga dell\'esito: una riga, la coppia, il campo della richiesta di fusione', () => {
  const rosso = campoEsito({ ramo: A, main: B, prova: { esito: 'rosso_sulla_fusione', mainSha: B, rossi: ['t › uno\nfinto'] } });
  assert.equal(rosso.ramo, A);
  assert.equal(rosso.main, B);
  assert.equal(rosso.mainSha, B);
  const riga = rigaEsito(rosso);
  assert.ok(riga.startsWith(`${MARCA} {`));
  assert.ok(!riga.includes('\n'));
  assert.deepEqual(JSON.parse(riga.slice(MARCA.length + 1)).rossi, ['t › uno\nfinto']);
  assert.deepEqual(campoEsito({ ramo: A, main: B, prova: { errore: 'npm giù' } }), { ramo: A, main: B, esito: 'non_provata', motivo: 'npm giù' });
  assert.equal(campoEsito({ ramo: A, main: B, prova: { saltata: true, motivo: 'nessun origin' } }).esito, 'non_provata');
  assert.equal(codiceUscita({ esito: 'verde' }), 0);
  assert.equal(codiceUscita({ esito: 'rosso_anche_su_main' }), 0);
  assert.equal(codiceUscita({ esito: 'main_contenuto' }), 0);
  assert.equal(codiceUscita({ esito: 'rosso_sulla_fusione' }), 1);
  assert.equal(codiceUscita({ esito: 'conflitto' }), 1);
  assert.equal(codiceUscita({ esito: 'non_provata' }), 2);
});

const TEST_VALORE = "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { readFileSync } from 'node:fs';\n"
  + "test('il valore è uno', () => assert.equal(readFileSync('valore.txt', 'utf8').trim(), 'uno'));\n";

function repoFinto() {
  const casa = cartellaTemporanea('filo-1207-azione-');
  const origin = join(casa, 'origin.git');
  const lavoro = join(casa, 'prova');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
  mkdirSync(join(lavoro, 'scripts', 'lib'), { recursive: true });
  mkdirSync(join(lavoro, 'tests', 'unit'), { recursive: true });
  for (const f of ['scripts/run-unit-tests.mjs', 'scripts/lib/riga-di-comando.mjs', 'scripts/lib/riepilogo-unit.mjs', 'scripts/lib/avanzamento-unit.mjs']) {
    copyFileSync(join(ROOT, f), join(lavoro, f));
  }
  writeFileSync(join(lavoro, '.gitignore'), 'node_modules\n', 'utf8');
  writeFileSync(join(lavoro, 'valore.txt'), 'uno\n', 'utf8');
  writeFileSync(join(lavoro, 'tests', 'unit', 'base.test.mjs'), "import { test } from 'node:test';\ntest('base', () => {});\n", 'utf8');
  mkdirSync(join(lavoro, 'node_modules'));
  const git = (args) => String(execFileSync('git', args, { cwd: lavoro, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();
  for (const a of [['init', '-q', '--initial-branch=main'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't'], ['add', '-A'], ['commit', '-qm', 'base'],
    ['remote', 'add', 'origin', origin], ['push', '-q', 'origin', 'main']]) git(a);
  const commit = (msg) => { git(['add', '-A']); git(['commit', '-qm', msg]); return git(['rev-parse', 'HEAD']); };
  return { casa, lavoro, git, commit };
}

function azione(r, ramo, main) {
  const { NODE_TEST_CONTEXT: _figlio, GITHUB_STEP_SUMMARY: _riassunto, ...env } = process.env;
  const p = spawnSync(process.execPath, [join(ROOT, 'scripts', 'unit-fusione-azione.mjs'), '--root', r.lavoro, '--ramo', ramo, '--main', main], {
    cwd: r.casa, env, encoding: 'utf8', timeout: TETTO_ATTESA_MS,
  });
  const righe = String(p.stdout || '').split('\n').filter((l) => l.startsWith(`${MARCA} `));
  return { codice: p.status, campo: righe.length ? JSON.parse(righe[righe.length - 1].slice(MARCA.length + 1)) : null, uscita: `${p.stdout}${p.stderr}` };
}

test('prova vera: prova il main nominato, non quello di origin, e il rosso esce con l\'elenco', () => {
  const r = repoFinto();
  try {
    // main va avanti senza toccare il valore (M1), il ramo lo cambia, poi main aggiunge il test che lo vuole com'era (M2).
    writeFileSync(join(r.lavoro, 'altro.txt'), 'x\n', 'utf8');
    const m1 = r.commit('main: altro');
    r.git(['push', '-q', 'origin', 'main']);
    r.git(['checkout', '-q', '-b', 'claude/valore', 'HEAD~1']);
    writeFileSync(join(r.lavoro, 'valore.txt'), 'due\n', 'utf8');
    const ramo = r.commit('ramo: valore');
    r.git(['checkout', '-q', 'main']);
    writeFileSync(join(r.lavoro, 'tests', 'unit', 'valore.test.mjs'), TEST_VALORE, 'utf8');
    const m2 = r.commit('main: test del valore');
    r.git(['push', '-q', 'origin', 'main']);
    r.git(['checkout', '-q', 'claude/valore']);

    const verde = azione(r, ramo, m1);
    assert.equal(verde.codice, 0, verde.uscita);
    assert.deepEqual({ ramo: verde.campo.ramo, main: verde.campo.main, esito: verde.campo.esito, mainSha: verde.campo.mainSha },
      { ramo, main: m1, esito: 'verde', mainSha: m1 }, verde.uscita);

    const rosso = azione(r, ramo, m2);
    assert.equal(rosso.codice, 1, rosso.uscita);
    assert.equal(rosso.campo.esito, 'rosso_sulla_fusione', rosso.uscita);
    assert.deepEqual(rosso.campo.rossi, ['tests/unit/valore.test.mjs › il valore è uno']);
    assert.equal(rosso.campo.main, m2);

    const assente = azione(r, ramo, 'c'.repeat(40));
    assert.equal(assente.codice, 2, assente.uscita);
    assert.equal(assente.campo.esito, 'non_provata');
    assert.match(assente.campo.motivo, /main cccccccccccc/);
  } finally {
    togliCartella(r.casa);
  }
});

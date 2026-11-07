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
import {
  MARCA, MARCA_PARTE, leggiArgomenti, campoEsito, rigaEsito, codiceUscita, unisciParti, partiDaAmbiente,
} from '../../scripts/unit-fusione-azione.mjs';

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
  for (const r of righe) {
    assert.match(r, /^(run-name: |\s{6}(RAMO|MAIN|MODO): |\s{4}if: github\.event\.client_payload\.windows != 'spento'$)/, `client_payload fuori da run-name, env e la parte spenta: ${r.trim()}`);
  }
  assert.doesNotMatch(W, /run:[^\n]*\$\{\{/, 'un\'espressione dentro `run:` diventa codice della shell');
});

// I lavori del workflow, ognuno col suo testo: `nome` → blocco.
const LAVORI = Object.fromEntries(W.split(/\n(?= {2}[a-z][\w-]*:\n)/).slice(1).map((b) => [/^ {2}([\w-]+):/.exec(b)[1], b]));

test('strumenti di main, ramo dal suo sha, titolo che il server cerca', () => {
  for (const nome of ['linux', 'windows']) {
    const b = LAVORI[nome];
    assert.match(b, /ref: \$\{\{ github\.sha \}\}\n {10}path: strumenti/, nome);
    assert.match(b, /ref: \$\{\{ env\.RAMO \}\}\n {10}path: prova\n {10}fetch-depth: 0/, nome);
    assert.match(b, /if \[\[ ! "\$RAMO" =~ \^\[0-9a-f\]\{40\}\$ \|\| ! "\$MAIN" =~ \^\[0-9a-f\]\{40\}\$ \]\]/, `${nome}: la coppia si controlla prima di tutto`);
  }
  assert.match(LAVORI.unit, /ref: \$\{\{ github\.sha \}\}\n {10}path: strumenti/);
  assert.doesNotMatch(LAVORI.unit, /path: prova/, 'chi scrive la riga non tocca il codice del ramo');
  assert.match(W, /^run-name: unit-fusione \$\{\{ github\.event\.client_payload\.corsa \}\}$/m);
});

// #2225: tre rossi di Windows nati su main da fusioni verdi su Linux.
test('Linux e Windows provano in parallelo, e la riga per il server la scrive solo `unit`, con entrambi gli esiti', () => {
  assert.deepEqual(Object.keys(LAVORI).sort(), ['linux', 'unit', 'windows']);
  assert.match(LAVORI.linux, /runs-on: ubuntu-latest/);
  assert.match(LAVORI.windows, /runs-on: windows-latest/);
  assert.match(LAVORI.windows, /defaults:\n {6}run:\n {8}shell: bash/);
  for (const nome of ['linux', 'windows']) {
    assert.doesNotMatch(LAVORI[nome], /needs:/, `${nome} non aspetta nessuno: la latenza è quella del più lento`);
    assert.match(LAVORI[nome], /outputs:\n {6}campo: \$\{\{ steps\.prova\.outputs\.campo \}\}/);
    assert.match(LAVORI[nome], new RegExp(`id: prova\\n {8}run: node strumenti/scripts/unit-fusione-azione\\.mjs --root prova --ramo "\\$RAMO" --main "\\$MAIN" --parte ${nome} --unit `));
  }
  assert.match(LAVORI.linux, /--parte linux --unit tutti$/m, 'su Linux la corsa intera, come prima');
  assert.match(LAVORI.windows, /--parte windows --unit "\$MODO"$/m);
  assert.match(LAVORI.unit, /needs: \[linux, windows\]\n {4}if: \$\{\{ !cancelled\(\) \}\}/, 'anche con una parte caduta la riga si scrive');
  for (const n of ['LINUX', 'WINDOWS']) {
    const p = n.toLowerCase();
    assert.match(LAVORI.unit, new RegExp(`CAMPO_${n}: \\$\\{\\{ needs\\.${p}\\.outputs\\.campo \\}\\}`));
    assert.match(LAVORI.unit, new RegExp(`RISULTATO_${n}: \\$\\{\\{ needs\\.${p}\\.result \\}\\}`));
  }
  assert.match(LAVORI.unit, /run: node strumenti\/scripts\/unit-fusione-azione\.mjs --unisci linux,windows --ramo "\$RAMO" --main "\$MAIN"$/m);
  assert.equal((W.match(/--unisci/g) || []).length, 1);
});

// Gira codice non fidato nell'ambito delle cache di main: una cache letta da un'altra corsa sarebbe sua da avvelenare.
test('nessun workflow usa le cache di Actions', () => {
  for (const f of readdirSync(CARTELLA).filter((n) => /\.ya?ml$/.test(n))) {
    const t = senzaCommenti(readFileSync(join(CARTELLA, f), 'utf8'));
    assert.doesNotMatch(t, /actions\/cache@|^\s+cache:|package-manager-cache: true/m, `${f} usa una cache`);
  }
});

test('argomenti: due sha interi e la cartella', () => {
  assert.deepEqual(leggiArgomenti(['--root', 'p', '--ramo', A.toUpperCase(), '--main', B]), { root: 'p', ramo: A, main: B, parte: '', unit: 'tutti', unisci: [], errori: [] });
  assert.ok(leggiArgomenti(['--root', 'p', '--ramo', 'main', '--main', B]).errori.length);
  assert.ok(leggiArgomenti(['--ramo', A, '--main', B]).errori.length);
  assert.ok(leggiArgomenti(['--root', 'p', '--ramo', A, '--main', B, '--altro', 'x']).errori.length);
  const w = leggiArgomenti(['--root', 'p', '--ramo', A, '--main', B, '--parte', 'windows', '--unit', '']);
  assert.deepEqual({ parte: w.parte, unit: w.unit, errori: w.errori }, { parte: 'windows', unit: 'toccati', errori: [] }, 'senza scelta del server, i toccati');
  assert.equal(leggiArgomenti(['--root', 'p', '--ramo', A, '--main', B, '--unit', 'tutti']).unit, 'tutti');
  assert.equal(leggiArgomenti(['--root', 'p', '--ramo', A, '--main', B, '--unit', '$(rm -rf)']).unit, 'toccati');
  assert.ok(leggiArgomenti(['--root', 'p', '--ramo', A, '--main', B, '--parte', 'Win dows']).errori.length);
  const u = leggiArgomenti(['--unisci', 'linux,windows', '--ramo', A, '--main', B]);
  assert.deepEqual({ unisci: u.unisci, errori: u.errori }, { unisci: ['linux', 'windows'], errori: [] });
  assert.ok(leggiArgomenti(['--unisci', 'linux', '--root', 'p', '--ramo', A, '--main', B]).errori.length);
});

test('l\'esito unico dalle parti: un rosso di Windows ferma la fusione e si legge come tale', () => {
  const parte = (nome, campo, risultato = 'success') => ({ nome, risultato, campo: campo === null ? '' : JSON.stringify({ ramo: A, main: B, mainSha: B, ...campo }) });
  const unisci = (...parti) => unisciParti({ ramo: A, main: B, parti });
  const verde = unisci(parte('linux', { esito: 'verde', storia: { superficiale: false } }), parte('windows', { esito: 'verde' }));
  assert.deepEqual(verde, { ramo: A, main: B, esito: 'verde', mainSha: B, storia: { superficiale: false } });
  assert.equal(codiceUscita(verde), 0);

  const rossoWin = unisci(parte('linux', { esito: 'verde' }), parte('windows', { esito: 'rosso_sulla_fusione', rossi: ['tests/unit/aiutoAttesa.test.mjs › import'] }));
  assert.equal(rossoWin.esito, 'rosso_sulla_fusione');
  assert.deepEqual(rossoWin.rossi, ['tests/unit/aiutoAttesa.test.mjs › import [Windows]']);
  assert.equal(codiceUscita(rossoWin), 1);

  const due = unisci(parte('linux', { esito: 'rosso_sulla_fusione', rossi: Array.from({ length: 30 }, (_, i) => `l${i}`), altriRossi: 5 }),
    parte('windows', { esito: 'rosso_sulla_fusione', rossi: Array.from({ length: 20 }, (_, i) => `w${i}`) }));
  assert.equal(due.rossi.length, 40);
  assert.equal(due.rossi[30], 'w0 [Windows]');
  assert.equal(due.altriRossi, 15, 'nessun rosso sparisce in silenzio: il conto dice quanti restano fuori');

  assert.equal(unisci(parte('linux', { esito: 'verde' }), parte('windows', { esito: 'conflitto', file: ['a.js'] })).esito, 'conflitto');
  assert.equal(unisci(parte('linux', { esito: 'verde' }), parte('windows', { esito: 'rosso_anche_su_main' })).esito, 'rosso_anche_su_main');
  assert.equal(unisci(parte('linux', { esito: 'main_contenuto' }), parte('windows', { esito: 'main_contenuto' })).esito, 'main_contenuto');
  assert.equal(unisci(parte('linux', { esito: 'verde' }), { nome: 'windows', risultato: 'skipped', campo: '' }).esito, 'verde', 'la parte spenta non conta');

  const caduta = unisci(parte('linux', { esito: 'verde' }), { nome: 'windows', risultato: 'failure', campo: '' });
  assert.equal(caduta.esito, 'non_provata');
  assert.match(caduta.motivo, /windows: corsa failure/);
  assert.equal(codiceUscita(caduta), 2);
  assert.match(unisci(parte('linux', { esito: 'verde' }), parte('windows', { esito: 'non_provata', motivo: 'npm giù' })).motivo, /windows: npm giù/);
  const altraCoppia = { nome: 'windows', risultato: 'success', campo: JSON.stringify({ ramo: B, main: A, esito: 'verde' }) };
  assert.equal(unisci(parte('linux', { esito: 'verde' }), altraCoppia).esito, 'non_provata', 'un esito di un\'altra coppia non vale');
  assert.equal(unisci(parte('linux', { esito: 'verde' }), { nome: 'windows', risultato: 'success', campo: '{rotto' }).esito, 'non_provata');
  assert.equal(unisci().esito, 'non_provata');
  assert.equal(unisci(parte('linux', { esito: 'rosso_sulla_fusione', rossi: ['x'] }), { nome: 'windows', risultato: 'cancelled', campo: '' }).esito,
    'rosso_sulla_fusione', 'un rosso trovato decide anche se l\'altra parte è caduta');
  assert.deepEqual(partiDaAmbiente(['linux'], { CAMPO_LINUX: '{}', RISULTATO_LINUX: 'success' }), [{ nome: 'linux', campo: '{}', risultato: 'success' }]);
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

function azione(r, ramo, main, { args = ['--root', r.lavoro], extra = {} } = {}) {
  const { NODE_TEST_CONTEXT: _figlio, GITHUB_STEP_SUMMARY: _riassunto, GITHUB_OUTPUT: _uscita, ...env } = process.env;
  const p = spawnSync(process.execPath, [join(ROOT, 'scripts', 'unit-fusione-azione.mjs'), ...args, '--ramo', ramo, '--main', main], {
    cwd: r.casa, env: { ...env, ...extra }, encoding: 'utf8', timeout: TETTO_ATTESA_MS,
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

// La strada del workflow: due parti scrivono il loro esito nelle uscite del lavoro, `--unisci` lo legge dall'ambiente.
test('prova vera a parti: la parte veloce trova il test rotto del ramo, la riga unica lo porta al server', () => {
  const r = repoFinto();
  try {
    writeFileSync(join(r.lavoro, 'altro.txt'), 'x\n', 'utf8');
    const m1 = r.commit('main: altro');
    r.git(['push', '-q', 'origin', 'main']);
    r.git(['checkout', '-q', '-b', 'claude/import', 'HEAD~1']);
    // Un rosso di Windows qui non si fabbrica: il test nuovo è rosso ovunque, e conta che la parte veloce lo scelga.
    writeFileSync(join(r.lavoro, 'tests', 'unit', 'nuovo.test.mjs'), TEST_VALORE.replace("'uno'", "'due'"), 'utf8');
    const ramo = r.commit('ramo: test nuovo');

    const campi = {};
    for (const [nome, unit] of [['linux', 'tutti'], ['windows', '']]) {
      const uscita = join(r.casa, `uscita-${nome}.txt`);
      writeFileSync(uscita, '', 'utf8');
      const p = azione(r, ramo, m1, { args: ['--root', r.lavoro, '--parte', nome, '--unit', unit], extra: { GITHUB_OUTPUT: uscita } });
      assert.equal(p.codice, 0, `una parte non decide la corsa:\n${p.uscita}`);
      assert.equal(p.campo, null, 'una parte non scrive la riga del server');
      assert.match(p.uscita, new RegExp(`^${MARCA_PARTE} ${nome} \\{`, 'm'));
      const righe = readFileSync(uscita, 'utf8').split('\n').filter(Boolean);
      assert.equal(righe.length, 1, righe.join('\n'));
      assert.ok(righe[0].startsWith('campo={'));
      campi[nome] = righe[0].slice('campo='.length);
      assert.equal(JSON.parse(campi[nome]).esito, 'rosso_sulla_fusione', p.uscita);
    }
    assert.match(azione(r, ramo, m1, { args: ['--root', r.lavoro, '--parte', 'windows', '--unit', ''] }).uscita, /toccati dal ramo \(1 file\)/);

    const finale = azione(r, ramo, m1, {
      args: ['--unisci', 'linux,windows'],
      extra: { CAMPO_LINUX: campi.linux, RISULTATO_LINUX: 'success', CAMPO_WINDOWS: campi.windows, RISULTATO_WINDOWS: 'success' },
    });
    assert.equal(finale.codice, 1, finale.uscita);
    assert.equal(finale.campo.esito, 'rosso_sulla_fusione');
    assert.deepEqual(finale.campo.rossi, ['tests/unit/nuovo.test.mjs › il valore è uno', 'tests/unit/nuovo.test.mjs › il valore è uno [Windows]']);
    assert.deepEqual({ ramo: finale.campo.ramo, main: finale.campo.main }, { ramo, main: m1 });

    const senzaWindows = azione(r, ramo, m1, {
      args: ['--unisci', 'linux,windows'],
      extra: { CAMPO_LINUX: JSON.stringify({ ramo, main: m1, esito: 'verde', mainSha: m1 }), RISULTATO_LINUX: 'success', RISULTATO_WINDOWS: 'failure' },
    });
    assert.equal(senzaWindows.codice, 2, senzaWindows.uscita);
    assert.equal(senzaWindows.campo.esito, 'non_provata');
  } finally {
    togliCartella(r.casa);
  }
});

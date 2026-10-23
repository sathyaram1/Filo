// #1185: il cancello di pubblicazione prova l'ultimo commit di main con la suite verde, a volte giorni indietro. Un
// rosso già verde sulla punta di main non apre un feedback; ogni dubbio lo apre come prima. I passi di release.yml
// si ESEGUONO qui, su un repo vero con una punta finta.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileDaRifare, tuttiGiaVerdi, rifaiSullaPunta } from '../../scripts/rossi-sulla-punta.mjs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { leggiWorkflow } from '../helpers/workflowInVigore.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const YML = leggiWorkflow('release.yml');

// Le righe del cancello come le ha scritte il runner Windows nell'allarme di #1185.
const REGISTRO_1185 = [
  'not ok 100 - acceso: tutto come prima, scarica da solo, si installa alla chiusura e non scrive carte',
  "  location: 'D:\\\\a\\\\Filo\\\\Filo\\\\tests\\\\unit\\\\aggiornamentiAutomatici.test.mjs:116:1'",
  'not ok 101 - «Installa» scarica, la carta mostra a che punto è e poi che si installa alla chiusura',
  "  location: 'D:\\\\a\\\\Filo\\\\Filo\\\\tests\\\\unit\\\\aggiornamentiAutomatici.test.mjs:125:1'",
].join('\n');
const RADICE_WIN = String.raw`D:\a\Filo\Filo`;

describe('quali rossi si rifanno sulla punta', () => {
  test('solo file di test dentro il repo; un rosso senza file, un modulo o un percorso che esce no', () => {
    assert.deepEqual(fileDaRifare([
      'unit:tests/unit/a.test.mjs', 'unit', 'unit:tests/helpers/percorsi.mjs', 'unit:../fuori.test.mjs', 'unit:tests/../../x.test.mjs', 'suite:x',
    ]), {
      file: ['tests/unit/a.test.mjs'],
      nonRifacibili: ['unit', 'unit:tests/helpers/percorsi.mjs', 'unit:../fuori.test.mjs', 'unit:tests/../../x.test.mjs', 'suite:x'],
    });
  });

  test('«tutti già verdi» vuole almeno un file, nessun rosso non rifatto e ogni file verde', () => {
    const a = 'tests/unit/a.test.mjs';
    const b = 'tests/unit/b.test.mjs';
    assert.equal(tuttiGiaVerdi({ file: [a, b], nonRifacibili: [], verdi: [a, b] }), true);
    assert.equal(tuttiGiaVerdi({ file: [a, b], nonRifacibili: [], verdi: [a] }), false);
    assert.equal(tuttiGiaVerdi({ file: [a], nonRifacibili: ['unit'], verdi: [a] }), false);
    assert.equal(tuttiGiaVerdi({ file: [], nonRifacibili: [], verdi: [] }), false, 'zero file rifatti non dice che è corretto');
  });
});

describe('rifaiSullaPunta', () => {
  function punta(file) {
    const dir = cartellaTemporanea('filo-punta-finta-');
    for (const f of file) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), '');
    }
    return dir;
  }

  test('i rossi di #1185, verdi sulla punta: tutti già verdi, ogni file lanciato una volta', () => {
    const dir = punta(['tests/unit/aggiornamentiAutomatici.test.mjs']);
    try {
      const lanciati = [];
      const r = rifaiSullaPunta(REGISTRO_1185, { radice: RADICE_WIN, punta: dir, lancia: (f) => { lanciati.push(f); return 0; } });
      assert.deepEqual(r, { verdi: ['tests/unit/aggiornamentiAutomatici.test.mjs'], tutti: true });
      assert.deepEqual(lanciati, ['tests/unit/aggiornamentiAutomatici.test.mjs']);
    } finally { togliCartella(dir); }
  });

  test('un file ancora rosso sulla punta: non tutti, e l\'elenco dice solo quelli verdi', () => {
    const dir = punta(['tests/unit/a.test.mjs', 'tests/unit/b.test.mjs']);
    try {
      const registro = "not ok 1 - x\n  location: 'D:\\\\a\\\\Filo\\\\Filo\\\\tests\\\\unit\\\\a.test.mjs:1:1'\n"
        + "not ok 2 - y\n  location: 'D:\\\\a\\\\Filo\\\\Filo\\\\tests\\\\unit\\\\b.test.mjs:9:1'\n";
      const r = rifaiSullaPunta(registro, { radice: RADICE_WIN, punta: dir, lancia: (f) => (f.endsWith('a.test.mjs') ? 0 : 1) });
      assert.deepEqual(r, { verdi: ['tests/unit/a.test.mjs'], tutti: false });
    } finally { togliCartella(dir); }
  });

  test('un file che sulla punta non c\'è più non si dà per corretto', () => {
    const dir = punta([]);
    try {
      const r = rifaiSullaPunta(REGISTRO_1185, { radice: RADICE_WIN, punta: dir, lancia: () => assert.fail('lanciato un file che non c\'è') });
      assert.deepEqual(r, { verdi: [], tutti: false });
    } finally { togliCartella(dir); }
  });

  test('un registro senza file riconoscibili non lancia niente e non dà per corretto', () => {
    const r = rifaiSullaPunta('not ok 1 - qualcosa\n# fail 1', { radice: RADICE_WIN, punta: ROOT, lancia: () => assert.fail('lanciato senza file') });
    assert.deepEqual(r, { verdi: [], tutti: false });
  });

  test('col lanciatore vero, sui file di questo repo: i rossi di #1185 sono verdi qui', () => {
    const dir = cartellaTemporanea('filo-rossi-1185-');
    try {
      writeFileSync(join(dir, 'unit.log'), REGISTRO_1185);
      const { NODE_TEST_CONTEXT: _figlio, ...env } = process.env;
      const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'rossi-sulla-punta.mjs'), join(dir, 'unit.log')],
        { cwd: dir, env, encoding: 'utf8', windowsHide: true });
      assert.equal(r.status, 0, r.stderr.slice(-2000));
      assert.equal(r.stdout.trim(), 'tests/unit/aggiornamentiAutomatici.test.mjs', 'stdout porta solo l\'elenco dei verdi');
    } finally { togliCartella(dir); }
  });
});

// Il cancello rifà i rossi sulla punta senza chiavi e lascia l'esito in file; `avviso-cancello`, con la parola
// d'ordine, li legge da quei file e apre il feedback (#1139.1). Qui i due passi girano uno dopo l'altro nella stessa
// cartella, come se il registro fosse passato da una macchina all'altra.
const PASSO_PUNTA = /-\s+name:\s*I rossi sono gia' verdi sulla punta di main\?\s*\n/;
const PASSO_AVVISO = /-\s+name:\s*Controlli falliti - apri un feedback\s*\n/;

function scriptDelPasso(nome) {
  const at = YML.search(nome);
  assert.ok(at >= 0, `manca il passo ${nome}: il cancello rosso non diventerebbe un feedback`);
  const righe = YML.slice(at).split(/\n\s{6}-\s+name:/)[0].split('\n');
  const i = righe.findIndex((r) => /^\s*run:\s*\|\s*$/.test(r));
  assert.ok(i >= 0, 'il passo non ha un blocco `run: |`');
  const corpo = [];
  for (const r of righe.slice(i + 1)) {
    if (r.trim() && !r.startsWith(' '.repeat(10))) break;
    corpo.push(r.slice(10));
  }
  const s = corpo.join('\n');
  assert.doesNotMatch(s, /\$\{\{/, 'il passo usa un\'espressione che la prova non sa sostituire');
  return s;
}

const haBash = spawnSync('bash', ['-c', 'true']).status === 0;

// Il commit provato ha l'allarme (finto: scrive i suoi argomenti ed esce come gli dice la prova); la punta di main in
// più ha il controllo dei rossi (finto: risponde come gli dice la prova). Si lavora su un clone fermo al commit provato.
function scena({ sullaPunta = false } = {}) {
  const base = cartellaTemporanea('filo-rossi-punta-');
  const origine = join(base, 'origine');
  const lavoro = join(base, 'lavoro');
  mkdirSync(join(origine, 'scripts'), { recursive: true });
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  g(origine, 'init', '-q', '-b', 'main');
  g(origine, 'config', 'user.email', 't@t');
  g(origine, 'config', 'user.name', 't');
  g(origine, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(origine, 'scripts', 'build-alarm.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    'writeFileSync(process.env.FINTO_ALLARME, JSON.stringify(process.argv.slice(2)));',
    'process.exitCode = Number(process.env.FINTO_INVIO || 0);',
    '',
  ].join('\n'));
  g(origine, 'add', '.');
  g(origine, 'commit', '-q', '-m', 'provato');
  const provato = g(origine, 'rev-parse', 'HEAD');
  writeFileSync(join(origine, 'scripts', 'rossi-sulla-punta.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(process.env.FINTO_PUNTA, process.argv.slice(2).join(' '));",
    "if (process.env.FINTO_ESITO === 'rotto') throw new Error('controllo rotto');",
    'if (process.env.FINTO_VERDI) process.stdout.write(process.env.FINTO_VERDI);',
    'process.exitCode = Number(process.env.FINTO_ESITO);',
    '',
  ].join('\n'));
  g(origine, 'add', '.');
  g(origine, 'commit', '-q', '-m', 'punta');
  g(base, 'clone', '-q', origine, lavoro);
  if (!sullaPunta) g(lavoro, 'checkout', '-q', '--detach', provato);
  writeFileSync(join(lavoro, 'unit.log'), REGISTRO_1185);
  return { base, origine, lavoro, g, provato: provato.slice(0, 7), punta: g(origine, 'rev-parse', '--short', 'HEAD') };
}

/** Il passo del cancello, poi (se `avviso`) quello dell'avviso; `prima` gira fra i due, come il viaggio del registro. */
function eseguiPassi(s, { esito, verdi = '', invio = 0, prima = () => {}, punta = true } = {}) {
  const riepilogo = join(s.base, 'riepilogo.md');
  const allarme = join(s.base, 'allarme.json');
  const lanciata = join(s.base, 'punta.txt');
  writeFileSync(riepilogo, '');
  const env = {
    ...process.env, GITHUB_STEP_SUMMARY: riepilogo, FINTO_ALLARME: allarme, FINTO_PUNTA: lanciata,
    FINTO_ESITO: String(esito), FINTO_VERDI: verdi, FINTO_INVIO: String(invio),
  };
  const bash = (script) => spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { cwd: s.lavoro, encoding: 'utf8', env });
  const a = punta ? bash(scriptDelPasso(PASSO_PUNTA)) : { status: 0, stdout: '', stderr: '' };
  const copiaRimasta = existsSync(join(s.lavoro, '.punta-main'));
  const copieGit = s.g(s.lavoro, 'worktree', 'list').split('\n').length;
  prima();
  const b = bash(scriptDelPasso(PASSO_AVVISO));
  return {
    statoCancello: a.status,
    status: b.status,
    out: a.stdout + a.stderr + b.stdout + b.stderr,
    riepilogo: readFileSync(riepilogo, 'utf8'),
    allarme: existsSync(allarme) ? JSON.parse(readFileSync(allarme, 'utf8')) : null,
    puntaLanciata: existsSync(lanciata) ? readFileSync(lanciata, 'utf8') : null,
    copiaRimasta,
    copieGit,
  };
}

describe('i passi del cancello rosso in release.yml: i rossi sulla punta e il feedback', { skip: !haBash && 'serve bash' }, () => {
  test('ogni rosso già verde sulla punta: niente feedback, e il riepilogo lo dice', () => {
    const s = scena();
    try {
      const r = eseguiPassi(s, { esito: 0, verdi: 'tests/unit/aggiornamentiAutomatici.test.mjs\n' });
      assert.equal(r.statoCancello, 0, r.out);
      assert.equal(r.status, 0, r.out);
      assert.equal(r.allarme, null, 'aperto un feedback per un rosso già corretto su main');
      assert.equal(r.puntaLanciata, 'unit.log', 'il controllo della punta deve leggere il registro del cancello');
      assert.match(r.out, /::warning::.*gia' verdi sulla punta di main/);
      assert.match(r.riepilogo, /Rossi gia' corretti su main/);
      assert.match(r.riepilogo, new RegExp(`Rossi su ${s.provato}, verdi sulla punta ${s.punta}`));
      assert.match(r.riepilogo, /- tests\/unit\/aggiornamentiAutomatici\.test\.mjs/);
      assert.equal(r.copiaRimasta, false, 'la copia della punta è rimasta nel repo');
      assert.equal(r.copieGit, 1);
    } finally { togliCartella(s.base); }
  });

  test('un rosso ancora rosso sulla punta: il feedback si apre, col commit provato e i file già verdi da non correggere', () => {
    const s = scena();
    try {
      const r = eseguiPassi(s, { esito: 1, verdi: 'tests/unit/altro.test.mjs\n' });
      assert.equal(r.status, 0, r.out);
      assert.ok(r.allarme, 'il feedback non si è aperto');
      const [titolo, testo, ...resto] = r.allarme;
      assert.equal(titolo, 'Controlli automatici rossi: nessuna versione pubblicata');
      assert.deepEqual(resto, ['--chiavi-unit', 'esiti-cancello/unit.log']);
      assert.match(testo, new RegExp(`Commit provato: ${s.provato}, l'ultimo di main con la suite verde\\.`));
      assert.match(testo, /Gia' verdi sulla punta di main, da non correggere: tests\/unit\/altro\.test\.mjs/);
      assert.match(testo, /aggiornamentiAutomatici\.test\.mjs:116:1/);
      assert.equal(r.copiaRimasta, false);
      assert.equal(r.copieGit, 1);
    } finally { togliCartella(s.base); }
  });

  test('main fermo al commit provato: niente da rifare, il feedback si apre', () => {
    const s = scena({ sullaPunta: true });
    try {
      const r = eseguiPassi(s, { esito: 0, verdi: 'tests/unit/aggiornamentiAutomatici.test.mjs\n' });
      assert.equal(r.puntaLanciata, null, 'rifatto sulla punta lo stesso commit appena provato');
      assert.ok(r.allarme, 'il feedback non si è aperto');
      assert.doesNotMatch(r.allarme[1], /Gia' verdi/);
    } finally { togliCartella(s.base); }
  });

  test('main irraggiungibile: il feedback si apre come prima', () => {
    const s = scena();
    try {
      s.g(s.lavoro, 'remote', 'set-url', 'origin', join(s.base, 'non-esiste'));
      const r = eseguiPassi(s, { esito: 0, verdi: 'tests/unit/aggiornamentiAutomatici.test.mjs\n' });
      assert.equal(r.puntaLanciata, null);
      assert.ok(r.allarme, 'senza la punta l\'allarme è sparito');
    } finally { togliCartella(s.base); }
  });

  test('il controllo della punta che si rompe: il feedback si apre', () => {
    const s = scena();
    try {
      const r = eseguiPassi(s, { esito: 'rotto', verdi: 'tests/unit/aggiornamentiAutomatici.test.mjs\n' });
      assert.ok(r.allarme, 'un controllo rotto ha spento l\'allarme');
      assert.equal(r.copiaRimasta, false);
    } finally { togliCartella(s.base); }
  });

  test('il registro non arriva all\'avviso: il feedback si apre lo stesso, senza rossi elencati', () => {
    const s = scena();
    try {
      const r = eseguiPassi(s, { esito: 1, punta: false });
      assert.ok(r.allarme, 'senza registro il cancello rosso tacerebbe');
      assert.match(r.allarme[1], /nessuna riga not ok: guarda la coda/);
      assert.match(r.allarme[1], /\(nessun output\)/);
    } finally { togliCartella(s.base); }
  });

  test('un feedback che non parte lascia rosso l\'avviso', () => {
    const s = scena();
    try {
      const r = eseguiPassi(s, { esito: 1, invio: 1 });
      assert.ok(r.allarme, 'l\'allarme non è stato nemmeno chiamato');
      assert.equal(r.status, 1);
      assert.match(r.out, /::error::Allarme del cancello non consegnato/);
    } finally { togliCartella(s.base); }
  });

  // L'esito della punta viene dalla macchina delle prove: per l'avviso è un dato, e lo sha finisce in un'annotazione.
  test('dal cancello lo sha della punta passa solo come esadecimale', () => {
    const s = scena();
    try {
      const r = eseguiPassi(s, {
        esito: 0,
        verdi: 'tests/unit/aggiornamentiAutomatici.test.mjs\n',
        prima: () => writeFileSync(join(s.lavoro, 'esiti-cancello', 'punta'), 'abc123\n::error::finto\n'),
      });
      const avviso = r.out.split('\n').find((x) => x.startsWith('::warning::'));
      assert.match(avviso, /sulla punta di main \(abc123[0-9a-f]*\):/);
      assert.doesNotMatch(r.out, /::error::finto/);
    } finally { togliCartella(s.base); }
  });
});

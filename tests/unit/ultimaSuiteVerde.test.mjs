// Quale commit si pubblica (scripts/ultima-suite-verde.mjs): il più nuovo di main con la suite verde, e un
// feedback quando la pubblicazione è ferma da troppo. Un verde sbagliato pubblica un rosso; uno mancato ferma tutto.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'ultima-suite-verde.mjs');

// Una copia, mai un collegamento fisso: il node che esegue questa prova tiene il suo file aperto, e su Windows
// nessun nome di quel file si cancella finché gira (EPERM alla pulizia).
const ghExeFinto = (bin) => copyFileSync(process.execPath, join(bin, 'gh.exe'));

const {
  scegliUltimoVerde, corseVerdi, rilascioFermo, testoRilascioFermo, rigaCorsa, verdePiuNuovoDelTag, SOGLIA_ORE, CHIAVE_FERMO,
  oreDalPrimoVerde, testoFermoDopoIlVerde, SOGLIA_VERDE_ORE, CHIAVE_FERMO_DOPO_VERDE, chiaveDelFermo,
} = await import('../../scripts/ultima-suite-verde.mjs');

// main dal più nuovo: c5 è la punta, c1 il più vecchio.
const MAIN = ['c5', 'c4', 'c3', 'c2', 'c1'];
const corsa = (head_sha, conclusion = 'success', extra = {}) => ({
  head_sha, conclusion, status: 'completed', event: 'push', head_branch: 'main',
  html_url: `https://github.com/o/r/actions/runs/${head_sha}`, created_at: '2026-09-28T10:00:00Z', ...extra,
});

describe('il commit più nuovo di main con la suite verde', () => {
  test('vince il più nuovo nella storia di main, non la corsa più recente', () => {
    // La corsa su c2 è arrivata dopo (una riesecuzione), ma c4 è più nuovo su main.
    assert.equal(scegliUltimoVerde([corsa('c2'), corsa('c4'), corsa('c1')], MAIN), 'c4');
    assert.equal(scegliUltimoVerde([corsa('c5'), corsa('c4')], MAIN), 'c5');
  });

  test('un verde su un commit fuori dalla storia del primo genitore non conta', () => {
    // Un commit di un ramo fuso, o di un ramo provato a mano: non è main.
    assert.equal(scegliUltimoVerde([corsa('ramo-x'), corsa('c2')], MAIN), 'c2');
    assert.equal(scegliUltimoVerde([corsa('ramo-x')], MAIN), '');
  });

  test('nessun verde → stringa vuota', () => {
    assert.equal(scegliUltimoVerde([], MAIN), '');
    assert.equal(scegliUltimoVerde(undefined, MAIN), '');
    assert.equal(scegliUltimoVerde([corsa('c3')], []), '');
  });

  test('corse rosse, annullate, in corso o di altri eventi e rami non contano', () => {
    const corse = [
      corsa('c5', 'failure'),
      corsa('c4', 'cancelled'),
      corsa('c3', null, { status: 'in_progress' }),
      corsa('c3', 'success', { status: 'in_progress' }),
      corsa('c2', 'success', { event: 'pull_request' }),
      corsa('c2', 'success', { head_branch: 'claude/prova' }),
      corsa('c1', 'success', { event: 'workflow_dispatch' }),
    ];
    assert.equal(scegliUltimoVerde(corse, MAIN), 'c1', 'un avvio a mano su main riuscito è un verde valido');
    assert.deepEqual([...corseVerdi(corse).keys()], ['c1']);
  });

  test('si pubblica solo un verde più nuovo dell\'ultima versione', () => {
    // main: c5 c4 c3 c2 c1, l'ultima versione è su c3.
    const antenato = (a, b) => MAIN.indexOf(a) >= MAIN.indexOf(b);
    assert.equal(verdePiuNuovoDelTag('c4', 'c3', antenato), true);
    assert.equal(verdePiuNuovoDelTag('c3', 'c3', antenato), false, 'il commit già pubblicato non ha niente di nuovo');
    assert.equal(verdePiuNuovoDelTag('c2', 'c3', antenato), false, 'un verde vecchio (una corsa rifatta) ripubblicherebbe codice vecchio');
    assert.equal(verdePiuNuovoDelTag('c2', '', antenato), true, 'senza versioni precedenti ogni verde è nuovo');
    assert.equal(verdePiuNuovoDelTag('', 'c3', antenato), false);
  });

  test('di più corse verdi sullo stesso commit si tiene la prima (la più nuova)', () => {
    const v = corseVerdi([corsa('c4', 'success', { html_url: 'nuova' }), corsa('c4', 'success', { html_url: 'vecchia' })]);
    assert.equal(v.get('c4').html_url, 'nuova');
  });
});

describe('la pubblicazione ferma', () => {
  test(`ferma: più di ${SOGLIA_ORE} ore, codice nuovo dopo l'ultima versione, niente di verde dopo di lei`, () => {
    assert.equal(rilascioFermo({ oreDallUltima: 49, commitDopoTag: 3, verdeDopoTag: false }), 'senza-verde');
  });

  test(`ferma anche con un verde, se da più di ${SOGLIA_VERDE_ORE} ore non esce: il guasto sta dopo la scelta`, () => {
    // Il caso che ha fermato i rilasci per tre settimane: cancello unit rosso su Windows, allarme assorbito.
    assert.equal(rilascioFermo({ oreDallUltima: 100, commitDopoTag: 3, verdeDopoTag: true, oreDalVerde: 68 }), 'dopo-il-verde');
    assert.equal(rilascioFermo({ oreDallUltima: 400, commitDopoTag: 3, verdeDopoTag: true, oreDalVerde: 13 }), 'dopo-il-verde');
  });

  test('non ferma: entro la soglia, senza codice nuovo, o con un verde appena arrivato da pubblicare', () => {
    assert.equal(rilascioFermo({ oreDallUltima: 47, commitDopoTag: 3, verdeDopoTag: false }), '');
    assert.equal(rilascioFermo({ oreDallUltima: 47, commitDopoTag: 3, verdeDopoTag: true, oreDalVerde: 40 }), '', 'entro le 48 ore niente');
    assert.equal(rilascioFermo({ oreDallUltima: 400, commitDopoTag: 0, verdeDopoTag: false }), '', 'niente da pubblicare non è un guasto');
    assert.equal(rilascioFermo({ oreDallUltima: 400, commitDopoTag: 3, verdeDopoTag: true, oreDalVerde: 2 }), '',
      'un verde di due ore fa: questo giro lo pubblica');
    assert.equal(rilascioFermo({ oreDallUltima: 400, commitDopoTag: 3, verdeDopoTag: true }), '', 'da quando è verde non si sa: non si inventa');
    assert.equal(rilascioFermo({ oreDallUltima: NaN, commitDopoTag: 3, verdeDopoTag: false }), '', 'età sconosciuta: non si inventa');
    assert.equal(rilascioFermo(), '');
  });

  test('da quando c\'è un verde da pubblicare: il primo diventato verde dopo l\'ultima versione, non il più nuovo', () => {
    // main: c5 c4 c3 c2 c1, l'ultima versione è su c2. Ogni fusione porta un verde nuovo: conta il primo.
    const antenato = (a, b) => MAIN.indexOf(a) >= MAIN.indexOf(b);
    const adesso = Date.parse('2026-09-28T12:00:00Z');
    const corse = [
      corsa('c5', 'success', { updated_at: '2026-09-28T11:00:00Z' }),
      corsa('c4', 'failure', { updated_at: '2026-09-27T12:00:00Z' }),
      corsa('c3', 'success', { updated_at: '2026-09-26T12:00:00Z' }),
      corsa('c2', 'success', { updated_at: '2026-09-20T12:00:00Z' }),
      corsa('ramo', 'success', { updated_at: '2026-09-01T12:00:00Z' }),
    ];
    assert.equal(oreDalPrimoVerde(corse, MAIN, 'c2', antenato, adesso), 48, 'c3, verde da due giorni; c2 è la versione stessa');
    assert.equal(oreDalPrimoVerde(corse, MAIN, 'c3', antenato, adesso), 1);
    assert.ok(Number.isNaN(oreDalPrimoVerde(corse, MAIN, 'c5', antenato, adesso)), 'niente di verde dopo la versione');
    assert.ok(Number.isNaN(oreDalPrimoVerde([], MAIN, 'c2', antenato, adesso)));
    assert.equal(oreDalPrimoVerde([corsa('c3', 'success', { updated_at: undefined })], MAIN, 'c2', antenato, adesso),
      (adesso - Date.parse('2026-09-28T10:00:00Z')) / 3.6e6, 'senza updated_at vale created_at');
  });

  test('il feedback del verde che non esce dice da quanto, quale verde, e le ultime corse della pubblicazione', () => {
    assert.equal(CHIAVE_FERMO_DOPO_VERDE, 'rilascio:fermo-dopo-il-verde');
    assert.notEqual(CHIAVE_FERMO_DOPO_VERDE, CHIAVE_FERMO, 'due guasti diversi, due chiavi: uno non assorbe l\'altro');
    const { titolo, testo } = testoFermoDopoIlVerde({
      tag: 'v0.2.228', oreDallUltima: 100, commitDopoTag: 7, verde: 'abc1234', corsaVerde: corsa('abc1234'), oreDalVerde: 68,
      pubblicazioni: [corsa('fffffffff1', 'failure')], esecuzione: 'https://github.com/o/r/actions/runs/7',
    });
    assert.match(titolo, /4 giorni/);
    assert.match(titolo, /verde/);
    assert.match(testo, /v0\.2\.228/);
    assert.match(testo, /68 ore/);
    assert.match(testo, /abc1234 \(https:\/\/github\.com\/o\/r\/actions\/runs\/abc1234\)/);
    assert.match(testo, /failure · fffffffff · /);
    assert.match(testo, /actions\/runs\/7/);
    assert.match(testoFermoDopoIlVerde({ tag: 'v1', oreDallUltima: 60, verde: 'x' }).testo, /\(nessuna letta\)/);
  });

  test('il feedback dice da quanto, l\'ultimo verde e le ultime corse coi loro link; la chiave è una sola', () => {
    assert.equal(CHIAVE_FERMO, 'rilascio:fermo');
    const { titolo, testo } = testoRilascioFermo({
      tag: 'v0.2.228', oreDallUltima: 18 * 24 + 3, commitDopoTag: 412, verde: 'abc1234',
      corsaVerde: corsa('abc1234'), esecuzione: 'https://github.com/o/r/actions/runs/7',
      corse: [corsa('dddddddddd', 'failure'), corsa('eeeeeeeeee', null, { status: 'in_progress' })],
    });
    assert.match(titolo, /18 giorni/);
    assert.match(testo, /v0\.2\.228/);
    assert.match(testo, /412 commit/);
    assert.match(testo, /abc1234 \(https:\/\/github\.com\/o\/r\/actions\/runs\/abc1234\)/);
    assert.match(testo, /failure · ddddddddd · .* · https:\/\/github\.com\/o\/r\/actions\/runs\/dddddddddd/);
    assert.match(testo, /in_progress · eeeeeeeee/);
    assert.match(testo, /actions\/runs\/7/);
  });

  test('la chiave di un fermo porta la versione a cui è fermo: un fermo nuovo non è il doppione di uno vecchio', () => {
    for (const tipo of [CHIAVE_FERMO, CHIAVE_FERMO_DOPO_VERDE]) {
      assert.equal(chiaveDelFermo(tipo, 'v0.2.300'), chiaveDelFermo(tipo, 'v0.2.300'), 'lo stesso fermo, giro dopo giro: un feedback solo');
      assert.notEqual(chiaveDelFermo(tipo, 'v0.2.300'), chiaveDelFermo(tipo, 'v0.2.301'), 'dopo una versione uscita è un fermo nuovo');
      assert.ok(chiaveDelFermo(tipo, 'v0.2.300').startsWith(`${tipo}:`));
    }
    assert.notEqual(chiaveDelFermo(CHIAVE_FERMO, 'v1'), chiaveDelFermo(CHIAVE_FERMO_DOPO_VERDE, 'v1'));
    assert.match(testoRilascioFermo({ tag: 'v0.2.301', oreDallUltima: 100 }).titolo, /alla v0\.2\.301 da 4 giorni/);
    assert.match(testoFermoDopoIlVerde({ tag: 'v0.2.301', oreDallUltima: 100 }).titolo, /alla v0\.2\.301 da 4 giorni/);
  });

  test('senza un verde, e senza corse lette, lo dice invece di tacere', () => {
    const { testo } = testoRilascioFermo({ tag: 'v1.0.0', oreDallUltima: 72, commitDopoTag: 2, verde: '', corse: [], erroreApi: 'HTTP 403' });
    assert.match(testo, /nessun commit verde/);
    assert.match(testo, /\(nessuna letta\)/);
    assert.match(testo, /HTTP 403/);
  });

  test('una corsa senza dati si scrive lo stesso, senza «undefined»', () => {
    assert.doesNotMatch(rigaCorsa({}), /undefined/);
  });
});

// Lo script vero, contro un main finto (date vere dei commit), un `gh` finto e un buildAlarm finto: la regola sopra
// serve solo se la scelta la chiama. Su Windows `gh.exe` è node, che esegue lo script `api` della cartella corrente.
describe('la scelta vera, contro un main finto', () => {
  const WIN = process.platform === 'win32';
  const oreFa = (ore) => new Date(Date.now() - ore * 3.6e6).toISOString();
  const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
  const CORPO_GH = `
const fs = require('fs');
const p = process.argv.find((a) => a.startsWith('repos/')) || '';
const s = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATO, 'utf8'));
if (p.includes('/actions/workflows/suite.yml/runs')) {
  const runs = s.runs.filter((r) => !p.includes('status=success') || r.conclusion === 'success');
  process.stdout.write(JSON.stringify({ workflow_runs: runs }));
} else if (p.includes('/releases/tags/')) process.stdout.write(JSON.stringify({ published_at: s.pubblicata }));
else { process.stderr.write('percorso non previsto ' + p); process.exit(1); }
`;

  async function scegli({ oreVersione, oreVerde }) {
    const tmp = cartellaTemporanea('filo-scelta-vera-');
    const repo = join(tmp, 'main');
    const ricevute = [];
    const srv = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        ricevute.push(JSON.parse(b));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, num: '#9', duplicate: false }));
      });
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      mkdirSync(repo, { recursive: true });
      git(repo, ['init', '-q', '-b', 'main']);
      git(repo, ['config', 'user.email', 'p@f']);
      git(repo, ['config', 'user.name', 'p']);
      const sha = [];
      for (const [ore, msg] of [[oreVersione, 'release: v0.2.228 [skip ci]'], [oreVerde + 2, 'merge-gate: #1 via server'], [1, 'merge-gate: #2 via server']]) {
        writeFileSync(join(repo, 'f.txt'), `${msg}\n`, { flag: 'a' });
        git(repo, ['add', 'f.txt']);
        git(repo, ['commit', '-qm', msg], { GIT_AUTHOR_DATE: oreFa(ore), GIT_COMMITTER_DATE: oreFa(ore) });
        sha.push(git(repo, ['rev-parse', 'HEAD']));
      }
      git(repo, ['tag', 'v0.2.228', sha[0]]);
      const bin = join(tmp, 'bin');
      mkdirSync(bin);
      if (WIN) {
        ghExeFinto(bin);
        writeFileSync(join(repo, 'api'), CORPO_GH);
      } else {
        writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n${CORPO_GH}`);
        chmodSync(join(bin, 'gh'), 0o755);
      }
      const corsaDi = (s, conclusion, ore) => ({ head_sha: s, conclusion, status: 'completed', event: 'push', head_branch: 'main',
        created_at: oreFa(ore + 1), updated_at: oreFa(ore), html_url: `https://github.com/o/r/actions/runs/${ore}` });
      writeFileSync(join(tmp, 'stato.json'), JSON.stringify({
        pubblicata: oreFa(oreVersione), runs: [corsaDi(sha[2], 'failure', 0.5), corsaDi(sha[1], 'success', oreVerde)],
      }));
      const env = {
        ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_GH_STATO: join(tmp, 'stato.json'),
        GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: join(tmp, 'output.txt'), GITHUB_STEP_SUMMARY: join(tmp, 'riassunto.md'),
        FILO_BUILD_PASSPHRASE: 'prova', FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`,
        NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
      };
      const codice = await new Promise((ok) => {
        execFile(process.execPath, [SCRIPT], { cwd: repo, env }, (err) => ok(err ? (err.code ?? 1) : 0));
      });
      return { codice, ricevute, output: readFileSync(join(tmp, 'output.txt'), 'utf8'), verde: sha[1] };
    } finally {
      await new Promise((ok) => srv.close(ok));
      togliCartella(tmp, { tentativi: 10 });
    }
  }

  test('ultima versione di 100 ore fa, un verde di 68 ore fa mai uscito: allarme, e il verde si prova lo stesso', async () => {
    const r = await scegli({ oreVersione: 100, oreVerde: 68 });
    assert.equal(r.ricevute.length, 1, 'passate le 48 ore senza versioni, un verde fermo deve aprire un feedback');
    assert.deepEqual(r.ricevute[0].keys, [chiaveDelFermo(CHIAVE_FERMO_DOPO_VERDE, 'v0.2.228')]);
    assert.match(r.ricevute[0].name, /alla v0\.2\.228/, 'due fermi aperti insieme si distinguono dal titolo');
    assert.match(r.ricevute[0].text, /68 ore/);
    assert.equal(r.output.trim(), `sha=${r.verde}`, 'il guasto a valle può essere passato: la pubblicazione si tenta');
    assert.equal(r.codice, 0);
  });

  test('un verde appena arrivato dopo una lunga attesa: si pubblica, senza allarme', async () => {
    const r = await scegli({ oreVersione: 100, oreVerde: 3 });
    assert.equal(r.ricevute.length, 0);
    assert.equal(r.output.trim(), `sha=${r.verde}`);
  });
});

// Il caso di #569: il feedback di un fermo resta aperto (parcheggiato) anche dopo che una versione è uscita. Il server
// finto applica il contratto: un feedback aperto copre le chiavi del suo alarmKeys, e un allarme coperto non apre niente.
describe('un fermo dopo una versione uscita apre il suo feedback, anche col feedback del fermo di prima aperto', () => {
  const WIN = process.platform === 'win32';
  const oreFa = (ore) => new Date(Date.now() - ore * 3.6e6).toISOString();
  const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
  const CORPO_GH = `
const fs = require('fs');
const p = process.argv.find((a) => a.startsWith('repos/')) || '';
const s = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATO, 'utf8'));
if (p.includes('/actions/workflows/suite.yml/runs')) {
  const runs = s.runs.filter((r) => !p.includes('status=success') || r.conclusion === 'success');
  process.stdout.write(JSON.stringify({ workflow_runs: runs }));
} else if (p.includes('/releases/tags/')) process.stdout.write(JSON.stringify({ published_at: s.pubblicata }));
else process.stdout.write(JSON.stringify({ workflow_runs: [] }));
`;
  const corsaDi = (sha, conclusion, ore) => ({ head_sha: sha, conclusion, status: 'completed', event: 'push', head_branch: 'main',
    created_at: oreFa(ore + 1), updated_at: oreFa(ore), html_url: `https://github.com/o/r/actions/runs/${Math.round(ore)}` });

  async function dueFermi(verdi) {
    const tmp = cartellaTemporanea('filo-due-fermi-');
    const repo = join(tmp, 'main');
    const aperti = [];
    const srv = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const { keys = [], name } = JSON.parse(b);
        const coperte = new Set(aperti.flatMap((f) => f.alarmKeys));
        const nuove = keys.filter((k) => !coperte.has(k));
        if (nuove.length) aperti.push({ num: `#${aperti.length + 1}`, name, alarmKeys: nuove });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, num: `#${aperti.length}`, duplicate: !nuove.length, nuove }));
      });
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      mkdirSync(repo, { recursive: true });
      git(repo, ['init', '-q', '-b', 'main']);
      git(repo, ['config', 'user.email', 'p@f']);
      git(repo, ['config', 'user.name', 'p']);
      const sha = {};
      for (const [nome, ore, msg] of [['v300', 250, 'merge-gate: #1 via server'], ['r1', 200, 'merge-gate: #2 via server'],
        ['v301', 120, 'merge-gate: #3 via server'], ['bump', 118, 'release: v0.2.301 [skip ci]'],
        ['r2', 90, 'merge-gate: #4 via server'], ['testa', 60, 'merge-gate: #5 via server']]) {
        writeFileSync(join(repo, 'f.txt'), `${msg}\n`, { flag: 'a' });
        git(repo, ['add', 'f.txt']);
        git(repo, ['commit', '-qm', msg], { GIT_AUTHOR_DATE: oreFa(ore), GIT_COMMITTER_DATE: oreFa(ore) });
        sha[nome] = git(repo, ['rev-parse', 'HEAD']);
      }
      git(repo, ['tag', 'v0.2.300', sha.v300]);
      const bin = join(tmp, 'bin');
      mkdirSync(bin);
      if (WIN) {
        ghExeFinto(bin);
        writeFileSync(join(repo, 'api'), CORPO_GH);
      } else {
        writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n${CORPO_GH}`);
        chmodSync(join(bin, 'gh'), 0o755);
      }
      const env = {
        ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_GH_STATO: join(tmp, 'stato.json'),
        GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: join(tmp, 'output.txt'), GITHUB_STEP_SUMMARY: join(tmp, 'riassunto.md'),
        FILO_BUILD_PASSPHRASE: 'prova', FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`,
        NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
      };
      const giro = (stato) => {
        writeFileSync(join(tmp, 'stato.json'), JSON.stringify(stato));
        return new Promise((ok) => { execFile(process.execPath, [SCRIPT], { cwd: repo, env }, () => ok()); });
      };
      // Primo fermo alla v0.2.300; il suo feedback resta aperto.
      git(repo, ['checkout', '-q', sha.r1]);
      await giro({ pubblicata: oreFa(249), runs: verdi(sha).primo });
      await giro({ pubblicata: oreFa(249), runs: verdi(sha).primo });
      // Esce la v0.2.301, e la pubblicazione si ferma di nuovo.
      git(repo, ['checkout', '-q', sha.testa]);
      git(repo, ['tag', 'v0.2.301', sha.v301]);
      await giro({ pubblicata: oreFa(117), runs: verdi(sha).secondo });
      await giro({ pubblicata: oreFa(117), runs: verdi(sha).secondo });
      return aperti;
    } finally {
      await new Promise((ok) => srv.close(ok));
      togliCartella(tmp, { tentativi: 10 });
    }
  }

  test('senza verdi: il secondo fermo apre il suo feedback, e ogni fermo uno solo', async () => {
    const aperti = await dueFermi((s) => ({
      primo: [corsaDi(s.r1, 'failure', 199), corsaDi(s.v300, 'success', 249)],
      secondo: [corsaDi(s.testa, 'failure', 59), corsaDi(s.r2, 'failure', 89), corsaDi(s.v301, 'success', 119)],
    }));
    assert.equal(aperti.length, 2, `feedback aperti: ${JSON.stringify(aperti)}`);
    assert.deepEqual(aperti.map((f) => f.alarmKeys), [[chiaveDelFermo(CHIAVE_FERMO, 'v0.2.300')], [chiaveDelFermo(CHIAVE_FERMO, 'v0.2.301')]]);
    assert.match(aperti[1].name, /alla v0\.2\.301/);
  });

  test('con un verde che non esce: il secondo fermo apre il suo feedback, e ogni fermo uno solo', async () => {
    const aperti = await dueFermi((s) => ({
      primo: [corsaDi(s.r1, 'success', 198), corsaDi(s.v300, 'success', 249)],
      secondo: [corsaDi(s.testa, 'failure', 59), corsaDi(s.r2, 'success', 88), corsaDi(s.v301, 'success', 119)],
    }));
    assert.equal(aperti.length, 2, `feedback aperti: ${JSON.stringify(aperti)}`);
    assert.deepEqual(aperti.map((f) => f.alarmKeys),
      [[chiaveDelFermo(CHIAVE_FERMO_DOPO_VERDE, 'v0.2.300')], [chiaveDelFermo(CHIAVE_FERMO_DOPO_VERDE, 'v0.2.301')]]);
  });
});

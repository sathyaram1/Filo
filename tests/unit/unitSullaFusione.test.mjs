// Gli unit sul risultato della fusione prima di chiederla (#929): l'esito dai due lati, il campo per il server, i
// tentativi quando main si muove, e la pulizia che non deve MAI attraversare il collegamento a node_modules.
// La prova vera gira su un repo finto con origin, col lanciatore vero degli unit copiato dentro.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, collegaCartella } from '../helpers/percorsi.mjs';
import {
  decidiEsito, campoPerIlServer, chiaveTest, testoProva, togliCollegamento, chiudiAlbero, gitIn,
  provaUnitSullaFusione, chiediConProva, pulisciResti, TETTO_ROSSI, assicuraStoria, testoStoria,
} from '../../scripts/lib/unit-sulla-fusione.mjs';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA = 'a'.repeat(40);

test('esito: verde, contenuto, conflitto, e un rosso si giudica solo dopo averlo riprovato su main', () => {
  assert.deepEqual(decidiEsito({ contenuto: true }), { esito: 'main_contenuto' });
  assert.equal(decidiEsito({ conflitto: ['a.js'] }).esito, 'conflitto');
  assert.deepEqual(decidiEsito({ fusione: { ok: true, rossi: [] } }), { esito: 'verde' });
  assert.deepEqual(decidiEsito({ fusione: { ok: false, rossi: ['x'] } }), { serveMain: true });
  assert.deepEqual(decidiEsito({ fusione: { ok: false, rossi: ['x'] }, main: { ok: true, rossi: [] } }),
    { esito: 'rosso_sulla_fusione', rossi: ['x'] });
});

test('esito: rosso anche su main fonde, ma non se la fusione rompe test che su main passano', () => {
  assert.equal(decidiEsito({ fusione: { ok: false, rossi: ['x'] }, main: { ok: false, rossi: ['x'] } }).esito, 'rosso_anche_su_main');
  const nuovi = decidiEsito({ fusione: { ok: false, rossi: ['x', 'y'] }, main: { ok: false, rossi: ['x'] } });
  assert.deepEqual(nuovi, { esito: 'rosso_sulla_fusione', rossi: ['y'], rossiMain: 1 });
  // Un lanciatore caduto senza elenco non si confronta: vale la regola dell'owner, main rotto non ferma.
  assert.equal(decidiEsito({ fusione: { ok: false, rossi: [] }, main: { ok: false, rossi: ['x'] } }).esito, 'rosso_anche_su_main');
});

test('lo stesso test rosso ha la stessa chiave in due cartelle diverse', () => {
  const a = chiaveTest({ nome: 'n', file: join('/tmp/x/fusione', 'tests', 'unit', 'a.test.mjs') }, '/tmp/x/fusione');
  const b = chiaveTest({ nome: 'n', file: join('/tmp/x/main', 'tests', 'unit', 'a.test.mjs') }, '/tmp/x/main');
  assert.equal(a, 'tests/unit/a.test.mjs › n');
  assert.equal(a, b);
  // Fuori dalla cartella (forma corta e lunga di Windows): conta il pezzo da tests/.
  assert.equal(chiaveTest({ nome: 'n', file: 'C:\\ALTRO~1\\fusione\\tests\\unit\\a.test.mjs' }, 'C:\\altro nome\\fusione'), 'tests/unit/a.test.mjs › n');
});

test('il campo per il server: niente campo senza origin, «non_provata» col motivo, elenco dei rossi col tetto dichiarato', () => {
  assert.equal(campoPerIlServer({ saltata: true, motivo: 'nessun origin' }), null);
  assert.deepEqual(campoPerIlServer({ errore: 'git giù' }), { esito: 'non_provata', motivo: 'git giù' });
  assert.deepEqual(campoPerIlServer({ esito: 'verde', mainSha: SHA }), { esito: 'verde', mainSha: SHA });
  const tanti = Array.from({ length: TETTO_ROSSI + 5 }, (_, i) => `t${i}`);
  const c = campoPerIlServer({ esito: 'rosso_sulla_fusione', mainSha: SHA, rossi: tanti });
  assert.equal(c.rossi.length, TETTO_ROSSI);
  assert.equal(c.altriRossi, 5, 'un taglio si dice');
  assert.match(testoProva({ esito: 'rosso_sulla_fusione', mainSha: SHA, rossi: ['tests/unit/a.test.mjs › n'] }), /✖ tests\/unit\/a\.test\.mjs › n/);
});

test('main mosso: si rifà la prova fino al tetto, poi ci si ferma senza fondere', async () => {
  let prove = 0;
  const chieste = [];
  const prova = () => { prove++; return { esito: 'verde', mainSha: String(prove).repeat(40).slice(0, 40) }; };
  const muto = () => {};
  const r = await chiediConProva({
    prova, scrivi: muto, tentativi: 3,
    chiedi: async (campo) => { chieste.push(campo.mainSha); return { result: chieste.length < 2 ? 'main_moved' : 'merged' }; },
    mainMosso: (x) => x.result === 'main_moved',
  });
  assert.equal(r.reply.result, 'merged');
  assert.equal(prove, 2, 'una prova nuova per ogni main mosso');
  assert.notEqual(chieste[0], chieste[1], 'la seconda richiesta porta lo sha della seconda prova');
  const sempre = await chiediConProva({ prova, scrivi: muto, tentativi: 3, chiedi: async () => ({ result: 'main_moved' }), mainMosso: (x) => x.result === 'main_moved' });
  assert.equal(sempre.esaurito, true);
  assert.equal(sempre.tentativi, 3);
  const fermo = await chiediConProva({
    prova: () => ({ esito: 'rosso_sulla_fusione', mainSha: SHA, rossi: ['x'] }), scrivi: muto,
    fermaSe: (p) => p.esito === 'rosso_sulla_fusione', chiedi: async () => assert.fail('un rosso sulla fusione non si chiede'), mainMosso: () => false,
  });
  assert.equal(fermo.fermo, true);
});

test('togliere il collegamento a node_modules non tocca la cartella a cui punta', () => {
  const casa = cartellaTemporanea('filo-929-collegamento-');
  try {
    const vero = join(casa, 'principale', 'node_modules');
    mkdirSync(join(vero, 'pacchetto'), { recursive: true });
    writeFileSync(join(vero, 'pacchetto', 'sentinella.txt'), 'resta', 'utf8');
    const albero = join(casa, 'albero');
    mkdirSync(albero);
    collegaCartella(vero, join(albero, 'node_modules'));
    assert.ok(existsSync(join(albero, 'node_modules', 'pacchetto', 'sentinella.txt')), 'il collegamento funziona');
    assert.deepEqual(togliCollegamento(join(albero, 'node_modules')), { ok: true });
    assert.ok(!existsSync(join(albero, 'node_modules')), 'il collegamento non c\'è più');
    assert.equal(readFileSync(join(vero, 'pacchetto', 'sentinella.txt'), 'utf8'), 'resta', 'il node_modules vero è intatto');
    // Una cartella vera piena al posto del collegamento: non si svuota.
    const finto = join(casa, 'finto', 'node_modules');
    mkdirSync(finto, { recursive: true });
    writeFileSync(join(finto, 'dentro.txt'), 'x', 'utf8');
    assert.equal(togliCollegamento(finto).ok, false);
    assert.ok(existsSync(join(finto, 'dentro.txt')));
    assert.deepEqual(togliCollegamento(join(casa, 'non-c-e')), { ok: true });
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});

// ─── La prova vera, su un repo finto con origin ──────────────────────────────

function repoFinto() {
  const casa = cartellaTemporanea('filo-929-repo-');
  const origin = join(casa, 'origin.git');
  const lavoro = join(casa, 'lavoro');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
  mkdirSync(join(lavoro, 'scripts', 'lib'), { recursive: true });
  mkdirSync(join(lavoro, 'tests', 'unit'), { recursive: true });
  for (const f of ['scripts/run-unit-tests.mjs', 'scripts/lib/riga-di-comando.mjs', 'scripts/lib/riepilogo-unit.mjs']) {
    copyFileSync(join(ROOT, f), join(lavoro, f));
  }
  writeFileSync(join(lavoro, '.gitignore'), 'node_modules\n', 'utf8');
  writeFileSync(join(lavoro, 'valore.txt'), 'uno\n', 'utf8');
  writeFileSync(join(lavoro, 'tests', 'unit', 'base.test.mjs'), "import { test } from 'node:test';\ntest('base', () => {});\n", 'utf8');
  // Il node_modules vero del repo: la prova lo collega nelle sue cartelle, e alla fine deve essere ancora qui.
  mkdirSync(join(lavoro, 'node_modules'));
  writeFileSync(join(lavoro, 'node_modules', 'sentinella.txt'), 'resta', 'utf8');
  const g = gitIn(lavoro);
  const ok = (args) => { const r = g(args); assert.ok(r.ok, `git ${args.join(' ')}: ${r.out}`); return r.out; };
  ok(['init', '-q', '--initial-branch=main']);
  ok(['config', 'user.email', 't@t']);
  ok(['config', 'user.name', 't']);
  ok(['add', '-A']);
  ok(['commit', '-qm', 'base']);
  ok(['remote', 'add', 'origin', origin]);
  ok(['push', '-q', 'origin', 'main']);
  const scrivi = (file, testo) => { mkdirSync(dirname(join(lavoro, file)), { recursive: true }); writeFileSync(join(lavoro, file), testo, 'utf8'); };
  const commit = (msg) => { ok(['add', '-A']); ok(['commit', '-qm', msg]); return ok(['rev-parse', 'HEAD']); };
  const suMain = (fn) => { ok(['checkout', '-q', 'main']); fn(); commit('main avanti'); ok(['push', '-q', 'origin', 'main']); };
  const ramo = (nome, fn) => { ok(['checkout', '-q', '-b', nome, 'main']); fn(); return commit(nome); };
  return { casa, lavoro, g, ok, scrivi, suMain, ramo };
}

const TEST_VALORE = "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { readFileSync } from 'node:fs';\n"
  + "test('il valore è uno', () => assert.equal(readFileSync('valore.txt', 'utf8').trim(), 'uno'));\n";
const TEST_ROTTO = "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('rotto su main', () => assert.fail('rotto'));\n";

function provaIn(r, punta) {
  return provaUnitSullaFusione({ root: r.lavoro, punta, scrivi: () => {} });
}

function pulita(r) {
  assert.equal(readFileSync(join(r.lavoro, 'node_modules', 'sentinella.txt'), 'utf8'), 'resta', 'il node_modules del repo è intatto');
  const alberi = r.ok(['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree '));
  assert.equal(alberi.length, 1, `nessuna cartella di prova rimasta: ${alberi.join(', ')}`);
}

test('prova vera: main dentro il ramo, verde, conflitto', () => {
  const r = repoFinto();
  try {
    const dentro = r.ramo('claude/dentro', () => r.scrivi('nuovo.txt', 'x\n'));
    const p0 = provaIn(r, dentro);
    assert.equal(p0.esito, 'main_contenuto');
    r.suMain(() => r.scrivi('altro.txt', 'y\n'));
    r.ok(['checkout', '-q', 'claude/dentro']);
    const p1 = provaIn(r, dentro);
    assert.equal(p1.esito, 'verde', JSON.stringify(p1));
    assert.equal(p1.mainSha, r.ok(['rev-parse', 'origin/main']), 'lo sha provato è quello di origin/main');
    pulita(r);
    const urta = r.ramo('claude/urta', () => r.scrivi('valore.txt', 'tre\n'));
    r.suMain(() => r.scrivi('valore.txt', 'quattro\n'));
    const p2 = provaIn(r, urta);
    assert.equal(p2.esito, 'conflitto');
    assert.deepEqual(p2.file, ['valore.txt']);
    pulita(r);
  } finally {
    rmSync(r.casa, { recursive: true, force: true });
  }
});

test('prova vera: rosso solo sulla fusione ferma con l\'elenco, rosso anche su main no', () => {
  const r = repoFinto();
  try {
    // Il ramo cambia il valore, main aggiunge il test che lo vuole com'era: verdi da soli, rossi insieme.
    const punta = r.ramo('claude/valore', () => r.scrivi('valore.txt', 'due\n'));
    r.suMain(() => r.scrivi('tests/unit/valore.test.mjs', TEST_VALORE));
    const p = provaIn(r, punta);
    assert.equal(p.esito, 'rosso_sulla_fusione', JSON.stringify(p));
    assert.deepEqual(p.rossi, ['tests/unit/valore.test.mjs › il valore è uno']);
    pulita(r);

    // Main già rotto e un ramo innocuo: si fonde.
    r.suMain(() => r.scrivi('tests/unit/rotto.test.mjs', TEST_ROTTO));
    const innocuo = r.ramo('claude/innocuo', () => r.scrivi('innocuo.txt', 'x\n'));
    r.suMain(() => r.scrivi('ancora.txt', 'z\n'));
    const q = provaIn(r, innocuo);
    assert.equal(q.esito, 'rosso_anche_su_main', JSON.stringify(q));
    pulita(r);

    // Main rotto E la fusione ne rompe un altro: ferma, e l'elenco ha solo quello nuovo.
    r.ok(['checkout', '-q', 'claude/valore']);
    const s = provaIn(r, punta);
    assert.equal(s.esito, 'rosso_sulla_fusione', JSON.stringify(s));
    assert.deepEqual(s.rossi, ['tests/unit/valore.test.mjs › il valore è uno']);
    pulita(r);
  } finally {
    rmSync(r.casa, { recursive: true, force: true });
  }
});

test('senza origin la prova si salta e lo si dice; con origin irraggiungibile è un errore', () => {
  const casa = cartellaTemporanea('filo-929-senza-');
  try {
    const g = gitIn(casa);
    g(['init', '-q', '--initial-branch=main']);
    assert.equal(provaUnitSullaFusione({ root: casa, punta: SHA, scrivi: () => {} }).saltata, true);
    g(['remote', 'add', 'origin', join(casa, 'non-esiste.git')]);
    assert.match(provaUnitSullaFusione({ root: casa, punta: SHA, scrivi: () => {} }).errore, /non riesco a scaricare main/);
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});

test('una cartella di prova si toglie anche dopo un guasto, e il node_modules collegato resta', () => {
  const r = repoFinto();
  try {
    const punta = r.ramo('claude/guasto', () => r.scrivi('nuovo.txt', 'x\n'));
    r.suMain(() => r.scrivi('altro.txt', 'y\n'));
    const p = provaUnitSullaFusione({ root: r.lavoro, punta, scrivi: () => {}, lancia: () => { throw new Error('lanciatore esploso'); } });
    assert.fail(`doveva lanciare, ha dato ${JSON.stringify(p)}`);
  } catch (e) {
    assert.match(String(e.message), /lanciatore esploso/);
    pulita(r);
  } finally {
    rmSync(r.casa, { recursive: true, force: true });
  }
});

test('chiudiAlbero toglie prima il collegamento: con un collegamento che non si toglie, il resto non si tocca', () => {
  const casa = cartellaTemporanea('filo-929-chiudi-');
  try {
    const albero = join(casa, 'albero');
    mkdirSync(join(albero, 'node_modules'), { recursive: true });
    writeFileSync(join(albero, 'node_modules', 'dentro.txt'), 'x', 'utf8');
    const r = chiudiAlbero(() => assert.fail('git non va chiamato'), albero);
    assert.equal(r.ok, false);
    assert.ok(existsSync(join(albero, 'node_modules', 'dentro.txt')));
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});

// ─── I clienti: cosa si manda, come si legge la risposta ─────────────────────

const { askServerMerge, classifyOwnerMerge, exitCodeForOwnerMerge, messageForOwnerMerge, erroreDiConnessione } = await import('../../scripts/lib/owner-merge.mjs');
const { exitCodeFor } = await import('../../scripts/merge-gate.mjs');
const { fermoDopoLaProva } = await import('../../scripts/finish-local.mjs');

test('finish: la prova viaggia con la richiesta, e «main mosso»/«unit rossi» hanno un nome e un\'uscita', async () => {
  process.env.FILO_ADMIN_REFRESH_TOKEN = 'refresh-finto';
  const vero = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id_token: 'id-finto' }), text: async () => '' });
  const corpi = [];
  try {
    const campo = { esito: 'verde', mainSha: SHA };
    const r = await askServerMerge({
      branch: 'claude/x', sha: SHA, provaUnit: campo, url: 'https://esempio/ownerMerge',
      fetchImpl: async (_u, o) => { corpi.push(JSON.parse(o.body)); return { status: 200, text: async () => JSON.stringify({ result: { ok: true, result: 'main_moved', mainSha: 'b'.repeat(40) } }) }; },
    });
    assert.deepEqual(corpi[0].data.provaUnit, campo);
    assert.deepEqual(r, { outcome: 'main_moved', mainSha: 'b'.repeat(40) });
    // #933: dopo minuti di test la connessione può essere chiusa dall'altra parte; un secondo tentativo.
    let volte = 0;
    const r2 = await askServerMerge({
      branch: 'claude/x', sha: SHA, url: 'https://esempio/ownerMerge',
      fetchImpl: async () => {
        if (volte++ === 0) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
        return { status: 200, text: async () => JSON.stringify({ result: { ok: true, result: 'merged', sha: 'c'.repeat(40) } }) };
      },
    });
    assert.equal(r2.outcome, 'merged');
    assert.equal(volte, 2);
  } finally {
    globalThis.fetch = vero;
    delete process.env.FILO_ADMIN_REFRESH_TOKEN;
  }
  assert.equal(erroreDiConnessione(new Error('ENOTFOUND')), false, 'un nome che non si risolve non si ritenta');
  const rossi = classifyOwnerMerge(200, { result: { ok: true, result: 'unit_rossi', reason: 'unit rossi: 2' } });
  assert.equal(rossi.outcome, 'unit_rossi');
  assert.equal(exitCodeForOwnerMerge(rossi), 20);
  assert.equal(exitCodeForOwnerMerge({ outcome: 'main_moved' }), 1);
  assert.match(messageForOwnerMerge({ outcome: 'main_moved', mainSha: 'b'.repeat(40) }), /Main si è mosso a ogni prova/);
  assert.match(fermoDopoLaProva({ esito: 'rosso_sulla_fusione' }), /non ho chiesto la fusione/);
  assert.match(fermoDopoLaProva({ errore: 'git giù' }), /git giù/);
});

test('cancello delle routine: unit rossi sulla fusione escono 20, come un conflitto (il server ha già riallineato)', () => {
  assert.equal(exitCodeFor({ ok: true, result: 'unit_rossi' }), 20);
  assert.equal(exitCodeFor({ ok: true, result: 'main_moved' }), 1);
});

test('prova vera: un rosso instabile si riprova da solo e non ferma la fusione', () => {
  const r = repoFinto();
  try {
    // Rosso alla prima corsa, verde alla seconda: il segno sta nella cartella della prova, fuori dall'albero.
    const instabile = "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { existsSync, writeFileSync } from 'node:fs';\n"
      + "import { join } from 'node:path';\ntest('a tempo', () => { const s = join(process.cwd(), '..', 'gia-provato'); "
      + "if (!existsSync(s)) { writeFileSync(s, 'x'); assert.fail('troppo lento'); } });\n";
    const punta = r.ramo('claude/instabile', () => r.scrivi('tests/unit/tempo.test.mjs', instabile));
    r.suMain(() => r.scrivi('altro.txt', 'y\n'));
    r.ok(['checkout', '-q', 'claude/instabile']);
    const righe = [];
    const p = provaUnitSullaFusione({ root: r.lavoro, punta, scrivi: (s) => righe.push(s) });
    assert.equal(p.esito, 'verde', JSON.stringify(p));
    assert.deepEqual(p.instabili, ['tests/unit/tempo.test.mjs › a tempo']);
    assert.ok(!righe.some((s) => /su main da solo/.test(s)), 'verde alla riprova: main non serve');
    assert.match(testoProva(p), /instabili/);
    pulita(r);
  } finally {
    rmSync(r.casa, { recursive: true, force: true });
  }
});

test('prova vera: due test verdi da soli che si rompono sempre insieme non sono instabili, e fermano la fusione', () => {
  const r = repoFinto();
  try {
    // Il test di main lascia un segno legato alla corsa (il `node --test` padre), quello del ramo cade se lo trova:
    // da solo passa sempre, nella stessa suite mai, in parallelo o in fila (main.test viene prima).
    const diMain = "import { test } from 'node:test';\nimport { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\n"
      + "test('main da solo', () => writeFileSync(join(process.cwd(), '..', `segno-${process.ppid}`), 'x'));\n";
    const delRamo = "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { existsSync } from 'node:fs';\n"
      + "import { join } from 'node:path';\ntest('ramo da solo', async () => {\n"
      + '  for (let i = 0; i < 40; i++) {\n'
      + "    assert.ok(!existsSync(join(process.cwd(), '..', `segno-${process.ppid}`)), 'insieme a main no');\n"
      + '    await new Promise((ok) => setTimeout(ok, 100));\n  }\n});\n';
    const punta = r.ramo('claude/insieme', () => r.scrivi('tests/unit/ramo.test.mjs', delRamo));
    r.suMain(() => r.scrivi('tests/unit/main.test.mjs', diMain));
    r.ok(['checkout', '-q', 'claude/insieme']);
    const p = provaIn(r, punta);
    assert.equal(p.esito, 'rosso_sulla_fusione', JSON.stringify(p));
    assert.ok(p.rossi.length >= 1, JSON.stringify(p));
    assert.ok(!p.instabili, 'niente instabili: si rompono a ogni suite intera');
    pulita(r);
  } finally {
    rmSync(r.casa, { recursive: true, force: true });
  }
});

// ─── Una prova interrotta a metà (Ctrl+C, timeout di chi la lancia) ──────────
//
// Un worktree di prova interrotto resta nell'elenco del repo, e il `worktree unlock` + `remove --force` che git stesso
// suggerisce attraverserebbe un collegamento al suo interno svuotando node_modules (verifica #929 giro 2): il
// collegamento sta nella cartella base, accanto ai worktree, e nessun comando di git su un worktree lo incontra.

test('durante la prova i worktree non contengono collegamenti: unlock e remove --force lasciano intatto node_modules', () => {
  const r = repoFinto();
  try {
    const punta = r.ramo('claude/senza-collegamento', () => r.scrivi('nuovo.txt', 'x\n'));
    r.suMain(() => r.scrivi('altro.txt', 'y\n'));
    let dentro = null;
    let trovaModuli = null;
    let rimosso = null;
    const p = provaUnitSullaFusione({
      root: r.lavoro, punta, scrivi: () => {},
      lancia: (dir) => {
        dentro = existsSync(join(dir, 'node_modules'));
        trovaModuli = existsSync(join(dir, '..', 'node_modules', 'sentinella.txt'));
        r.g(['worktree', 'unlock', dir]);
        rimosso = r.g(['worktree', 'remove', '--force', dir]).ok;
        return { ok: true, rossi: [] };
      },
    });
    assert.equal(p.esito, 'verde');
    assert.equal(dentro, false, 'nessun node_modules dentro il worktree di prova');
    assert.equal(trovaModuli, true, 'node_modules si trova risalendo dal worktree');
    assert.equal(rimosso, true, 'la pulizia che git suggerisce va fino in fondo');
    pulita(r);
  } finally {
    rmSync(r.casa, { recursive: true, force: true });
  }
});

test('i resti di una prova interrotta si tolgono alla richiesta dopo anche se il ramo contiene già main', () => {
  const r = repoFinto();
  // Nella temporanea vera, dove la prova la cerca e col nome che riconosce, col pid di un processo già finito.
  const base = join(tmpdir(), `filo-fusione-t${Math.random().toString(36).slice(2).padEnd(5, '0').slice(0, 5)}`);
  mkdirSync(base);
  try {
    const morto = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(join(base, 'pid'), morto);
    collegaCartella(join(r.lavoro, 'node_modules'), join(base, 'node_modules'));
    r.ok(['worktree', 'add', '--detach', '--quiet', join(base, 'fusione'), 'HEAD']);
    const punta = r.ok(['rev-parse', 'HEAD']);
    assert.equal(provaUnitSullaFusione({ root: r.lavoro, punta, scrivi: () => {} }).esito, 'main_contenuto');
    assert.ok(!existsSync(base), 'i resti sono stati tolti');
    pulita(r);
  } finally {
    togliCollegamento(join(base, 'node_modules'));
    rmSync(base, { recursive: true, force: true });
    rmSync(r.casa, { recursive: true, force: true });
  }
});

test('i resti di una prova interrotta li toglie la prova dopo, senza attraversare il collegamento; quelli di una viva no', () => {
  const r = repoFinto();
  const tmp = cartellaTemporanea('filo-929-tmp-');
  const resto = (nome, pid) => {
    const base = join(tmp, nome);
    mkdirSync(base);
    writeFileSync(join(base, 'pid'), String(pid));
    const dir = join(base, 'fusione');
    r.ok(['worktree', 'add', '--detach', '--quiet', dir, 'HEAD']);
    r.ok(['worktree', 'lock', '--reason', 'prova', dir]);
    collegaCartella(join(r.lavoro, 'node_modules'), join(dir, 'node_modules'));
    return base;
  };
  try {
    const morta = resto('filo-fusione-mort01', 4242);
    const viva = resto('filo-fusione-viva01', 4343);
    const tolte = pulisciResti({ git: r.g, tmp, vivo: (pid) => pid === 4343 });
    assert.deepEqual(tolte, [morta]);
    assert.ok(!existsSync(morta));
    assert.ok(existsSync(join(viva, 'fusione', 'node_modules')), 'una prova viva non si tocca');
    assert.equal(readFileSync(join(r.lavoro, 'node_modules', 'sentinella.txt'), 'utf8'), 'resta');
    assert.deepEqual(pulisciResti({ git: r.g, tmp, vivo: () => false }), [viva]);
    pulita(r);
  } finally {
    rmSync(r.casa, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── Clone poco profondo (#958): le routine in cloud lavorano su cloni tagliati ─

test('clone poco profondo: la prova scarica la storia che manca e gira davvero sulla fusione', () => {
  const r = repoFinto();
  const clone = join(r.casa, 'clone');
  try {
    r.ramo('claude/lungo', () => r.scrivi('ramo-1.txt', '1\n'));
    for (let i = 2; i <= 4; i++) { r.scrivi(`ramo-${i}.txt`, `${i}\n`); r.ok(['add', '-A']); r.ok(['commit', '-qm', `ramo ${i}`]); }
    r.ok(['push', '-q', 'origin', 'claude/lungo']);
    r.suMain(() => r.scrivi('altro.txt', 'y\n'));
    // Il clone di una routine: un commit solo, il ramo e nient'altro.
    execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'claude/lungo', pathToFileURL(join(r.casa, 'origin.git')).href, clone]);
    const g = gitIn(clone);
    assert.equal(g(['rev-parse', '--is-shallow-repository']).out, 'true');
    const punta = g(['rev-parse', 'HEAD']).out;
    const p = provaUnitSullaFusione({ root: clone, punta, scrivi: () => {} });
    assert.equal(p.esito, 'verde', `la prova deve girare, non fallire per la storia tagliata: ${JSON.stringify(p)}`);
    assert.equal(p.mainSha, g(['rev-parse', 'origin/main']).out);
    assert.equal(p.storia.superficiale, true);
    assert.ok(p.storia.approfondito > 0, 'la storia scaricata si misura');
    const campo = campoPerIlServer(p);
    assert.equal(campo.storia.superficiale, true, 'la profondità del clone arriva al server');
    assert.equal(campo.storia.approfondito, p.storia.approfondito);
  } finally {
    rmSync(r.casa, { recursive: true, force: true });
  }
});

test('clone poco profondo: un ramo che contiene già main si riconosce solo dopo aver scaricato la storia', () => {
  const r = repoFinto();
  const clone = join(r.casa, 'clone');
  try {
    r.ramo('claude/dentro', () => r.scrivi('ramo-1.txt', '1\n'));
    for (let i = 2; i <= 3; i++) { r.scrivi(`ramo-${i}.txt`, `${i}\n`); r.ok(['add', '-A']); r.ok(['commit', '-qm', `ramo ${i}`]); }
    r.ok(['push', '-q', 'origin', 'claude/dentro']);
    execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'claude/dentro', pathToFileURL(join(r.casa, 'origin.git')).href, clone]);
    const punta = gitIn(clone)(['rev-parse', 'HEAD']).out;
    const p = provaUnitSullaFusione({ root: clone, punta, scrivi: () => {}, lancia: () => assert.fail('main è già dentro: niente unit') });
    assert.equal(p.esito, 'main_contenuto', JSON.stringify(p));
  } finally {
    rmSync(r.casa, { recursive: true, force: true });
  }
});

test('storia: si scarica a passi, poi tutta; un clone intero non si tocca; senza base comune è un errore col motivo', () => {
  const finto = ({ superficiale = true, baseDopo = Infinity, fetchRotto = false } = {}) => {
    const fatti = [];
    let sup = superficiale;
    let passi = 0;
    const git = (args) => {
      fatti.push(args.join(' '));
      if (args[0] === 'rev-parse') return { ok: true, out: String(sup) };
      if (args[0] === 'merge-base') return { ok: passi >= baseDopo, out: '' };
      if (args[0] === 'fetch') {
        if (fetchRotto) return { ok: false, out: 'fatal: rete giù' };
        passi += 1;
        if (args.includes('--unshallow')) sup = false;
        return { ok: true, out: '' };
      }
      return { ok: false, out: '?' };
    };
    return { git, fatti };
  };
  const intero = finto({ superficiale: false });
  assert.deepEqual(assicuraStoria({ git: intero.git, mainSha: SHA, punta: SHA }), { storia: { superficiale: false } });
  assert.ok(!intero.fatti.some((f) => f.startsWith('fetch')), 'un clone intero non scarica niente');

  const giaBase = finto({ baseDopo: 0 });
  assert.deepEqual(assicuraStoria({ git: giaBase.git, mainSha: SHA, punta: SHA }).storia, { superficiale: true, approfondito: 0, intera: false });

  const secondo = finto({ baseDopo: 2 });
  const s2 = assicuraStoria({ git: secondo.git, mainSha: SHA, punta: SHA, passi: [5, 20, 100] });
  assert.deepEqual(s2.storia, { superficiale: true, approfondito: 25, intera: false });
  assert.ok(secondo.fatti.includes('fetch --quiet --deepen=20 origin +refs/heads/main:refs/remotes/origin/main'));

  const tutta = finto({ baseDopo: 4 });
  const s3 = assicuraStoria({ git: tutta.git, mainSha: SHA, punta: SHA, passi: [5, 20, 100] });
  assert.equal(s3.storia.intera, true);
  assert.ok(!s3.errore);
  assert.match(testoStoria(s3.storia), /storia intera/);

  const mai = finto({ baseDopo: Infinity });
  assert.match(assicuraStoria({ git: mai.git, mainSha: SHA, punta: SHA, passi: [5] }).errore, /nessuna base comune|non hanno una base comune/);

  const rotto = finto({ fetchRotto: true });
  assert.match(assicuraStoria({ git: rotto.git, mainSha: SHA, punta: SHA }).errore, /storia che manca \(fatal: rete giù\)/);
  assert.deepEqual(campoPerIlServer({ errore: 'x', storia: { superficiale: true, approfondito: 50, intera: false } }),
    { esito: 'non_provata', motivo: 'x', storia: { superficiale: true, approfondito: 50, intera: false } });
});

test('clone del solo ramo: il primo download di main ha il tetto della storia, e se fallisce la misura arriva lo stesso', () => {
  const r = repoFinto();
  const clone = join(r.casa, 'clone');
  try {
    r.ramo('claude/corto', () => r.scrivi('ramo-1.txt', '1\n'));
    r.ok(['push', '-q', 'origin', 'claude/corto']);
    r.suMain(() => r.scrivi('altro.txt', 'y\n'));
    execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'claude/corto', pathToFileURL(join(r.casa, 'origin.git')).href, clone]);
    const vero = gitIn(clone);
    const punta = vero(['rev-parse', 'HEAD']).out;
    // Il git col tetto corto «scade» su ogni download senza limite di profondità da un clone tagliato: è il caso
    // del repo vero con una rete lenta, dove la storia di main arriva tutta col primo download.
    const corto = (args) => {
      const limitato = args.some((a) => /^--(depth|deepen|shallow-)/.test(a));
      if (args[0] === 'fetch' && !limitato && vero(['rev-parse', '--is-shallow-repository']).out === 'true') return { ok: false, out: 'spawnSync git ETIMEDOUT' };
      return vero(args);
    };
    const p = provaUnitSullaFusione({ root: clone, punta, git: corto, gitStoria: vero, scrivi: () => {} });
    assert.equal(p.esito, 'verde', JSON.stringify(p));

    const senzaRete = provaUnitSullaFusione({ root: clone, punta, gitStoria: (args) => (args[0] === 'fetch' ? { ok: false, out: 'fatal: rete giù' } : vero(args)), scrivi: () => {} });
    assert.match(senzaRete.errore, /non riesco a scaricare main/);
    assert.equal(campoPerIlServer(senzaRete).storia.superficiale, true, 'il registro sa che il clone era poco profondo');
  } finally {
    rmSync(r.casa, { recursive: true, force: true });
  }
});

test('storia: un approfondimento arrivato alla radice si registra come storia intera', () => {
  let sup = true;
  let passi = 0;
  const fatti = [];
  const git = (args) => {
    fatti.push(args.join(' '));
    if (args[0] === 'rev-parse') return { ok: true, out: String(sup) };
    if (args[0] === 'merge-base') return { ok: passi >= 2, out: '' };
    if (args[0] === 'fetch') { passi += 1; if (passi === 2) sup = false; return { ok: true, out: '' }; }
    return { ok: false, out: '?' };
  };
  const s = assicuraStoria({ git, mainSha: SHA, punta: SHA, passi: [5, 20, 100] });
  assert.deepEqual(s.storia, { superficiale: true, approfondito: 25, intera: true });
  assert.ok(!fatti.some((f) => f.includes('--unshallow')), 'la storia è già tutta: niente altri download');
  assert.match(testoStoria(s.storia), /storia intera/);
});

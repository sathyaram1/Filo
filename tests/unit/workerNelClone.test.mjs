// Il worker di un giro lavora in un clone suo: la cartella da cui la sessione dell'orchestratore legge impostazioni,
// agenti e ganci resta su main e intatta (#1182). Giro vero contro un server finto, in cartelle usa-e-getta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { pinTools, pinnedDirWorker } from '../../scripts/lib/tools-pin.mjs';
import { MARCA_GIRO, accendi, cloneDelGiro, preparaIntestazione } from '../../scripts/lib/worker-nel-clone.mjs';
import { MARCATORE_WORKER } from '../../scripts/lib/dati-worker.mjs';
import { cartelleTranscript } from '../../scripts/session-report.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIGLIETTO = 'Biglietto_di_prova_per_il_clone_1182xyzABCD';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fintoServer(lavoro, consegne) {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let b = {};
      try { b = JSON.parse(body || '{}'); } catch (_) { /* non JSON */ }
      consegne.push({ url: req.url, body: b });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/routineWork')) res.end(JSON.stringify(lavoro));
      else if (req.url.includes('config')) res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

/** La cartella della sessione (su main, con origin e node_modules) e gli strumenti fissati dal preflight per lei. */
function scena({ acceso = true } = {}) {
  const base = cartellaTemporanea('filo-worker-clone-');
  const origin = resolve(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
  const sessione = resolve(base, 'sessione');
  execFileSync('git', ['clone', '-q', origin, sessione], { stdio: 'ignore' });
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['core.autocrlf', 'false']]) git(sessione, 'config', k, v);
  writeFileSync(resolve(sessione, '.gitignore'), readFileSync(resolve(REPO, '.gitignore'), 'utf8'), 'utf8');
  writeFileSync(resolve(sessione, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
  mkdirSync(resolve(sessione, '.claude'), { recursive: true });
  writeFileSync(resolve(sessione, '.claude', 'settings.local.json'), '{}\n', 'utf8');
  git(sessione, 'add', '-A');
  git(sessione, 'commit', '-qm', 'base');
  git(sessione, 'push', '-q', 'origin', 'main');
  git(sessione, 'branch', 'worker/1182');
  git(sessione, 'push', '-q', 'origin', 'worker/1182');
  mkdirSync(resolve(sessione, 'node_modules', 'pacchetto'), { recursive: true });
  const strumenti = resolve(base, 'strumenti');
  const pin = pinTools(sessione, { dest: strumenti, da: REPO });
  assert.equal(pin.ok, true, pin.why);
  if (acceso) assert.equal(accendi(strumenti).ok, true);
  return { base, sessione, strumenti, lavori: resolve(base, 'lavori') };
}

function lancia(s, script, args, port) {
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [resolve(s.strumenti, 'scripts', script), ...args], {
      cwd: s.sessione,
      env: {
        ...process.env,
        FILO_ROUTINE: '1',
        FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
        FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
        FILO_ROUTINES_ENABLED: '1',
        FILO_FEEDBACK_PRIVKEY: '',
        FILO_NO_BEAT: '1',
        FILO_TOOLS_DIR: s.strumenti,
        FILO_CLONI_DIR: s.lavori,
        FILO_DISPATCH_STATE_DIR: resolve(s.base, 'stato'),
        FILO_REPO_ROOT: '',
        FILO_TOOLS_ROOT: '',
        FILO_ROUTINE_TICKET: '',
      },
    });
    let so = ''; let se = '';
    p.stdout.on('data', (c) => { so += c; });
    p.stderr.on('data', (c) => { se += c; });
    p.on('close', (status) => risolvi({ status, so, se }));
  });
}

const LAVORO = {
  ok: true, role: 'fixer', id: 'fid-1182', num: '#1182', branch: 'worker/1182',
  payload: { role: 'fixer', feedback: { name: 'x', text: 'y', num: '#1182' }, loopCount: 1 },
};

test('il worker parte nel suo clone, sul ramo del lavoro; la cartella della sessione resta su main e senza promemoria', async () => {
  const s = scena();
  const consegne = [];
  const { srv, port } = await fintoServer(LAVORO, consegne);
  try {
    const r = await lancia(s, 'dispatch.mjs', ['--ticket', BIGLIETTO], port);
    assert.equal(r.status, 0, r.se);
    const json = JSON.parse(r.so.slice(r.so.indexOf('{'), r.so.lastIndexOf('}') + 1));
    const clone = resolve(s.lavori, '1');
    assert.equal(json.role, 'fixer');
    assert.ok(json.instructions.startsWith('## La tua cartella'), json.instructions.slice(0, 200));
    assert.ok(json.instructions.includes(`cd "${clone}" && …`));
    // Le ricette del ruolo puntano agli strumenti del clone: le consegne del worker finiscono lì.
    assert.ok(json.instructions.includes(pinnedDirWorker(1, s.strumenti)), 'ricette dagli strumenti del clone');
    assert.equal(git(clone, 'branch', '--show-current'), 'worker/1182');
    assert.equal(JSON.parse(readFileSync(resolve(clone, '.claude', 'routine-ticket.json'), 'utf8')).ticket, BIGLIETTO);
    assert.equal(git(s.sessione, 'branch', '--show-current'), 'main');
    assert.equal(existsSync(resolve(s.sessione, '.claude', 'routine-ticket.json')), false);
    assert.equal(git(s.sessione, 'status', '--porcelain'), '');

    // L'orchestratore rilascia il worker morto con i SUOI strumenti: il rilascio va nel clone e salva quello che c'è.
    writeFileSync(resolve(clone, 'nato-da-shell.txt'), 'lavoro\n', 'utf8');
    const rel = await lancia(s, 'routine-channel.mjs', ['release', BIGLIETTO, '--role', 'orchestrator', '--senza-rapporto'], port);
    assert.equal(rel.status, 0, rel.se);
    assert.match(rel.so, /OK: biglietto rilasciato/);
    assert.equal(git(clone, 'status', '--porcelain'), '');
    assert.ok(git(clone, 'ls-remote', 'origin', 'refs/heads/worker/1182').startsWith(git(clone, 'rev-parse', 'HEAD')));
    assert.ok(consegne.some((c) => c.url.endsWith('/routineRelease')), 'il rilascio arriva al server');
    assert.equal(git(s.sessione, 'status', '--porcelain'), '');
  } finally {
    srv.close();
    togliCartella(s.base);
  }
});

test('un clone che non si prepara ferma il worker: nella cartella della sessione non si lavora mai', async () => {
  const s = scena();
  // Al posto del clone c'è una cartella che non è un clone di worker: preparaClone non la tocca.
  mkdirSync(resolve(s.lavori, '1'), { recursive: true });
  writeFileSync(resolve(s.lavori, '1', 'altro.txt'), 'x\n', 'utf8');
  const consegne = [];
  const { srv, port } = await fintoServer(LAVORO, consegne);
  try {
    const r = await lancia(s, 'dispatch.mjs', ['--ticket', BIGLIETTO], port);
    assert.equal(r.status, 1);
    assert.match(r.se, /clone del worker non è pronto/);
    assert.equal(consegne.filter((c) => c.url.endsWith('/routineWork')).length, 0, 'nessun lavoro preso');
    assert.equal(git(s.sessione, 'branch', '--show-current'), 'main');
    assert.equal(existsSync(resolve(s.sessione, '.claude', 'routine-ticket.json')), false);
  } finally {
    srv.close();
    togliCartella(s.base);
  }
});

test('il clone del giro vale solo per la cartella per cui il preflight ha fissato e acceso gli strumenti', () => {
  const s = scena({ acceso: false });
  try {
    assert.equal(cloneDelGiro(s.sessione, { toolsDir: s.strumenti }), null, 'spento: fuori dal cloud resta tutto com\'era');
    accendi(s.strumenti);
    assert.deepEqual(cloneDelGiro(s.sessione, { toolsDir: s.strumenti }), { indice: 1, toolsDir: s.strumenti });
    assert.equal(cloneDelGiro(s.base, { toolsDir: s.strumenti }), null, 'altra cartella');
    // Il clone stesso non rimanda a un altro clone.
    mkdirSync(resolve(s.base, 'c', '.claude'), { recursive: true });
    writeFileSync(resolve(s.base, 'c', MARCATORE_WORKER), JSON.stringify({ indice: 1, principale: s.sessione }), 'utf8');
    assert.equal(cloneDelGiro(resolve(s.base, 'c'), { toolsDir: s.strumenti }), null);
    // Un preflight nuovo rifissa gli strumenti da capo: il clone si riaccende solo se lo dice lui.
    pinTools(s.sessione, { dest: s.strumenti, da: REPO });
    assert.equal(existsSync(resolve(s.strumenti, MARCA_GIRO)), false);
  } finally {
    togliCartella(s.base);
  }
});

test('nel clone: pacchetti collegati anche con un lock diverso, e il worker sa dove lavora e come allinearli', () => {
  const s = scena();
  try {
    const clone = resolve(s.base, 'c');
    mkdirSync(resolve(clone, '.claude'), { recursive: true });
    writeFileSync(resolve(clone, MARCATORE_WORKER), JSON.stringify({ indice: 1, principale: s.sessione }), 'utf8');
    writeFileSync(resolve(clone, 'package-lock.json'), '{"lockfileVersion":3,"diverso":true}\n', 'utf8');
    const chiamate = [];
    const testo = preparaIntestazione(clone, { allinea: (...a) => { chiamate.push(a); return { ok: true, pacchetti: 'collegati', lockDiverso: true }; } });
    assert.deepEqual(chiamate, [[clone, s.sessione, { soloCollegati: true }]]);
    assert.match(testo, /un clone tuo del progetto/);
    assert.match(testo, /npm ci/);
    assert.equal(preparaIntestazione(s.sessione), '', 'fuori da un clone nessuna intestazione');
    // Il rapporto di fine sessione cerca i transcript anche nella cartella della sessione.
    const cartelle = cartelleTranscript({ cwd: clone, configDir: resolve(s.base, 'cfg'), env: {} });
    assert.ok(cartelle.some((c) => c.endsWith(s.sessione.replace(/[^A-Za-z0-9]/g, '-'))), cartelle.join('\n'));
  } finally {
    togliCartella(s.base);
  }
});

test('fra un worker e l\'altro la cartella della sessione perde i file nuovi in .claude, non i marcatori ignorati', async () => {
  const s = scena();
  try {
    writeFileSync(resolve(s.sessione, '.claude', 'settings.json'), '{"disableAllHooks":true}\n', 'utf8');
    mkdirSync(resolve(s.sessione, '.claude', 'agents'), { recursive: true });
    writeFileSync(resolve(s.sessione, '.claude', 'agents', 'mio.md'), 'x\n', 'utf8');
    writeFileSync(resolve(s.sessione, '.claude', 'settings.local.json'), '{"disableAllHooks":true}\n', 'utf8');
    writeFileSync(resolve(s.sessione, '.claude', 'routine-role.json'), '{}\n', 'utf8');
    const r = await lancia(s, 'dispatch.mjs', ['--linea-principale'], 1);
    assert.equal(r.status, 0, r.se);
    assert.equal(existsSync(resolve(s.sessione, '.claude', 'settings.json')), false);
    assert.equal(existsSync(resolve(s.sessione, '.claude', 'agents', 'mio.md')), false);
    assert.equal(readFileSync(resolve(s.sessione, '.claude', 'settings.local.json'), 'utf8'), '{}\n');
    assert.equal(existsSync(resolve(s.sessione, '.claude', 'routine-role.json')), true);
  } finally {
    togliCartella(s.base);
  }
});

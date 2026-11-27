// Dopo una presa in carico rifiutata dispatch non consegna un ruolo che lo stato vero non regge (#2674); la ripresa di
// un lavoro in verifica sì, col suo stato nel payload. Giro vero col biglietto contro un server finto; cartelle usa-e-getta.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { esitoDellaPresa } from '../../scripts/dispatch.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ID = 'fid-2674';
const RAMO = `worker/${ID}-20261125T201740Z`;
const BIGLIETTO = 'biglietto-di-prova';
const RIPRESA = { motivo: 'locale', ruolo: 'resolver', at: '2026-11-25T20:17:40.000Z', domanda: 'Ripresa fermata prima del biglietto: il ramo è 323 commit dietro main.', risposta: '', rilievi: [] };

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(cwd, file, body) {
  writeFileSync(resolve(cwd, file), body, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', `add ${file}`);
}

/** Il server finto: consegna il lavoro `busta` e rifiuta la presa in carico dallo stato `da`, come applyStatus. */
function fintoServer({ busta, da }) {
  const consegne = [];
  const srv = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('config')) return res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      if (req.url.endsWith('/routineWork')) return res.end(JSON.stringify({ ok: true, id: ID, num: '#1905.1', ...busta }));
      if (req.url.endsWith('/routineDeliver')) {
        const { data = {} } = JSON.parse(corpo || '{}');
        consegne.push(data.status);
        if (data.status === 'working' && da !== 'todo') {
          res.statusCode = 409;
          return res.end(JSON.stringify({ ok: false, reason: 'illegal_transition', detail: `${da} → working` }));
        }
      }
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, consegne, port: srv.address().port })));
}

/** Una casa col ramo del lavoro già su origin, come per chi riprende. */
function scena(base) {
  const origin = resolve(base, 'origin.git');
  const casa = resolve(base, 'casa');
  mkdirSync(casa, { recursive: true });
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(casa, 'init', '-q', '-b', 'main');
  cpSync(resolve(REPO, 'routines', 'roles'), resolve(casa, 'routines', 'roles'), { recursive: true });
  writeFileSync(resolve(casa, '.gitignore'),
    '.claude/routine-ticket.json\n.claude/routine-beat.json\n.claude/routine-state/\n.claude/branch-expect.json\n.claude/routine-role.json\n', 'utf8');
  commit(casa, 'segnaposto.txt', 'x\n');
  git(casa, 'remote', 'add', 'origin', origin);
  git(casa, 'push', '-q', '-u', 'origin', 'main');
  git(casa, 'checkout', '-q', '-b', RAMO);
  commit(casa, 'lavoro.js', 'fatto a metà\n');
  git(casa, 'push', '-q', 'origin', RAMO);
  git(casa, 'checkout', '-q', 'main');
  return casa;
}

function giro(casa, port) {
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), '--ticket', BIGLIETTO], {
      cwd: casa,
      env: {
        ...process.env,
        FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
        FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
        FILO_REPO_ROOT: casa,
        FILO_TOOLS_ROOT: casa,
        FILO_DISPATCH_STATE_DIR: resolve(casa, '..', 'stato'),
        FILO_ROUTINES_ENABLED: '1',
        FILO_FEEDBACK_PRIVKEY: '',
        FILO_NO_BEAT: '1',
      },
    });
    let so = ''; let se = '';
    p.stdout.on('data', (c) => { so += c; });
    p.stderr.on('data', (c) => { se += c; });
    p.on('close', (code) => {
      let json = null;
      try { json = JSON.parse(so.slice(so.indexOf('{'), so.lastIndexOf('}') + 1)); } catch (_) { /* lo dice l'assert */ }
      risolvi({ code, json, so, se });
    });
  });
}

async function conServer(busta, da, prova) {
  const base = cartellaTemporanea('filo-presa-rifiutata-');
  const { srv, consegne, port } = await fintoServer({ busta, da });
  try {
    await prova(await giro(scena(base), port), consegne);
  } finally {
    srv.close();
    togliCartella(base);
  }
}

const bustaRipresa = { role: 'fixer', branch: RAMO, payload: { role: 'fixer', num: '#1905.1', ripresa: RIPRESA, feedback: { name: 'Il lavoro', text: 'Testo.', num: '#1905.1' } } };

test('ripresa di un lavoro in verifica: il resolver riceve il lavoro con lo stato vero, senza un rifiuto stampato', async () => {
  await conServer(bustaRipresa, 'revision_capability', async (r, consegne) => {
    assert.equal(r.json && r.json.role, 'fixer', `il resolver lavora (uscita ${r.code}): ${r.se}`);
    assert.equal(r.code, 0);
    const istruzioni = r.json.istruzioniFile ? '' : r.json.instructions;
    assert.equal(r.json.payload.ripresa.statoDelFeedback, 'revision_capability');
    assert.equal(r.json.payload.ripresa.domanda, RIPRESA.domanda, 'il resto della ripresa resta quello del server');
    assert.doesNotMatch(r.se, /RIFIUTATA/, 'il rifiuto atteso non si presenta come una decisione persa');
    assert.match(r.se, /ripresa di un lavoro in verifica \(revision_capability\)/);
    if (istruzioni) assert.match(istruzioni, /statoDelFeedback/);
    assert.deepEqual(consegne, ['working']);
  });
});

test('presa rifiutata da uno stato che il ruolo non regge: niente lavoratore, un guasto col motivo del server', async () => {
  await conServer(bustaRipresa, 'done', async (r, consegne) => {
    assert.equal(r.json && r.json.role, 'halt', `nessun resolver su un feedback chiuso: ${r.so.slice(0, 300)}`);
    assert.equal(r.code, 3);
    assert.equal(r.json.payload.kind, 'transient');
    assert.match(r.json.payload.message, /illegal_transition: done → working/);
    assert.doesNotMatch(r.json.payload.message, /["`$\\]/, 'si ricopia dentro le virgolette di --guasto');
    assert.ok(r.json.instructions.includes('--role halt --guasto'), 'il testo è quello del guasto');
    assert.deepEqual(consegne, ['working'], 'dopo il rifiuto non parte nessun\'altra consegna');
  });
});

test('primo lavoro con la presa rifiutata: niente lavoratore', async () => {
  const busta = { role: 'new-work', branch: '', payload: { role: 'new-work', num: '#1905.1', feedback: { name: 'Il lavoro', text: 'Testo.', num: '#1905.1' } } };
  await conServer(busta, 'revision_capability', async (r) => {
    assert.equal(r.json && r.json.role, 'halt', `un primo lavoro su un feedback in verifica non parte: ${r.so.slice(0, 300)}`);
    assert.match(r.json.payload.message, /revision_capability → working/);
  });
});

test('esitoDellaPresa: lavora solo con la presa accettata, o con la ripresa di un lavoro in verifica', () => {
  const no = (reason, detail) => ({ outcome: 'refused', reason, detail });
  assert.deepEqual(esitoDellaPresa({ outcome: 'ok' }), { azione: 'lavora' });
  assert.deepEqual(esitoDellaPresa({ outcome: 'fault', reason: 'rete' }), { azione: 'lavora' }, 'server giù: la consegna lo dirà');
  assert.deepEqual(esitoDellaPresa(no('illegal_transition', 'revision_security → working'), { ripresa: true }), { azione: 'lavora', statoVero: 'revision_security' });
  assert.equal(esitoDellaPresa(no('illegal_transition', 'revision_capability → working')).azione, 'ferma', 'senza ripresa no');
  assert.equal(esitoDellaPresa(no('illegal_transition', 'archived → working'), { ripresa: true }).azione, 'ferma');
  assert.equal(esitoDellaPresa(no('dead_ticket', ''), { ripresa: true }).azione, 'ferma');
  assert.match(esitoDellaPresa(no('branch_mismatch', 'a ≠ b'), { branch: 'a' }).messaggio, /legato questo biglietto a un altro ramo.*su a/);
});

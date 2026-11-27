// Verifica #2674 giro 1: la ripresa di un lavoro in verifica riceve il correttore e la sua consegna parte davvero; uno
// stato che il ruolo non regge non consegna nessun ruolo. dispatch vero contro un server finto, cartelle usa-e-getta.
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ID = 'fid-v2674';
const RAMO = `worker/${ID}-20261125T201740Z`;
const RIPRESA = { motivo: 'locale', ruolo: 'resolver', at: '2026-11-25T20:17:40.000Z', domanda: 'Ripresa fermata prima del biglietto: il ramo è 323 commit dietro main. Sblocca con una nota, rifallo da capo o archivialo.', risposta: '', rilievi: [] };
const BUSTA = { role: 'fixer', branch: RAMO, payload: { role: 'fixer', num: '#1905.1', ripresa: RIPRESA, feedback: { name: 'Il lavoro', text: 'Testo.', num: '#1905.1' } } };

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(cwd, file, body) {
  writeFileSync(resolve(cwd, file), body, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', `add ${file}`);
}

function server(stato) {
  const consegne = [];
  const srv = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('config')) return res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      if (req.url.endsWith('/routineWork')) return res.end(JSON.stringify({ ok: true, id: ID, num: '#1905.1', ...BUSTA }));
      if (req.url.endsWith('/routineDeliver')) {
        const b = JSON.parse(corpo || '{}');
        consegne.push(b.intent === 'status' ? `status:${b.data && b.data.status}` : b.intent);
        if (b.intent === 'status' && b.data && b.data.status === 'working' && stato !== 'todo') {
          res.statusCode = 409;
          return res.end(JSON.stringify({ ok: false, reason: 'illegal_transition', detail: `${stato} → working` }));
        }
      }
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, consegne, port: srv.address().port })));
}

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

function dispatch(casa, port, args) {
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), ...args], {
      cwd: casa,
      env: {
        ...process.env,
        FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
        FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
        FILO_REPO_ROOT: casa, FILO_TOOLS_ROOT: casa,
        FILO_DISPATCH_STATE_DIR: resolve(casa, '..', 'stato'),
        FILO_ROUTINES_ENABLED: '1', FILO_FEEDBACK_PRIVKEY: '', FILO_NO_BEAT: '1',
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

async function conScena(stato, prova) {
  const base = cartellaTemporanea('filo-v2674-');
  const { srv, consegne, port } = await server(stato);
  try { await prova(scena(base), port, consegne); } finally { srv.close(); togliCartella(base); }
}

test('ripresa su un lavoro in verifica: il correttore riceve il lavoro e la sua consegna arriva al server', async () => {
  await conScena('revision_capability', async (casa, port, consegne) => {
    const r = await dispatch(casa, port, ['--ticket', 'biglietto-di-verifica']);
    expect(r.json && r.json.role, r.se).toBe('fixer');
    expect(r.se).not.toMatch(/RIFIUTATA/);
    expect(r.json.payload.ripresa.statoDelFeedback).toBe('revision_capability');
    expect(git(casa, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(RAMO);
    commit(casa, 'lavoro.js', 'finito\n');
    const f = await dispatch(casa, port, ['--record-fixed', ID, 'Ripreso il lavoro sul ramo com\'è, dopo lo sblocco del ramo vecchio: finito il pezzo che mancava e lasciato il resto.', '--frase', 'Sistemato.', '--motivo', 'ripresa', '--ticket', 'biglietto-di-verifica']);
    expect(consegne, `${f.code} ${f.se}`).toContain('fixed');
    expect(f.code, f.se).toBe(0);
  });
});

test('ripresa su un feedback fermo per una domanda: nessun correttore, il motivo del server nel guasto', async () => {
  await conScena('design', async (casa, port, consegne) => {
    const r = await dispatch(casa, port, ['--ticket', 'biglietto-di-verifica']);
    expect(r.json && r.json.role, r.so.slice(0, 300)).toBe('halt');
    expect(r.json.payload.message).toMatch(/design → working/);
    expect(consegne).toEqual(['status:working']);
  });
});

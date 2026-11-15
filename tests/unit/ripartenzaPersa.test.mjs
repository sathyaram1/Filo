// Un lavoro nuovo che riparte da una fermata riceve il ramo a cui il feedback era legato (payload.ramoLegato): ci riparte,
// e se su origin non c'è più lo dice a chi lavora e al server invece di partire zitto da main (#2516).
// Repo usa-e-getta con un origin nudo; il giro vero di dispatch parla con un server finto.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { ramoLegatoDaRiprendere } from '../../scripts/lib/branch-integrity.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ID = 'fid-2516';
const BIGLIETTO = 'biglietto-di-prova';
const LEGATO = `worker/${ID}-20261107T120000Z`;

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(cwd, file, body) {
  writeFileSync(resolve(cwd, file), body, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', `add ${file}`);
  return git(cwd, 'rev-parse', 'HEAD');
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
  const main = commit(casa, 'segnaposto.txt', 'x\n');
  git(casa, 'remote', 'add', 'origin', origin);
  git(casa, 'push', '-q', '-u', 'origin', 'main');
  return { origin, casa, main };
}

/** Un ramo spinto su origin con `n` commit propri da main. */
function ramoSpinto(casa, nome, n) {
  git(casa, 'checkout', '-q', '-B', nome, 'main');
  let head = '';
  for (let i = 0; i < n; i += 1) head = commit(casa, `parte-${i}.js`, `A${i + 1}\n`);
  git(casa, 'push', '-q', '-f', 'origin', `${nome}:refs/heads/${nome}`);
  git(casa, 'checkout', '-q', 'main');
  return head;
}

/** Il server di oggi per un lavoro nuovo ripartito: busta senza ramo, col ramo legato al feedback nel payload. */
function fintoServer({ ramoLegato = '' } = {}) {
  const mondo = { consegne: [] };
  const srv = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('config')) return res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      if (req.url.endsWith('/routineWork')) {
        return res.end(JSON.stringify({
          ok: true, role: 'new-work', id: ID, num: '#2516', branch: '',
          payload: {
            role: 'new-work', num: '#2516', feedback: { name: 'Il ramo', text: 'Riparte dal ramo.', num: '#2516' },
            piano: 'A1-A4 fatte sul ramo.', ...(ramoLegato ? { ramoLegato } : {}),
          },
        }));
      }
      if (req.url.endsWith('/routineDeliver')) {
        const { intent, data = {} } = JSON.parse(corpo || '{}');
        mondo.consegne.push({ intent, ...data });
      }
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, mondo, port: srv.address().port })));
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

test('il ramo legato non c\'è più su origin: chi lavora e il server lo sanno, e si parte da main', async () => {
  const base = cartellaTemporanea('filo-ripartenza-persa-');
  const { srv, mondo, port } = await fintoServer({ ramoLegato: LEGATO });
  try {
    const { casa, main } = scena(base);
    const r = await giro(casa, port);
    assert.equal(r.json && r.json.role, 'new-work', `il giro lavora (uscita ${r.code}): ${r.se}`);
    assert.equal(git(casa, 'rev-parse', 'HEAD'), main, 'niente da riprendere: nasce da main');
    const persa = r.json.payload.ripartenzaPersa;
    assert.equal(persa && persa.ramo, LEGATO, 'chi lavora sa che il ramo del piano non c\'è');
    assert.match(persa.nota, /non c'è più su origin/);
    assert.match(persa.nota, /piano o la ripresa/);
    const presa = mondo.consegne.find((c) => c.intent === 'status' && c.status === 'working');
    assert.ok(presa, 'la presa in carico è arrivata');
    assert.equal(presa.ripartenzaPersa, LEGATO, 'il server lo sa dalla presa in carico');
    assert.equal(presa.notes, persa.nota, 'e la conversazione del feedback lo dice con la stessa frase');
  } finally { srv.close(); togliCartella(base); }
});

test('il ramo legato c\'è, anche con un nome che non è un tentativo: si riparte dalla sua punta', async () => {
  const base = cartellaTemporanea('filo-ripartenza-legato-');
  const legato = 'claude/sessione-2516';
  const { srv, mondo, port } = await fintoServer({ ramoLegato: legato });
  try {
    const { casa } = scena(base);
    const punta = ramoSpinto(casa, legato, 2);
    const r = await giro(casa, port);
    assert.equal(r.json && r.json.role, 'new-work', `il giro lavora (uscita ${r.code}): ${r.se}`);
    assert.equal(git(casa, 'rev-parse', 'HEAD'), punta, 'le parti già fatte ci sono');
    assert.deepEqual(r.json.payload.ripartenza, { ramo: legato, commit: 2 });
    assert.equal(r.json.payload.ripartenzaPersa, undefined);
    assert.equal(mondo.consegne.find((c) => c.status === 'working').ripartenzaPersa, undefined);
  } finally { srv.close(); togliCartella(base); }
});

test('ramoLegatoDaRiprendere: niente per main, nomi non validi o il ramo stesso; vuoto un ramo senza commit propri', () => {
  const base = cartellaTemporanea('filo-ramo-legato-');
  try {
    const { casa } = scena(base);
    for (const legato of ['', 'main', '-x', 'a..b', LEGATO]) {
      assert.deepEqual(ramoLegatoDaRiprendere({ root: casa, legato, escludi: LEGATO }), { ok: true, stato: 'nessuno', ramo: '' }, legato);
    }
    ramoSpinto(casa, 'worker/vuoto-20261101T000000Z', 0);
    assert.equal(ramoLegatoDaRiprendere({ root: casa, legato: 'worker/vuoto-20261101T000000Z' }).stato, 'vuoto');
    assert.equal(ramoLegatoDaRiprendere({ root: casa, legato: LEGATO }).stato, 'perso');
  } finally { togliCartella(base); }
});

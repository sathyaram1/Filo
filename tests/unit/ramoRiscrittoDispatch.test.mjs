// Dopo un riallineamento fatto altrove, il giro che riparte su questa macchina col vecchio stato locale si posiziona
// sulla punta pubblicata e lì mette il punto fermo: la critica si registra senza riportare indietro il ramo (#1486).
// Il giro vero (dispatch col biglietto) contro un server finto, in cartelle usa-e-getta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { lastCheckpoint } from '../../scripts/lib/branch-integrity.mjs';
import { codiceCambiatoDallAvvio } from '../../scripts/lib/codice-fermo.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ID = 'fid-1486';
const RAMO = 'worker/fid-1486-x';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(cwd, file, body) {
  writeFileSync(resolve(cwd, file), body, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', `add ${file}`);
  return git(cwd, 'rev-parse', 'HEAD');
}

function fintoServer(lavoro) {
  const srv = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/routineWork')) res.end(JSON.stringify(lavoro));
      else if (req.url.includes('config')) res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

/** Questa macchina ha il ramo e lo stato del giro prima; altrove il ramo viene rifatto su main e spinto forzando. */
function scena(base) {
  const origin = resolve(base, 'origin.git');
  const casa = resolve(base, 'casa');
  const altrove = resolve(base, 'altrove');
  const stato = resolve(base, 'stato');
  for (const d of [casa, altrove, stato]) mkdirSync(d, { recursive: true });
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(casa, 'init', '-q', '-b', 'main');
  cpSync(resolve(REPO, 'routines', 'roles'), resolve(casa, 'routines', 'roles'), { recursive: true });
  writeFileSync(resolve(casa, '.gitignore'),
    '.claude/routine-ticket.json\n.claude/routine-beat.json\n.claude/routine-state/\n.claude/branch-expect.json\n.claude/routine-role.json\n', 'utf8');
  commit(casa, 'segnaposto.txt', 'x\n');
  git(casa, 'remote', 'add', 'origin', origin);
  git(casa, 'push', '-q', '-u', 'origin', 'main');
  git(casa, 'checkout', '-q', '-b', RAMO);
  const vecchio = commit(casa, 'lavoro.js', 'giro 0\n');
  git(casa, 'push', '-q', 'origin', RAMO);
  writeFileSync(resolve(stato, `${ID}.json`), JSON.stringify({
    id: ID, branch: RAMO,
    checkpoints: [{ sha: vecchio, by: 'new-work:checkout', at: '2026-10-20T10:00:00.000Z' }],
  }), 'utf8');

  git(altrove, 'clone', '-q', origin, '.');
  commit(altrove, 'main-avanti.js', 'main\n');
  git(altrove, 'push', '-q', 'origin', 'main');
  git(altrove, 'checkout', '-q', '-b', RAMO, `origin/${RAMO}`);
  git(altrove, 'rebase', '-q', 'main');
  const nuovo = commit(altrove, 'giro1.js', 'correzioni del giro 1\n');
  git(altrove, 'push', '-q', '--force', 'origin', RAMO);
  return { casa, stato, vecchio, nuovo };
}

function giro(casa, stato, port) {
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), '--ticket', 'biglietto-di-prova'], {
      cwd: casa,
      env: {
        ...process.env,
        FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
        FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
        // Senza queste due il giro lavora sul deposito vero.
        FILO_REPO_ROOT: casa,
        FILO_DISPATCH_STATE_DIR: stato,
        FILO_ROUTINES_ENABLED: '1',
        FILO_FEEDBACK_PRIVKEY: '',
        FILO_NO_BEAT: '1',
      },
    });
    let so = ''; let se = '';
    p.stdout.on('data', (c) => { so += c; });
    p.stderr.on('data', (c) => { se += c; });
    p.on('close', (code) => risolvi({ code, so, se }));
  });
}

test('verifica dopo un riallineamento fatto altrove: punto fermo sulla punta pubblicata, niente codice «cambiato dall\'avvio»', async () => {
  const base = cartellaTemporanea('filo-riscritto-');
  const { srv, port } = await fintoServer({
    ok: true, role: 'verifier', id: ID, num: '#1486', branch: RAMO,
    payload: { role: 'verifier', feedback: { name: 'Il pulsante', text: 'Il pulsante non salva.', num: '#1486' } },
  });
  try {
    const { casa, stato, vecchio, nuovo } = scena(base);
    const r = await giro(casa, stato, port);
    const json = JSON.parse(r.so.slice(r.so.indexOf('{'), r.so.lastIndexOf('}') + 1) || 'null');
    assert.equal(json && json.role, 'verifier', `il giro doveva consegnare la verifica (uscita ${r.code}): ${r.se}`);
    assert.equal(git(casa, 'rev-parse', 'HEAD'), nuovo, 'la verifica parte dal ramo riallineato');
    const st = JSON.parse(readFileSync(resolve(stato, `${ID}.json`), 'utf8'));
    assert.equal(lastCheckpoint(st), nuovo, 'il punto fermo del checkout è la punta pubblicata');
    assert.deepEqual(st.checkpoints.map((c) => c.sha), [nuovo], 'i punti fermi della storia di prima se ne vanno');
    assert.deepEqual(codiceCambiatoDallAvvio(lastCheckpoint(st), casa).cambiati, [],
      'registrando adesso la critica non deve trovare codice cambiato dall\'avvio');
    assert.equal(git(casa, 'ls-remote', 'origin', `refs/heads/${RAMO}`).split(/\s+/)[0], nuovo, 'origin resta riallineato');
    assert.match(r.se, /riscritto/, 'il log dice perché il punto fermo locale è stato lasciato');
    assert.notEqual(vecchio, nuovo);
  } finally {
    srv.close();
    togliCartella(base);
  }
});

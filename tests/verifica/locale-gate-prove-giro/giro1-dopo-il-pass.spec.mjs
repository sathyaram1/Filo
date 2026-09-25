// Giro 1 — il lavoro con due via libera arriva alla fusione, e ogni rifiuto locale ha un rimedio che porta lì.
// Il canale vero non si tocca: un server finto registra le buste. I comandi dettati dai rifiuti si eseguono
// in una shell così come sono scritti, perché è così che li usa chi fa il controllo di sicurezza.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const DISPATCH = fileURLToPath(new URL('../../../scripts/dispatch.mjs', import.meta.url));
const GATE = fileURLToPath(new URL('../../../scripts/merge-gate.mjs', import.meta.url));
const ATTREZZI = fileURLToPath(new URL('../../..', import.meta.url));
const ID = 'ID700';
const RAMO = 'worker/700';

function fintoServer(rispostaFusione = { ok: true, result: 'merged', sha: 'f'.repeat(40) }) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* lo scoprono gli assert */ }
      const url = String(req.url || '');
      ricevuti.push({ url, body: j });
      res.setHeader('Content-Type', 'application/json');
      if (url.includes('routineMerge')) {
        res.statusCode = rispostaFusione.ok ? 200 : 403;
        res.end(JSON.stringify(rispostaFusione));
      } else {
        res.end(JSON.stringify({ ok: true, id: ID, num: '#700', reply: { outcome: 'pass' } }));
      }
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

// Un ramo di lavoro con una modifica di prodotto e una prova del giro, spedito su un origin.
function deposito(prefisso) {
  const dir = cartellaTemporanea(prefisso);
  const remoto = cartellaTemporanea(`${prefisso}remoto-`);
  const g = (args, cwd = dir) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare'], { cwd: remoto, stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q', '--initial-branch=main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(resolve(dir, 'a.txt'), 'base\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  g(['checkout', '-qb', RAMO]);
  writeFileSync(resolve(dir, 'a.txt'), 'la correzione\n', 'utf8');
  mkdirSync(resolve(dir, 'tests/verifica/700'), { recursive: true });
  writeFileSync(resolve(dir, 'tests/verifica/700/giro1-esterno.spec.mjs'), "test('rilievo uscito in un feedback suo', () => {});\n", 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'il lavoro']);
  g(['remote', 'add', 'origin', remoto]);
  g(['push', '-q', '--no-verify', 'origin', RAMO]);
  return { dir, remoto, g, punta: () => g(['rev-parse', 'HEAD']).trim() };
}

// Dopo il pass il verificatore toglie la prova del rilievo uscito dal giro: il commit dopo il verdetto.
function togliProvaDelGiro(g, dir) {
  rmSync(resolve(dir, 'tests/verifica/700/giro1-esterno.spec.mjs'));
  g(['add', '-A'], dir);
  g(['commit', '-qm', 'verifica giro 1: tolta la prova del rilievo esterno'], dir);
}

function ambiente(dir, fuori, port) {
  return {
    ...process.env,
    FILO_REPO_ROOT: dir,
    FILO_TOOLS_ROOT: ATTREZZI,
    FILO_DISPATCH_STATE_DIR: resolve(fuori, 'stato'),
    FILO_NO_BEAT: '1',
    FILO_ROUTINE_TICKET: 'biglietto-finto',
    FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  };
}

function seminaStato(fuori) {
  mkdirSync(resolve(fuori, 'stato'), { recursive: true });
  writeFileSync(resolve(fuori, 'stato', `${ID}.json`), JSON.stringify({ id: ID, branch: RAMO }, null, 2) + '\n', 'utf8');
}

function lancia(script, args, env, cwd) {
  return new Promise((r) => execFile(process.execPath, [script, ...args], { env, cwd },
    (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));
}

// Una riga di comando copiata dal rifiuto ed eseguita in una shell, come farebbe chi lo legge.
function shell(riga, env, cwd) {
  return new Promise((r) => execFile('bash', ['-c', riga], { env, cwd },
    (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));
}

const CRITICA = 'Provato il giro intero come lo vive chi consegna: la correzione fa quello che la segnalazione chiedeva, e sul cammino principale non ho trovato niente da correggere.';

async function verifica(env, dir) {
  const v = await lancia(DISPATCH, ['--record-verifier', ID, CRITICA], env, dir);
  expect(v.status, v.stderr + v.stdout).toBe(0);
}

async function sicurezza(env, dir, fuori) {
  const nota = resolve(fuori, 'nota.md');
  writeFileSync(nota, 'Letto il diff riga per riga: nessun comando di sistema, nessuna chiave, nessuna regola del database.', 'utf8');
  const s = await lancia(DISPATCH, ['--record-secaudit', ID, 'pass', '--nota', nota], env, dir);
  expect(s.status, s.stderr + s.stdout).toBe(0);
  return nota;
}

const fusioni = (ricevuti) => ricevuti.filter((r) => r.url.includes('routineMerge'));
const rigaCon = (testo, pezzo) => String(testo || '').split(/\r?\n/).map((r) => r.trim()).find((r) => r.includes(pezzo)) || '';

function nessunRientroInVerifica(testo) {
  expect(testo, 'nessun rifiuto deve più proporre al controllo di sicurezza di rimettere il lavoro in verifica')
    .not.toMatch(/revision_capability|rimett\w* (il lavoro )?in verifica/i);
}

test('la prova del giro tolta dopo il pass non ferma la fusione: la richiesta parte e dichiara la punta', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, g, punta } = deposito('filo-gate-g1-lamentela-');
  const fuori = cartellaTemporanea('filo-gate-g1-lamentela-fuori-');
  const env = ambiente(dir, fuori, port);
  seminaStato(fuori);
  try {
    await verifica(env, dir);
    const verificato = punta();
    togliProvaDelGiro(g, dir);
    g(['push', '-q', '--no-verify', 'origin', RAMO]);
    const tolta = punta();
    await sicurezza(env, dir, fuori);

    const r = await lancia(GATE, [RAMO], env, dir);
    expect(r.status, r.stderr).toBe(0);
    const f = fusioni(ricevuti);
    expect(f.length, 'la fusione va chiesta al server').toBe(1);
    expect(f[0].body.sha).toBe(tolta);
    expect(r.stderr, 'la nota dice che lo giudica il server').toContain(verificato.slice(0, 12));
    nessunRientroInVerifica(r.stderr + r.stdout);
  } finally {
    srv.close();
  }
});

test('controllo di sicurezza dato prima della prova tolta: il rimedio dettato, eseguito com\'è scritto, porta alla fusione', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, g, punta } = deposito('filo-gate-g1-rimedio-');
  const fuori = cartellaTemporanea('filo-gate-g1-rimedio-fuori-');
  const env = ambiente(dir, fuori, port);
  seminaStato(fuori);
  try {
    await verifica(env, dir);
    const nota = await sicurezza(env, dir, fuori);
    const controllato = punta();
    togliProvaDelGiro(g, dir);
    g(['push', '-q', '--no-verify', 'origin', RAMO]);
    const tolta = punta();

    const primo = await lancia(GATE, [RAMO], env, dir);
    expect(primo.status).toBe(1);
    expect(fusioni(ricevuti).length, 'con righe mai lette dal controllo di sicurezza la fusione non si chiede').toBe(0);
    nessunRientroInVerifica(primo.stderr + primo.stdout);

    const diff = rigaCon(primo.stderr, 'git diff ');
    expect(diff, primo.stderr).toContain(controllato.slice(0, 12));
    const letto = await shell(diff, env, dir);
    expect(letto.status, letto.stderr).toBe(0);
    expect(letto.stdout, 'il comando dettato mostra proprio il pezzo nuovo').toContain('giro1-esterno.spec.mjs');

    const registra = rigaCon(primo.stderr, '--record-secaudit');
    expect(registra, primo.stderr).toBeTruthy();
    const eseguibile = registra.replace('<pass|fail>', 'pass').replace('<file.md>', `"${nota}"`);
    const rr = await shell(eseguibile, env, dir);
    expect(rr.status, rr.stderr + rr.stdout).toBe(0);
    const stato = JSON.parse(readFileSync(resolve(fuori, 'stato', `${ID}.json`), 'utf8'));
    expect(stato.secauditSha, 'il verdetto registrato di nuovo parla del contenuto nuovo').toBe(tolta);

    const secondo = await lancia(GATE, [RAMO], env, dir);
    expect(secondo.status, secondo.stderr).toBe(0);
    const f = fusioni(ricevuti);
    expect(f.length).toBe(1);
    expect(f[0].body.sha).toBe(tolta);
  } finally {
    srv.close();
  }
});

test('su origin il ramo è più avanti: seguendo i rifiuti uno dopo l\'altro si arriva alla fusione, senza toccare origin', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, remoto, g, punta } = deposito('filo-gate-g1-avanti-');
  const fuori = cartellaTemporanea('filo-gate-g1-avanti-fuori-');
  const env = ambiente(dir, fuori, port);
  seminaStato(fuori);
  try {
    await verifica(env, dir);
    const nota = await sicurezza(env, dir, fuori);
    // Il verificatore toglie la prova da un'altra macchina: qui la directory resta indietro.
    const altra = cartellaTemporanea('filo-gate-g1-avanti-altra-');
    execFileSync('git', ['clone', '-q', '--branch', RAMO, remoto, altra], { stdio: ['ignore', 'pipe', 'pipe'] });
    g(['config', 'user.email', 't@t'], altra);
    g(['config', 'user.name', 't'], altra);
    togliProvaDelGiro(g, altra);
    g(['push', '-q', '--no-verify', 'origin', RAMO], altra);
    const suOrigin = g(['rev-parse', 'HEAD'], altra).trim();

    let ultimo = null;
    for (let passo = 0; passo < 4; passo++) {
      ultimo = await lancia(GATE, [RAMO], env, dir);
      if (ultimo.status === 0) break;
      expect(ultimo.status, ultimo.stderr).toBe(1);
      nessunRientroInVerifica(ultimo.stderr + ultimo.stdout);
      const ff = rigaCon(ultimo.stderr, 'git merge --ff-only');
      const registra = rigaCon(ultimo.stderr, '--record-secaudit');
      if (ff) {
        const m = await shell(ff, env, dir);
        expect(m.status, m.stderr).toBe(0);
      } else if (registra) {
        const rr = await shell(registra.replace('<pass|fail>', 'pass').replace('<file.md>', `"${nota}"`), env, dir);
        expect(rr.status, rr.stderr + rr.stdout).toBe(0);
      } else {
        throw new Error(`rifiuto senza un rimedio eseguibile:\n${ultimo.stderr}`);
      }
    }
    expect(ultimo.status, `dopo i rimedi dettati la fusione deve partire:\n${ultimo.stderr}`).toBe(0);
    expect(punta()).toBe(suOrigin);
    const f = fusioni(ricevuti);
    expect(f.length).toBe(1);
    expect(f[0].body.sha).toBe(suOrigin);
    expect(g(['rev-parse', `refs/heads/${RAMO}`], remoto).trim(), 'origin non si tocca').toBe(suOrigin);
  } finally {
    srv.close();
  }
});

test('dopo il pass qualcuno cambia il prodotto: la decisione arriva dal server, e il rifiuto non detta un rimedio impossibile', async () => {
  const { srv, ricevuti, port } = await fintoServer({ ok: false, rejected: true, reason: 'not_approved' });
  const { dir, g, punta } = deposito('filo-gate-g1-prodotto-');
  const fuori = cartellaTemporanea('filo-gate-g1-prodotto-fuori-');
  const env = ambiente(dir, fuori, port);
  seminaStato(fuori);
  try {
    await verifica(env, dir);
    writeFileSync(resolve(dir, 'a.txt'), 'la correzione, cambiata dopo la verifica\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'cambio dopo il pass']);
    g(['push', '-q', '--no-verify', 'origin', RAMO]);
    await sicurezza(env, dir, fuori);

    const r = await lancia(GATE, [RAMO], env, dir);
    expect(fusioni(ricevuti).length, 'il giudizio sulla mossa dopo la verifica spetta al server').toBe(1);
    expect(fusioni(ricevuti)[0].body.sha).toBe(punta());
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not_approved');
    nessunRientroInVerifica(r.stderr + r.stdout);
  } finally {
    srv.close();
  }
});

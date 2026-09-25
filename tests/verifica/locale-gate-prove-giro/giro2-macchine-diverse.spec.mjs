// Giro 2 — verifica e controllo di sicurezza su due macchine diverse, come nelle routine in cloud: chi chiede la
// fusione non sa su quale commit la verifica ha dato l'ok. Server finto; i comandi dei rifiuti si eseguono in una shell.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const DISPATCH = fileURLToPath(new URL('../../../scripts/dispatch.mjs', import.meta.url));
const CANALE = fileURLToPath(new URL('../../../scripts/routine-channel.mjs', import.meta.url));
const GATE = fileURLToPath(new URL('../../../scripts/merge-gate.mjs', import.meta.url));
const ATTREZZI = fileURLToPath(new URL('../../..', import.meta.url));
const ID = 'ID701';
const RAMO = 'worker/701';

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
        res.end(JSON.stringify({ ok: true, id: ID, num: '#701', reply: { outcome: 'pass' } }));
      }
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// La macchina di chi verifica: il ramo del lavoro, con una prova del giro, spedito su origin.
function macchinaVerifica(prefisso) {
  const dir = cartellaTemporanea(`${prefisso}verifica-`);
  const remoto = cartellaTemporanea(`${prefisso}remoto-`);
  git(['init', '-q', '--bare'], remoto);
  git(['init', '-q', '--initial-branch=main'], dir);
  git(['config', 'user.email', 't@t'], dir);
  git(['config', 'user.name', 't'], dir);
  writeFileSync(resolve(dir, 'a.txt'), 'base\n', 'utf8');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'base'], dir);
  git(['checkout', '-qb', RAMO], dir);
  writeFileSync(resolve(dir, 'a.txt'), 'la correzione\n', 'utf8');
  mkdirSync(resolve(dir, 'tests/verifica/701'), { recursive: true });
  writeFileSync(resolve(dir, 'tests/verifica/701/giro1-esterno.spec.mjs'), "test('rilievo uscito in un feedback suo', () => {});\n", 'utf8');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'il lavoro'], dir);
  git(['remote', 'add', 'origin', remoto], dir);
  git(['push', '-q', '--no-verify', 'origin', RAMO], dir);
  return { dir, remoto };
}

// Un'altra macchina, con la sua copia del ramo e il suo stato: di quello che ha registrato la verifica non sa niente.
function altraMacchina(prefisso, remoto) {
  const dir = cartellaTemporanea(`${prefisso}sicurezza-`);
  execFileSync('git', ['clone', '-q', '--branch', RAMO, remoto, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  git(['config', 'user.email', 's@s'], dir);
  git(['config', 'user.name', 's'], dir);
  return dir;
}

function ambiente(dir, fuori, port) {
  mkdirSync(resolve(fuori, 'stato'), { recursive: true });
  writeFileSync(resolve(fuori, 'stato', `${ID}.json`), JSON.stringify({ id: ID, branch: RAMO }, null, 2) + '\n', 'utf8');
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

function lancia(script, args, env, cwd) {
  return new Promise((r) => execFile(process.execPath, [script, ...args], { env, cwd },
    (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));
}

function shell(riga, env, cwd) {
  return new Promise((r) => execFile('bash', ['-c', riga], { env, cwd },
    (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));
}

const CRITICA = 'Provato il giro intero come lo vive chi consegna: la correzione fa quello che la segnalazione chiedeva.';
const fusioni = (ricevuti) => ricevuti.filter((r) => r.url.includes('routineMerge'));
const rigaCon = (testo, pezzo) => String(testo || '').split(/\r?\n/).map((r) => r.trim()).find((r) => r.includes(pezzo)) || '';
const punta = (dir) => git(['rev-parse', 'HEAD'], dir).trim();

function togliProvaDelGiro(dir) {
  rmSync(resolve(dir, 'tests/verifica/701/giro1-esterno.spec.mjs'));
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'verifica: tolta la prova del rilievo esterno'], dir);
  git(['push', '-q', '--no-verify', 'origin', RAMO], dir);
}

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

function nessunRimedioImpossibile(testo) {
  expect(testo, 'nessun rifiuto deve proporre al controllo di sicurezza di rimettere il lavoro in verifica')
    .not.toMatch(/revision_capability|rimett\w* (il lavoro )?in verifica/i);
}

test('prova del giro tolta prima che parta il controllo di sicurezza, su un\'altra macchina: la fusione parte al primo colpo', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const A = macchinaVerifica('filo-gate-g2-cloud-');
  const envA = ambiente(A.dir, cartellaTemporanea('filo-gate-g2-cloud-statoA-'), port);
  try {
    await verifica(envA, A.dir);
    togliProvaDelGiro(A.dir);
    const tolta = punta(A.dir);

    const B = altraMacchina('filo-gate-g2-cloud-', A.remoto);
    const fuoriB = cartellaTemporanea('filo-gate-g2-cloud-statoB-');
    const envB = ambiente(B, fuoriB, port);
    await sicurezza(envB, B, fuoriB);
    const r = await lancia(GATE, [RAMO], envB, B);
    expect(r.status, r.stderr).toBe(0);
    const f = fusioni(ricevuti);
    expect(f.length, 'la fusione va chiesta al server').toBe(1);
    expect(f[0].body.sha).toBe(tolta);
    expect(r.stderr, 'di quello che qui non risulta si dice che decide il server').toMatch(/decide il server/i);
    nessunRimedioImpossibile(r.stderr + r.stdout);
  } finally {
    srv.close();
  }
});

test('il controllo di sicurezza parte prima che la prova tolta arrivi: seguendo i rifiuti, e registrando di nuovo dal canale, si arriva alla fusione', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const A = macchinaVerifica('filo-gate-g2-corsa-');
  const envA = ambiente(A.dir, cartellaTemporanea('filo-gate-g2-corsa-statoA-'), port);
  try {
    await verifica(envA, A.dir);
    const B = altraMacchina('filo-gate-g2-corsa-', A.remoto);
    const fuoriB = cartellaTemporanea('filo-gate-g2-corsa-statoB-');
    const envB = ambiente(B, fuoriB, port);
    await sicurezza(envB, B, fuoriB);
    togliProvaDelGiro(A.dir);
    const suOrigin = punta(A.dir);

    let ultimo = null;
    let letto = '';
    for (let passo = 0; passo < 4; passo++) {
      ultimo = await lancia(GATE, [RAMO], envB, B);
      if (ultimo.status === 0) break;
      expect(ultimo.status, ultimo.stderr).toBe(1);
      nessunRimedioImpossibile(ultimo.stderr + ultimo.stdout);
      const ff = rigaCon(ultimo.stderr, 'git merge --ff-only');
      const diff = rigaCon(ultimo.stderr, 'git diff ');
      if (ff) {
        const m = await shell(ff, envB, B);
        expect(m.status, m.stderr).toBe(0);
      } else if (diff) {
        const d = await shell(diff, envB, B);
        expect(d.status, d.stderr).toBe(0);
        letto = d.stdout;
        // La strada del canale al posto di quella dettata: registra lo stesso esito, e deve valere uguale.
        const rr = await lancia(CANALE, ['deliver', 'secaudit', '--verdict', 'pass', '--notes','Riletto il pezzo nuovo: solo una prova del giro tolta.'], envB, B);
        expect(rr.status, rr.stderr + rr.stdout).toBe(0);
      } else {
        throw new Error(`rifiuto senza un rimedio eseguibile:\n${ultimo.stderr}`);
      }
    }
    expect(ultimo.status, `dopo i rimedi dettati la fusione deve partire:\n${ultimo.stderr}`).toBe(0);
    expect(letto, 'il confronto dettato mostra il pezzo nuovo').toContain('giro1-esterno.spec.mjs');
    const f = fusioni(ricevuti);
    expect(f.length).toBe(1);
    expect(f[0].body.sha).toBe(suOrigin);
    expect(git(['rev-parse', `refs/heads/${RAMO}`], A.remoto).trim(), 'origin non si tocca').toBe(suOrigin);
  } finally {
    srv.close();
  }
});

test('su un\'altra macchina, dopo la verifica cambia il prodotto: decide il server, e il rifiuto non detta niente di impossibile', async () => {
  const { srv, ricevuti, port } = await fintoServer({ ok: false, rejected: true, reason: 'not_approved' });
  const A = macchinaVerifica('filo-gate-g2-prodotto-');
  const envA = ambiente(A.dir, cartellaTemporanea('filo-gate-g2-prodotto-statoA-'), port);
  try {
    await verifica(envA, A.dir);
    writeFileSync(resolve(A.dir, 'a.txt'), 'la correzione, cambiata dopo la verifica\n', 'utf8');
    git(['add', '-A'], A.dir);
    git(['commit', '-qm', 'cambio dopo il pass'], A.dir);
    git(['push', '-q', '--no-verify', 'origin', RAMO], A.dir);

    const B = altraMacchina('filo-gate-g2-prodotto-', A.remoto);
    const fuoriB = cartellaTemporanea('filo-gate-g2-prodotto-statoB-');
    const envB = ambiente(B, fuoriB, port);
    await sicurezza(envB, B, fuoriB);
    const r = await lancia(GATE, [RAMO], envB, B);
    expect(fusioni(ricevuti).length, 'il giudizio sulla mossa dopo la verifica spetta al server').toBe(1);
    expect(fusioni(ricevuti)[0].body.sha).toBe(punta(B));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not_approved');
    nessunRimedioImpossibile(r.stderr + r.stdout);
    expect(r.stderr, 'il controllo di sicurezza è sul contenuto giusto: non gli si chiede di rifarlo').not.toContain('--record-secaudit');
    expect(r.stderr, 'origin ha già il contenuto: non si detta una spedizione').not.toContain('git push');
  } finally {
    srv.close();
  }
});

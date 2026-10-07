// Giro 3 — il contenuto con i via libera è rimasto solo in questa directory (la spedizione del salvataggio è fallita):
// i rifiuti in fila, eseguiti come sono scritti, portano alla fusione della punta giusta senza rimettere niente in verifica.

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
const ID = 'ID702';
const RAMO = 'worker/702';

function fintoServer() {
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
      if (url.includes('routineMerge')) res.end(JSON.stringify({ ok: true, result: 'merged', sha: 'f'.repeat(40) }));
      else res.end(JSON.stringify({ ok: true, id: ID, num: '#702', reply: { outcome: 'pass' } }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

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
  mkdirSync(resolve(dir, 'tests/verifica/702'), { recursive: true });
  writeFileSync(resolve(dir, 'tests/verifica/702/giro1-esterno.spec.mjs'), "test('rilievo uscito in un feedback suo', () => {});\n", 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'il lavoro']);
  g(['remote', 'add', 'origin', remoto]);
  g(['push', '-q', '--no-verify', 'origin', RAMO]);
  return { dir, remoto, g, punta: () => g(['rev-parse', 'HEAD']).trim() };
}

// La prova tolta dopo il pass, committata qui e NON spedita: il salvataggio automatico non è riuscito a spingere.
function togliProvaSenzaSpedire(g, dir) {
  rmSync(resolve(dir, 'tests/verifica/702/giro1-esterno.spec.mjs'));
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
const righe = (t) => String(t || '').split(/\r?\n/).map((r) => r.trim());
const rigaCon = (testo, pezzo) => righe(testo).find((r) => r.includes(pezzo)) || '';
// Il comando di spedizione sta in coda a una frase: si copia da «git push» a fine riga, come farebbe chi legge.
const comandoPush = (testo) => { const r = rigaCon(testo, 'git push '); return r ? r.slice(r.indexOf('git push ')) : ''; };

function nessunRientroInVerifica(testo) {
  expect(testo, 'nessun rifiuto deve proporre al controllo di sicurezza di rimettere il lavoro in verifica')
    .not.toMatch(/revision_capability|rimett\w* (il lavoro )?in verifica/i);
}

// Segue i rifiuti uno dopo l'altro, eseguendo i comandi dettati; si ferma alla fusione o a un rifiuto senza rimedio.
async function seguiRifiuti(env, dir, nota, passiMax = 5) {
  let ultimo = null;
  const visti = [];
  for (let passo = 0; passo < passiMax; passo++) {
    ultimo = await lancia(GATE, [RAMO], env, dir);
    if (ultimo.status === 0) return { ultimo, visti };
    expect(ultimo.status, ultimo.stderr).toBe(1);
    nessunRientroInVerifica(ultimo.stderr + ultimo.stdout);
    const push = comandoPush(ultimo.stderr);
    const ff = rigaCon(ultimo.stderr, 'git merge --ff-only');
    const registra = rigaCon(ultimo.stderr, '--record-secaudit');
    if (registra) {
      visti.push('registra');
      const diff = rigaCon(ultimo.stderr, 'git diff ');
      const letto = await shell(diff, env, dir);
      expect(letto.status, letto.stderr).toBe(0);
      const rr = await shell(registra.replace('<pass|fail>', 'pass').replace('<file.md>', `"${nota}"`), env, dir);
      expect(rr.status, rr.stderr + rr.stdout).toBe(0);
    } else if (push) {
      visti.push('spedisci');
      const p = await shell(push, env, dir);
      expect(p.status, p.stderr).toBe(0);
    } else if (ff) {
      visti.push('allinea');
      const m = await shell(ff, env, dir);
      expect(m.status, m.stderr).toBe(0);
    } else {
      throw new Error(`rifiuto senza un rimedio eseguibile:\n${ultimo.stderr}`);
    }
  }
  return { ultimo, visti };
}

test('prova del giro tolta e rimasta qui, controllo di sicurezza già su quel contenuto: si spedisce e la fusione parte', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, remoto, g, punta } = deposito('filo-gate-g3-qui-');
  const fuori = cartellaTemporanea('filo-gate-g3-qui-fuori-');
  const env = ambiente(dir, fuori, port);
  seminaStato(fuori);
  try {
    await verifica(env, dir);
    const verificato = punta();
    togliProvaSenzaSpedire(g, dir);
    const tolta = punta();
    const nota = await sicurezza(env, dir, fuori);

    const { ultimo, visti } = await seguiRifiuti(env, dir, nota);
    expect(ultimo.status, `dopo i rimedi dettati la fusione deve partire:\n${ultimo.stderr}`).toBe(0);
    expect(visti, 'basta spedire: il verdetto di sicurezza parla già di questo contenuto').toEqual(['spedisci']);
    const f = fusioni(ricevuti);
    expect(f.length).toBe(1);
    expect(f[0].body.sha).toBe(tolta);
    expect(g(['rev-parse', `refs/heads/${RAMO}`], remoto).trim(), 'su origin arriva il contenuto controllato').toBe(tolta);
    expect(ultimo.stderr, 'la mossa dopo la verifica la giudica il server, e lo si dice').toContain(verificato.slice(0, 12));
  } finally {
    srv.close();
  }
});

test('prova del giro tolta e rimasta qui dopo il controllo di sicurezza: rileggere, registrare, spedire, e si arriva alla fusione', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, remoto, g, punta } = deposito('filo-gate-g3-entrambi-');
  const fuori = cartellaTemporanea('filo-gate-g3-entrambi-fuori-');
  const env = ambiente(dir, fuori, port);
  seminaStato(fuori);
  try {
    await verifica(env, dir);
    const nota = await sicurezza(env, dir, fuori);
    togliProvaSenzaSpedire(g, dir);
    const tolta = punta();

    const { ultimo, visti } = await seguiRifiuti(env, dir, nota);
    expect(ultimo.status, `dopo i rimedi dettati la fusione deve partire:\n${ultimo.stderr}`).toBe(0);
    expect(visti.length, `passi: ${visti.join(', ')}`).toBeLessThanOrEqual(3);
    const stato = JSON.parse(readFileSync(resolve(fuori, 'stato', `${ID}.json`), 'utf8'));
    expect(stato.secauditSha, 'il verdetto registrato di nuovo parla del contenuto che si fonde').toBe(tolta);
    const f = fusioni(ricevuti);
    expect(f.length, 'una richiesta sola, alla fine').toBe(1);
    expect(f[0].body.sha).toBe(tolta);
    expect(g(['rev-parse', `refs/heads/${RAMO}`], remoto).trim()).toBe(tolta);
  } finally {
    srv.close();
  }
});

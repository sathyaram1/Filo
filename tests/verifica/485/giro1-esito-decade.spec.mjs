// #485 giro 1 — «un lavoro verificato resta approvato anche se il codice cambia sotto».
//
// La lamentela, con le parole di chi l'ha scritta: la verifica automatica
// approva un lavoro, e l'approvazione resta valida anche se subito dopo quel
// lavoro viene modificato. È firmare «il documento nella cartella X» invece di
// «questa esatta versione»: basta sostituire il foglio e la firma resta lì,
// buona, su un contenuto che nessuno ha guardato.
//
// Qui si prova il cammino VERO fino in fondo, non il pezzo intermedio: un
// esito registrato su un contenuto, poi il contenuto cambia, poi si chiede la
// fusione. La domanda dell'utente è una sola — la richiesta di fusione dice
// ancora «buona» del vecchio esito, oppure l'esito decade?
//
// Il canale vero non lo tocchiamo: al suo posto c'è un server finto che
// registra quello che riceve. È esattamente ciò che si vuole guardare: cosa
// parte da questa macchina.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const DISPATCH = fileURLToPath(new URL('../../../scripts/dispatch.mjs', import.meta.url));
const CANALE = fileURLToPath(new URL('../../../scripts/routine-channel.mjs', import.meta.url));
const GATE = fileURLToPath(new URL('../../../scripts/merge-gate.mjs', import.meta.url));

/** Un server finto che registra le buste e risponde «fatto». */
function fintoServer(rispondi) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* lo scoprono gli assert */ }
      ricevuti.push({ url: String(req.url || ''), body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(rispondi ? rispondi(String(req.url || ''), j) : { ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

/** Un deposito usa-e-getta con un ramo di lavoro e un commit. */
function deposito(prefisso) {
  const dir = cartellaTemporanea(prefisso);
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q', '--initial-branch=main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(resolve(dir, 'a.txt'), 'contenuto controllato\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  g(['checkout', '-qb', 'worker/485']);
  return { dir, g, punta: () => g(['rev-parse', 'HEAD']).trim() };
}

/**
 * Lo stato locale del lavoro, come lo lascia il dispatcher quando assegna il
 * ramo: qui serve solo perché il ramo ci sia scritto, come nel giro vero.
 */
function seminaStato(statoDir, id, branch) {
  mkdirSync(statoDir, { recursive: true });
  writeFileSync(resolve(statoDir, `${id}.json`), JSON.stringify({ id, branch }, null, 2) + '\n', 'utf8');
}

function lancia(script, args, env, cwd) {
  return new Promise((r) => execFile(process.execPath, [script, ...args], { env, cwd },
    (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));
}

test('il foglio sostituito: cambiato il contenuto dopo il via libera, la fusione o si ferma o dice su quale versione era stato dato l\'ok', async () => {
  const { srv, ricevuti, port } = await fintoServer((url) => (url.includes('routineMerge')
    ? { ok: true, result: 'merged', sha: 'x'.repeat(40) }
    : { ok: true, id: 'ID485', num: '#485' }));
  const { dir, g, punta } = deposito('filo-485-foglio-');
  const fuori = cartellaTemporanea('filo-485-fuori-');
  try {
    const NOTA = resolve(fuori, 'nota.md');
    writeFileSync(NOTA, 'Letto il diff riga per riga: un test e un commento. Niente comandi di sistema, niente chiavi, niente regole del database.', 'utf8');
    seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
    const env = {
      ...process.env,
      FILO_REPO_ROOT: dir,
      FILO_TOOLS_ROOT: dir,
      FILO_DISPATCH_STATE_DIR: resolve(fuori, 'stato'),
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_TICKET: 'biglietto-finto',
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    };

    // 1. Il contenuto CONTROLLATO, e l'esito registrato su quello.
    const controllato = punta();
    const verdetto = await lancia(DISPATCH, ['--record-secaudit', 'ID485', 'pass', '--nota', NOTA], env, dir);
    expect(verdetto.status, verdetto.stderr).toBe(0);
    const consegna = ricevuti.find((x) => x.url.includes('routineDeliver'));
    expect(consegna?.body?.data?.sha).toBe(controllato);

    // 2. Il foglio viene sostituito: chi lavora ha per costruzione il permesso
    //    di spingere sul proprio ramo, quindi questa finestra si apre da sé.
    writeFileSync(resolve(dir, 'a.txt'), 'contenuto MAI guardato da nessuno\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'sostituito dopo il via libera']);
    const sostituito = punta();
    expect(sostituito).not.toBe(controllato);

    // 3. Si chiede la fusione. Questa è la domanda dell'utente.
    const gate = await lancia(GATE, ['worker/485'], env, dir);
    const richiesta = ricevuti.find((x) => x.url.includes('routineMerge'));

    // O la richiesta non parte (l'esito è decaduto e va rifatto), o parte
    // dicendo su QUALE contenuto l'ok era stato dato — altrimenti il via
    // libera continua a parlare di un'etichetta e non di una versione.
    const diceIlContenuto = String(richiesta?.body?.sha || '') === controllato;
    const siEFermata = !richiesta || gate.status !== 0;
    expect(siEFermata || diceIlContenuto,
      `la fusione è partita per nome del ramo, senza dire su quale contenuto era stato dato l'ok (busta: ${JSON.stringify(richiesta?.body || null)})`).toBe(true);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});

test('l\'impronta del verdetto non si detta: o combacia con la directory, o la consegna si ferma', async () => {
  const { srv, ricevuti, port } = await fintoServer(() => ({ ok: true, id: 'ID485', num: '#485' }));
  const { dir, punta } = deposito('filo-485-dettato-');
  try {
    const env = {
      ...process.env,
      FILO_REPO_ROOT: dir,
      FILO_TOOLS_ROOT: dir,
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    };
    const vero = punta();
    const r = await lancia(CANALE, ['deliver', 'biglietto-finto', 'secaudit', '--verdict', 'pass', '--sha', 'f'.repeat(40)], env, dir);
    const busta = ricevuti[ricevuti.length - 1];
    const dichiarato = String(busta?.body?.data?.sha || '');

    // Il nome del RAMO, in questo stesso canale, può solo confermare quello del
    // biglietto: nominarne un altro è un rifiuto registrato, non una correzione
    // silenziosa. Lo sha del contenuto esaminato merita la stessa regola: o
    // combacia con la punta vera, o la consegna si ferma.
    expect(dichiarato === vero || r.status !== 0,
      `il verdetto è partito per il commit ${dichiarato.slice(0, 12)}, che non è quello della directory (${vero.slice(0, 12)})`).toBe(true);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('la fusione guarda se nella directory è rimasto qualcosa fuori dai commit, come il passo prima', async () => {
  const { srv, ricevuti, port } = await fintoServer((url) => (url.includes('routineMerge')
    ? { ok: true, result: 'merged', sha: 'x'.repeat(40) }
    : { ok: true, id: 'ID485', num: '#485' }));
  const { dir, punta } = deposito('filo-485-sporca-');
  const fuori = cartellaTemporanea('filo-485-sporca-fuori-');
  try {
    const NOTA = resolve(fuori, 'nota.md');
    writeFileSync(NOTA, 'Letto il diff: niente di sospetto, nessun pattern critico.', 'utf8');
    seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
    const env = {
      ...process.env,
      FILO_REPO_ROOT: dir,
      FILO_TOOLS_ROOT: dir,
      FILO_DISPATCH_STATE_DIR: resolve(fuori, 'stato'),
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_TICKET: 'biglietto-finto',
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    };
    const controllato = punta();
    const verdetto = await lancia(DISPATCH, ['--record-secaudit', 'ID485', 'pass', '--nota', NOTA], env, dir);
    expect(verdetto.status, verdetto.stderr).toBe(0);

    // Dopo il verdetto compare un file fuori dai commit: il salvataggio
    // automatico lo committerà, e quello che viene fuso conterrà righe mai
    // controllate. La registrazione del verdetto questo caso lo respinge;
    // la richiesta di fusione, che è il passo dopo, dovrebbe accorgersene
    // altrettanto.
    mkdirSync(resolve(dir, 'src'), { recursive: true });
    writeFileSync(resolve(dir, 'src', 'aggiunto-dopo.js'), 'module.exports = 1;\n', 'utf8');

    const gate = await lancia(GATE, ['worker/485'], env, dir);
    const richiesta = ricevuti.find((x) => x.url.includes('routineMerge'));
    expect(!richiesta || gate.status !== 0,
      `la fusione è partita con ${controllato.slice(0, 8)} controllato e un file fuori dai commit nella directory`).toBe(true);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});

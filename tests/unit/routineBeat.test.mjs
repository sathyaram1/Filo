// IL BATTITO PARTE DA SOLO col biglietto.
//
// PERCHÉ QUESTO FILE ESISTE
//   Un giro intero è andato perso così: lavoro fatto e spinto (venti commit sul
//   ramo), consegna rifiutata con `dead_ticket`, esito e report mai registrati.
//   Il semaforo cade dopo 30 minuti senza battito, la suite completa in cloud ne
//   dura 37, e il comando che tiene vivo il semaforo non lo lanciava nessuno:
//   c'era, ma non stava in nessuna ricetta.
//
//   Il controllo che conta è quello in fondo: si lancia il giro vero col
//   biglietto e si guarda se al server ARRIVA un battito. Senza l'avvio
//   automatico non arriva niente, ed è rosso. Un controllo sulla sola funzione
//   che avvia il processo sarebbe rimasto verde per tutto il tempo in cui il
//   difetto è esistito, perché quella funzione non si era mai rotta: mancava
//   chi la chiamava.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beatIsLive, readBeat, startBeat, stopBeat, beatFile } from '../../scripts/lib/routine-beat.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function casaFinta() {
  const casa = mkdtempSync(resolve(tmpdir(), 'filo-battito-'));
  mkdirSync(resolve(casa, '.claude'), { recursive: true });
  return casa;
}

function scriviMarcatore(casa, marker) {
  writeFileSync(beatFile(casa), JSON.stringify(marker, null, 2) + '\n', 'utf8');
}

// ── Il marcatore: quando un battito già acceso conta come acceso ────────────

test('un battito acceso sul biglietto PRECEDENTE non vale', () => {
  // Fra un lavoratore e il successivo il biglietto cambia. Un ciclo rimasto
  // vivo sul biglietto vecchio non tiene in piedi il semaforo del nuovo, e
  // scambiarlo per buono lascerebbe il giro nuovo senza battito.
  const m = { pid: 1234, ticket: 'vecchio', since: new Date().toISOString() };
  assert.equal(beatIsLive(m, 'nuovo', { alive: () => true }), false);
  assert.equal(beatIsLive(m, 'vecchio', { alive: () => true }), true);
});

test('un marcatore che nomina un processo morto non vale', () => {
  const m = { pid: 1234, ticket: 'b', since: new Date().toISOString() };
  assert.equal(beatIsLive(m, 'b', { alive: () => false }), false);
});

test('un marcatore più vecchio del tetto del semaforo non vale', () => {
  const dieciOreFa = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
  const m = { pid: 1234, ticket: 'b', since: dieciOreFa };
  assert.equal(beatIsLive(m, 'b', { alive: () => true }), false);
});

// ── L'avvio: uno solo, e solo quando serve ─────────────────────────────────

test('due invocazioni con lo stesso biglietto accendono UN battito solo', () => {
  const casa = casaFinta();
  try {
    let avvii = 0;
    const finto = () => { avvii += 1; return { pid: 4242, unref() {} }; };

    const primo = startBeat(casa, 'b-1', { spawnImpl: finto, alive: () => true });
    assert.equal(primo.started, true);
    assert.equal(readBeat(casa).ticket, 'b-1', 'il marcatore deve ricordare a quale biglietto è appeso');

    const secondo = startBeat(casa, 'b-1', { spawnImpl: finto, alive: () => true });
    assert.equal(secondo.started, false);
    assert.equal(secondo.why, 'already_live');
    assert.equal(avvii, 1, 'due processi che battono lo stesso biglietto sono solo rumore');
  } finally {
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('biglietto nuovo: il battito si riaccende, e il vecchio non resta orfano', () => {
  // Il marcatore sta per essere sovrascritto: se il battito del biglietto
  // precedente non lo si spegne adesso, resta vivo e IRRAGGIUNGIBILE — nessuno
  // sa più che processo sia — a tenere in piedi un semaforo che non serve.
  const casa = casaFinta();
  const uccisi = [];
  const killVero = process.kill.bind(process);
  process.kill = (pid, sig) => { uccisi.push(pid); if (sig === 0) return killVero(pid, sig); };
  try {
    let avvii = 0;
    const finto = () => { avvii += 1; return { pid: 4242 + avvii, unref() {} }; };
    startBeat(casa, 'b-1', { spawnImpl: finto, alive: () => true });
    const r = startBeat(casa, 'b-2', { spawnImpl: finto, alive: () => true });
    assert.equal(r.started, true);
    assert.equal(avvii, 2);
    assert.deepEqual(uccisi, [4243], 'il battito del biglietto vecchio va spento prima di perderne le tracce');
  } finally {
    process.kill = killVero;
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

// ── Lo spegnimento: solo il proprio battito ────────────────────────────────

test('rilasciare un biglietto NON spegne il battito di un altro lavoro', () => {
  // Riprodotto sul campo: il rilascio spegneva "il battito che c'è" senza
  // guardare a quale biglietto fosse appeso, e un lavoro vivo restava senza
  // battito — cioè col semaforo che cade mentre sta ancora lavorando.
  const casa = casaFinta();
  const uccisi = [];
  const killVero = process.kill.bind(process);
  process.kill = (pid, sig) => { uccisi.push(pid); if (sig === 0) return killVero(pid, sig); };
  try {
    startBeat(casa, 'b-vivo', { spawnImpl: () => ({ pid: 5150, unref() {} }), alive: () => true });
    const r = stopBeat(casa, { ticket: 'b-altro', alive: () => true });
    assert.equal(r.stopped, false);
    assert.equal(r.why, 'other_ticket');
    assert.deepEqual(uccisi, [], 'nessuno deve essere ammazzato');
    assert.equal(readBeat(casa).ticket, 'b-vivo', 'e il marcatore resta quello di chi lavora');
  } finally {
    process.kill = killVero;
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('rilasciare il PROPRIO biglietto spegne il battito', () => {
  const casa = casaFinta();
  const uccisi = [];
  const killVero = process.kill.bind(process);
  process.kill = (pid, sig) => { uccisi.push(pid); if (sig === 0) return killVero(pid, sig); };
  try {
    startBeat(casa, 'b-mio', { spawnImpl: () => ({ pid: 5151, unref() {} }), alive: () => true });
    const r = stopBeat(casa, { ticket: 'b-mio', alive: () => true });
    assert.equal(r.stopped, true);
    assert.deepEqual(uccisi, [5151]);
    assert.equal(readBeat(casa), null);
  } finally {
    process.kill = killVero;
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('senza biglietto non si accende niente', () => {
  const casa = casaFinta();
  try {
    let avvii = 0;
    const r = startBeat(casa, '', { spawnImpl: () => { avvii += 1; return { pid: 1, unref() {} }; } });
    assert.equal(r.started, false);
    assert.equal(avvii, 0);
  } finally {
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('un marcatore rimasto da una sessione morta non blocca il battito nuovo', () => {
  // Il caso vero: la macchina è quella di prima, il processo no. Se il
  // marcatore vecchio valesse, il giro nuovo resterebbe senza battito.
  const casa = casaFinta();
  try {
    scriviMarcatore(casa, { pid: 999999, ticket: 'b-1', since: new Date().toISOString() });
    let avvii = 0;
    const r = startBeat(casa, 'b-1', {
      spawnImpl: () => { avvii += 1; return { pid: 7, unref() {} }; },
      alive: () => false,
    });
    assert.equal(r.started, true);
    assert.equal(avvii, 1);
  } finally {
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

// ── Il rilascio rifiutato non deve spegnere niente ─────────────────────────

/** Server finto che risponde come gli si dice al rilascio. */
async function serverCheRifiuta(rispostaRilascio) {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/routineRelease')) res.end(JSON.stringify(rispostaRilascio));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, port: srv.address().port };
}

test('un rilascio RIFIUTATO dal server lascia vivo il battito', async () => {
  // Un rilascio rifiutato non ha liberato niente: il lavoro è ancora in piedi e
  // ha ancora bisogno del suo battito. Spegnerlo lo lascerebbe col semaforo che
  // cade mezz'ora dopo, cioè il guasto che tutto questo lavoro viene a togliere.
  const { srv, port } = await serverCheRifiuta({ ok: false, reason: 'not_holder' });
  const casa = casaFinta();
  try {
    scriviMarcatore(casa, { pid: process.pid, ticket: 'b-mio', since: new Date().toISOString() });
    await new Promise((fine) => {
      const p = spawn(process.execPath,
        [resolve(REPO, 'scripts', 'routine-channel.mjs'), 'release', 'b-mio'],
        { cwd: casa, env: { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa }, stdio: 'ignore' });
      p.on('close', fine);
    });
    // Il marcatore è la prova: se fosse stato spento, sarebbe sparito.
    assert.ok(readBeat(casa), 'il battito non va toccato quando il rilascio non è andato a buon fine');
  } finally {
    srv.close();
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('un rilascio ACCETTATO spegne il battito', async () => {
  const { srv, port } = await serverCheRifiuta({ ok: true });
  const casa = casaFinta();
  try {
    // Un processo che esiste davvero ma che non è il battito: usiamo il nostro,
    // e il segnale non arriva perché il marcatore viene tolto prima. Quello che
    // conta è che il marcatore sparisca.
    scriviMarcatore(casa, { pid: 999999, ticket: 'b-mio', since: new Date().toISOString() });
    await new Promise((fine) => {
      const p = spawn(process.execPath,
        [resolve(REPO, 'scripts', 'routine-channel.mjs'), 'release', 'b-mio'],
        { cwd: casa, env: { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa }, stdio: 'ignore' });
      p.on('close', fine);
    });
    assert.equal(readBeat(casa), null, 'col biglietto muore anche il battito');
  } finally {
    srv.close();
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

// ── Il controllo che conta: al server ARRIVA un battito ────────────────────

test('il giro col biglietto fa arrivare un battito al server, senza che nessuno lo chieda', async () => {
  const arrivati = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      arrivati.push(String(req.url || ''));
      res.setHeader('Content-Type', 'application/json');
      // Al lavoro rispondiamo di no: qui si guarda il battito, non la busta.
      if (req.url.endsWith('/routineWork')) res.end(JSON.stringify({ ok: false, reason: 'niente' }));
      else res.end(JSON.stringify({ ok: true, expiresAt: new Date(Date.now() + 1800000).toISOString() }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const casa = casaFinta();

  try {
    await new Promise((fine) => {
      const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), '--ticket', 'biglietto-vivo'], {
        cwd: casa,
        env: {
          ...process.env,
          FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
          FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
          FILO_REPO_ROOT: casa,
          FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
          FILO_ROUTINES_ENABLED: '1',
        },
        stdio: 'ignore',
      });
      p.on('close', fine);
    });

    // Il battito è staccato: vive oltre dispatch, quindi lo si aspetta.
    const scadenza = Date.now() + 15000;
    while (Date.now() < scadenza && !arrivati.some((u) => u.includes('routineHeartbeat'))) {
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(arrivati.some((u) => u.includes('routineHeartbeat')),
      `nessun battito è arrivato al server (chiamate viste: ${arrivati.join(', ') || 'nessuna'})`);
  } finally {
    // Il processo è staccato apposta: se non lo si ferma resta a battere.
    const m = readBeat(casa);
    if (m && m.pid) { try { process.kill(Number(m.pid)); } catch (_) { /* già morto */ } }
    srv.close();
    await new Promise((r) => setTimeout(r, 200));
    rmSync(casa, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

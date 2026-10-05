// Unit test: con cmd scelto nelle Preferenze i comandi dell'assistente partono davvero (#719).
// `cmd /c` esegue solo la prima riga della stringa: era il preludio UTF-8, e il comando risultava riuscito senza
// partire. Le prove vere girano con cmd su Windows (cancello della pubblicazione) e con sh altrove.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));
const S = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));

const ATTESA = 300_000;
const TMP = cartellaTemporanea('filo-cmd-');
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

// ─────────── la strada: su Windows cmd passa dalla sessione, intero ───────────
// Qui si finge Windows e si guarda cosa arriva alla sessione: su Linux cmd non c'è, ma la scelta della strada sì.

async function suWindowsConSessioneFinta(risposta, fn) {
  const piattaforma = Object.getOwnPropertyDescriptor(process, 'platform');
  const vera = S.createSession;
  const visto = { opzioni: null, comandi: [], chiusa: false, uccisa: false };
  S.createSession = (opzioni) => {
    visto.opzioni = opzioni;
    return {
      exec(comando, cb) { visto.comandi.push(comando); setImmediate(() => risposta(cb)); },
      chiudi() { visto.chiusa = true; },
      kill() { visto.uccisa = true; },
    };
  };
  Object.defineProperty(process, 'platform', { ...piattaforma, value: 'win32' });
  try {
    return await fn(visto);
  } finally {
    Object.defineProperty(process, 'platform', piattaforma);
    S.createSession = vera;
  }
}

test('con cmd il comando dell\'assistente arriva intero alla shell, non dietro al preludio', async () => {
  await suWindowsConSessioneFinta((cb) => {
    cb.onData({ chunk: 'prova.txt\n', stream: 'stdout' });
    cb.onExit({ code: 0, cwd: TMP });
  }, async (visto) => {
    const out = await T.runCommand('echo x > prova.txt', { shell: 'cmd', cwd: TMP, trackCwd: true, timeoutMs: ATTESA });
    assert.deepEqual(visto.comandi, ['echo x > prova.txt'], 'il comando non è arrivato alla shell così com\'è');
    assert.equal(T.resolveShell(visto.opzioni.shell), 'cmd');
    assert.equal(visto.opzioni.cwd, TMP, 'il comando deve partire dalla cartella dell\'assistente');
    // L'AutoRun del registro può contenere un `cd`: il comando finirebbe altrove.
    assert.equal(visto.opzioni.autoRun, false);
    assert.equal(out.code, 0);
    assert.equal(out.stdout, 'prova.txt\n');
    assert.equal(out.cwd, TMP);
    // La shell esce chiudendo lo stdin: uccidere l'albero chiuderebbe anche un `start notepad`.
    assert.equal(visto.chiusa, true);
    assert.equal(visto.uccisa, false);
  });
});

test('con cmd un comando su più righe arriva tutto, e un esito senza marcatore non diventa un successo', async () => {
  await suWindowsConSessioneFinta((cb) => cb.onExit({ code: 0, cwd: TMP, chiusa: true, uscita: 3 }), async (visto) => {
    const comando = 'cd sotto\nexit 3';
    const out = await T.runCommand(comando, { shell: 'cmd', cwd: TMP, trackCwd: true, timeoutMs: ATTESA });
    assert.deepEqual(visto.comandi, [comando]);
    assert.equal(out.code, 3, 'la shell chiusa da `exit 3` risultava riuscita');
    assert.equal(out.cwd, TMP, 'senza marcatore non si sa dove sia finita: resta la cartella di prima');
  });
});

test('le altre shell restano sulla loro strada', () => {
  assert.equal(T.viaSessione('powershell'), false);
  assert.equal(T.viaSessione('sh'), false);
  assert.equal(T.viaSessione('bash'), false);
});

// ─────────── il giro vero: cmd su Windows, la stessa sessione con sh altrove ───────────

const WIN = process.platform === 'win32';
const esegui = (comando, o = {}) => (WIN
  ? T.runCommand(comando, { shell: 'cmd', cwd: TMP, timeoutMs: ATTESA, trackCwd: true, ...o })
  : T.eseguiInSessione(comando, { shell: 'sh', cwd: TMP, timeoutMs: ATTESA, trackCwd: true, ...o }));
const ELENCA = WIN ? 'dir /b' : 'ls';

test('«echo x > prova.txt» crea il file, e l\'elenco della cartella lo mostra', async () => {
  const out = await esegui('echo x> prova.txt');
  assert.equal(out.code, 0, `il comando è fallito: ${out.stderr}`);
  assert.ok(existsSync(join(TMP, 'prova.txt')), 'il comando risulta eseguito ma il file non c\'è');
  assert.equal(readFileSync(join(TMP, 'prova.txt'), 'utf8').trim(), 'x');
  const elenco = await esegui(ELENCA);
  assert.equal(elenco.code, 0, elenco.stderr);
  assert.ok(elenco.stdout.split(/\r?\n/).includes('prova.txt'), `elenco vuoto o storpiato: ${JSON.stringify(elenco.stdout)}`);
  assert.ok(!/FILO_(META|RDY)_/.test(elenco.stdout), 'le righe di servizio non vanno mostrate');
});

test('un comando fallito risulta fallito, col suo messaggio', async () => {
  const out = await esegui(WIN ? 'type non-esiste.txt' : 'cat non-esiste.txt');
  assert.notEqual(out.code, 0, 'un comando fallito risultava riuscito');
  assert.ok(out.stderr.trim(), 'il messaggio di errore si è perso');
});

test('un `cd` vale per il comando dopo', async () => {
  const sotto = join(TMP, 'sotto');
  mkdirSync(sotto, { recursive: true });
  const andata = await esegui('cd sotto');
  assert.equal(andata.code, 0, andata.stderr);
  assert.equal(andata.cwd, sotto);
  const qui = await esegui(WIN ? 'cd' : 'pwd', { cwd: andata.cwd });
  assert.equal(qui.stdout.trim(), sotto);
});

test('un comando su più righe le esegue tutte', async () => {
  const out = await esegui('echo uno\necho due');
  assert.deepEqual(out.stdout.split(/\r?\n/).filter(Boolean), ['uno', 'due']);
});

test('`exit 3` torna come esito 3, non come riuscito', async () => {
  const out = await esegui('exit 3');
  assert.equal(out.code, 3);
});

test('un nome con accenti e trattino lungo si crea e torna identico', async () => {
  const nome = 'RELAZIONE — attività finale.txt';
  const out = await esegui(`echo ciao> "${nome}"`);
  assert.equal(out.code, 0, out.stderr);
  assert.ok(existsSync(join(TMP, nome)), 'il file è nato con un nome diverso da quello chiesto');
  const elenco = await esegui(ELENCA);
  assert.ok(elenco.stdout.includes(nome), `nome storpiato: ${JSON.stringify(elenco.stdout)}`);
});

test('un output enorme non fa perdere esito e cartella', async () => {
  const righe = Math.ceil((T.MAX_OUTPUT_CHARS * 3) / 15);
  const out = await esegui(WIN
    ? `for /l %i in (1,1,${righe}) do @echo riga-di-elenco\nexit /b 3`
    : `for i in $(seq 1 ${righe}); do echo riga-di-elenco; done; false`);
  assert.equal(out.truncated, true);
  assert.notEqual(out.code, 0, 'l\'esito si è perso dietro all\'output');
  assert.equal(out.cwd, TMP);
});

test('un comando che non finisce scade, e lo dice', async () => {
  const inizio = Date.now();
  const out = await esegui(WIN ? 'ping -n 60 127.0.0.1 >nul' : 'sleep 60', { timeoutMs: 1500 });
  assert.equal(out.timedOut, true);
  assert.equal(out.code, 124);
  assert.ok(Date.now() - inizio < 30_000, 'il tempo scaduto non ha fermato il comando');
});

test('con cmd anche un ciclo `for` scritto come al prompt gira', { skip: !WIN && 'cmd esiste solo su Windows' }, async () => {
  const out = await esegui('for %f in (prova.txt) do @echo trovato %f');
  assert.equal(out.stdout.trim(), 'trovato prova.txt');
});

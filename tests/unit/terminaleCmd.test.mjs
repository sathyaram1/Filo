// Unit test: con cmd scelto nelle Preferenze i comandi dell'assistente partono davvero (#719).
// `cmd /c` esegue solo la prima riga della stringa: era il preludio UTF-8, e il comando risultava riuscito senza
// partire. Le prove vere girano con cmd su Windows (cancello della pubblicazione) e con sh altrove.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));
const S = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));

const ATTESA = 300_000;
const TMP = cartellaTemporanea('filo-cmd-');
process.on('exit', () => { try { togliCartella(TMP); } catch (_) {} });

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

// ─────────── con /q cmd non mostra il prompt: la sessione non può aspettarlo ───────────
// Fuori da Windows un cmd finto con la regola documentata: eco spento, niente prompt e niente eco dei comandi.

const CMD_FINTO = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
let eco = !process.argv.slice(2).some((a) => a.toLowerCase() === '/q');
let prompt = '$P$G'; let livello = 0; let resto = '';
const mostraPrompt = () => { if (eco) process.stdout.write('\\r\\n' + prompt.replace(/\\$_/g, '\\r\\n').replace(/\\$P/g, process.cwd()).replace(/\\$G/g, '>')); };
function esegui(riga) {
  if (eco) process.stdout.write(riga + '\\r\\n');
  const r = riga.trim();
  if (!r) return;
  if (/^chcp\\b/i.test(r)) { livello = 0; return; }
  if (/^prompt\\s/i.test(r)) { prompt = r.slice(7); return; }
  if (/^echo[\\s.]/i.test(r)) {
    const testo = r.slice(5).replace(/%errorlevel%/gi, String(livello)).replace(/%cd%/gi, process.cwd());
    const i = testo.indexOf('>');
    if (i === -1) process.stdout.write(testo + '\\r\\n');
    else fs.writeFileSync(path.resolve(testo.slice(i + 1).trim()), testo.slice(0, i) + '\\r\\n');
    livello = 0; return;
  }
  process.stderr.write("'" + r.split(/\\s/)[0] + "' non è riconosciuto come comando interno o esterno.\\r\\n");
  livello = 9009;
}
mostraPrompt();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  resto += c; let n;
  while ((n = resto.indexOf('\\n')) !== -1) { const riga = resto.slice(0, n).replace(/\\r$/, ''); resto = resto.slice(n + 1); esegui(riga); mostraPrompt(); }
});
process.stdin.on('end', () => process.exit(livello));
`;

async function conCmdFinto(fn) {
  const dir = join(TMP, 'cmd-finto');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cmd.js'), CMD_FINTO);
  chmodSync(join(dir, 'cmd.js'), 0o755);
  // Allo scadere la sessione chiude l'albero con taskkill: qui ne fa le veci un kill.
  writeFileSync(join(dir, 'taskkill'), '#!/bin/sh\nkill -9 "$2" 2>/dev/null\nexit 0\n');
  chmodSync(join(dir, 'taskkill'), 0o755);
  const piattaforma = Object.getOwnPropertyDescriptor(process, 'platform');
  const prima = { PATH: process.env.PATH, ComSpec: process.env.ComSpec };
  process.env.PATH = `${dir}:${prima.PATH}`;
  process.env.ComSpec = join(dir, 'cmd.js');
  Object.defineProperty(process, 'platform', { ...piattaforma, value: 'win32' });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', piattaforma);
    process.env.PATH = prima.PATH;
    if (prima.ComSpec === undefined) delete process.env.ComSpec; else process.env.ComSpec = prima.ComSpec;
  }
}

const SOLO_FUORI = { skip: process.platform === 'win32' && 'su Windows lo provano le prove con cmd vero, qui sotto' };

test('con l\'eco spento cmd non mostra il prompt: il comando dell\'assistente parte lo stesso', SOLO_FUORI, async () => {
  const qui = join(TMP, 'senza-prompt');
  mkdirSync(qui, { recursive: true });
  const out = await conCmdFinto(() => T.runCommand('echo x> prova.txt', { shell: 'cmd', cwd: qui, trackCwd: true, timeoutMs: ATTESA }));
  assert.equal(out.timedOut, false, 'la sessione di cmd non è mai partita: il comando è scaduto');
  assert.equal(out.code, 0, out.stderr);
  assert.equal(readFileSync(join(qui, 'prova.txt'), 'utf8').trim(), 'x');
  assert.equal(out.cwd, qui);
});

test('con l\'eco spento cmd non mostra il prompt: il terminale della dashboard risponde', SOLO_FUORI, async () => {
  const uscita = await conCmdFinto(() => new Promise((resolve, reject) => {
    const sessione = S.createSession({ shell: 'cmd', cwd: TMP });
    let testo = '';
    const scade = setTimeout(() => { sessione.kill(); reject(new Error('il terminale con cmd non ha mai risposto')); }, 15_000);
    sessione.exec('echo ciao', {
      onData: ({ chunk }) => { testo += chunk; },
      onExit: ({ code }) => { clearTimeout(scade); sessione.kill(); resolve({ testo, code }); },
      onError: ({ message }) => { clearTimeout(scade); reject(new Error(message)); },
    });
  }));
  assert.equal(uscita.code, 0);
  assert.equal(uscita.testo.trim(), 'ciao');
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

// cmd decodifica lo stdin di una pipe un byte per volta (#1044): qualunque sia la tabella codici, un byte fuori
// dall'ASCII sul filo è un carattere perso. Il comando ricomposto da cmd deve però essere quello scritto.
test('a cmd il comando arriva in soli caratteri ASCII, e ricomposto è quello scritto', () => {
  const lungo = Array.from({ length: 150 }, (_, i) => `parola${i} è`).join(' ');
  const righe = Array.from({ length: 130 }, (_, i) => `echo r${i} %USERNAME% è${i}`).join('\n');
  for (const comando of [
    'echo ciao> "RELAZIONE — attività finale.txt"',
    'for %f in (*attività*) do @echo %f & echo 50% più %CD%',
    `echo ${lungo}`,
    righe,
    'echo 中文😀 Привет',
  ]) {
    const { testo, file } = S.comandoPerCmd(comando);
    assert.match(testo, /^[\x00-\x7F]*$/, 'sul filo verso cmd è passato un byte fuori dall\'ASCII');
    const valori = file.flatMap((f) => f.split('\r\n').slice(0, -1));
    for (const v of valori) assert.ok(Buffer.byteLength(v) <= 1023, 'una riga oltre quello che `set /p` legge');
    for (const f of file) assert.ok(f.split('\r\n').length - 1 <= 100);
    const ultimaRiga = testo.split('\r\n').slice(file.length).join('\r\n');
    const ricomposto = ultimaRiga.replace(/%FILO_U(\d+)%/g, (_, n) => valori[Number(n) - 1]);
    assert.equal(ricomposto, comando);
    assert.ok(!valori.some((v) => v.includes('%')), 'una variabile dell\'utente è finita dentro un valore e non si espande più');
  }
  assert.deepEqual(S.comandoPerCmd('dir /b'), { testo: 'dir /b', file: [] }, 'un comando ASCII deve partire identico a prima');
});

test('un output enorme non fa perdere esito e cartella', async () => {
  // Poche righe lunghe: sotto carico ogni riga è un giro fra la shell e Filo, e duemila righe corte costavano minuti (#1063).
  const riga = 'riga-di-elenco-'.repeat(64);
  const righe = Math.ceil((T.MAX_OUTPUT_CHARS * 3) / riga.length);
  const out = await esegui(WIN
    ? `for /l %i in (1,1,${righe}) do @echo ${riga}\ncmd /c exit 3`
    : `for i in $(seq 1 ${righe}); do echo ${riga}; done; false`);
  assert.equal(out.truncated, true);
  assert.notEqual(out.code, 0, 'l\'esito si è perso dietro all\'output');
  assert.equal(out.cwd, TMP);
});

test('un comando che non finisce scade, e lo dice', async () => {
  const inizio = Date.now();
  // Fuori da Windows la sessione uccide solo sh: un `sleep` lungo terrebbe aperti i tubi e fermo il test.
  // Su Windows il comando durerebbe dieci minuti: fermato, finisce molto prima anche a macchina carica (#1063).
  const naturaleMs = WIN ? 600_000 : 5_000;
  const out = await esegui(WIN ? `ping -n ${naturaleMs / 1000} 127.0.0.1 >nul` : 'sleep 5', { timeoutMs: 1500 });
  assert.equal(out.timedOut, true);
  assert.equal(out.code, 124);
  assert.ok(Date.now() - inizio < (WIN ? naturaleMs / 2 : 30_000), 'il tempo scaduto non ha fermato il comando');
});

test('con cmd anche un ciclo `for` scritto come al prompt gira', { skip: !WIN && 'cmd esiste solo su Windows' }, async () => {
  const out = await esegui('for %f in (prova.txt) do @echo trovato %f');
  assert.equal(out.stdout.trim(), 'trovato prova.txt');
});

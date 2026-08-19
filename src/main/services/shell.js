// Sessione di shell PERSISTENTE per la modalità terminale della dashboard.
//
// A differenza del modello "uno spawn per comando", qui ogni scheda ha UN
// processo shell di lunga durata, pilotato via stdin. Così variabili d'ambiente,
// `$env:`, alias e directory persistono tra un comando e l'altro — un vero
// terminale. La sessione:
//   - muore quando si chiude la scheda (il modo più intuitivo per uccidere un
//     processo collegato) → vedi ipc.js, hook su 'destroyed';
//   - NON è persistita su disco: alla riapertura di Filo si parte da una shell
//     pulita (comportamento atteso da chi usa un terminale; persistere sarebbe
//     complessità inutile e un rischio di sicurezza in più).
//
// PROTOCOLLO marcatori (validato empiricamente su powershell/cmd/sh):
//   - FILO_RDY_<sid>            riga di "pronto" + prompt da rimuovere (cmd);
//   - FILO_META_<sid>:<code>:<cwd>  fine comando, con exit code e directory.
// I comandi vengono serializzati in coda: ne parte uno alla volta e l'output
// in arrivo è instradato alle callback del comando corrente fino al suo META.
//
// SICUREZZA: esegue comandi arbitrari sulla macchina. È raggiungibile SOLO
// dalle pagine interne filo:// (vedi ipc.js, che rifiuta i sender esterni),
// SOLO con la modalità terminale attiva e SOLO con comandi digitati a mano
// dall'utente — mai output dell'LLM, mai contenuto di pagine web.

const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');

function defaultCwd() {
  return os.homedir();
}

// La cartella iniziale può arrivare da uno stato persistito (#259: "riparti da
// dove eri"): se nel frattempo è stata cancellata/rinominata, spawnare con una
// cwd inesistente farebbe morire la shell. Ripieghiamo sulla home. I path in
// stile Linux passati a WSL (bash su Windows) non sono verificabili con `fs`
// dell'host Windows: li lasciamo passare (li validerà WSL).
function usableCwd(cwd) {
  if (!cwd) return defaultCwd();
  if (process.platform === 'win32' && /^\//.test(cwd)) return cwd;
  try {
    if (fs.statSync(cwd).isDirectory()) return cwd;
  } catch (_) {}
  return defaultCwd();
}

// Identificativo di sessione, improbabile in output reale. Entra nei marcatori.
function randSid() {
  return 'F' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);
}

// Config per shell: come avviare il processo persistente, la riga di "pronto"
// da inviare all'avvio, e come "incartare" un comando utente perché stampi il
// marcatore di fine (exit code + cwd) su una riga propria.
function shellConfig(shell, sid, startCwd) {
  // Fuori da Windows (routine cloud Linux, macOS): /bin/sh persistente. Letto
  // da pipe è non-interattivo → nessun prompt da ripulire.
  if (process.platform !== 'win32') {
    return {
      file: '/bin/sh',
      args: [],
      options: { cwd: startCwd || undefined, windowsHide: true },
      ready: `printf 'FILO_RDY_${sid}\\n'\n`,
      wrap: (command) =>
        `${command}\nprintf 'FILO_META_${sid}:%s:%s\\n' "$?" "$PWD"\n`,
    };
  }
  if (shell === 'cmd') {
    // /q = niente echo dei comandi; /k = resta aperto leggendo da stdin.
    // Cambiamo il prompt nel marcatore RDY ($_ = CRLF): così ogni prompt
    // diventa una riga FILO_RDY_<sid> che rimuoviamo dall'output.
    return {
      file: process.env.ComSpec || 'cmd.exe',
      args: ['/q', '/k'],
      options: { cwd: startCwd || undefined, windowsHide: true },
      ready: `prompt FILO_RDY_${sid}$_\r\n`,
      wrap: (command) =>
        `${command}\r\necho FILO_META_${sid}:%errorlevel%:%cd%\r\n`,
    };
  }
  if (shell === 'bash') {
    // WSL bash persistente. `--cd` accetta sia path Windows sia Linux e imposta
    // la dir iniziale; il resto va via stdin. Letto da pipe → niente prompt.
    const args = ['--cd', startCwd || defaultCwd(), '--', 'bash'];
    return {
      file: 'wsl.exe',
      args,
      options: { windowsHide: true },
      ready: `printf 'FILO_RDY_${sid}\\n'\n`,
      wrap: (command) =>
        `${command}\nprintf 'FILO_META_${sid}:%s:%s\\n' "$?" "$PWD"\n`,
    };
  }
  // PowerShell (default). `-Command -` legge ed esegue da stdin in modo
  // incrementale, senza prompt. Azzeriamo $LASTEXITCODE prima di ogni comando
  // così i cmdlet (che non lo toccano) riportano 0 invece dell'ultimo codice
  // nativo rimasto appeso.
  return {
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-Command', '-'],
    options: { cwd: startCwd || undefined, windowsHide: true },
    ready: `"FILO_RDY_${sid}"\n`,
    wrap: (command) =>
      `$global:LASTEXITCODE=0\n${command}\n` +
      `"FILO_META_${sid}:$($LASTEXITCODE):$((Get-Location).Path)"\n`,
  };
}

// Crea una sessione persistente. Ritorna un oggetto con:
//   exec(command, { onData, onExit, onError })  accoda ed esegue un comando
//   write(text)                                 invia testo grezzo allo stdin
//   kill()                                      termina l'albero di processi
//   shell, cwd, dead                            stato osservabile
//
// Le callback sono PER COMANDO: onData({chunk, stream}), onExit({code, cwd}),
// onError({message}).
function createSession({ shell, cwd } = {}) {
  const sid = randSid();
  const wantShell = process.platform !== 'win32' ? 'sh' : (shell || 'powershell');
  const startCwd = usableCwd(cwd);
  const cfg = shellConfig(wantShell, sid, startCwd);

  const session = {
    shell: shell || 'powershell',
    sid,
    cwd: startCwd,
    dead: false,
    ready: false,
    proc: null,
    queue: [],        // comandi in attesa: { command, cb }
    current: null,    // comando in esecuzione: { cb }
    _buf: '',         // buffer di linea per stdout
    _pendingBlank: 0, // righe vuote in attesa (separatori prompt/marcatore)
    exec, write, kill,
  };

  const META_PREFIX = `FILO_META_${sid}:`;
  const RDY_LINE = `FILO_RDY_${sid}`;

  let proc;
  try {
    proc = spawn(cfg.file, cfg.args, cfg.options);
  } catch (err) {
    session.dead = true;
    session._spawnError = err.message || String(err);
    return session;
  }
  session.proc = proc;
  proc.stdout && proc.stdout.setEncoding('utf8');
  proc.stderr && proc.stderr.setEncoding('utf8');

  proc.stdout && proc.stdout.on('data', onStdout);
  proc.stderr && proc.stderr.on('data', (chunk) => {
    // stderr non passa dal protocollo a righe: lo inoltriamo grezzo al comando
    // corrente (rosso nella bolla). Normalizziamo solo i \r\n.
    if (session.current && session.current.cb.onData) {
      session.current.cb.onData({ chunk: String(chunk).replace(/\r\n/g, '\n'), stream: 'stderr' });
    }
  });
  proc.on('error', (err) => fatal(err.message || String(err)));
  proc.on('close', () => {
    session.dead = true;
    const cur = session.current;
    session.current = null;
    if (cur && cur.cb.onExit) cur.cb.onExit({ code: 0, cwd: session.cwd });
    drainQueueErr('shell terminata');
  });

  // Invia la riga di "pronto": quando la rivediamo in output, la sessione è
  // operativa e svuotiamo la coda.
  try { proc.stdin.write(cfg.ready); } catch (_) {}

  // ── stdout: parsing a righe con soppressione delle righe vuote di prompt ──
  function onStdout(chunk) {
    session._buf += chunk;
    let nl;
    while ((nl = session._buf.indexOf('\n')) !== -1) {
      let line = session._buf.slice(0, nl);
      session._buf = session._buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      processLine(line);
    }
    // Una coda parziale senza newline (es. output con -NoNewline) resta in
    // _buf: la mostriamo subito se NON contiene l'inizio di un marcatore, così
    // i comandi che non terminano con a-capo restano reattivi.
    if (session._buf && session._buf.indexOf(META_PREFIX) === -1 && session._buf !== RDY_LINE) {
      // niente: la teniamo finché non arriva il newline, per non spezzare un
      // eventuale marcatore a metà. (I comandi comuni terminano con newline.)
    }
  }

  function emitOut(text) {
    if (session.current && session.current.cb.onData) {
      session.current.cb.onData({ chunk: text, stream: 'stdout' });
    }
  }

  function flushBlanks() {
    while (session._pendingBlank > 0) { session._pendingBlank--; emitOut('\n'); }
  }

  function processLine(line) {
    // Riga di "pronto"/prompt: segnale di sessione operativa + da rimuovere.
    if (line === RDY_LINE) {
      session._pendingBlank = 0; // la riga vuota che la precede era un separatore
      if (!session.ready) { session.ready = true; pump(); }
      return;
    }
    if (!session.ready) return; // rumore pre-pronto (es. prompt iniziale di cmd)

    // Marcatore di fine comando (può essere "incollato" a output senza newline).
    const idx = line.indexOf(META_PREFIX);
    if (idx !== -1) {
      const before = line.slice(0, idx);
      if (before) { flushBlanks(); emitOut(before); }
      session._pendingBlank = 0;
      const rest = line.slice(idx + META_PREFIX.length);
      const sep = rest.indexOf(':');
      const codeStr = sep === -1 ? '' : rest.slice(0, sep);
      const cwdStr = sep === -1 ? rest : rest.slice(sep + 1);
      const code = codeStr === '' ? 0 : (parseInt(codeStr, 10) || 0);
      if (cwdStr) session.cwd = cwdStr;
      const cur = session.current;
      session.current = null;
      if (cur && cur.cb.onExit) cur.cb.onExit({ code, cwd: session.cwd });
      pump();
      return;
    }

    // Riga vuota: differita. Se segue un prompt/marcatore la scartiamo (è un
    // separatore), altrimenti la emettiamo quando arriva la prossima riga vera.
    if (line === '') { session._pendingBlank++; return; }

    flushBlanks();
    emitOut(line + '\n');
  }

  // ── coda comandi ──────────────────────────────────────────────────────────
  function pump() {
    if (session.dead || session.current || !session.ready) return;
    const next = session.queue.shift();
    if (!next) return;
    session.current = next;
    session._pendingBlank = 0;
    try { proc.stdin.write(cfg.wrap(next.command)); }
    catch (err) {
      session.current = null;
      next.cb.onError && next.cb.onError({ message: err.message || String(err) });
    }
  }

  function exec(command, cb = {}) {
    if (session.dead) {
      cb.onError && cb.onError({ message: session._spawnError || 'shell non disponibile' });
      return;
    }
    session.queue.push({ command: String(command == null ? '' : command), cb });
    pump();
  }

  function write(text) {
    try { proc.stdin && proc.stdin.write(String(text == null ? '' : text)); } catch (_) {}
  }

  function kill() {
    session.dead = true;
    try {
      if (process.platform === 'win32' && proc.pid) {
        // /T termina anche i figli (npm, build, ecc.) che kill() lascerebbe orfani.
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
      } else {
        proc.kill('SIGTERM');
      }
    } catch (_) {}
  }

  function fatal(message) {
    session.dead = true;
    const cur = session.current;
    session.current = null;
    if (cur && cur.cb.onError) cur.cb.onError({ message });
    drainQueueErr(message);
  }

  function drainQueueErr(message) {
    while (session.queue.length) {
      const q = session.queue.shift();
      q.cb.onError && q.cb.onError({ message });
    }
  }

  return session;
}

// Verifica veloce e "usa e getta" se un comando esiste nella shell scelta.
// Serve all'evidenziazione live della dashboard in modalità terminale: un
// "/comando" inesistente va colorato di rosso. È separata dalla sessione
// persistente (che è in streaming) per non interferire con essa.
//
// SICUREZZA: il nome del comando NON viene mai interpolato in una stringa di
// shell né appeso a un `-Command`. Sui resolver POSIX e su `where.exe` viaggia
// come argomento (argv), che non passa da nessuna shell. Su PowerShell viaggia
// in una VARIABILE D'AMBIENTE (`$env:FILO_WHICH_CMD`): il valore di un env non
// viene mai rivalutato come codice, quindi `node;calc` resta la stringa
// "node;calc", non due comandi. (Trappola di Windows PowerShell 5.1: i token
// messi DOPO `-Command '<script>'` NON finiscono in `$args` — vengono
// concatenati ed ESEGUITI. Per questo il nome non tocca mai la riga di
// `-Command`.)
//
// Builtin di cmd.exe che `where` non vede (non sono eseguibili nel PATH).
const CMD_BUILTINS = new Set(['cd', 'dir', 'echo', 'cls', 'copy', 'del', 'move',
  'type', 'set', 'md', 'mkdir', 'rd', 'rmdir', 'ren', 'rename', 'exit',
  'pushd', 'popd', 'title', 'ver', 'vol', 'path', 'start', 'call', 'color']);

// I "probe" per verificare l'esistenza di un comando, in ordine di tentativo:
// si prova il primo, e SOLO se non conferma si passa al successivo. Ogni probe
// è { file, args } e l'esistenza è segnalata da exit code 0.
function existenceProbes({ shell, cmd }) {
  if (process.platform !== 'win32') {
    // Linux/macOS (incluse le routine cloud): /bin/sh, `command -v` copre
    // builtin, funzioni ed eseguibili nel PATH.
    return [{ file: '/bin/sh', args: ['-c', 'command -v "$1" >/dev/null 2>&1', '_', cmd] }];
  }
  if (shell === 'cmd') {
    // cmd.exe: i builtin li abbiamo già coperti a monte; `where` trova gli
    // eseguibili nel PATH.
    return [{ file: 'where.exe', args: [cmd] }];
  }
  if (shell === 'bash') {
    // WSL bash.
    return [{ file: 'wsl.exe', args: ['--', 'bash', '-c', 'command -v "$1" >/dev/null 2>&1', '_', cmd] }];
  }
  // PowerShell (default). `where.exe` PER PRIMO: risolve ogni eseguibile nel
  // PATH in ~100ms ed è affidabile anche con gli shim .ps1/.cmd di npm. NON
  // partire da Get-Command: per quegli shim (es. `firebase.ps1`) deve fare
  // l'analisi dello script e ci mette anche 5s — oltre il timeout — finendo per
  // colorare di rosso un comando perfettamente valido. Get-Command resta come
  // fallback per ciò che `where` non vede: cmdlet, alias e funzioni (ls, cd,
  // Get-ChildItem…). A quel punto NON è mai un eseguibile esterno → niente
  // analisi pesante → risolve in fretta.
  return [
    { file: 'where.exe', args: [cmd] },
    {
      file: 'powershell.exe',
      // Il nome NON è un argomento della riga `-Command` (in 5.1 verrebbe
      // eseguito, non passato in $args): entra come env, che PowerShell tratta
      // come dato. `-Name` prende una stringa, non la rivaluta.
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        'if (Get-Command -Name $env:FILO_WHICH_CMD -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }'],
      env: { FILO_WHICH_CMD: cmd },
    },
  ];
}

// Esegue UN probe e risolve true se il processo esce con codice 0.
function runProbe({ file, args, env: probeEnv }, cwd) {
  return new Promise((resolve) => {
    let done = false;
    let proc;
    const finish = (val) => { if (done) return; done = true; try { proc.kill(); } catch (_) {} resolve(val); };
    try {
      // `env` del probe: il nome del comando da controllare viaggia qui (mai
      // sulla riga di comando di PowerShell), così non può essere eseguito.
      const env = probeEnv ? { ...process.env, ...probeEnv } : undefined;
      proc = spawn(file, args, { cwd: cwd || undefined, env, windowsHide: true, stdio: 'ignore' });
    } catch (_) { resolve(false); return; }
    // Timeout difensivo: un resolver che si impalla non deve restare appeso.
    // Largo di proposito (10s): qui un falso negativo è il danno vero — un
    // comando valido colorato di rosso — mentre una risposta lenta è solo
    // lenta. Sotto carico (antivirus su node_modules fresco, suite di test in
    // parallelo) anche `where.exe` può metterci secondi.
    const timer = setTimeout(() => finish(false), 10000);
    proc.on('error', () => { clearTimeout(timer); finish(false); });
    proc.on('exit', (code) => { clearTimeout(timer); finish(code === 0); });
  });
}

async function commandExists({ shell, cwd, command } = {}) {
  const cmd = String(command == null ? '' : command).trim();
  // Niente da controllare, o token chiaramente non un nome di comando
  // (newline/null): consideralo "non esiste".
  if (!cmd || /[\n\r\0]/.test(cmd)) return false;
  // Builtin cmd.exe: sì senza spawnare nulla.
  if (process.platform === 'win32' && shell === 'cmd' && CMD_BUILTINS.has(cmd.toLowerCase())) {
    return true;
  }
  for (const probe of existenceProbes({ shell, cmd })) {
    if (await runProbe(probe, cwd)) return true;
  }
  return false;
}

// `existenceProbes` è esportata SOLO per il guard di regressione nei test
// ("firebase rosso"): l'ordine dei probe — `where.exe` prima di Get-Command —
// è ciò che tiene veloci gli shim npm, e un assert sul cronometro era rumore
// su una macchina carica.
module.exports = { createSession, defaultCwd, commandExists, existenceProbes };

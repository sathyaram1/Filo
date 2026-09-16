// Sessione di shell PERSISTENTE per la modalità terminale: una shell di lunga durata per scheda, pilotata via stdin, così variabili d'ambiente, alias e directory persistono fra un comando e l'altro. Muore quando si chiude la scheda (ipc.js, hook 'destroyed') e NON si persiste su disco: alla riapertura di Filo si parte da una shell pulita.
// Protocollo dei marcatori: FILO_RDY_<sid> è il "pronto" (e il prompt da rimuovere), FILO_META_<sid>:<code>:<cwd> la fine di un comando. I comandi partono uno alla volta e l'output è instradato alle callback del comando corrente fino al suo META.
// SICUREZZA: esegue comandi arbitrari sulla macchina. Raggiungibile SOLO dalle pagine filo:// (ipc.js rifiuta i sender esterni), SOLO con la modalità terminale attiva e SOLO con comandi digitati a mano dall'utente — mai output dell'LLM, mai contenuto di pagine web.

const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');

function defaultCwd() {
  return os.homedir();
}

// La cartella iniziale può arrivare da uno stato persistito (#259): se nel frattempo è stata cancellata o rinominata, spawnare con una cwd inesistente farebbe morire la shell, quindi si ripiega sulla home. I path in stile Linux passati a WSL non sono verificabili con `fs` di Windows: passano, li valida WSL.
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

// Per ogni shell: come avviare il processo persistente, la riga di "pronto" da inviare all'avvio, e come incartare un comando utente perché stampi il marcatore di fine (exit code + cwd) su una riga propria.
function shellConfig(shell, sid, startCwd) {
  // Fuori da Windows (routine cloud Linux, macOS): /bin/sh persistente. Letto da pipe è non-interattivo, quindi nessun prompt da ripulire.
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
    // /q = niente echo dei comandi, /k = resta aperto leggendo da stdin. Il prompt diventa il marcatore RDY, così ogni prompt è una riga che possiamo rimuovere dall'output.
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
    // WSL bash persistente: `--cd` accetta sia path Windows sia Linux e imposta la dir iniziale. Letto da pipe, niente prompt.
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
  // PowerShell (default): `-Command -` legge ed esegue da stdin in modo incrementale, senza prompt. $LASTEXITCODE si azzera prima di ogni comando, altrimenti i cmdlet (che non lo toccano) riporterebbero l'ultimo codice nativo rimasto appeso.
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

// exec(command, { onData, onExit, onError }) accoda ed esegue; write(text) manda testo grezzo allo stdin; kill() termina l'albero di processi; shell, cwd, dead sono lo stato osservabile.
// Le callback sono PER COMANDO: onData({chunk, stream}), onExit({code, cwd}), onError({message}).
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
    // stderr non passa dal protocollo a righe: si inoltra grezzo al comando corrente (rosso nella bolla), normalizzando solo i \r\n.
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

  // Quando la riga di "pronto" torna in output la sessione è operativa e si svuota la coda.
  try { proc.stdin.write(cfg.ready); } catch (_) {}

  function onStdout(chunk) {
    session._buf += chunk;
    let nl;
    while ((nl = session._buf.indexOf('\n')) !== -1) {
      let line = session._buf.slice(0, nl);
      session._buf = session._buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      processLine(line);
    }
    // Una coda parziale senza newline resta in _buf e si mostra subito solo se NON contiene l'inizio di un marcatore: i comandi che non terminano con a-capo restano reattivi senza rischiare di spezzare un marcatore a metà.
    if (session._buf && session._buf.indexOf(META_PREFIX) === -1 && session._buf !== RDY_LINE) {
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
    // Riga di "pronto"/prompt: segnale di sessione operativa, e da rimuovere.
    if (line === RDY_LINE) {
      session._pendingBlank = 0; // la riga vuota che la precede era un separatore
      if (!session.ready) { session.ready = true; pump(); }
      return;
    }
    if (!session.ready) return; // rumore pre-pronto (es. prompt iniziale di cmd)

    // Marcatore di fine comando: può arrivare "incollato" a output senza newline.
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

    // Riga vuota differita: se segue un prompt o un marcatore è un separatore e si scarta, altrimenti si emette quando arriva la prossima riga vera.
    if (line === '') { session._pendingBlank++; return; }

    flushBlanks();
    emitOut(line + '\n');
  }

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
        // /T termina anche i figli (npm, build…) che kill() lascerebbe orfani.
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

// Verifica "usa e getta" se un comando esiste nella shell scelta: serve all'evidenziazione live della dashboard, dove un "/comando" inesistente va colorato di rosso. Separata dalla sessione persistente per non interferire con lo streaming.
// SICUREZZA: il nome del comando NON viene mai interpolato in una stringa di shell né appeso a un `-Command`. Sui resolver POSIX e su `where.exe` viaggia come argomento (argv), che non passa da nessuna shell; su PowerShell in una VARIABILE D'AMBIENTE, il cui valore non viene mai rivalutato come codice, quindi `node;calc` resta la stringa "node;calc". (Trappola di PowerShell 5.1: i token dopo `-Command '<script>'` NON finiscono in $args, vengono concatenati ed ESEGUITI.)
// Builtin di cmd.exe che `where` non vede, non essendo eseguibili nel PATH.
const CMD_BUILTINS = new Set(['cd', 'dir', 'echo', 'cls', 'copy', 'del', 'move',
  'type', 'set', 'md', 'mkdir', 'rd', 'rmdir', 'ren', 'rename', 'exit',
  'pushd', 'popd', 'title', 'ver', 'vol', 'path', 'start', 'call', 'color']);

// I probe in ordine di tentativo: si prova il primo e SOLO se non conferma si passa al successivo. Ogni probe è { file, args } e l'esistenza è segnalata da exit code 0.
function existenceProbes({ shell, cmd }) {
  if (process.platform !== 'win32') {
    // Linux/macOS (routine cloud incluse): `command -v` copre builtin, funzioni ed eseguibili nel PATH.
    return [{ file: '/bin/sh', args: ['-c', 'command -v "$1" >/dev/null 2>&1', '_', cmd] }];
  }
  if (shell === 'cmd') {
    // cmd.exe: i builtin sono già coperti a monte, `where` trova gli eseguibili nel PATH.
    return [{ file: 'where.exe', args: [cmd] }];
  }
  if (shell === 'bash') {
    return [{ file: 'wsl.exe', args: ['--', 'bash', '-c', 'command -v "$1" >/dev/null 2>&1', '_', cmd] }];
  }
  // `where.exe` PER PRIMO: risolve ogni eseguibile nel PATH in ~100ms ed è affidabile anche con gli shim .ps1/.cmd di npm, mentre Get-Command su quegli shim deve analizzare lo script e può metterci 5s — oltre il timeout — finendo per colorare di rosso un comando valido.
  // Get-Command resta il fallback per ciò che `where` non vede (cmdlet, alias, funzioni): lì non è mai un eseguibile esterno, quindi risolve in fretta.
  return [
    { file: 'where.exe', args: [cmd] },
    {
      file: 'powershell.exe',
      // Il nome entra come env, che PowerShell tratta come dato: sulla riga `-Command` in 5.1 verrebbe eseguito invece che passato in $args. `-Name` prende una stringa e non la rivaluta.
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
      // Il nome del comando da controllare viaggia nell'env del probe, mai sulla riga di comando di PowerShell, così non può essere eseguito.
      const env = probeEnv ? { ...process.env, ...probeEnv } : undefined;
      proc = spawn(file, args, { cwd: cwd || undefined, env, windowsHide: true, stdio: 'ignore' });
    } catch (_) { resolve(false); return; }
    // Timeout difensivo largo di proposito (10s): qui il danno vero è il falso negativo — un comando valido colorato di rosso — mentre una risposta lenta è solo lenta, e sotto carico (antivirus, suite in parallelo) anche `where.exe` può metterci secondi.
    const timer = setTimeout(() => finish(false), 10000);
    proc.on('error', () => { clearTimeout(timer); finish(false); });
    proc.on('exit', (code) => { clearTimeout(timer); finish(code === 0); });
  });
}

async function commandExists({ shell, cwd, command } = {}) {
  const cmd = String(command == null ? '' : command).trim();
  // Niente da controllare, o token che non è un nome di comando (newline/null): "non esiste".
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

// `existenceProbes` è esportata SOLO per il guard di regressione nei test ("firebase rosso"): l'ordine dei probe — `where.exe` prima di Get-Command — è ciò che tiene veloci gli shim npm, e un assert sul cronometro era rumore su una macchina carica.
module.exports = { createSession, defaultCwd, commandExists, existenceProbes };

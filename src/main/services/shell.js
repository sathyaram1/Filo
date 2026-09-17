// Shell persistente per la modalità terminale: una per scheda, così env, alias e cwd durano.
// SICUREZZA: esegue comandi arbitrari — solo da pagine filo://, solo digitati dall'utente,
// mai output dell'LLM o di pagine web. Marcatori: FILO_RDY il pronto, FILO_META la fine.

const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');

function defaultCwd() {
  return os.homedir();
}

// Spawnare con una cwd inesistente (cartella cancellata dopo un ripristino) ucciderebbe la
// shell: si ripiega sulla home. I path Linux passati a WSL li valida WSL, non `fs`.
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

// Per ogni shell: come avviarla, la riga di «pronto», e come incartare un comando utente
// perché stampi il marcatore di fine (exit code + cwd) su una riga propria.
function shellConfig(shell, sid, startCwd) {
  // Fuori da Windows /bin/sh letto da pipe è non-interattivo: nessun prompt da ripulire.
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
    // /q toglie l'echo, /k tiene aperto lo stdin. Il prompt diventa il marcatore RDY, così è
    // una riga riconoscibile da togliere dall'output.
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
    // `--cd` accetta path Windows e Linux; letto da pipe, niente prompt da ripulire.
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
  // `-Command -` esegue da stdin in modo incrementale, senza prompt. $LASTEXITCODE: terminal.js.
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

// exec() accoda, write() manda testo grezzo a stdin, kill() termina l'albero di processi.
// Callback PER COMANDO: onData({chunk,stream}), onExit({code,cwd}), onError({message}).
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
    _buf: '',
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
    // stderr non passa dal protocollo a righe: si inoltra grezzo al comando corrente,
    // normalizzando solo i fine riga.
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
    // Una coda senza newline si mostra subito solo se non contiene l'inizio di un marcatore:
    // restare reattivi non deve costare un marcatore spezzato a metà.
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

    // Riga vuota differita: dopo un prompt o un marcatore è un separatore e si scarta,
    // altrimenti si emette quando arriva la prossima riga vera.
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

// SICUREZZA: il nome del comando non finisce mai su una riga di shell (il perché sta in
// existenceProbes). Sotto: i builtin di cmd che `where` non vede.
const CMD_BUILTINS = new Set(['cd', 'dir', 'echo', 'cls', 'copy', 'del', 'move',
  'type', 'set', 'md', 'mkdir', 'rd', 'rmdir', 'ren', 'rename', 'exit',
  'pushd', 'popd', 'title', 'ver', 'vol', 'path', 'start', 'call', 'color']);

// In ordine: si passa al probe successivo SOLO se il precedente non conferma. Ogni probe è
// { file, args }, e l'esistenza è l'exit code 0.
function existenceProbes({ shell, cmd }) {
  if (process.platform !== 'win32') {
    // `command -v` copre builtin, funzioni ed eseguibili nel PATH.
    return [{ file: '/bin/sh', args: ['-c', 'command -v "$1" >/dev/null 2>&1', '_', cmd] }];
  }
  if (shell === 'cmd') {
    // cmd.exe: i builtin sono già coperti a monte, `where` trova gli eseguibili nel PATH.
    return [{ file: 'where.exe', args: [cmd] }];
  }
  if (shell === 'bash') {
    return [{ file: 'wsl.exe', args: ['--', 'bash', '-c', 'command -v "$1" >/dev/null 2>&1', '_', cmd] }];
  }
  // `where.exe` per primo: regge gli shim .ps1/.cmd di npm in ~100ms, dove Get-Command deve
  // leggere lo script e può sforare il timeout, colorando di rosso un comando valido.
  return [
    { file: 'where.exe', args: [cmd] },
    {
      file: 'powershell.exe',
      // Il nome entra come env, che PowerShell tratta come dato: sulla riga `-Command` in 5.1
      // verrebbe ESEGUITO invece che passato in $args.
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        'if (Get-Command -Name $env:FILO_WHICH_CMD -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }'],
      env: { FILO_WHICH_CMD: cmd },
    },
  ];
}

function runProbe({ file, args, env: probeEnv }, cwd) {
  return new Promise((resolve) => {
    let done = false;
    let proc;
    const finish = (val) => { if (done) return; done = true; try { proc.kill(); } catch (_) {} resolve(val); };
    try {
      // L'env dei probe: vedi existenceProbes.
      const env = probeEnv ? { ...process.env, ...probeEnv } : undefined;
      proc = spawn(file, args, { cwd: cwd || undefined, env, windowsHide: true, stdio: 'ignore' });
    } catch (_) { resolve(false); return; }
    // Timeout largo di proposito: il danno vero è il falso negativo — un comando valido
    // colorato di rosso — mentre una risposta lenta è solo lenta.
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

// existenceProbes è esportata per il test di regressione sull'ORDINE dei probe.
module.exports = { createSession, defaultCwd, commandExists, existenceProbes };

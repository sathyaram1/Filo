// Esecuzione di comandi shell per la modalità terminale della dashboard.
//
// Ogni comando è uno spawn indipendente della shell scelta, con streaming di
// stdout/stderr verso il renderer. Per far "persistere" la directory tra un
// comando e l'altro (così `cd` funziona come in un vero terminale) appendiamo
// al comando dell'utente un sentinel che stampa la directory finale: il main
// lo rimuove dall'output e lo restituisce al renderer, che lo passerà come
// `cwd` del comando successivo. (Limite noto: le variabili d'ambiente NON
// persistono tra un comando e l'altro, perché ogni comando è uno spawn nuovo.)
//
// SICUREZZA: esegue comandi arbitrari sulla macchina. È raggiungibile SOLO
// dalle pagine interne filo:// (vedi ipc.js, che rifiuta i sender esterni) e
// solo quando l'utente ha attivato la modalità terminale nelle Preferenze.

const { spawn } = require('node:child_process');
const os = require('node:os');

// Marcatore poco probabile in output reale (SOH + tag). Lo usiamo per
// estrarre la directory finale dallo stdout del comando.
const SENTINEL = 'FILO_CWD:';

function defaultCwd() {
  return os.homedir();
}

// Costruisce file+args+options per lo spawn in base alla shell scelta.
// Appende al comando dell'utente un'istruzione che stampa la cwd finale,
// preceduta dal SENTINEL.
function buildInvocation(shell, command, cwd) {
  // Fuori da Windows (es. routine cloud Linux, macOS) PowerShell/cmd non
  // esistono: usiamo sempre /bin/sh così la feature e i test restano eseguibili.
  if (process.platform !== 'win32') {
    return {
      file: '/bin/sh',
      args: ['-c', `${command}\nprintf '%s%s\\n' '${SENTINEL}' "$PWD"`],
      options: { cwd, windowsHide: true },
    };
  }
  if (shell === 'cmd') {
    return {
      file: process.env.ComSpec || 'cmd.exe',
      // /d = niente AutoRun del registro; /s /c = esegui la stringa così com'è.
      args: ['/d', '/s', '/c', `${command} & echo ${SENTINEL}%CD%`],
      options: { cwd, windowsHide: true },
    };
  }
  if (shell === 'bash') {
    // WSL: `--cd` accetta sia path Windows sia Linux e imposta la dir iniziale,
    // quindi NON usiamo l'opzione cwd di spawn (sarebbe un path Windows passato
    // a un processo Linux). Il sentinel stampa $PWD (path Linux, es. /mnt/c/...),
    // che torna come cwd del comando successivo (di nuovo via --cd).
    const args = [];
    if (cwd) args.push('--cd', cwd);
    args.push('--', 'bash', '-lc', `${command}; printf '%s%s\\n' '${SENTINEL}' "$PWD"`);
    return { file: 'wsl.exe', args, options: { windowsHide: true } };
  }
  // PowerShell (default)
  return {
    file: 'powershell.exe',
    args: [
      '-NoLogo', '-NoProfile', '-Command',
      `${command}; Write-Output ('${SENTINEL}' + (Get-Location).Path)`,
    ],
    options: { cwd, windowsHide: true },
  };
}

// Estrae la directory dal testo catturato dopo il SENTINEL (prima riga utile).
function parseCwd(raw) {
  if (!raw) return '';
  const line = String(raw).split(/\r?\n/).find((l) => l.trim().length > 0);
  return line ? line.trim() : '';
}

// Avvia un comando. Callback:
//   onData({ chunk, stream })   stream: 'stdout' | 'stderr'
//   onExit({ code, cwd })       cwd: directory dopo il comando (per il next)
//   onError({ message })
// Ritorna { write(text), kill() }.
function runCommand({ shell, command, cwd } = {}, { onData, onExit, onError } = {}) {
  const startCwd = cwd || defaultCwd();
  let child;
  try {
    const inv = buildInvocation(shell || 'powershell', String(command || ''), startCwd);
    child = spawn(inv.file, inv.args, inv.options);
  } catch (err) {
    onError && onError({ message: err.message || String(err) });
    return { write() {}, kill() {} };
  }

  // Estrazione del SENTINEL dallo stdout senza mostrarlo all'utente. Il
  // sentinel compare una sola volta, in coda. Tratteniamo una piccola coda
  // (lunghezza-1 del marker) per gestire un sentinel spezzato tra due chunk.
  let buf = '';
  let sawSentinel = false;
  let cwdCapture = '';
  const HOLD = SENTINEL.length - 1;

  child.stdout && child.stdout.setEncoding('utf8');
  child.stderr && child.stderr.setEncoding('utf8');

  child.stdout && child.stdout.on('data', (chunk) => {
    if (sawSentinel) { cwdCapture += chunk; return; }
    buf += chunk;
    const idx = buf.indexOf(SENTINEL);
    if (idx !== -1) {
      const before = buf.slice(0, idx);
      if (before) onData && onData({ chunk: before, stream: 'stdout' });
      cwdCapture = buf.slice(idx + SENTINEL.length);
      buf = '';
      sawSentinel = true;
      return;
    }
    if (buf.length > HOLD) {
      const emit = buf.slice(0, buf.length - HOLD);
      buf = buf.slice(buf.length - HOLD);
      if (emit) onData && onData({ chunk: emit, stream: 'stdout' });
    }
  });

  child.stderr && child.stderr.on('data', (chunk) => {
    onData && onData({ chunk, stream: 'stderr' });
  });

  child.on('error', (err) => {
    onError && onError({ message: err.message || String(err) });
  });

  child.on('close', (code) => {
    if (!sawSentinel && buf) onData && onData({ chunk: buf, stream: 'stdout' });
    const newCwd = parseCwd(cwdCapture) || startCwd;
    onExit && onExit({ code: code == null ? 0 : code, cwd: newCwd });
  });

  return {
    write(text) {
      try { child.stdin && child.stdin.write(text); } catch (_) {}
    },
    kill() {
      try {
        if (process.platform === 'win32' && child.pid) {
          // taskkill /T termina anche i processi figli (npm, build, ecc.),
          // che `child.kill()` da solo lascerebbe orfani su Windows.
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill('SIGTERM');
        }
      } catch (_) {}
    },
  };
}

module.exports = { runCommand, defaultCwd };

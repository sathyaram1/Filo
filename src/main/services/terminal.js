// Esecuzione di comandi shell per Filo (#146.6): la shell scelta nelle preferenze, un timeout oltre il quale il processo viene ucciso, stdout/stderr catturati e troncati se enormi (la chat non deve esplodere).
// La classificazione di sicurezza NON avviene qui: la fa il gate dei livelli (src/shared/cmdClassify.js + actionLevels.js) PRIMA di chiamare runCommand. Qui si esegue solo ciò che è già stato autorizzato.

const { spawn, execFile } = require('node:child_process');

// Uccide l'INTERO albero: su Windows `child.kill()` non termina i figli, le pipe restano aperte, `close` non scatta e il timeout non libererebbe mai. taskkill /T /F chiude l'albero; su POSIX SIGKILL sul processo basta.
function killTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    try { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {}); return; } catch (_) {}
  }
  try { child.kill('SIGKILL'); } catch (_) {}
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 12_000;

// Shell di default per piattaforma quando la preferenza non è impostata.
function defaultShell() {
  return process.platform === 'win32' ? 'powershell' : 'bash';
}

// Fuori da Windows 'powershell'/'cmd' non esistono (pwsh è raro): si ricade su /bin/sh, esattamente come la shell persistente della modalità terminale, così i comandi dell'assistente girano davvero su Linux/macOS invece di fallire con ENOENT. 'bash' resta bash se esplicitamente preferito.
function resolveShell(shell) {
  const s = String(shell || '').toLowerCase();
  if (process.platform === 'win32') {
    if (s === 'cmd') return 'cmd';
    if (s === 'bash') return 'bash';
    return 'powershell';
  }
  return s === 'bash' ? 'bash' : 'sh';
}

// (programma, argv) per lanciare la shell con un'unica stringa di comando; `shell` qui è già risolto da resolveShell().
function shellInvocation(shell, command) {
  switch (resolveShell(shell)) {
    case 'cmd':
      return { file: 'cmd.exe', args: ['/d', '/s', '/c', command] };
    case 'bash':
      return { file: 'bash', args: ['-c', command] };
    case 'sh':
      return { file: '/bin/sh', args: ['-c', command] };
    case 'powershell':
    default:
      return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] };
  }
}

function truncate(text) {
  const s = String(text || '');
  if (s.length <= MAX_OUTPUT_CHARS) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}

// Marcatore con cui un comando one-shot riporta exit code e cwd risultante: ogni comando parte da una shell nuova, quindi senza questo un `cd` non avrebbe effetto sul comando successivo. La cwd catturata viene ripassata come `cwd` al comando dopo (handlers.js).
const CWD_MARK = '__FILO_ONESHOT_CWD_8b9cb__';

// La sonda gira SEMPRE, anche se il comando fallisce, e riporta l'exit code reale del comando, non il proprio. Specifica per shell.
function withCwdProbe(shell, command) {
  const sh = resolveShell(shell);
  if (sh === 'cmd') {
    // echo gira comunque; %errorlevel% = esito del comando, %cd% = directory.
    return `${command}\r\necho ${CWD_MARK}:%errorlevel%:%cd%`;
  }
  if (sh === 'powershell') {
    // try/finally: il marcatore esce anche su errore terminante. $LASTEXITCODE azzerato prima, così i cmdlet (che non lo toccano) riportano 0.
    return `$global:LASTEXITCODE=0\ntry { ${command} } finally { Write-Output "${CWD_MARK}:$($LASTEXITCODE):$((Get-Location).Path)" }`;
  }
  // bash/sh (routine cloud incluse): $? catturato subito dopo il comando, poi il marcatore su riga propria.
  return `${command}\n__filo_c=$?\nprintf '%s:%s:%s\\n' '${CWD_MARK}' "$__filo_c" "$PWD"`;
}

// Va chiamata PRIMA del troncamento: con un output enorme il marcatore in coda andrebbe perso.
function extractCwdMark(rawStdout) {
  const i = rawStdout.lastIndexOf(CWD_MARK + ':');
  if (i === -1) return { stdout: rawStdout, code: null, cwd: undefined };
  const m = rawStdout.slice(i + CWD_MARK.length + 1).match(/^(-?\d+):([^\r\n]*)/);
  let cut = i;
  if (rawStdout[cut - 1] === '\n') cut--;
  if (rawStdout[cut - 1] === '\r') cut--;
  return {
    stdout: rawStdout.slice(0, cut),
    code: m ? (parseInt(m[1], 10) || 0) : null,
    cwd: m ? (m[2].trim() || undefined) : undefined,
  };
}

// Non rigetta mai: gli errori di spawn finiscono in stderr/code, così il chiamante ha sempre un esito da mostrare.
function runCommand(command, { shell, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, env, trackCwd = false } = {}) {
  const cmd = String(command || '').trim();
  const startedAt = Date.now();
  const usedShell = shell || defaultShell();
  return new Promise((resolve) => {
    if (!cmd) {
      resolve({ command: cmd, stdout: '', stderr: 'Comando vuoto.', code: 1, signal: null, cwd: cwd || undefined, truncated: false, timedOut: false, durationMs: 0 });
      return;
    }
    const toRun = trackCwd ? withCwdProbe(usedShell, cmd) : cmd;
    const { file, args } = shellInvocation(usedShell, toRun);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(file, args, {
        cwd: cwd || undefined,
        env: env || process.env,
        windowsHide: true,
        shell: false,
      });
    } catch (e) {
      resolve({ command: cmd, stdout: '', stderr: `Impossibile avviare la shell: ${e && e.message ? e.message : e}`, code: 127, signal: null, truncated: false, timedOut: false, durationMs: Date.now() - startedAt });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, Math.max(1000, timeoutMs));

    const cap = (chunk, which) => {
      const s = chunk.toString();
      if (which === 'out') { if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += s; }
      else if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += s;
    };
    if (child.stdout) child.stdout.on('data', (c) => cap(c, 'out'));
    if (child.stderr) child.stderr.on('data', (c) => cap(c, 'err'));

    child.on('error', (e) => {
      stderr += (stderr ? '\n' : '') + (e && e.message ? e.message : String(e));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let rawOut = stdout;
      let realCode = typeof code === 'number' ? code : (timedOut ? 124 : 1);
      let resultCwd = trackCwd ? (cwd || undefined) : undefined;
      if (trackCwd) {
        // La sonda è l'ULTIMO comando eseguito: l'exit code del processo è il suo, non quello del comando. Si prendono entrambi dal marcatore.
        const parsed = extractCwdMark(rawOut);
        rawOut = parsed.stdout;
        if (parsed.code !== null) realCode = parsed.code;
        if (parsed.cwd) resultCwd = parsed.cwd;
      }
      const out = truncate(rawOut);
      const err = truncate(stderr);
      resolve({
        command: cmd,
        stdout: out.text,
        stderr: err.text,
        code: realCode,
        signal: signal || null,
        cwd: resultCwd,
        truncated: out.truncated || err.truncated,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

module.exports = { runCommand, shellInvocation, defaultShell, MAX_OUTPUT_CHARS, DEFAULT_TIMEOUT_MS };

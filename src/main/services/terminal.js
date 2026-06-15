// Esecuzione di comandi shell per Filo (#146.6).
//
// Il main process esegue il comando EFFETTIVO deciso dall'utente, con:
//   • la shell scelta nelle preferenze (powershell | cmd | bash);
//   • un timeout, oltre il quale il processo viene ucciso;
//   • cattura di stdout/stderr, troncati se enormi (la chat non deve esplodere).
//
// La classificazione di sicurezza NON avviene qui: la fa il gate dei livelli
// (src/shared/cmdClassify.js + actionLevels.js) PRIMA di chiamare runCommand.
// Qui ci limitiamo a eseguire ciò che è già stato autorizzato.

const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 12_000;

// Shell di default per piattaforma quando la preferenza non è impostata.
function defaultShell() {
  return process.platform === 'win32' ? 'powershell' : 'bash';
}

// (programma, argv) per lanciare la shell con un'unica stringa di comando.
function shellInvocation(shell, command) {
  switch (String(shell || '').toLowerCase()) {
    case 'cmd':
      return { file: 'cmd.exe', args: ['/d', '/s', '/c', command] };
    case 'bash':
      return { file: 'bash', args: ['-c', command] };
    case 'powershell':
    default: {
      const ps = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
      return { file: ps, args: ['-NoProfile', '-NonInteractive', '-Command', command] };
    }
  }
}

function truncate(text) {
  const s = String(text || '');
  if (s.length <= MAX_OUTPUT_CHARS) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}

// Esegue `command` e risolve con { command, stdout, stderr, code, signal,
// truncated, timedOut, durationMs }. Non rigetta mai: gli errori di spawn
// finiscono in stderr/code così il chiamante può sempre mostrare un esito.
function runCommand(command, { shell, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, env } = {}) {
  const cmd = String(command || '').trim();
  const startedAt = Date.now();
  return new Promise((resolve) => {
    if (!cmd) {
      resolve({ command: cmd, stdout: '', stderr: 'Comando vuoto.', code: 1, signal: null, truncated: false, timedOut: false, durationMs: 0 });
      return;
    }
    const { file, args } = shellInvocation(shell || defaultShell(), cmd);
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
      try { child.kill('SIGKILL'); } catch (_) {}
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
      const out = truncate(stdout);
      const err = truncate(stderr);
      resolve({
        command: cmd,
        stdout: out.text,
        stderr: err.text,
        code: typeof code === 'number' ? code : (timedOut ? 124 : 1),
        signal: signal || null,
        truncated: out.truncated || err.truncated,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

module.exports = { runCommand, shellInvocation, defaultShell, MAX_OUTPUT_CHARS, DEFAULT_TIMEOUT_MS };

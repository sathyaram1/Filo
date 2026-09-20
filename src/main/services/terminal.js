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

const { spawn, execFile } = require('node:child_process');

// Uccide l'INTERO albero del processo. Su Windows `child.kill()` non termina i
// figli (es. una shell che ne lancia un'altra): le pipe restano aperte e la
// `close` non scatta → il timeout non libererebbe mai. taskkill /T /F chiude
// l'albero. Su POSIX SIGKILL sul processo basta nei casi comuni.
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
//
// Fuori da Windows è la shell di SISTEMA, non bash: dev'essere lo stesso
// ripiego di resolveShell() qui sotto, che è quello su cui cade la sessione
// persistente della modalità terminale. Quando erano diversi, i comandi
// dell'assistente partivano da bash e il terminale da /bin/sh: due strade
// equivalenti che rispondevano con due shell diverse, e lo stesso comando
// poteva comportarsi in modo diverso a seconda di dove lo scrivevi.
function defaultShell() {
  return process.platform === 'win32' ? 'powershell' : 'sh';
}

// Risolve la shell RICHIESTA in quella EFFETTIVAMENTE disponibile sulla
// piattaforma. Fuori da Windows, 'powershell'/'cmd' non esistono (pwsh è
// raramente installato) → ricadiamo su /bin/sh, ESATTAMENTE come fa la shell
// persistente della modalità terminale (src/main/services/shell.js, che fuori
// da Windows usa sempre /bin/sh). Così i comandi dell'assistente girano davvero
// anche su Linux/macOS invece di fallire con ENOENT, e le due shell restano
// coerenti. 'bash' resta bash se esplicitamente preferito.
function resolveShell(shell) {
  const s = String(shell || '').toLowerCase();
  if (process.platform === 'win32') {
    if (s === 'cmd') return 'cmd';
    if (s === 'bash') return 'bash';
    return 'powershell';
  }
  return s === 'bash' ? 'bash' : 'sh';
}

// (programma, argv) per lanciare la shell EFFETTIVA con un'unica stringa di
// comando. `shell` qui è già risolto da resolveShell().
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

// ── La shell deve PARLARE UTF-8 ───────────────────────────────────────────────
//
// #551. Su Windows la console non scrive in UTF-8: scrive nella tabella OEM del
// sistema (cp850 dalle nostre parti). Lì dentro il trattino lungo «—» non
// esiste e diventa «-», e la «à» diventa un byte che in UTF-8 non vuol dire
// niente e arriva qui come «<27>». Noi leggiamo lo stdout come UTF-8 — ed è
// giusto così — quindi il modello vedeva nomi di file SBAGLIATI, li ricopiava
// nel comando dopo (o nel percorso da leggere), e ogni passo successivo
// falliva in modo onesto su un nome che non è mai esistito. Visto dal vivo:
// «SPECIFICHE SEO E METADATI — singolarita.txt» elencato come «… - singolarita»
// e poi non più ritrovato. Riguarda qualunque nome con accenti o segni
// tipografici, cioè moltissimi file di un utente italiano.
//
// La cura sta a monte: si chiede alla shell di scrivere in UTF-8 prima ancora
// che il comando dell'utente parta. Non è cosmetico e non è filtrabile a valle:
// una volta che «à» è diventata un byte invalido, l'informazione è persa.
//
// Il preludio è SEMPRE anteposto (non solo con la sonda della cartella): un
// comando senza sonda ha lo stesso identico problema.
// I preludi, per shell EFFETTIVA. Vivono qui e basta: la shell persistente
// della modalità terminale (shell.js) li prende da qui invece di tenerne una
// copia, così non possono divergere — e ognuno finisce già con l'a-capo,
// perché va anteposto sia a una riga di comando sia a uno stdin.
const PRELUDI_CODIFICA = {
  // 65001 = UTF-8. `>nul` perché `chcp` stampa una riga ("Tabella codici
  // attiva: 65001") che finirebbe in testa all'output del comando.
  cmd: 'chcp 65001>nul\r\n',
  // Due codifiche, due lavori diversi, servono entrambe:
  //   [Console]::OutputEncoding → con cosa la console scrive su stdout (è
  //     questa che rovinava i nomi);
  //   $OutputEncoding           → con cosa PowerShell scrive quando passa
  //     testo in pipe a un programma esterno.
  // UTF8Encoding($false) = senza BOM: il BOM comparirebbe come «ï»¿» in testa
  // alla prima riga. Tutte e due in try/catch: il setter di [Console] può
  // rifiutare quando non c'è una console vera attaccata, e `New-Object` è
  // vietato dove PowerShell gira in modalità ristretta. In quei casi il
  // comando dell'utente deve girare lo stesso — con i nomi storpiati, come
  // prima — non morire sul preludio né sporcare stderr con un errore suo.
  powershell: 'try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}\n'
    + 'try { $OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}\n',
  // bash / sh: nessun preludio. Su Linux e macOS lo stdout è già UTF-8 e
  // forzare una locale che sulla macchina può non esistere farebbe solo danno.
  bash: '',
  sh: '',
};

function encodingPrelude(shell) {
  return PRELUDI_CODIFICA[resolveShell(shell)] || '';
}

// Marcatore (improbabile in output reale) con cui un comando one-shot riporta
// l'exit code e la cwd RISULTANTE. Serve a far PERSISTERE la cwd tra i comandi
// dell'assistente: ogni comando parte da una shell nuova, quindi senza questo un
// `cd` non avrebbe effetto sul comando successivo. La cwd catturata viene
// ripassata come `cwd` al comando seguente (vedi handlers.js).
const CWD_MARK = '__FILO_ONESHOT_CWD_8b9cb__';

// Appende al comando una "sonda" che stampa CWD_MARK:<exitcode>:<cwd>. La sonda
// gira SEMPRE (anche se il comando fallisce) e cattura l'exit code reale del
// comando, non quello della sonda. Specifica per shell.
function withCwdProbe(shell, command) {
  const sh = resolveShell(shell);
  if (sh === 'cmd') {
    // echo gira comunque; %errorlevel% = esito del comando, %cd% = directory.
    return `${command}\r\necho ${CWD_MARK}:%errorlevel%:%cd%`;
  }
  if (sh === 'powershell') {
    // try/finally: il marcatore esce anche su errore terminante. Azzeriamo
    // $LASTEXITCODE prima così i cmdlet (che non lo toccano) riportano 0.
    return `$global:LASTEXITCODE=0\ntry { ${command} } finally { Write-Output "${CWD_MARK}:$($LASTEXITCODE):$((Get-Location).Path)" }`;
  }
  // bash / sh (incluse le routine cloud Linux): cattura $? subito dopo il
  // comando, poi stampa il marcatore (sempre eseguito, su riga propria).
  return `${command}\n__filo_c=$?\nprintf '%s:%s:%s\\n' '${CWD_MARK}' "$__filo_c" "$PWD"`;
}

// Estrae dal grezzo stdout il marcatore CWD_MARK (se presente), ritornando
// l'output ripulito + { code, cwd } dal marcatore. Va chiamato PRIMA del
// troncamento, così non si perde il marcatore in coda quando l'output è enorme.
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

// Esegue `command` e risolve con { command, stdout, stderr, code, signal,
// truncated, timedOut, durationMs }. Non rigetta mai: gli errori di spawn
// finiscono in stderr/code così il chiamante può sempre mostrare un esito.
function runCommand(command, { shell, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, env, trackCwd = false } = {}) {
  const cmd = String(command || '').trim();
  const startedAt = Date.now();
  const usedShell = shell || defaultShell();
  return new Promise((resolve) => {
    if (!cmd) {
      resolve({ command: cmd, stdout: '', stderr: 'Comando vuoto.', code: 1, signal: null, cwd: cwd || undefined, truncated: false, timedOut: false, durationMs: 0 });
      return;
    }
    // Con trackCwd appendiamo la sonda che riporta exit code + cwd risultante,
    // così un `cd` persiste tra i comandi dell'assistente. Davanti a tutto il
    // preludio che mette la shell in UTF-8 (#551), altrimenti i nomi con
    // accenti e trattini lunghi tornano storpiati.
    const toRun = encodingPrelude(usedShell) + (trackCwd ? withCwdProbe(usedShell, cmd) : cmd);
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
        // La sonda è l'ULTIMO comando eseguito: l'exit code del processo è il
        // suo (0), non quello del comando. Prendiamo entrambi dal marcatore.
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

module.exports = {
  runCommand, shellInvocation, resolveShell, defaultShell, MAX_OUTPUT_CHARS, DEFAULT_TIMEOUT_MS,
  // esportati per gli unit test (il preludio UTF-8 e la sonda sono la parte
  // che si può verificare senza avviare una shell su ogni piattaforma).
  encodingPrelude, withCwdProbe, PRELUDI_CODIFICA,
};

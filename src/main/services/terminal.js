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
  // Il taglio cade dove capita, e un'emoji occupa DUE unità di testo: tagliando
  // per numero di unità si può restare con la prima metà, che da sola non è
  // nessun carattere e si mostra come un rombo. Se in fondo resta una metà di
  // coppia, la si lascia fuori: un carattere in meno, nessun carattere rotto.
  let n = MAX_OUTPUT_CHARS;
  const ultimo = s.charCodeAt(n - 1);
  if (ultimo >= 0xD800 && ultimo <= 0xDBFF) n -= 1;
  return { text: s.slice(0, n), truncated: true };
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
  // `chcp` PRIMA delle due righe .NET, e per due motivi distinti:
  //   • cambia la tabella della CONSOLE, quella che i programmi esterni usano
  //     sia per scrivere sia per LEGGERE. Senza, dire a PowerShell «i programmi
  //     esterni parlano UTF-8» (la riga dopo) è una bugia quando il programma
  //     scrive ancora in OEM;
  //   • è anche l'unica cura per il verso opposto: quello che l'utente digita
  //     nella casella di risposta a un programma in corso arriva a quel
  //     programma come byte grezzi, e con la tabella vecchia una parola
  //     accentata gli arrivava diversa (#551, terzo giro di verifica). Con
  //     `cmd` questo non succedeva perché lì `chcp` c'era già.
  // In try/catch e con l'uscita buttata via: se non c'è una console vera
  // attaccata `chcp` fallisce, e deve fallire in silenzio senza fermare niente.
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
  powershell: 'try { chcp 65001 > $null } catch {}\n'
    + 'try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}\n'
    + 'try { $OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}\n',
  // bash / sh: nessun preludio. Su Linux e macOS lo stdout è già UTF-8 e
  // forzare una locale che sulla macchina può non esistere farebbe solo danno.
  bash: '',
  sh: '',
};

function encodingPrelude(shell) {
  return PRELUDI_CODIFICA[resolveShell(shell)] || '';
}

// ── La riga di servizio non si fa scrivere da fuori ───────────────────────────
//
// Marcatore con cui un comando one-shot riporta l'exit code e la cwd
// RISULTANTE. Serve a far PERSISTERE la cwd tra i comandi dell'assistente: ogni
// comando parte da una shell nuova, quindi senza questo un `cd` non avrebbe
// effetto sul comando successivo. La cwd catturata viene ripassata come `cwd`
// al comando seguente (vedi handlers.js).
//
// #551, ottavo giro di verifica. Quella riga la scrive Filo, ma arriva
// MESCOLATA a quello che il comando ha stampato — e quello che un comando
// stampa lo scrive chi ha scritto il file letto, la pagina scaricata, la
// risposta del servizio. Finché il segno che la distingue era una costante
// scritta nel programma, uguale a ogni avvio e su ogni macchina, chiunque
// poteva scriversela: bastava che il file letto la contenesse e che l'uscita
// del comando fosse abbastanza lunga da far cadere quella vera. Da lì in poi
// Filo credeva di essere in una cartella scelta da un estraneo, ci faceva
// girare il comando dopo, e la annunciava nel popup di conferma come se fosse
// la sua; e un comando fallito risultava riuscito.
//
// Adesso il marcatore porta dentro un numero a caso, diverso a OGNI comando:
// è la stessa difesa che la shell persistente del terminale della dashboard ha
// da sempre (shell.js, `randSid`), e che infatti non ha mai avuto questo
// guasto. Il prefisso resta fisso perché le guardie che controllano che il
// marcatore non finisca sotto gli occhi dell'utente lo cercano per nome.
const CWD_MARK_PREFIX = '__FILO_ONESHOT_CWD_';

function nuovoMarcatore() {
  return CWD_MARK_PREFIX
    + Math.random().toString(36).slice(2, 10)
    + Date.now().toString(36).slice(-5);
}

// L'esito di un comando PowerShell, con $__filo_ok = il $? preso subito dopo. $LASTEXITCODE lo scrivono solo
// i programmi esterni: un cmdlet fallito lo lascia a 0, e a dirlo resta $? (#714). Vale anche per shell.js.
const ESITO_POWERSHELL = 'if ($__filo_ok) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }';

// Appende al comando una "sonda" che stampa <marcatore>:<exitcode>:<cwd>. La
// sonda gira SEMPRE (anche se il comando fallisce) e cattura l'exit code reale
// del comando, non quello della sonda. Specifica per shell.
function withCwdProbe(shell, command, mark = nuovoMarcatore()) {
  const sh = resolveShell(shell);
  if (sh === 'cmd') {
    // echo gira comunque; %errorlevel% = esito del comando, %cd% = directory.
    return `${command}\r\necho ${mark}:%errorlevel%:%cd%`;
  }
  if (sh === 'powershell') {
    // Il comando su righe sue: un commento in coda si mangiava la chiusura del try. Se non arriva in fondo
    // (exit, errore che ferma tutto) l'esito resta vuoto e lo dà il codice del processo, l'unico che lo sa.
    return `$global:LASTEXITCODE=0\n$__filo_c=''\ntry {\n${command}\n$__filo_ok=$?\n$__filo_c=${ESITO_POWERSHELL}\n}`
      + ` finally { Write-Output "${mark}:$($__filo_c):$((Get-Location).Path)" }`;
  }
  // bash / sh (incluse le routine cloud Linux): cattura $? subito dopo il
  // comando, poi stampa il marcatore (sempre eseguito, su riga propria).
  return `${command}\n__filo_c=$?\nprintf '%s:%s:%s\\n' '${mark}' "$__filo_c" "$PWD"`;
}

// Estrae dal grezzo stdout il marcatore (se presente), ritornando l'output
// ripulito + { code, cwd } dal marcatore. Va chiamato PRIMA del troncamento,
// così non si perde il marcatore in coda quando l'output è enorme.
function extractCwdMark(rawStdout, mark) {
  const i = rawStdout.lastIndexOf(mark + ':');
  if (i === -1) return { stdout: rawStdout, code: null, cwd: undefined };
  const m = rawStdout.slice(i + mark.length + 1).match(/^(-?\d+):([^\r\n]*)/);
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
    const mark = trackCwd ? nuovoMarcatore() : '';
    const toRun = encodingPrelude(usedShell) + (trackCwd ? withCwdProbe(usedShell, cmd, mark) : cmd);
    const { file, args } = shellInvocation(usedShell, toRun);
    // La cartella può non esistere più: rinominata, cancellata, su una
    // chiavetta staccata (#551, quarto giro). Lì dentro non fallisce il
    // comando, fallisce la shell prima di leggerlo, e la cartella appuntata
    // resta quella morta: ogni comando dopo cade allo stesso modo, compreso
    // quello per andarsene. Si ripiega sulla home e lo si DICE, perché il
    // modello possa riferirlo invece di raccontare che manca PowerShell.
    // Il controllo vive in shell.js, accanto a quello che la shell persistente
    // del terminale usa da sempre: una copia qui divergerebbe.
    let cartella = cwd || undefined;
    let cartellaPersa = false;
    if (cwd) {
      try {
        const scelta = require('./shell').cartellaPerComando(cwd);
        cartella = scelta.cwd;
        cartellaPersa = scelta.persa;
      } catch (_) {}
    }
    let stdout = '';
    let codaOut = ''; // ultimi caratteri dello stdout, anche oltre il tetto
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(file, args, {
        cwd: cartella,
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

    // L'output NON arriva in un pezzo solo: arriva man mano, e ogni pezzo
    // finisce dove capita. Una «à» occupa due byte, un'emoji quattro: se la
    // lettura cade in mezzo e si trasforma in testo un pezzo per volta, quei
    // byte non vogliono dire niente né di qua né di là e diventano rombi. Il
    // nome torna storpiato come prima del preludio UTF-8, su Windows come su
    // Linux, perché qui la shell non c'entra: c'entra dove cade la lettura
    // (#551, secondo giro di verifica). `setEncoding` mette davanti allo
    // stream il decodificatore che tiene da parte i byte di un carattere
    // ancora incompleto e li riattacca al pezzo dopo. È lo stesso che fa la
    // shell persistente del terminale della dashboard, che infatti non ha mai
    // avuto questo guasto: le due strade adesso leggono allo stesso modo.
    if (child.stdout) child.stdout.setEncoding('utf8');
    if (child.stderr) child.stderr.setEncoding('utf8');
    // Oltre il tetto non si accumula più — ma la CODA va tenuta comunque: lì
    // c'è il marcatore con cui la shell riporta la cartella in cui è finita e
    // com'è andato il comando. Senza, proprio i comandi che stampano tanto (una
    // ricerca dentro una cartella grande, cioè quello che Filo fa quando non sa
    // ancora dove sta il file) perdevano il loro `cd` e risultavano riusciti
    // anche quando erano falliti (#551, terzo giro di verifica). Il marcatore
    // più un percorso lungo stanno in poche centinaia di caratteri: la finestra
    // è larga con abbondanza, e costa quanto una riga di testo.
    const CODA_CHARS = 8192;
    const cap = (chunk, which) => {
      const s = String(chunk);
      if (which === 'out') {
        codaOut = codaOut.length + s.length > CODA_CHARS ? (codaOut + s).slice(-CODA_CHARS) : codaOut + s;
        if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += s;
      } else if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += s;
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
      let resultCwd = trackCwd ? (cartella || undefined) : undefined;
      if (trackCwd) {
        // La sonda è l'ULTIMO comando eseguito: l'exit code del processo è il
        // suo (0), non quello del comando. Cartella ed esito si leggono dalla
        // CODA, che è l'unico pezzo di uscita tenuto per intero fino alla fine:
        // `rawOut` smette di accumulare al tetto, quindi proprio sui comandi che
        // stampano tanto la riga vera lì non c'è più. Prima si guardava `rawOut`
        // per primo, e bastava che dentro l'uscita ce ne fosse un'altra perché
        // vincesse quella (#551, ottavo giro di verifica).
        const inCoda = extractCwdMark(codaOut, mark);
        const parsed = extractCwdMark(rawOut, mark);
        rawOut = parsed.stdout;
        const letto = inCoda.code !== null ? inCoda : parsed;
        if (letto.code !== null) realCode = letto.code;
        if (letto.cwd) resultCwd = letto.cwd;
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
        // La cartella chiesta non c'era più e il comando è girato nella home.
        // Chi formatta l'esito per il modello lo riporta, così l'utente sente
        // la causa vera invece di un guasto inventato (#551, quarto giro).
        cwdPersa: cartellaPersa || undefined,
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
  // il marcatore della sonda: il prefisso è fisso, il resto è a caso a ogni
  // comando, ed è quello che impedisce all'uscita di scriverselo (#551, ottavo
  // giro di verifica).
  CWD_MARK_PREFIX, nuovoMarcatore,
};

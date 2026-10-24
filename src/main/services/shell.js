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
// PROTOCOLLO marcatori (powershell/cmd/sh):
//   - FILO_RDY_<sid>            riga di "pronto" (e prompt da rimuovere, con cmd);
//   - FILO_META_<sid>:<code>:<cwd>  fine comando, con exit code e directory.
// I comandi vengono serializzati in coda: ne parte uno alla volta e l'output
// in arrivo è instradato alle callback del comando corrente fino al suo META.
//
// SICUREZZA: esegue comandi arbitrari sulla macchina. Via ipc.js è raggiungibile
// SOLO dalle pagine interne filo://, con la modalità terminale attiva e con
// comandi digitati a mano dall'utente. L'altro chiamante è il comando one-shot
// dell'assistente con cmd (terminal.js), che arriva già passato dal gate dei livelli.

const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
// Quale shell gira davvero, dato quella chiesta e il sistema: la regola è una
// sola e sta in terminal.js. Erano due: i comandi dell'assistente onoravano
// "bash" fuori da Windows, questa sessione ricadeva sempre su /bin/sh — cioè
// su Linux e Mac la voce "Bash" delle Preferenze non faceva niente.
// I preludi che mettono la shell di Windows in UTF-8 (#551) stanno in un posto
// solo, accanto ai comandi one-shot dell'assistente: due copie divergono.
const { resolveShell, PRELUDI_CODIFICA, righePowerShell, invocaCodificato, PREPARA_STDIN_POWERSHELL, ambienteComandi } = require('./terminal');

function defaultCwd() {
  return os.homedir();
}

// ── Il comando dell'UTENTE viaggia verso PowerShell per lo stdin ─────────────
//
// #551, l'altro verso. Il preludio mette la shell in UTF-8 quando SCRIVE, e i
// nomi che escono tornano interi. Quando LEGGE, no: Windows PowerShell
// decodifica lo stdin con la tabella di codici della console (quella OEM),
// mentre Node gli scrive UTF-8. Un comando che contiene «attività» arriva alla
// shell con un nome diverso da quello digitato, e lei risponde che il file non
// esiste. È il guasto della segnalazione, dalla parte opposta. Con cmd succede
// lo stesso, per un'altra via: vedi comandoPerCmd.
//
// Toccare `[Console]::InputEncoding` sarebbe peggio del male. Il setter di .NET
// butta via il lettore dello stdin, e con lui tutto quello che aveva già letto
// in avanti: la riga di «pronto» parte nello stesso pezzo del preludio, quindi
// andrebbe persa e la sessione resterebbe muta per sempre.
//
// La cura è non far viaggiare caratteri non ASCII sul filo: il comando parte con i caratteri speciali scritti come
// numeri e lo rimette insieme PowerShell, senza passare da nessuna tabella. Sempre, non solo per gli accenti, perché
// il testo serve anche come dato a chi conta gli esiti dei programmi (#718, terminal.js); gira nello scope di chi
// chiama, quindi variabili, cartella ed `exit` restano quelli di un terminale vero.
const SOLO_ASCII = /^[\x00-\x7F]*$/;

function comandoPerPowerShell(command, coda = '') {
  return invocaCodificato(String(command == null ? '' : command), coda);
}

// cmd legge lo stdin di una pipe un byte per volta e decodifica ogni byte da solo con la tabella attiva: con 65001
// i byte di «à» o «—» diventano rombi, con una tabella a un byte passa solo ciò che quella tabella contiene (#1044).
// Sul filo vanno quindi solo caratteri ASCII: i tratti con caratteri non ASCII stanno in file UTF-8 che `set /p`
// legge a righe intere, e il comando li richiama come %variabili%, espanse prima che cmd guardi virgolette e
// redirezioni. Un tratto non contiene `%`, così le variabili e i `%f` del `for` scritti dall'utente restano suoi.
// Tetti: `set /p` legge 1023 byte per riga (200 caratteri da 4 byte ci stanno) e una riga di cmd ne tiene 8191
// (100 letture per riga e per file).
const PEZZO_CMD = 200;
const LETTURE_PER_FILE = 100;
const VALORI_CMD = 'FILO_VALORI_CMD';

function comandoPerCmd(command) {
  const cmd = String(command == null ? '' : command);
  if (SOLO_ASCII.test(cmd)) return { testo: cmd, file: [] };
  const valori = [];
  const nomi = new Map();
  const richiama = (pezzo) => {
    if (!nomi.has(pezzo)) { valori.push(pezzo); nomi.set(pezzo, `FILO_U${valori.length}`); }
    return `%${nomi.get(pezzo)}%`;
  };
  const testo = cmd.replace(/[^\x00-\x7F](?:[^%\r\n]*[^\x00-\x7F])?/g, (tratto) => {
    const caratteri = Array.from(tratto);
    let s = '';
    for (let i = 0; i < caratteri.length; i += PEZZO_CMD) s += richiama(caratteri.slice(i, i + PEZZO_CMD).join(''));
    return s;
  });
  const file = [];
  const letture = [];
  for (let i = 0; i < valori.length; i += LETTURE_PER_FILE) {
    const gruppo = valori.slice(i, i + LETTURE_PER_FILE);
    file.push(`${gruppo.join('\r\n')}\r\n`);
    const set = gruppo.map((_, j) => `set /p "FILO_U${i + j + 1}="`).join(' & ');
    letture.push(`(${set})<"%${VALORI_CMD}%-${file.length}.txt"`);
  }
  return { testo: `${letture.join('\r\n')}\r\n${testo}`, file };
}

// Quella cartella c'è ancora, ed è una cartella? La domanda si fa qui per
// tutti, perché la risposta sia la stessa nei tre punti che la fanno: la shell
// persistente quando nasce, il comando one-shot dell'assistente quando parte, e
// il popup che dice all'utente in quale cartella quel comando scriverà.
function cartellaViva(p) {
  if (!p) return false;
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

// Le lettere d'unità viste puntare a un altro computer: `pushd \\host\x` di cmd ne crea una, e da lì un `dir`
// manda nomi a quel computer come col percorso scritto per intero (#1072). Fuori da Windows non ci sono lettere.
const _unita = new Map();
function unitaDiRete(cwd, { win = process.platform === 'win32', realpath = (p) => fs.realpathSync.native(p) } = {}) {
  if (!win) return [];
  const m = /^([A-Za-z]):/.exec(String(cwd || ''));
  const u = m && `${m[1].toLowerCase()}:`;
  if (u && !_unita.has(u)) {
    // Windows risolve un'unità di rete nel suo percorso `\\host\cartella`; un errore non si ricorda, si riprova.
    try { _unita.set(u, /^(?:[\\/]{2}[^\\/?.]|\\\\\?\\UNC\\)/i.test(realpath(`${u}\\`))); } catch (_) {}
  }
  return [..._unita].filter(([, rete]) => rete).map(([u]) => u);
}

// La cartella iniziale può arrivare da uno stato persistito (#259: "riparti da
// dove eri"): se nel frattempo è stata cancellata/rinominata, spawnare con una
// cwd inesistente farebbe morire la shell. Ripieghiamo sulla home. I path in
// stile Linux passati a WSL (bash su Windows) non sono verificabili con `fs`
// dell'host Windows: li lasciamo passare (li validerà WSL).
function usableCwd(cwd) {
  if (!cwd) return defaultCwd();
  if (process.platform === 'win32' && /^\//.test(cwd)) return cwd;
  return cartellaViva(cwd) ? cwd : defaultCwd();
}

// La cartella in cui far girare DAVVERO un comando, più la notizia che quella
// chiesta non c'è più.
//
// #551, quarto giro di verifica. La cartella in cui Filo sta guardando può
// sparire sotto i piedi: l'utente la rinomina mentre riordina, stacca la
// chiavetta, o la cancella Filo stesso perché gliel'ha chiesto. Avviare una
// shell lì dentro non fa fallire il COMANDO: fa fallire la shell prima ancora
// di leggerlo, con un motivo che parla del programma («spawn … ENOENT») e non
// della cartella. E siccome la cartella resta appuntata, da quello stato non si
// esce più nemmeno chiedendo di andare altrove: in quella scheda il terminale
// dell'assistente è finito finché l'utente non la chiude. Il terminale che
// l'utente digita a mano questo controllo ce l'ha da sempre (qui sopra), e
// infatti riparte dalla home e continua a funzionare: erano due strade
// equivalenti con esiti diversi.
//
// Il ripiego è la home, la stessa da cui il terminale parte. Se non esiste
// nemmeno quella (profilo su un disco di rete staccato) si lascia decidere al
// sistema invece di insistere su un percorso che non c'è.
function cartellaPerComando(cwd) {
  const chiesta = String(cwd || '');
  if (chiesta && cartellaViva(chiesta)) return { cwd: chiesta, persa: false };
  const casa = defaultCwd();
  return { cwd: cartellaViva(casa) ? casa : undefined, persa: !!chiesta };
}

// Identificativo di sessione, improbabile in output reale. Entra nei marcatori.
function randSid() {
  return 'F' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);
}

// Config per shell: come avviare il processo persistente, la riga di "pronto"
// da inviare all'avvio, e come "incartare" un comando utente perché stampi il
// marcatore di fine (exit code + cwd) su una riga propria.
function shellConfig(shell, sid, startCwd, { env, autoRun = true } = {}) {
  const ambiente = { env: ambienteComandi(env || process.env) };
  // Fuori da Windows (Linux, macOS): shell POSIX persistente, letta da pipe →
  // non-interattiva, nessun prompt da ripulire. `bash` se l'utente l'ha scelto
  // nelle Preferenze, altrimenti la shell di sistema. I marcatori sono gli
  // stessi: `printf`, `$?` e `$PWD` valgono in entrambe.
  if (process.platform !== 'win32') {
    return {
      file: shell === 'bash' ? 'bash' : '/bin/sh',
      args: [],
      options: { cwd: startCwd || undefined, windowsHide: true, ...ambiente },
      ready: `printf 'FILO_RDY_${sid}\\n'\n`,
      wrap: (command) =>
        `${command}\nprintf 'FILO_META_${sid}:%s:%s\\n' "$?" "$PWD"\n`,
    };
  }
  if (shell === 'cmd') {
    // /q = niente echo dei comandi; /k = resta aperto leggendo da stdin.
    // Con l'eco spento cmd non mostra nemmeno il prompt: la riga di pronto la stampa un `echo`, se no non
    // arriva mai e la sessione resta muta (#719). Il prompt diventa comunque RDY, per chi riaccende l'eco.
    // Davanti a tutto il preludio che porta la tabella codici a UTF-8 (#551,
    // gemello di quello in terminal.js): senza, i nomi con accenti e trattini
    // lunghi arrivano storpiati anche qui, nel terminale che l'utente guarda.
    // Il percorso del file dei pezzi non ASCII arriva per variabile d'ambiente: la cartella temporanea può avere
    // accenti nel nome utente, e scritta sullo stdin si storpierebbe come il resto (comandoPerCmd).
    const fileValori = path.join(os.tmpdir(), `filo-cmd-${sid}`);
    let scritti = 0;
    return {
      file: process.env.ComSpec || 'cmd.exe',
      // /d salta l'AutoRun del registro: un suo `cd` porterebbe il comando dell'assistente fuori dalla sua cartella.
      args: autoRun ? ['/q', '/k'] : ['/d', '/q', '/k'],
      options: { cwd: startCwd || undefined, windowsHide: true, env: { ...ambiente.env, [VALORI_CMD]: fileValori } },
      ready: `${PRELUDI_CODIFICA.cmd}prompt FILO_RDY_${sid}$_\r\necho FILO_RDY_${sid}\r\n`,
      wrap: (command) => {
        let { testo, file } = comandoPerCmd(command);
        try {
          file.forEach((contenuto, i) => fs.writeFileSync(`${fileValori}-${i + 1}.txt`, contenuto, 'utf8'));
          scritti = Math.max(scritti, file.length);
        } catch (_) { testo = String(command); }
        return `${testo}\r\necho FILO_META_${sid}:%errorlevel%:%cd%\r\n`;
      },
      pulisci: () => {
        for (let i = 1; i <= scritti; i++) { try { fs.rmSync(`${fileValori}-${i}.txt`, { force: true }); } catch (_) {} }
      },
    };
  }
  if (shell === 'bash') {
    // `--cd` accetta path Windows e Linux; letto da pipe, niente prompt da ripulire.
    const args = ['--cd', startCwd || defaultCwd(), '--', 'bash'];
    return {
      file: 'wsl.exe',
      args,
      options: { windowsHide: true, ...ambiente },
      ready: `printf 'FILO_RDY_${sid}\\n'\n`,
      wrap: (command) =>
        `${command}\nprintf 'FILO_META_${sid}:%s:%s\\n' "$?" "$PWD"\n`,
    };
  }
  // PowerShell (default). `-Command -` legge ed esegue da stdin in modo
  // incrementale, senza prompt. Le righe attorno al comando sono le stesse dei
  // comandi dell'assistente (righePowerShell), che leggono da stdin anche loro.
  // La prima cosa che scriviamo è il preludio UTF-8 (#551): la console di
  // Windows scrive di suo nella tabella OEM, dove il trattino lungo diventa
  // «-» e la «à» un byte che qui arriva come «<27>». Gemello del preludio in
  // terminal.js, che fa lo stesso per i comandi one-shot dell'assistente.
  return {
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-Command', '-'],
    options: { cwd: startCwd || undefined, windowsHide: true, ...ambiente },
    ready: `${PREPARA_STDIN_POWERSHELL}${PRELUDI_CODIFICA.powershell}"FILO_RDY_${sid}"\n`,
    wrap: (command) => righePowerShell(command, `FILO_META_${sid}`, comandoPerPowerShell),
  };
}

// Crea una sessione persistente. Ritorna un oggetto con:
//   exec(command, { onData, onExit, onError })  accoda ed esegue un comando
//   write(text)                                 invia testo grezzo allo stdin
//   chiudi()                                    chiude lo stdin: la shell esce da sola, i programmi avviati restano
//   kill()                                      termina l'albero di processi
//   shell, cwd, dead                            stato osservabile
//
// Le callback sono PER COMANDO: onData({chunk, stream}), onExit({code, cwd}),
// onError({message}). Se la shell si chiude prima del marcatore (un `exit 3`),
// onExit porta anche { chiusa: true, uscita: <codice del processo> }.
function createSession({ shell, cwd, env, autoRun } = {}) {
  const sid = randSid();
  const wantShell = resolveShell(shell);
  const startCwd = usableCwd(cwd);
  const cfg = shellConfig(wantShell, sid, startCwd, { env, autoRun });

  const session = {
    // La shell VERA, non quella chiesta: chi confronta per decidere se
    // ricreare la sessione (ipc.js) deve vedere lo stesso valore che ha
    // calcolato lui, altrimenti la sessione si ricrea a ogni comando.
    shell: wantShell,
    sid,
    cwd: startCwd,
    dead: false,
    ready: false,
    proc: null,
    queue: [],        // comandi in attesa: { command, cb }
    current: null,    // comando in esecuzione: { cb }
    _buf: '',
    _pendingBlank: 0, // righe vuote in attesa (separatori prompt/marcatore)
    exec, write, chiudi, kill,
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
  proc.on('close', (uscita) => {
    session.dead = true;
    if (cfg.pulisci) cfg.pulisci();
    const cur = session.current;
    session.current = null;
    if (cur && cur.cb.onExit) cur.cb.onExit({ code: 0, cwd: session.cwd, chiusa: true, uscita });
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

  function chiudi() {
    try { proc.stdin && proc.stdin.end(); } catch (_) {}
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

// Largo perché il danno vero è un falso negativo, un comando valido colorato di rosso. Le prove passano la loro
// attesa: con la macchina carica anche `where.exe` supera i dieci secondi (#1063).
const ATTESA_PROBE_MS = 10000;

// Un probe risponde 'si' (uscito 0), 'no' (uscito con un altro codice) o 'incerto': scaduto, non partito, ucciso
// da un segnale. Un incerto non è un «non esiste»: con la macchina carica colorava di rosso comandi validi (#1176).
function runProbe({ file, args, env: probeEnv }, cwd, attesaMs = ATTESA_PROBE_MS) {
  return new Promise((resolve) => {
    let done = false;
    let proc;
    const finish = (val) => { if (done) return; done = true; try { proc.kill(); } catch (_) {} resolve(val); };
    try {
      // L'env dei probe: vedi existenceProbes.
      const env = ambienteComandi({ ...process.env, ...(probeEnv || {}) });
      proc = spawn(file, args, { cwd: cwd || undefined, env, windowsHide: true, stdio: 'ignore' });
    } catch (_) { resolve('incerto'); return; }
    const timer = setTimeout(() => finish('incerto'), attesaMs);
    proc.on('error', () => { clearTimeout(timer); finish('incerto'); });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      finish(code === 0 ? 'si' : (typeof code === 'number' ? 'no' : 'incerto'));
    });
  });
}

// true se un probe conferma, false solo se TUTTI dicono no, null altrimenti: dopo un `where.exe` scaduto il «no» di
// Get-Command non basta, perché sbaglia proprio sugli shim npm che `where` avrebbe visto.
async function esitoDeiProbe(probes, cwd, attesaMs = ATTESA_PROBE_MS) {
  let incerto = false;
  for (const probe of probes) {
    const esito = await runProbe(probe, cwd, attesaMs);
    if (esito === 'si') return true;
    if (esito === 'incerto') incerto = true;
  }
  return incerto ? null : false;
}

// true esiste, false non esiste di certo, null non si è potuto sapere (la dashboard lo lascia senza colore).
async function commandExists({ shell, cwd, command, attesaMs = ATTESA_PROBE_MS } = {}) {
  const cmd = String(command == null ? '' : command).trim();
  // Niente da controllare, o token che non è un nome di comando (newline/null): "non esiste".
  if (!cmd || /[\n\r\0]/.test(cmd)) return false;
  // Builtin cmd.exe: sì senza spawnare nulla.
  if (process.platform === 'win32' && shell === 'cmd' && CMD_BUILTINS.has(cmd.toLowerCase())) {
    return true;
  }
  // Un programma dato col percorso (anche fra virgolette, #968): `where.exe` rifiuta i percorsi e cmd resterebbe
  // rosso. Fuori da Windows `command -v` qui sotto risolve già un percorso, e controlla anche che sia eseguibile.
  if (process.platform === 'win32' && /[\\/]/.test(cmd)) {
    try { if (fs.statSync(path.resolve(cwd || defaultCwd(), cmd)).isFile()) return true; } catch (_) {}
  }
  return esitoDeiProbe(existenceProbes({ shell, cmd }), cwd, attesaMs);
}

// `existenceProbes` è esportata SOLO per il guard di regressione nei test
// ("firebase rosso"): l'ordine dei probe — `where.exe` prima di Get-Command —
// è ciò che tiene veloci gli shim npm, e un assert sul cronometro era rumore
// su una macchina carica.
module.exports = {
  createSession, defaultCwd, commandExists, existenceProbes,
  // per la guardia di #1176: un probe scaduto o non partito non diventa un «non esiste».
  esitoDeiProbe,
  // La cartella di lavoro, controllata in un posto solo (#551, quarto giro):
  // la usano il comando one-shot dell'assistente e il popup di conferma.
  cartellaViva, cartellaPerComando, usableCwd, unitaDiRete,
  // esportata per la guardia di regressione di #551: il comando che l'utente
  // digita non deve mai arrivare a PowerShell con byte fuori dall'ASCII.
  comandoPerPowerShell,
  // e a cmd non arrivano byte fuori dall'ASCII nemmeno lui (#1044).
  comandoPerCmd,
};

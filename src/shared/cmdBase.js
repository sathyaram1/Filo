// Parte di cmdClassify.js (#2493): token, virgolette e gli elenchi dei programmi per livello.
// Non pubblica niente per conto suo: si registra su SN_CMD_PARTI, e la compone cmdClassify.js, dove stanno le regole.
// Si carica per prima: le altre parti prendono da qui al caricamento.
(function (global) {
  'use strict';
  const P = global.SN_CMD_PARTI || (global.SN_CMD_PARTI = {});
  // Da una parte caricata dopo: si cerca alla chiamata, perché classifyOne e segmentIsRead si chiamano a vicenda.
  const classifyOneLetto = (seg, c) => P.classifyOneLetto(seg, c);

  // Metacaratteri che rendono il comando composto o non riconoscibile → 3.
  const CHAIN_RE = /[|;&`<>]|\$\(|\$\{|\r|\n/;

  // I programmi che cancellano senza cestino: un elenco solo, per il costo (sempre 3) e per la parola (#1909).
  const CANCELLANO = new Set([
    'rm', 'rmdir', 'rd', 'del', 'erase', 'unlink', 'deltree', 'shred', 'srm', 'wipe', 'rimraf',
    'remove-item', 'ri', 'clear-recyclebin', 'format', 'diskpart',
  ]);

  // I programmi che si collegano a un altro computer: un elenco solo per gli indirizzi che un comando contatta
  // (urlExfil) e per la sua uscita, che arriva dalla rete (actionLevels, #2293).
  const PROGRAMMI_RETE = /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|aria2c|lynx|w3m|links|nc|ncat|netcat|telnet|ssh|scp|sftp|ftp|rsync|http|https|xh|ping|nslookup|dig|host|resolve-dnsname|test-netconnection|start-bitstransfer|certutil|bitsadmin|tracert|traceroute|whois|socat|smbclient|git\s+(?:clone|fetch|pull|push|ls-remote|archive))\b/i;

  // Codice arbitrario o distruzione di stato: SEMPRE 3, controllati per primi, backstop
  // anche se finissero in una whitelist.
  const ALWAYS_3 = new Set([
    ...CANCELLANO,
    'mkfs', 'fdisk', 'diskpart', 'dd', 'shutdown', 'reboot',
    'restart', 'halt', 'poweroff', 'kill', 'killall', 'taskkill', 'pkill',
    'reg', 'regedit', 'sc', 'net', 'netsh', 'fsutil', 'bcdedit', 'mklink',
    'chmod', 'chown', 'chgrp', 'attrib', 'icacls', 'takeown',
    // Shell ed esecutori diretti: SEMPRE 3, senza l'eccezione «versione» — anche `bash` da
    // solo apre una sessione interattiva.
    'sh', 'bash', 'zsh', 'fish', 'powershell', 'pwsh', 'cmd', 'eval', 'exec',
    'ssh', 'scp', 'sudo', 'su', 'doas',
  ]);

  // Interpreti, build tool e runner eseguono codice arbitrario → 3. Eccezione: la pura
  // interrogazione di versione o aiuto è sola lettura → 1.
  const ARBITRARY_CODE = new Set([
    'node', 'deno', 'bun', 'ts-node', 'tsx', 'python', 'python3', 'py', 'ruby',
    'perl', 'php', 'osascript', 'npx', 'pnpm', 'yarn', 'make', 'cmake', 'cargo',
    'go', 'rustc', 'gcc', 'g++', 'clang', 'docker', 'docker-compose', 'podman',
    'kubectl', 'helm', 'terraform', 'ansible', 'java', 'javac', 'dotnet', 'mvn',
    'gradle', 'tsc', 'dart', 'flutter', 'scala', 'kotlin', 'julia', 'lua',
    'code', 'rustup', 'rbenv', 'pyenv', 'nvm', 'composer', 'bundle', 'gem',
  ]);

  // Token che da soli rendono il comando una pura interrogazione. `-v`/`-V` qui valgono
  // «version»: un `cmd -v` senza operandi non compie nessuna azione.
  const VERSION_TOKENS = new Set([
    '--version', '-version', '-v', '-V', 'version', '--help', '-help', '-h',
    'help', '/?', '/version', '--usage', '-?',
  ]);

  // Serve almeno un token di versione o aiuto: un programma nudo come `node` apre un REPL
  // e non è lettura sicura.
  function isVersionQuery(cmd) {
    const rest = tokens(cmd).slice(1);
    if (!rest.length) return false;
    return rest.every((t) => VERSION_TOKENS.has(t.toLowerCase()));
  }

  // Sola lettura, nessun effetto sullo stato: livello 1.
  const LEVEL1 = new Set([
    // `cd` cambia solo la cartella di lavoro ed è la primitiva di navigazione dell'assistente:
    // chiedere conferma a ogni spostamento la renderebbe inutilizzabile.
    'cd', 'chdir',
    'ls', 'dir', 'pwd', 'cat', 'type', 'echo', 'whoami', 'hostname', 'date',
    'where', 'which', 'head', 'tail', 'tree', 'wc', 'ver', 'uname', 'more',
    'clear', 'cls', 'grep', 'findstr', 'stat', 'basename', 'dirname',
    'realpath', 'readlink', 'du', 'df', 'uptime', 'id', 'groups', 'whatis',
    'cal', 'nproc', 'arch',
    'ps', 'free', 'lscpu', 'lsblk', 'lsusb', 'printenv', 'whereis', 'who',
    'w', 'vmstat', 'lsof', 'column', 'cut', 'uniq', 'nl', 'file',
    'md5sum', 'sha1sum', 'sha256sum', 'cksum',
  ]);

  // Alcuni LEVEL1 leggono finché non ricevono gli argomenti che ne cambiano il senso: `date`
  // legge, `date -s` IMPOSTA. Il predicato riceve il comando intero e torna true se MODIFICA.
  const LEVEL1_MUTATES = {
    // `date -s`/`--set` imposta l'orologio, anche in un gruppo (`-us`) o col valore attaccato (`-s1`); `+%F`, `-u`,
    // `-d` sono letture. `-d`, `-f`, `-r`, `-I` prendono un valore: la `s` dopo di loro è quel valore.
    date: (cmd) => tokens(cmd).slice(1).map(unquote).some((t) => /^-[uR]*s/.test(t) || opzioneLunga(t, 'set', 1) != null),
    // `hostname <nome>` o `-F file` imposta il nome host; i flag di lettura no.
    // Attenzione: qui `-s` è «short», non «set».
    hostname: (cmd) => {
      const rest = tokens(cmd).slice(1);
      // `-F`/`--file` è case-sensitive: `-f` = fqdn è lettura e non deve combaciare.
      return rest.some((t) => /^-[A-Za-z]*F/.test(t) || opzioneLunga(t, 'file', 2) != null || !t.startsWith('-'));
    },
    // Lettori con un'uscita su file (#1994, #2292): `uniq IN OUT`, `tree -o FILE` (e `-R`, che scrive 00Tree.html in
    // ogni cartella), `file -C` (compila `<nome>.mgc` nella cartella di lavoro).
    uniq: (cmd) => uniqUscita(tokens(cmd).slice(1)) != null,
    tree: (cmd) => treeUscita(tokens(cmd).slice(1)) != null,
    file: (cmd) => tokens(cmd).slice(1).some((t) => /^-[A-Za-z]*C/.test(t) || opzioneLunga(t, 'compile', 2) != null),
  };

  // Il file che `tree` scriverà ('' se non si sa quale), o null se stampa e basta.
  function treeUscita(args) {
    for (let i = 0; i < args.length; i++) {
      const t = args[i];
      const lungo = /^--output(?:=(.*))?$/.exec(t);
      if (lungo) return lungo[1] != null ? lungo[1] : (args[i + 1] || '');
      if (!/^-[^-]/.test(t)) continue;
      const k = t.indexOf('o');
      if (k > 0) return t.slice(k + 1) || args[i + 1] || '';
      if (t.includes('R')) return '';
    }
    return null;
  }

  // getopt e git accettano un'opzione lunga abbreviata a ogni prefisso non ambiguo (`--comp` è `--compile`, `--outp=x`
  // è `--output=x`): l'opzione si riconosce come la legge il programma. Il valore dopo `=`, o '' senza; null se non è lei.
  function opzioneLunga(t, nome, min) {
    const m = /^--([A-Za-z][A-Za-z-]*)(?:=([\s\S]*))?$/.exec(String(t || ''));
    if (!m || m[1].length < min || !nome.startsWith(m[1].toLowerCase())) return null;
    return m[2] != null ? m[2] : '';
  }

  // Il secondo operando di uniq è il file in cui scrive (`-` è il terminale): null se non c'è.
  function uniqUscita(testi) {
    const ops = [];
    let fine = false;
    for (let i = 0; i < testi.length; i++) {
      const t = testi[i];
      if (fine || t === '-' || !t.startsWith('-')) { if (fine || !/^\+\d+$/.test(t)) ops.push(t); continue; }
      if (t === '--') { fine = true; continue; }
      if (/^--(skip-fields|skip-chars|check-chars)$/.test(t)) { i += 1; continue; }
      if (t.startsWith('--')) continue;
      // `-f N`, `-s N`, `-w N`, anche in coda a un gruppo (`-cf 1`); `-f1` porta il valore attaccato.
      const k = t.slice(1).search(/[fsw]/);
      if (k >= 0 && k === t.length - 2) i += 1;
    }
    return ops.length >= 2 && ops[1] !== '-' ? ops[1] : null;
  }

  // Modifica lo stato ma in modo recuperabile: livello 2.
  const LEVEL2 = new Set([
    'mkdir', 'md', 'touch', 'cp', 'copy', 'xcopy', 'robocopy', 'move', 'mv',
    'ren', 'rename', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'curl', 'wget',
    'ln',
  ]);

  // Su Windows la shell è PowerShell: senza questa whitelist elencare una cartella costava la
  // frizione di un `rm -rf`. Entra solo il cmdlet che NON ha una forma capace di scrivere.
  const PS_READ = new Set([
    'get-childitem', 'gci', 'get-content', 'gc', 'get-item', 'gi',
    'get-itemproperty', 'gp', 'get-itempropertyvalue', 'get-location', 'gl',
    'get-date', 'get-process', 'gps', 'get-service', 'get-help', 'get-member',
    'get-alias', 'get-variable', 'get-module', 'get-psdrive', 'get-host',
    'get-command', 'get-history', 'get-computerinfo', 'get-culture',
    'get-timezone', 'get-random', 'get-unique',
    'select-string', 'sls', 'select-object', 'select', 'sort-object',
    'measure-object', 'measure', 'group-object', 'group', 'compare-object',
    'test-path', 'resolve-path', 'split-path', 'join-path', 'convert-path',
    'format-table', 'ft', 'format-list', 'fl', 'format-wide', 'fw',
    'out-string', 'out-host', 'out-null', 'write-output', 'write-host',
    'convertto-json', 'convertfrom-json', 'convertto-csv', 'convertfrom-csv',
    'convertfrom-stringdata', 'get-filehash',
    // Navigazione pura: come `cd`, cambiano solo la cartella di lavoro.
    'set-location', 'sl', 'pushd', 'popd',
  ]);
  // Alias esclusi apposta perché su un'altra shell sono un programma che SCRIVE (`sort`,
  // `gm`, `gcm`, `compare`), e non si sa quale shell eseguirà. I nomi lunghi restano ammessi.

  // Valgono solo DENTRO una pipeline: da soli non ricevono niente da filtrare.
  const PS_PIPE_ONLY = new Set(['where-object', 'where', '?', 'foreach-object', 'foreach', '%']);
  // Quale `where` è: 'cmd' il programma di ricerca (where.exe, o la shell cmd), 'filtro' il Where-Object di PowerShell,
  // '' se la shell non si sa. L'unico posto che lo decide (#2292): il livello teme il filtro, la rete teme la ricerca.
  const eWhereExe = (raw) => /^where\.exe$/i.test(unquote(tokens(dequote(raw))[0] || ''));
  function qualeWhere(raw, shell) {
    if (eWhereExe(raw) || shell === 'cmd') return 'cmd';
    return shell === 'powershell' ? 'filtro' : '';
  }
  // ForEach-Object senza scriptblock usa la forma «nome di membro», che INVOCA il metodo su
  // ogni oggetto: `gci | % Delete` cancella i file. Lo scriptblock validato è obbligatorio.
  const PS_FOREACH = new Set(['foreach-object', 'foreach', '%']);

  // Uno scriptblock è il buco della pipeline: `gci | % { Remove-Item $_ }` è una cancellazione
  // travestita. Non si interpreta il contenuto: si pretende INERTE, nessun token che invochi.
  function scriptBlockIsInert(inner) {
    const s = String(inner);
    if (/[=(){}`;&|<>@]|::/.test(s)) return false;
    for (const t of s.trim().split(/\s+/).filter(Boolean)) {
      if (/^[A-Za-z_]/.test(t)) return false;              // parola nuda = comando
      if (/^\.{1,2}$/.test(t)) return false;               // dot-sourcing
      if (/[\\/]/.test(t) && !/^-/.test(t)) return false;  // percorso di un eseguibile
    }
    return true;
  }

  // Senza contesto: cartella di lavoro e home coincidono, un relativo si dà per interno.
  const SENZA_CONTESTO = { cwd: '/~', home: '/~', win: false, maiuscole: false };

  // Stessa funzione per il cmdlet isolato e per ogni pezzo di pipeline, così i due cammini
  // non divergono. Riceve il segmento GREZZO: i letterali quotati vanno visti prima.
  function segmentIsRead(seg, inPipeline, c = SENZA_CONTESTO) {
    // `%{...}` e `?{...}` senza spazio sono PowerShell normale: le graffe si isolano come
    // token a sé prima di guardare programma e blocco.
    const norm = String(seg).replace(/\{/g, ' { ').replace(/\}/g, ' } ');
    // Il primo token dev'essere il comando NUDO: senza `isBareName` un file su disco chiamato
    // come il cmdlet fidato verrebbe scambiato per lui.
    if (!isBareName(tokens(norm)[0])) return false;
    // I letterali fra virgolette sono inerti e diventano `0`: un confronto con una stringa passa
    // e un metacarattere dentro le virgolette non alza il livello. Ciò che invoca sta fuori.
    const noStr = norm.replace(/'[^']*'/g, ' 0 ').replace(/"[^"]*"/g, ' 0 ');
    // Sottoespressioni, chiamate, hashtable, redirezioni, membri statici: dentro può
    // nascondersi qualunque cosa.
    if (/[`()<>;&|@]|\$\(|\$\{|::/.test(noStr)) return false;
    const open = (noStr.match(/\{/g) || []).length;
    const close = (noStr.match(/\}/g) || []).length;
    if (open !== close || open > 1) return false; // graffe sbilanciate o annidate
    if (open === 1) {
      const i = noStr.indexOf('{');
      const j = noStr.lastIndexOf('}');
      if (j < i || !scriptBlockIsInert(noStr.slice(i + 1, j))) return false;
    }
    const prog = programOf(norm);
    if (!prog) return false;
    if (ALWAYS_3.has(prog) || ARBITRARY_CODE.has(prog)) return false;
    // Where-Object da solo (`where node`, `-InputObject`) filtra come in pipeline: esegue solo il blocco, già
    // preteso inerte qui sopra. ForEach-Object no: senza pipeline resta da chiedere.
    if (PS_PIPE_ONLY.has(prog)) {
      if (PS_FOREACH.has(prog)) return inPipeline && open === 1;
      return true;
    }
    if (PS_READ.has(prog)) return true;
    // In pipeline vale come lettura anche ciò che è già livello 1: `cat file | grep errore`
    // non compie niente di più di `cat file`.
    return inPipeline && classifyOneLetto(seg, c) === 1;
  }

  // Pura pipeline (solo `|`), senza sequenze, background, redirezioni o sostituzioni:
  // i segmenti, altrimenti null. `||` produce un segmento vuoto e non passa di qui.
  function splitSafePipeline(cmd) {
    if (/[`<>;&]|\$\(|\$\{|\r|\n/.test(cmd)) return null;
    if (cmd.indexOf('|') === -1) return null;
    const parts = cmd.split('|').map((p) => p.trim());
    if (parts.length < 2 || parts.some((p) => !p)) return null;
    return parts;
  }

  // Flag che alzano a 3 un comando altrimenti ≤2.
  const DANGEROUS_FLAG_RE = /(^|\s)(-[a-z]*f[a-z]*r[a-z]*|-[a-z]*r[a-z]*f[a-z]*)(\s|$)/i;
  // Le lunghe valgono anche accorciate, come le leggono getopt e git (`--forc`, `--de`): una lista sola per tutti.
  const LUNGHE_PERICOLOSE = ['force', 'hard', 'delete', 'prune', 'no-preserve-root'];
  const lungaPericolosa = (cmd, nomi) => tokens(cmd).slice(1).some((t) => nomi.some((n) => opzioneLunga(t, n, 2) != null));

  // robocopy usa lo slash, che DANGEROUS_FLAG_RE non vede: `/MIR` e `/PURGE` cancellano la
  // destinazione, `/MOVE` la sorgente. Check a sé e case-insensitive, o falsi positivi Unix.
  const ROBOCOPY_DESTRUCTIVE_RE = /(^|\s)\/(MIR|PURGE|MOVE|MOV)(\s|$)/i;

  // curl con un flag di output-su-file scrive dove decide chi compone il comando e può
  // sovrascrivere chiavi SSH o script d'avvio: un «download» diventa una backdoor → 3.
  const CURL_OUTPUT_RE = /(^|\s)(--output|--remote-name|--remote-header-name|-[a-z]*o)/i;

  // curl con `-D`/`--dump-header <file>` scrive gli header della risposta in un
  // percorso arbitrario: il contenuto lo decide il server (quindi l'attaccante
  // che pilota l'assistente da una pagina ostile), rendendolo un altro primitivo
  // di scrittura-su-file arbitraria → 3. Meno potente di `-o`/`-O` (byte header,
  // non corpo scelto liberamente) ma stessa classe: over-cautela = solo attrito.
  // Check curl-specifico e case-SENSITIVE sulla `D`: la `D` maiuscola in curl è
  // solo `--dump-header`, anche in bundle (`-sD file`); `-d` è CURL_SEND_SHORT_RE.
  const CURL_DUMP_RE = /(^|\s)(--dump-header|-[a-zA-Z]*D)/;

  // Altri flag curl che salvano dati influenzati dal server in un percorso scelto: stessa
  // classe di --dump-header → 3. Case-SENSITIVE: `-C`/--continue-at non deve salire.
  const CURL_ACCESSORY_WRITE_RE = /(^|\s)(--cookie-jar|--etag-save|--trace(-ascii)?|--stderr|--libcurl|--hsts|--alt-svc|--metalink)(=|\s|$)|(^|\s)-[a-zA-Z]*c/;

  // curl `-w` è un formato di stampa, ma da 8.3 `%output{FILE}` lo fa atterrare su un file →
  // stessa classe di `-o` → 3. Si cerca la direttiva, non il flag: `-w` da solo resta 2.
  const CURL_WRITE_OUT_FILE_RE = /%output\{/i;

  // curl `-K`/`--config` legge le opzioni da un file, dove può esserci `output = …`: stesso
  // primitivo di `-o` ma invisibile nel comando → 3. `-k`/`--insecure` non scrive niente.
  const CURL_CONFIG_RE = /(^|\s)(--config(=|\s|$)|-[a-zA-Z]*K)/;

  // curl che MANDA qualcosa al server (dati, un file, una mail, comandi FTP) o gli chiede di cambiare (un metodo
  // diverso da GET/HEAD) non si disfa: un file uscito dal computer non torna indietro → 3 (#530). Case-sensitive:
  // -d/-F/-T/-Q/-X in curl sono solo quelli, anche in un bundle; -x minuscolo è il proxy. Un'opzione lunga vale
  // anche accorciata (`--uplo`): curl accetta un prefisso che non è ambiguo.
  const CURL_SEND_SHORT_RE = /(^|\s)-[a-zA-Z]*[dFTQ]/;
  const CURL_SEND_LONG = ['data', 'form', 'form-string', 'upload-file', 'json', 'mail-rcpt', 'mail-from', 'quote'];
  const CURL_METHOD_RE = /(?:^|\s)(?:--request(?:=|\s+)|-[a-zA-Z]*X\s*)["']?([A-Za-z]*)/g;
  function curlCambiaIlServer(cmd) {
    if (CURL_SEND_SHORT_RE.test(cmd)) return true;
    for (const m of cmd.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)) {
      const w = m[1];
      if (w.startsWith('data') || CURL_SEND_LONG.some((n) => opzioneLunga(`--${w}`, n, 1) != null)) return true;
      if (w !== 'request' && opzioneLunga(`--${w}`, 'request', 3) != null) return true;
    }
    for (const m of cmd.matchAll(CURL_METHOD_RE)) if (!/^(GET|HEAD)$/i.test(m[1])) return true;
    return false;
  }

  function tokens(cmd) {
    // Spezzare sugli spazi basta per leggere programma e flag: i comandi con quoting
    // interessante finiscono comunque a 3.
    return String(cmd).trim().split(/\s+/).filter(Boolean);
  }

  // Le virgolette non cambiano il comando che la shell esegue ma possono nascondere ai
  // controlli programma e bersaglio: toglierle può solo far salire il livello, mai scendere.
  function unquote(tok) {
    return String(tok).replace(/['"]/g, '');
  }

  // La forma su cui girano tutti i controlli: whitelist, flag pericolosi, bersagli.
  function dequote(cmd) {
    return tokens(cmd).map(unquote).join(' ');
  }

  function programOf(cmd) {
    const first = tokens(cmd)[0] || '';
    const bare = unquote(first);
    return bare.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1|com|msi)$/i, '');
  }

  // Se il primo token ha un'estensione eseguibile è un FILE su disco, non il comando di
  // sistema che ne condivide il nome.
  const EXE_EXT_RE = /\.(exe|cmd|bat|ps1|psm1|com|msi|vbs|vbe|wsf|wsh|scr|pif|cpl|msc|jar|js|jse|ps1xml)$/i;

  // `programOf` normalizza per il backstop (`/bin/rm` resta 3), ma per FIDARSI serve di più:
  // un nome è «nudo» solo senza separatori, estensione eseguibile o prefisso di chiamata.
  function isBareName(tok) {
    const t = unquote(String(tok || ''));
    if (!t) return false;
    if (/[\\/]/.test(t)) return false;   // qualunque separatore di percorso
    if (/^[.&]/.test(t)) return false;   // .\  ./  .  &  (chiamata / dot-source)
    if (EXE_EXT_RE.test(t)) return false; // estensione eseguibile = file, non cmdlet
    return true;
  }

  // sotto-comando = primo token che non è una flag (dopo il programma)
  function subcommandOf(cmd) {
    const t = tokens(cmd).slice(1).map(unquote);
    for (const x of t) {
      if (x && !x.startsWith('-')) return x.toLowerCase();
    }
    return '';
  }

  Object.assign(P, {
    CHAIN_RE, CANCELLANO, PROGRAMMI_RETE, ALWAYS_3, ARBITRARY_CODE, VERSION_TOKENS, isVersionQuery, LEVEL1, LEVEL1_MUTATES,
    treeUscita, opzioneLunga, uniqUscita, LEVEL2, PS_READ, PS_PIPE_ONLY, eWhereExe, qualeWhere, SENZA_CONTESTO,
    segmentIsRead, splitSafePipeline, DANGEROUS_FLAG_RE, LUNGHE_PERICOLOSE, lungaPericolosa, ROBOCOPY_DESTRUCTIVE_RE,
    CURL_OUTPUT_RE, CURL_DUMP_RE, CURL_ACCESSORY_WRITE_RE, CURL_WRITE_OUT_FILE_RE, CURL_CONFIG_RE, curlCambiaIlServer,
    tokens, unquote, dequote, programOf, isBareName, subcommandOf,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);

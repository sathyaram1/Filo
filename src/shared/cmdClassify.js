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
//   • background (&), redirezioni (>, >>, <), `${...}`, backtick e newline NON
//     sono semplici sequenze: il comando non è "interamente riconoscibile" → 3,
//     sempre. Un falso positivo qui costa solo più attrito (digitare
//     "conferma"), mai un'esecuzione silenziosa indebita. I gruppi `( )`,
//     `@( )`, `$( )` e l'`if` di PowerShell si classificano per ciò che
//     eseguono (vedi `smonta`).
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
//     curl invece, SENZA flag che scrivono o mandano dati, stampa a schermo e non
//     fa atterrare niente: resta 2. Due programmi che si comportano diversamente prendono
//     regole diverse — è l'effetto a decidere. Salgono a 3 i flag curl che fanno
//     atterrare qualcosa: output-su-file (-o/-O/--output/--remote-name…), i DATI
//     ACCESSORI il cui contenuto è influenzato dal server (-D/--dump-header,
//     -c/--cookie-jar, --etag-save, --trace/--trace-ascii, --stderr, --libcurl,
//     --hsts, --alt-svc, --metalink, `-w '%output{...}'`) e -K/--config, che nasconde
//     l'output dentro un file di opzioni.

(function (global) {
  'use strict';
  // Le parti del classificatore, nell'ordine in cui si caricano (#2493): senza il loader (test, moduli che lo chiedono
  // da soli) le carica l'entrata. Sentinella: tests/unit/cmdClassifyParti.test.mjs.
  const PARTI = ['cmdBase', 'cmdGit', 'cmdPerimetro', 'cmdSovrascritture', 'cmdGruppi'];
  if (typeof require === 'function') for (const parte of PARTI) require(`./${parte}.js`);
  const P = global.SN_CMD_PARTI;
  const {
    dequote, programOf, ALWAYS_3, eWhereExe, isBareName, tokens, segmentIsRead, classifyGit, classifyNpm, ARBITRARY_CODE,
    isVersionQuery, LEVEL1, PS_PIPE_ONLY, qualeWhere, LEVEL1_MUTATES, LEVEL2, CURL_OUTPUT_RE, CURL_DUMP_RE,
    CURL_ACCESSORY_WRITE_RE, CURL_WRITE_OUT_FILE_RE, CURL_CONFIG_RE, curlCambiaIlServer, ROBOCOPY_DESTRUCTIVE_RE,
    DANGEROUS_FLAG_RE, lungaPericolosa, LUNGHE_PERICOLOSE, PS_READ, classifyDetail, fuoriDa, contesto, dove, MOTIVI,
    dentroCasa, PROFILO_APERTE, nomeNorm, CANCELLANO, GIT_READ, segniInterni, PROGRAMMI_RETE, subcommandOf, comeCmd,
    gitChiaveInerte,
  } = P;

  // Livello di un SINGOLO comando (senza metacaratteri di sequenza).
  function classifyOne(raw, shell = '') {
    // Si valuta sempre la forma senza virgolette: `git push "--force"` fa ciò che farebbe senza
    // e deve avere lo stesso livello. I metacaratteri erano già intercettati sul testo grezzo.
    const trimmed = dequote(raw);
    const prog = programOf(trimmed);
    if (!prog) return 3;
    if (ALWAYS_3.has(prog)) return 3; // backstop: vale anche col percorso (`/bin/rm`)

    // Superato il backstop, la whitelist si fida solo di un nome invocato nudo: un file su
    // disco che si chiama come un comando fidato è un eseguibile arbitrario → 3.
    // where.exe senza percorso è il where di cmd, l'unico modo di chiamarlo da PowerShell: lo trova la stessa ricerca.
    if (eWhereExe(trimmed)) return 1;
    if (!isBareName(tokens(trimmed)[0])) return 3;
    // In PowerShell Where-Object e `?` sono il filtro di `where`: esegue solo il suo blocco (#2292).
    if ((prog === 'where-object' || prog === '?') && shell !== 'cmd') return segmentIsRead(raw, false) ? 1 : 3;

    if (prog === 'git') return classifyGit(trimmed, raw);
    if (prog === 'npm' || prog === 'pip' || prog === 'pip3') return classifyNpm(trimmed);

    // Codice arbitrario → 3, salvo la sola interrogazione di versione o aiuto → 1.
    if (ARBITRARY_CODE.has(prog)) return isVersionQuery(trimmed) ? 1 : 3;

    if (LEVEL1.has(prog)) {
      // `where` legge solo come where.exe di cmd: in PowerShell è Where-Object, che esegue il suo blocco (#2292).
      if (PS_PIPE_ONLY.has(prog) && qualeWhere(trimmed, shell) !== 'cmd') return segmentIsRead(raw, false) ? 1 : 3;
      // Sul Mac `arch <opzioni> programma` lancia il programma: legge solo da nudo.
      if (prog === 'arch' && tokens(trimmed).length > 1) return 3;
      // Quasi tutti i LEVEL1 restano 1 anche con flag; fanno eccezione i pochi che con certi
      // argomenti IMPOSTANO lo stato.
      const mutates = LEVEL1_MUTATES[prog];
      return mutates && mutates(trimmed) ? 2 : 1;
    }
    // Anche un comando LEVEL2 ridotto a `--version`/`--help` è sola lettura → 1.
    if (LEVEL2.has(prog)) {
      if (isVersionQuery(trimmed)) return 1;
      // wget SCARICA SEMPRE SU FILE: anche senza flag crea un file nella cwd, che l'assistente
      // sposta da sé con `cd`. Nessuna eccezione, `--spider` compreso: si deciderebbe dal testo.
      if (prog === 'wget') return 3;
      if (prog === 'curl' && CURL_OUTPUT_RE.test(trimmed)) return 3;
      if (prog === 'curl' && CURL_DUMP_RE.test(trimmed)) return 3;
      if (prog === 'curl' && CURL_ACCESSORY_WRITE_RE.test(trimmed)) return 3;
      if (prog === 'curl' && CURL_WRITE_OUT_FILE_RE.test(trimmed)) return 3;
      if (prog === 'curl' && CURL_CONFIG_RE.test(trimmed)) return 3;
      if (prog === 'curl' && curlCambiaIlServer(trimmed)) return 3;
      // robocopy /MIR /PURGE (cancellano la destinazione) / /MOVE /MOV
      // (cancellano la sorgente): distruzione permanente → 3.
      if (prog === 'robocopy' && ROBOCOPY_DESTRUCTIVE_RE.test(trimmed)) return 3;
      return DANGEROUS_FLAG_RE.test(trimmed) || lungaPericolosa(trimmed, LUNGHE_PERICOLOSE) ? 3 : 2;
    }

    // Cmdlet PowerShell di lettura: 1 solo se superano anche i controlli strutturali.
    // Si passa `raw`, con le virgolette: i letterali quotati vanno riconosciuti inerti.
    if (PS_READ.has(prog) && segmentIsRead(raw, false)) return 1;

    return 3; // comando non riconosciuto → livello 3 di default
  }
  P.classifyOne = classifyOne;

  // Livello di sicurezza del comando: 1 | 2 | 3. Mai null: l'ignoto è 3.
  function classify(cmd, ctx) {
    return classifyDetail(cmd, ctx).level;
  }

  // Un percorso scritto da un modello, senza i segni di citazione in testa e in coda, anche spaiati: la stessa pulizia
  // per chi misura il perimetro e per chi tocca il disco, o uno dei due vede un altro percorso (#1499).
  function pulisciPercorso(percorso) {
    return String(percorso == null ? '' : percorso).trim().replace(/^["'«“‘‹]+|["'»”’›]+$/g, '').trim();
  }

  // Un percorso singolo (LEGGI_DOCUMENTO): '' se sta nel perimetro, altrimenti il motivo.
  function fuoriPerimetro(percorso, ctx) {
    return fuoriDa(pulisciPercorso(percorso), contesto(ctx));
  }

  // Il percorso fa contattare a Windows (o al Mac, con /net) un altro computer della rete.
  function diRete(percorso, ctx) {
    const p = pulisciPercorso(percorso);
    return !!p && dove(p, contesto(ctx)) === MOTIVI.rete;
  }

  // Nella cartella personale ma privato per la lettura (nascosto, cartella di profilo come la Libreria del Mac): chi
  // legge in blocco non ci entra se la cartella chiesta non è già lì dentro (#947.3).
  function privato(percorso, ctx) {
    return fuoriPerimetro(percorso, ctx) === MOTIVI.nascosto;
  }

  // Le cartelle aperte dentro `percorso`, se è proprio una cartella di profilo: chi legge in blocco scende solo lì.
  function aperteDentro(percorso, ctx) {
    const c = contesto(ctx);
    const r = dove(String(percorso == null ? '' : percorso).trim(), c);
    if (!r || typeof r !== 'object' || !dentroCasa(r, c) || r.segs.length !== c.home.segs.length + 1) return [];
    return (PROFILO_APERTE[nomeNorm(r.segs[r.segs.length - 1])] || []).slice();
  }

  // Cancellare senza cestino (#1909): un comando che lo fa vuole la parola «conferma» a ogni livello, come ogni «per
  // sempre». Si guarda il programma di ogni pezzo (anche dopo sudo, xargs, `cmd /c`, `find -exec`, `git rebase -x` e negli scriptblock):
  // sbagliare per eccesso costa una parola da scrivere, per difetto il comando resta comunque al costo più alto.
  // Dopo un programma che non si sa se lancia altro (sudo, `pwsh -ExecutionPolicy Bypass -Command`, timeout, busybox,
  // `for …; do`) ogni parola può essere il comando lanciato: le opzioni coi loro valori non si sanno contare (#1909.3).
  // Gli argomenti sono solo dati dopo un programma che non lancia niente (`echo rm`, `git commit -m "rm"`).
  // `arch` sta fra le letture ma con un argomento lancia un programma.
  const INERTI = new Set([...LEVEL1, ...LEVEL2, ...PS_READ, 'git'].filter((p) => p !== 'arch'));
  // Gli script di una riga (python, node, ruby, .NET) che cancellano chiamando una funzione.
  const CANCELLA_IN_UNO_SCRIPT = /(?:\.|::)delete\s*\(|\b(?:os\.(?:remove|unlink|rmdir|removedirs)|shutil\.rmtree|fileutils\.rm(?:_rf|_r|dir)?)\s*\(|(?:\.|\b)(?:unlink|rmsync|unlinksync|rmdirsync|rmtree)\s*\(|\b(?:fs|fsp|promises|fse)\.(?:rm|rmdir|remove)\s*\(/;
  // --delete e le sue varianti (--del, --delete-after, --delete-excluded, --delete-missing-args…).
  const RSYNC_CANCELLA = /^--del(?:ete(?:-[a-z]+)*)?$/;
  const RCLONE_CANCELLA = new Set(['sync', 'bisync', 'delete', 'deletefile', 'purge', 'rmdir', 'rmdirs', 'cleanup']);
  // Perl e ruby chiamano senza parentesi (`unlink "x"`, `File.delete "x"`): si cercano solo dopo chi lancia altro.
  const CANCELLA_SENZA_PARENTESI = /(?:\.|::)(?:delete|unlink|rm_rf|rm_r|rm|rmdir|remove_entry(?:_secure)?)\b|\b(?:unlink|rmtree|remove_tree)\b/;
  // `pwsh -EncodedCommand …` nasconde il comando: non si legge, quindi vale come uno che cancella.
  const PS_NASCOSTO = /^-e(?:c|n|nc|ncodedcommand|ncodedc\w*)?$/;
  const nomeProgramma = (tok) => String(tok || '').split(/[\\/]/).pop().replace(/\.(exe|cmd|bat|ps1|com)$/, '');
  // Il comando che parte dalla parola `i` cancella senza cestino?
  function cancellaDa(tok, i) {
    const prog = nomeProgramma(tok[i]);
    if (CANCELLANO.has(prog) || /^mkfs(\.|$)/.test(prog)) return true;
    if (!/^(find|git|robocopy|rsync|rclone|foreach-object|foreach|%|powershell|pwsh)$/.test(prog)) return false;
    const resto = tok.slice(i + 1);
    if (prog === 'find' && resto.includes('-delete')) return true;
    if (prog === 'git' && resto.find((x) => !x.startsWith('-')) === 'clean') return true;
    if (prog === 'robocopy' && resto.some((x) => x === '/mir' || x === '/purge')) return true;
    // Gli allineamenti di cartelle del Mac e di Linux, come robocopy /MIR: tolgono dalla destinazione quello che
    // manca nella sorgente (#1909.5). rclone si guarda su ogni parola: un'opzione col valore sposta il sotto-comando.
    if (prog === 'rsync' && resto.some((x) => RSYNC_CANCELLA.test(x))) return true;
    if (prog === 'rclone' && resto.some((x) => RCLONE_CANCELLA.has(x))) return true;
    // `gci | ForEach-Object Delete`, `% Delete`: il metodo che cancella chiamato per nome.
    if (/^(foreach-object|foreach|%)$/.test(prog) && resto.filter((x) => !x.startsWith('-'))[0] === 'delete') return true;
    return (prog === 'powershell' || prog === 'pwsh') && resto.some((x) => PS_NASCOSTO.test(x));
  }
  function cancellaPerSempre(cmd) {
    if (typeof cmd !== 'string' || !cmd.trim()) return false;
    const t = cmd.replace(/[‘-‟'"`^]/g, '').toLowerCase();
    if (CANCELLA_IN_UNO_SCRIPT.test(t)) return true;
    for (const pezzo of t.split(/[;&|(){}\r\n]|\s-(?:exec|execdir|ok|okdir)\s/)) {
      // `$x = Remove-Item …`: l'assegnazione davanti non cambia il comando.
      let testo = pezzo.replace(/^\s*(?:\[[\w.]+\]\s*)?\$[\w:]+\s*=\s*/, '').trim();
      let tok = testo.split(/\s+/).filter(Boolean);
      // `git rebase -x "rm …"`, `git submodule foreach rm …`: il programma che git lancia da sé si guarda al posto di git.
      while (nomeProgramma(tok[0]) === 'git') {
        const p = gitProgrammaScritto(tok.slice(1));
        if (!p || !p.length) break;
        tok = p;
        testo = p.join(' ');
      }
      if (!tok.length) continue;
      if (cancellaDa(tok, 0)) return true;
      const prog = nomeProgramma(tok[0]);
      if (INERTI.has(prog) && prog === tok[0]) continue;
      if (CANCELLA_SENZA_PARENTESI.test(testo.slice(tok[0].length))) return true;
      for (let i = 1; i < tok.length; i++) if (cancellaDa(tok, i)) return true;
    }
    return false;
  }

  // Le righe di `git config --list --show-scope --includes`: true se una chiave locale o del worktree non è inerte
  // (l'elenco sta in cmdGit.js, con la regola di chi le scrive).
  // Con `-z` (la forma della sonda) i campi sono separati da NUL e la chiave finisce al ritorno a capo: senza, un «=»
  // nel nome di un remoto (`[remote "a.url=x"]`) spostava il confine e la chiave passava per un'altra.
  function gitConfigLancia(righe) {
    const testo = String(righe || '');
    const voci = [];
    if (testo.includes('\u0000')) {
      const p = testo.split('\u0000');
      for (let i = 0; i + 1 < p.length; i += 2) {
        const a = p[i + 1].indexOf('\n');
        voci.push([p[i], a < 0 ? p[i + 1] : p[i + 1].slice(0, a), a < 0 ? '' : p[i + 1].slice(a + 1)]);
      }
    } else {
      for (const riga of testo.split(/\r?\n/)) {
        const m = /^(local|worktree)\t([^=]+)=?(.*)$/.exec(riga);
        if (m) voci.push([m[1], m[2], m[3]]);
      }
    }
    return voci.some(([ambito, k, valore]) => {
      if (ambito !== 'local' && ambito !== 'worktree') return false;
      return !gitChiaveInerte(k, valore, false);
    });
  }

  global.SN_CMD_CLASSIFY = {
    gitConfigLancia,
    // Per la sentinella che prova su ogni nome le forme che scrivono o eseguono: chi aggiunge un nome la deve aggiornare.
    nomiDiLettura: () => ({ level1: [...LEVEL1], ps: [...PS_READ], git: [...GIT_READ] }),
    // Per la sentinella che prova ogni segno interno scritto a mano.
    segniInterni,
    cancellaPerSempre, PROGRAMMI_RETE,
    classify, classifyDetail, fuoriPerimetro, pulisciPercorso, diRete, privato, aperteDentro, programOf, subcommandOf, comeCmd,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

// Parte di cmdClassify.js (#2493): gruppi, sottoespressioni e `if` di PowerShell (#516), le letture di ogni shell, la riga piatta.
// Non pubblica niente per conto suo: si registra su SN_CMD_PARTI, e la compone cmdClassify.js, dove stanno le regole.
// Si carica dopo le altre parti e prima di cmdClassify.js: da loro prende al caricamento.
(function (global) {
  'use strict';
  const P = global.SN_CMD_PARTI;
  const {
    TRE, unquote, SEGNAPOSTO, shellPosix, programOf, PS_READ, SPOSTAMENTI, LEVEL1, LEVEL1_MUTATES, dequote, FONTI_NOTE,
    CALCOLANO, nomiVariabili, VAR_INNOCUE, peggiore, due, MOTIVI, APICE_TESTO, VIRGOLETTE_TESTO, contesto, segniInterni,
    forsePowerShell, PS_IMPOSTA_AUTOMATICA_RE, forseDash, APICE_CHE_DASH_CHIUDE, splitSafeSequence, UNO, classifyOneDet,
    spostati, chiaveCwd, splitSafePipeline, segmentIsRead, LETTI_DAL_TUBO, PERCORSO_DAL_TUBO, CERCANO_NOME, argomenti,
    parametro, ELENCA_OGGETTI, PS_PIPE_ONLY, perimetroDi, CHAIN_RE, SEGNO_GRUPPO, graffe,
  } = P;

  // ── Gruppi, sottoespressioni e `if` di PowerShell (#516) ─────────────────
  // `( )`, `@( )` e `$( )` ESEGUONO ciò che contengono, anche come argomento di
  // un comando qualunque (`ls (Remove-Item x)` cancella). Ogni gruppo e ogni
  // ramo di un `if` si classifica per ciò che esegue; il comando attorno, con
  // SEGNAPOSTO al posto del gruppo. Una forma che `smonta` non riconosce è 3.
  const PROF_MAX = 8;
  const CD_RE = /(^|[^\w-])(cd|chdir|set-location|sl|pushd|popd)(?![\w-])/i;
  const LETTERALE = String.raw`'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?|\$(?:env:)?[A-Za-z_]\w*`;
  const LETTERALI_RE = new RegExp(`^\\s*(?:${LETTERALE})(?:\\s*,\\s*(?:${LETTERALE}))*\\s*$`, 'i');
  const LETTERALE_G = new RegExp(LETTERALE, 'gi');
  const TERMINE_RE = /^(?:'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?(?:kb|mb|gb|tb|pb)?|\$(?:env:)?[A-Za-z_]\w*)/i;
  const MEMBRI_RE = /^(?:\.[A-Za-z_]\w*|\[-?\d+\])*/;
  const OPERATORE_RE = /^\s*(?:-[ci]?(?:eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|notcontains|in|notin|join|and|or|xor)(?![\w-])|[+*/%,]|-(?=\s))/i;
  const UNARIO_RE = /^\s*(?:!|-not(?![\w-]))/i;
  const VALORE_RE = new RegExp(`${TERMINE_RE.source}$`, 'i');

  const saltaSpazi = (s, k) => { while (k < s.length && /\s/.test(s[k])) k += 1; return k; };

  // Indice della parentesi che chiude quella in `i`, saltando le stringhe; -1 se manca.
  function chiusura(s, i) {
    const apre = s[i];
    const chiude = apre === '(' ? ')' : '}';
    let prof = 0;
    for (let k = i; k < s.length; k++) {
      const ch = s[k];
      if (ch === '"' || ch === "'") {
        const j = s.indexOf(ch, k + 1);
        if (j < 0) return -1;
        k = j;
      } else if (ch === apre) prof += 1;
      else if (ch === chiude && (prof -= 1) === 0) return k;
    }
    return -1;
  }

  // Un gruppo si apre dopo uno spazio, una virgola, un `!` o il `-Nome:` di un
  // parametro. Attaccato a un nome (`$f.MoveTo(`, `[IO.File]::Delete(`) è una
  // chiamata di metodo, che non si classifica.
  function apreGruppo(s, i) {
    if (i === 0 || /[\s,!]/.test(s[i - 1])) return true;
    if (s[i - 1] !== ':') return false;
    let k = i - 2;
    while (k >= 0 && /[A-Za-z]/.test(s[k])) k -= 1;
    return k < i - 2 && s[k] === '-' && (k === 0 || /\s/.test(s[k - 1]));
  }

  // `if (…) {…} elseif (…) {…} else {…}`: condizioni e corpi diventano pezzi.
  // Ritorna l'indice dopo l'ultima graffa, -1 se la forma non è questa.
  function seIf(s, k, aggiungi) {
    for (let ramo = 'if'; ;) {
      if (ramo !== 'else') {
        k = saltaSpazi(s, k);
        const j = s[k] === '(' ? chiusura(s, k) : -1;
        if (j < 0 || !s.slice(k + 1, j).trim()) return -1;
        aggiungi(s.slice(k + 1, j), false);
        k = j + 1;
      }
      k = saltaSpazi(s, k);
      const j = s[k] === '{' ? chiusura(s, k) : -1;
      if (j < 0) return -1;
      aggiungi(s.slice(k + 1, j), true);
      k = j + 1;
      if (ramo === 'else') return k;
      const m = /^\s*(elseif|else)(?=[\s({]|$)/i.exec(s.slice(k));
      if (!m) return k;
      ramo = m[1].toLowerCase();
      k += m[0].length;
    }
  }

  // Un'espressione a inizio istruzione (`(gci).Count -gt 0`, `-not (Test-Path x)`):
  // apre con un gruppo, e fuori dai gruppi ammette solo operatori, proprietà,
  // numeri, stringhe e variabili. `lasciato` è il testo che non si riclassifica.
  function espressione(s, k, gruppo) {
    let lasciato = '';
    for (let primo = true; ; primo = false) {
      let m;
      while ((m = UNARIO_RE.exec(s.slice(k)))) k += m[0].length;
      k = saltaSpazi(s, k);
      if (s[k] === '(' || ((s[k] === '@' || s[k] === '$') && s[k + 1] === '(')) {
        const j = gruppo(s[k] === '(' ? k : k + 1);
        if (j < 0) return null;
        k = j + 1;
      } else if (!primo && (m = TERMINE_RE.exec(s.slice(k)))) {
        lasciato += ` ${m[0]}`;
        k += m[0].length;
      } else return null;
      k += MEMBRI_RE.exec(s.slice(k))[0].length;
      if (!(m = OPERATORE_RE.exec(s.slice(k)))) return { fine: k, lasciato };
      k += m[0].length;
    }
  }

  // Il comando con ogni gruppo ed ogni `if` sostituiti (`testo`) e ciò che quei
  // costrutti eseguono (`pezzi`). null senza gruppi; TRE se la forma non si
  // riconosce. `mosso`: un pezzo cambia cartella, quindi dopo non la si conosce.
  function smonta(s, c) {
    let q = '';
    let gruppi = false;
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (q) {
        if (ch === q) q = '';
        else if (q === '"' && ch === '$' && /[({]/.test(s[k + 1] || '')) return TRE;
      } else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '(' || (ch === '@' && s[k + 1] === '{')) gruppi = true;
    }
    if (!gruppi) return null;
    // Virgolette che qui non si leggono come le legge la shell (tipografiche, che
    // PowerShell accetta; dopo un backslash, in bash; non chiuse), `@{` (i valori
    // di una tabella sono comandi), `${…}` (in PowerShell legge un file).
    if (q || /[`\r\n\u2018-\u201e]|\\['"]|\$\{|@\{/.test(s)) return TRE;
    const pezzi = [];
    let out = '';
    let lasciato = '';
    let spostato = false;
    let mosso = false;
    const aggiungi = (testo, corpo) => {
      pezzi.push({ testo, corpo, spostato });
      // Senza virgolette, come le legge la shell: `c""d` è `cd`.
      if (CD_RE.test(unquote(testo))) { spostato = true; mosso = true; }
    };
    const gruppo = (a) => {
      const j = chiusura(s, a);
      if (j > a) aggiungi(s.slice(a + 1, j), false);
      return j;
    };
    let i = 0;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) out += s[i++];
      if (i >= s.length) break;
      const resto = s.slice(i);
      if (/^if\s*\(/i.test(resto)) {
        i = seIf(s, i + 2, aggiungi);
        if (i < 0) return TRE;
        out += `Write-Output ${SEGNAPOSTO}`;
      } else if (/^(?:[@$]?\(|!|-not(?![\w-]))/i.test(resto)) {
        // In sh, bash e zsh `$(…)` in testa esegue come comando ciò che stampa, e `@(…)` è un nome da espandere (#2392).
        if (shellPosix(c) && /^(?:(?:!|-not(?![\w-]))\s*)*[@$]\(/i.test(resto)) return TRE;
        const r = espressione(s, i, gruppo);
        if (!r) return TRE;
        lasciato += r.lasciato;
        out += `Write-Output ${SEGNAPOSTO}`;
        i = r.fine;
      } else {
        const prog = programOf(/^\S*/.exec(resto)[0]);
        while (i < s.length) {
          const ch = s[i];
          if (ch === ';' || ch === '|' || (ch === '&' && s[i + 1] === '&')) break;
          if (ch === ')' || ch === '}') return TRE;
          let j;
          if (ch === '"' || ch === "'") {
            j = s.indexOf(ch, i + 1);
            if (j < 0) return TRE;
            out += s.slice(i, j + 1);
          } else if (ch === '{') {
            // Uno scriptblock resta com'è (lo giudica segmentIsRead), ma senza gruppi dentro.
            j = chiusura(s, i);
            if (j < 0 || /\(/.test(s.slice(i, j).replace(/'[^']*'|"[^"]*"/g, ''))) return TRE;
            out += s.slice(i, j + 1);
          } else if (ch === '(' || ((ch === '@' || ch === '$') && s[i + 1] === '(')) {
            if (!apreGruppo(s, i)) return TRE;
            const a = ch === '(' ? i : i + 1;
            j = chiusura(s, a);
            if (j < 0) return TRE;
            const dentro = s.slice(a + 1, j);
            // Un gruppo di soli letterali (`@("a","b")`) vale quei letterali: un cmdlet li riceve come
            // un elenco, un programma esterno come argomenti separati (`git branch ("-D","x")`).
            if (LETTERALI_RE.test(dentro)) out += dentro.match(LETTERALE_G).join(PS_READ.has(prog) ? ',' : ' ');
            else { aggiungi(dentro, false); out += SEGNAPOSTO; }
          } else {
            out += ch;
            j = i;
          }
          i = j + 1;
        }
        if (SPOSTAMENTI.has(prog)) spostato = true;
      }
      i = saltaSpazi(s, i);
      if (i >= s.length) break;
      const sep = /^(?:;|&&|\|\|?)/.exec(s.slice(i));
      if (!sep) return TRE;
      out += sep[0];
      i += sep[0].length;
    }
    return { testo: out, pezzi, lasciato, mosso };
  }

  // Un gruppo come argomento vale qualcosa che si sa solo eseguendolo: verso un
  // programma esterno (o in bash) può essere un flag (`git checkout $(echo .)`), in
  // PowerShell uno scriptblock (`(Get-Command f).ScriptBlock`), che questi cmdlet
  // eseguono, e con un input dal tubo qualunque cmdlet. Si accetta solo dove nessun
  // valore cambia il livello o il perimetro, e in testa alla pipeline.
  const ESEGUONO_BLOCCHI = new Set([
    'select-object', 'select', 'sort-object', 'group-object', 'group', 'measure-object', 'measure',
    'compare-object', 'format-table', 'ft', 'format-list', 'fl', 'format-wide', 'fw', 'where',
  ]);
  function gruppoComeArgomento(prog) {
    return (PS_READ.has(prog) || LEVEL1.has(prog) || SPOSTAMENTI.has(prog)) && !ESEGUONO_BLOCCHI.has(prog)
      && !LEVEL1_MUTATES[prog] && prog !== 'grep' && prog !== 'findstr';
  }
  const gruppiAlPosto = (testo) => testo.split(/;|&&|\|\|/).every((istr) => istr.split('|')
    .every((seg, i) => !seg.includes(SEGNAPOSTO) || (i === 0 && gruppoComeArgomento(programOf(dequote(seg))))));

  function valoreNoto(testo) {
    if (/[({]/.test(String(testo).replace(/'[^']*'|"[^"]*"/g, ''))) return false;
    return String(testo).split(/;|&&|\|\|/).every((istr) => istr.split('|').every((seg, i) => {
      const prog = programOf(dequote(seg.trim()));
      return !seg.trim() || (FONTI_NOTE.has(prog) && !(i > 0 && CALCOLANO.has(prog)));
    }));
  }

  function classifica(cmd, c, prof) {
    const trimmed = String(cmd).trim();
    if (!trimmed || prof > PROF_MAX) return TRE;
    const sm = smonta(trimmed, c);
    if (sm === null) return classificaPiatta(trimmed, c);
    // Il testo lasciato fuori non passa dai controlli dei separatori: non ne deve avere, neanche fra virgolette.
    if (sm === TRE || /[;|&<>]/.test(sm.lasciato)) return TRE;
    if (!gruppiAlPosto(sm.testo)) return TRE;
    // Un gruppo che prende testo da un file può valere un percorso di rete (#1072).
    if (sm.pezzi.some((p) => !valoreNoto(p.testo))) c = { ...c, valoriIgnoti: true };
    const ignota = { ...c, cwd: null };
    let det = classificaPiatta(sm.testo.trim(), sm.mosso ? ignota : c);
    if (nomiVariabili(sm.lasciato).some((n) => !VAR_INNOCUE.has(n))) det = peggiore(det, due(MOTIVI.variabili));
    for (const p of sm.pezzi) {
      if (det.level === 3) break;
      const t = p.testo.trim();
      // Ciò che un gruppo stampa diventa l'argomento del comando attorno.
      const cc = { ...(p.spostato ? ignota : c), stampaLibera: false };
      // Il corpo di un `if` può essere vuoto o un valore solo (stringa, numero, variabile), che PowerShell stampa.
      if (p.corpo && !t) continue;
      const sub = p.corpo && VALORE_RE.test(t) ? `Write-Output ${t}` : t;
      det = peggiore(det, classifica(sub, cc, prof + 1));
    }
    return det;
  }

  // cmd toglie ogni `^` fuori dalle virgolette prima di passare il comando: `^.ssh` è `.ssh`, `^\^\host` è
  // `\\host`, `-^-force` è `--force` (#1072.1). null dove qui non si legge come cmd: un `^` in coda (si
  // prende la riga dopo), su un separatore (diventa testo), accanto alle espansioni `%` (fatte prima) e `!`.
  function comeCmd(cmd) {
    let out = '';
    let virgolette = false;
    let tolti = false;
    for (let i = 0; i < cmd.length; i++) {
      const ch = cmd[i];
      if (ch !== '^' || virgolette) {
        if (ch === '"') virgolette = !virgolette;
        out += ch;
        continue;
      }
      const dopo = cmd[i + 1];
      if (dopo === undefined || /[&|<>()%\r\n]/.test(dopo)) return null;
      out += dopo; // `^"` non apre né chiude le virgolette
      i += 1;
      tolti = true;
    }
    if ((tolti && out.includes('%')) || (out.includes('!') && out.includes('^'))) return null;
    return out;
  }

  // Livello del comando e, se chiede conferma per il perimetro, il perché.
  // PowerShell legge “ ” „ ‟ come `"`, ‘ ’ ‚ ‛ come `'` e – — ― in testa a una parola come `-`: i controlli
  // devono vedere il comando che la shell esegue, non la sua grafia (#1072). Per cmd quei segni sono testo.
  // Per cmd `'` è testo (`' \\host\x '` sono tre argomenti), per i programmi C anche `\"` (findstr); i programmi
  // MSYS (cat, ls di Git) leggono `'` come virgolette. Vale la lettura peggiore, a pari livello la prima (#1072.5).
  function comeLaShell(cmd, c) {
    if (!c.win && c.shell !== 'cmd') return [cmd];
    if (c.shell === 'cmd') {
      const l = comeCmd(cmd);
      if (l == null) return null;
      const interni = l.replace(/'/g, APICE_TESTO);
      const programmiC = interni.replace(/(\\+)"/g, (m, b) => (b.length % 2 ? '\\'.repeat(b.length >> 1) + VIRGOLETTE_TESTO : m));
      return [...new Set([programmiC, interni, l])];
    }
    return [cmd.replace(/[\u201C-\u201F]/g, '"')
      .replace(/[\u2018-\u201B]/g, "'")
      .replace(/(^|[\s(,;|&{=])[\u2013-\u2015]/g, '$1-')];
  }

  function classifyDetail(cmd, ctx) {
    if (typeof cmd !== 'string') return TRE;
    const c = { ...contesto(ctx), stampaLibera: true };
    if ([...segniInterni()].some((s) => cmd.includes(s))) return TRE;
    if (forsePowerShell(c) && PS_IMPOSTA_AUTOMATICA_RE.test(cmd)) return TRE;
    const letture = comeLaShell(cmd, c);
    if (letture == null) return TRE;
    const contesti = forseDash(c) && APICE_CHE_DASH_CHIUDE.test(cmd) ? [c, { ...c, senzaAnsi: true }] : [c];
    return letture.flatMap((l) => contesti.map((cc) => classifica(l, cc, 0))).reduce(peggiore);
  }

  // Un comando senza gruppi: sequenze, pipeline e comandi singoli.
  function classificaPiatta(trimmed, c) {
    if (!trimmed) return TRE;

    // Sequenza pura → livello massimo dei pezzi. Vale anche con UN solo pezzo: `git checkout .;`
    // va classificato sul comando vero, non sul token `.;` che non somiglia a niente di noto.
    const seq = splitSafeSequence(trimmed);
    if (seq && seq.length) {
      let cands = [c];
      let det = UNO;
      // I valori si raccolgono man mano: rifare l'elenco a ogni `$_` costava il quadrato dei comandi (#1994.1).
      const valori = new Set();
      let primo = true;
      let ignoto = false;
      let misure = 0;
      for (const part of seq) {
        let forme = [part];
        if (usaUltimoArg(part, c)) {
          misure += valori.size;
          if (primo || ignoto || valori.size > ULTIMI_MAX || misure > MISURE_MAX) return TRE;
          forme = [...valori].map((v) => part.replace(ULTIMO_ARG_RE, () => comeParola(v)));
        }
        for (const f of forme) {
          for (const cc of cands) det = peggiore(det, classifyOneDet(f, cc));
          primo = false;
          if (ignoto || valori.size > ULTIMI_MAX) continue;
          const u = ultimiArgomenti(f, c);
          if (u) u.forEach((v) => valori.add(v));
          else ignoto = true;
        }
        if (!SPOSTAMENTI.has(programOf(dequote(part)))) continue;
        const visti = new Map();
        for (const cc of cands.concat(cands.map((x) => spostati(part, x)))) visti.set(chiaveCwd(cc), cc);
        cands = [...visti.values()];
        if (cands.length > 8) cands = [c, { ...c, cwd: null }];
      }
      return det;
    }
    // Pipeline di sole letture → 1: incanalare una lettura in un'altra non produce niente in
    // più. Basta un segmento non riconosciuto, o uno scriptblock che invochi, e si torna a 3.
    const pipe = splitSafePipeline(trimmed);
    if (pipe) {
      if (usaUltimoArg(trimmed, c)) return TRE;
      if (!pipe.every((p) => segmentIsRead(p, true, c))) return TRE;
      const progs = pipe.map((p) => programOf(dequote(p)));
      const cp = progs.some((x) => SPOSTAMENTI.has(x)) ? { ...c, cwd: null } : c;
      let det = UNO;
      let elenco = false;
      let noto = true;
      pipe.forEach((p, i) => {
        if (elenco && LETTI_DAL_TUBO.has(progs[i])) det = peggiore(det, due(MOTIVI.ignoto));
        // Testo letto da un file, dato come percorso, può portare in rete (#1072).
        if (!noto && PERCORSO_DAL_TUBO.has(progs[i])) det = peggiore(det, due(MOTIVI.ignoto));
        // Un nome dal tubo si risolve contro la cartella di lavoro: in rete lo riceve il remoto (#1072.4).
        if (i > 0 && (PERCORSO_DAL_TUBO.has(progs[i]) || CERCANO_NOME.has(progs[i])) && cp.cwd && cp.cwd.rete) det = peggiore(det, due(MOTIVI.rete));
        // Join-Path/Split-Path sul valore del tubo compongono ciò che nessun argomento scrive (`'\\' | Join-Path`):
        // chi lo riceve come percorso chiede (noto), e Join-Path -Resolve lo apre da sé.
        if (i > 0 && progs[i] === 'join-path' && argomenti(p, c).some((a) => parametro(a.testo, 'resolve', 1))) det = peggiore(det, due(MOTIVI.ignoto));
        if (!FONTI_NOTE.has(progs[i]) || (i > 0 && CALCOLANO.has(progs[i])) || (c.valoriIgnoti && p.includes(SEGNAPOSTO))) noto = false;
        if (ELENCA_OGGETTI.has(progs[i]) || p.includes(SEGNAPOSTO)) elenco = true;
        if (!PS_PIPE_ONLY.has(progs[i])) det = peggiore(det, perimetroDi(p, i < pipe.length - 1 ? { ...cp, stampaLibera: false } : cp));
      });
      return det;
    }

    // Pipe / background / redirezioni / sostituzioni: non riconoscibili → 3.
    if (!seq && CHAIN_RE.test(trimmed)) return TRE;
    if (usaUltimoArg(trimmed, c)) return TRE;

    return classifyOneDet(trimmed, c);
  }

  // In sh e bash `$_` vale l'ultimo argomento del comando eseguito prima, che sceglie chi scrive la riga (#1994): si
  // misura con ognuno dei valori che può prendere. In testa alla riga, in un tubo o da un valore ignoto non si sa.
  // Senza contesto resta la lettura di PowerShell, dove `$_` è l'oggetto del tubo.
  // Il SEGNAPOSTO di un gruppo comincia anch'esso con `$_`, ma non è la variabile: `(ls | wc -l)` resta una lettura (#2345).
  const ULTIMO_ARG_RE = new RegExp(String.raw`\$_(?![\w${SEGNO_GRUPPO}])`, 'g');
  const ULTIMI_MAX = 16;
  function usaUltimoArg(s, c) {
    return shellPosix(c) && String(s).search(ULTIMO_ARG_RE) >= 0;
  }
  function ultimiArgomenti(raw, c) {
    const out = [];
    for (const vuote of [false, true]) {
      const args = argomenti(raw, { ...c, vuote });
      const ultimo = args[args.length - 1];
      if (!ultimo || ultimo.variabile || ultimo.ignoto) return null;
      const parole = graffe(args.map((a) => a.testo));
      if (!parole || !parole.length) return null;
      out.push(parole[parole.length - 1]);
      // bash toglie le parole vuote nate da graffe o da "$@" (`echo --output=x {,}` lascia `--output=x` in `$_`).
      const piene = parole.filter(Boolean);
      if (piene.length) out.push(piene[piene.length - 1]);
    }
    // Un gruppo fra gli argomenti lascia in `$_` ciò che stampa: si sa solo eseguendolo (#2392).
    return out.some((v) => v.includes(SEGNO_GRUPPO)) ? null : out;
  }
  const comeParola = (v) => (/^[\w./:=@%+,-]+$/.test(v) ? v : `'${v.replace(/'/g, "'\\''")}'`);

  Object.assign(P, { comeCmd, classifyDetail });
})(typeof globalThis !== 'undefined' ? globalThis : self);

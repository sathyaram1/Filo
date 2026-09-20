// Modalità terminale della home: cartella corrente, colori ANSI, esecuzione
// dei comandi di shell.
//
// Qui vive la VERITÀ sullo stato del terminale — acceso o spento, quale shell,
// in che cartella siamo. Chiunque altro (la barra di input che colora i
// comandi, il turno di Filo che applica un `cd`) la chiede da qui invece di
// tenersene una copia: tre copie della stessa cartella sono tre modi di
// mostrarne una sbagliata.
//
// Forma del modulo: IIFE che si registra su globalThis e NON tocca il DOM al
// caricamento — solo dentro `init`.
(function (global) {
  'use strict';

  const { STORAGE_KEYS } = global.SN_CONST;

  // Dipendenze dalla pagina, riempite da init().
  let dashDir = null;
  let inputEl = null;
  let bubblesEl = null;
  let makeBubble = null;
  let goThread = null;
  let updateInputClass = () => {};
  // #525 — mette una riga di questa conversazione nell'archivio della chat in
  // corso (la targa la sa la pagina, che è la stessa che manda i turni).
  let archiviaRiga = () => {};

  // ===== Stato del terminale (fonte unica) =====
  let terminalMode = false;          // attivabile da Preferenze
  let terminalShell = 'powershell';  // 'powershell' | 'cmd' | 'bash'
  let currentCwd = '';               // directory mostrata nella riga grigia

  function updateDirLine() {
    dashDir.textContent = currentCwd || '';
  }

  // Aggiorna la cartella corrente e la RENDE PERSISTENTE tra le sessioni (#259):
  // riaprendo Filo si riparte da qui, non dalla home. Un solo punto di verità per
  // ogni cambio di `cwd`, così barra mostrata, cartella reale e valore salvato
  // restano allineati.
  function setCwd(cwd) {
    if (!cwd || cwd === currentCwd) return;
    currentCwd = cwd;
    updateDirLine();
    applyTerminalMode();
    try { self.SN_STORAGE?.setRaw?.(STORAGE_KEYS.FILO_TERMINAL_CWD, cwd); } catch (_) {}
  }

  // L'assistente ha eseguito uno o più comandi: se l'ultimo ha cambiato cartella
  // (un `cd`, ora persistente), il main ce la riporta in _output.cwd. Aggiorniamo
  // la barra del percorso così "percorso mostrato" e cartella reale coincidono.
  function applyCommandCwd(actions) {
    if (!Array.isArray(actions)) return;
    let cwd = '';
    for (const a of actions) {
      const out = a && a._output;
      if (out && out.cwd) cwd = out.cwd;
    }
    if (cwd) setCwd(cwd);
  }

  function applyTerminalMode() {
    dashDir.hidden = !terminalMode || !currentCwd;
    inputEl.placeholder = terminalMode
      ? 'Chiedi qualsiasi cosa… o /comando per la shell'
      : 'Chiedi qualsiasi cosa…';
    updateInputClass();
  }

  async function initCwd() {
    if (currentCwd) return;
    // Ripristina l'ultima cartella in cui era il terminale (#259): riaprendo Filo
    // non si torna alla home. Se non c'è nulla di salvato (primo avvio) si parte
    // dalla home come prima. Se la cartella salvata non esiste più, il main la
    // riporta alla home al primo comando (shell.js valida la cwd) e il valore si
    // auto-corregge.
    try {
      const saved = await self.SN_STORAGE?.getRaw?.(STORAGE_KEYS.FILO_TERMINAL_CWD, '');
      if (saved && typeof saved === 'string') currentCwd = saved;
    } catch (_) {}
    if (!currentCwd) {
      try {
        const r = await window.filo?.shellHome?.();
        if (r?.cwd) currentCwd = r.cwd;
      } catch (_) {}
    }
    updateDirLine();
  }

  // L'utente ha cambiato le preferenze del terminale mentre la home è aperta.
  // Se il terminale si accende adesso e non sappiamo ancora dove siamo, la
  // cartella si recupera prima di ridisegnare la barra.
  function applySettings(t) {
    if (!t) return;
    if (typeof t.enabled === 'boolean') terminalMode = t.enabled;
    if (t.shell) terminalShell = t.shell;
    if (terminalMode && !currentCwd) {
      initCwd().then(applyTerminalMode);
    } else {
      applyTerminalMode();
    }
  }

  // ===== Rendering colori ANSI (SGR) per l'output del terminale =====
  // Niente emulazione TUI: interpretiamo solo le sequenze di colore/stile
  // (ESC[…m) e SCARTIAMO il resto (movimenti cursore, OSC…), così i tool che
  // colorano (git, ls --color, eslint…) si vedono giusti senza che i codici
  // grezzi sporchino l'output. Le altre sequenze a schermo intero non servono.
  const ANSI_BASE = ['#1e1e1e', '#cc4136', '#4e9a06', '#c4a000', '#3465a4',
    '#a347ba', '#0e9aa7', '#d3d7cf', '#6e7170', '#ef5350', '#8ae234',
    '#e6d44e', '#5a9ee6', '#c77fd6', '#34e2e2', '#fafafa'];
  function xterm256(n) {
    if (n < 16) return ANSI_BASE[n];
    if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
    const k = n - 16, L = [0, 95, 135, 175, 215, 255];
    return `rgb(${L[Math.floor(k / 36) % 6]},${L[Math.floor(k / 6) % 6]},${L[k % 6]})`;
  }
  // Trova una sequenza ESC a partire da `pos` (dove s[pos] === ESC). Ritorna
  // { end, sgr } oppure null se la sequenza è troncata a fine chunk (da
  // ricomporre col chunk successivo).
  function parseEscape(s, pos) {
    if (pos + 1 >= s.length) return null;
    const c = s[pos + 1];
    if (c === '[') { // CSI
      let j = pos + 2;
      while (j < s.length && !(s.charCodeAt(j) >= 0x40 && s.charCodeAt(j) <= 0x7e)) j++;
      if (j >= s.length) return null;
      return { end: j + 1, sgr: s[j] === 'm' ? s.slice(pos + 2, j) : null };
    }
    if (c === ']') { // OSC: fino a BEL o ST (ESC \)
      let j = pos + 2;
      while (j < s.length) {
        if (s[j] === '\x07') return { end: j + 1, sgr: null };
        if (s[j] === '\x1b') { if (j + 1 >= s.length) return null; if (s[j + 1] === '\\') return { end: j + 2, sgr: null }; }
        j++;
      }
      return null;
    }
    return { end: pos + 2, sgr: null }; // sequenza a due byte (ESC c, ESC 7…)
  }

  function runShellCommand(command, chat) {
    if (!command) return;
    if (document.body.dataset.state !== 'thread') goThread();
    // La conversazione a cui il comando e il suo esito appartengono è questa,
    // anche se l'esito arriva fra dieci secondi e intanto l'utente se n'è andato.
    const chatDelComando = chat || chatDellaRiga();

    // #525 — il comando e il suo esito sono battute di QUESTA conversazione:
    // l'utente li legge qui, in mezzo alle altre, e riaprendo la chat da
    // Cronologia li deve ritrovare. Prima restavano solo sullo schermo e la
    // chat si rileggeva con un buco dentro, proprio dove c'era la riga che si
    // torna a cercare («qual era il comando di ieri?»).
    archiviaRiga(`/${command}`, 'user', chatDelComando);

    // Bolla "comando" (stile utente) con il prompt digitato.
    const cmdBubble = makeBubble({ role: 'user', text: '' });
    cmdBubble.classList.add('dash-term-cmd');
    const promptLine = document.createElement('span');
    promptLine.className = 'dash-term-prompt';
    promptLine.textContent = '/ ';
    cmdBubble.appendChild(promptLine);
    cmdBubble.appendChild(document.createTextNode(command));
    bubblesEl.appendChild(cmdBubble);

    // Bolla output (monospace) con controlli.
    const out = document.createElement('div');
    out.className = 'dash-bubble dash-bubble-filo dash-term';
    const pre = document.createElement('pre');
    pre.className = 'dash-term-out';
    out.appendChild(pre);

    const controls = document.createElement('div');
    controls.className = 'dash-term-controls';
    const stdinInput = document.createElement('input');
    stdinInput.type = 'text';
    stdinInput.className = 'dash-term-stdin';
    stdinInput.placeholder = 'Invio testo al comando…';
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'dash-term-stop';
    stopBtn.textContent = 'Stop';
    controls.appendChild(stdinInput);
    controls.appendChild(stopBtn);
    out.appendChild(controls);
    bubblesEl.appendChild(out);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;

    // Stato di stile ANSI per QUESTA bolla (attraversa i chunk: un colore
    // aperto in un chunk resta valido nei successivi finché non c'è un reset).
    const ansi = { tail: '', fg: null, bg: null, bold: false, dim: false, underline: false };
    const applySgr = (params) => {
      const codes = (params === '' ? '0' : params).split(';').map((x) => parseInt(x || '0', 10) || 0);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) { ansi.fg = ansi.bg = null; ansi.bold = ansi.dim = ansi.underline = false; }
        else if (c === 1) ansi.bold = true;
        else if (c === 2) ansi.dim = true;
        else if (c === 4) ansi.underline = true;
        else if (c === 22) { ansi.bold = false; ansi.dim = false; }
        else if (c === 24) ansi.underline = false;
        else if (c === 39) ansi.fg = null;
        else if (c === 49) ansi.bg = null;
        else if (c >= 30 && c <= 37) ansi.fg = ANSI_BASE[c - 30];
        else if (c >= 90 && c <= 97) ansi.fg = ANSI_BASE[c - 90 + 8];
        else if (c >= 40 && c <= 47) ansi.bg = ANSI_BASE[c - 40];
        else if (c >= 100 && c <= 107) ansi.bg = ANSI_BASE[c - 100 + 8];
        else if (c === 38 || c === 48) {
          const tgt = c === 38 ? 'fg' : 'bg';
          if (codes[i + 1] === 5) { ansi[tgt] = xterm256(codes[i + 2] || 0); i += 2; }
          else if (codes[i + 1] === 2) { ansi[tgt] = `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`; i += 4; }
        }
      }
    };
    const styledSpan = (text, isErr) => {
      const node = document.createElement('span');
      if (isErr) node.className = 'dash-term-err';
      if (ansi.fg) node.style.color = ansi.fg;
      if (ansi.bg) node.style.background = ansi.bg;
      if (ansi.bold) node.style.fontWeight = '700';
      if (ansi.dim) node.style.opacity = '0.7';
      if (ansi.underline) node.style.textDecoration = 'underline';
      node.textContent = text;
      return node;
    };

    // L'esito ripulito dalle sequenze di colore, come lo legge chi guarda: è
    // quello che finisce nell'archivio della chat quando il comando ha finito.
    let testoEsito = '';
    const appendOut = (chunk, isErr) => {
      const data = ansi.tail + chunk;
      ansi.tail = '';
      let i = 0, plain = '';
      const flushPlain = () => {
        if (!plain) return;
        pre.appendChild(styledSpan(plain, isErr));
        testoEsito += plain;
        plain = '';
      };
      while (i < data.length) {
        const esc = data.indexOf('\x1b', i);
        if (esc === -1) { plain += data.slice(i); break; }
        plain += data.slice(i, esc);
        const seq = parseEscape(data, esc);
        if (seq === null) { ansi.tail = data.slice(esc); break; } // troncata: rimanda
        if (seq.sgr !== null) { flushPlain(); applySgr(seq.sgr); }
        i = seq.end;
      }
      flushPlain();
      const atBottom = bubblesEl.scrollHeight - bubblesEl.scrollTop - bubblesEl.clientHeight < 40;
      if (atBottom) bubblesEl.scrollTop = bubblesEl.scrollHeight;
    };

    let finished = false;
    const finish = (label) => {
      if (finished) return;
      finished = true;
      // Se il focus era sui controlli che sto per rimuovere (es. campo stdin),
      // riportalo nella barra principale invece di perderlo nel vuoto.
      const focusWasInControls = controls.contains(document.activeElement);
      controls.remove();
      if (focusWasInControls) inputEl.focus();
      if (label) {
        const tag = document.createElement('div');
        tag.className = 'dash-term-exit';
        tag.textContent = label;
        out.appendChild(tag);
      }
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
      // L'esito va nell'archivio quando è finito, non a pezzi: un comando che
      // scrive per un minuto riscriverebbe la chat a ogni riga. Un esito
      // enorme si accorcia, ma dicendolo (SN_CHAT_ARCHIVE.clampOutput): un
      // taglio muto toglie proprio l'errore in fondo.
      const CA = global.SN_CHAT_ARCHIVE;
      const corpo = `${testoEsito}${label ? `\n${label}` : ''}`.replace(/\s+$/, '');
      const daScrivere = corpo.trim() ? corpo : '(nessun esito)';
      archiviaRiga(CA ? CA.clampOutput(daScrivere) : daScrivere, 'filo', chatDelComando);
    };

    const handle = window.filo.shellExec({
      command,
      cwd: currentCwd,
      shell: terminalShell,
      onData: ({ chunk, stream }) => appendOut(chunk, stream === 'stderr'),
      onExit: ({ code, cwd }) => {
        if (cwd) setCwd(cwd);
        finish(code === 0 ? null : `(uscita con codice ${code})`);
      },
      onError: ({ message }) => {
        appendOut(`\n${message || 'Errore di esecuzione.'}`, true);
        finish('(comando non avviato)');
      },
    });

    stopBtn.addEventListener('click', () => {
      handle.abort();
      finish('(interrotto)');
    });
    stdinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handle.sendInput(stdinInput.value + '\n');
        appendOut(stdinInput.value + '\n', false);
        stdinInput.value = '';
      }
    });
    // Il cursore resta nella barra principale così l'utente può digitare subito
    // il comando successivo senza ricliccare. Il campo "Invio testo al comando…"
    // qui sopra resta cliccabile per i comandi interattivi che chiedono stdin.
    inputEl.focus();
  }

  function init(deps) {
    dashDir = deps.dashDir;
    inputEl = deps.inputEl;
    bubblesEl = deps.bubblesEl;
    makeBubble = deps.makeBubble;
    goThread = deps.goThread;
    if (deps.updateInputClass) updateInputClass = deps.updateInputClass;
    if (deps.archiviaRiga) archiviaRiga = deps.archiviaRiga;
  }

  global.SN_DASH_TERMINALE = {
    init,
    // Stato, chiesto e non copiato.
    isEnabled: () => terminalMode,
    getShell: () => terminalShell,
    getCwd: () => currentCwd,
    setEnabled: (v) => { terminalMode = !!v; },
    setShell: (v) => { if (v) terminalShell = v; },
    // Comportamento.
    setCwd,
    applyCommandCwd,
    applyTerminalMode,
    applySettings,
    initCwd,
    runShellCommand,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

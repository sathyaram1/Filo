// I file che il sistema ESEGUE con un doppio clic (#588): la lista che decide
// dove mettere attrito su uno scaricamento e sull'apertura.
// Regole, casi limite e frasi: tests/unit/eseguibili.test.mjs.

(function (global) {
  'use strict';

  // La lista è la stessa su ogni sistema: un .exe scaricato su Linux finisce
  // comunque sulla chiavetta di qualcuno, e chiedere solo sulla piattaforma
  // dove il file esegue lascerebbe passare proprio il caso peggiore.
  const ESTENSIONI = [
    // Windows: PATHEXT più i formati che la shell apre eseguendo.
    'exe', 'com', 'scr', 'pif', 'bat', 'cmd', 'msi', 'msp', 'mst',
    'msix', 'msixbundle', 'appx', 'appxbundle', 'cpl', 'msc', 'hta',
    'vbs', 'vbe', 'vb', 'jse', 'wsf', 'wsh', 'ws', 'wsc', 'sct',
    'ps1', 'ps1xml', 'ps2', 'psc1', 'psc2', 'psm1', 'psd1',
    'reg', 'lnk', 'inf', 'scf', 'url', 'chm', 'gadget', 'application', 'jnlp',
    // Mac: pacchetti, immagini disco e script che il Finder lancia.
    'dmg', 'pkg', 'mpkg', 'app', 'command', 'term', 'workflow', 'action',
    'scpt', 'scptd', 'applescript', 'prefpane', 'kext', 'osax',
    // Linux: installatori, immagini eseguibili e lanciatori.
    'sh', 'bash', 'zsh', 'csh', 'ksh', 'run', 'appimage', 'deb', 'rpm',
    'desktop', 'out', 'elf',
    // Interpretati ovunque ci sia l'interprete (su Windows basta il doppio clic).
    'jar', 'js', 'py', 'pyw',
  ];

  const SET = new Set(ESTENSIONI);

  // Caratteri che cambiano l'ORDINE di lettura senza cambiare il nome vero:
  // `fattura‮txt.exe` si legge «fatturaexe.txt» e resta un eseguibile.
  // Chi decide guarda il nome vero; chi legge deve vedere lo stesso nome.
  const INVISIBILI = /[​-‏؜‪-‮⁦-⁩﻿]/g;

  function nomeVisibile(nome) {
    return String(nome == null ? '' : nome).replace(INVISIBILI, '');
  }

  // Ultima estensione del nome, minuscola e senza punto. Windows ignora punti e
  // spazi in coda (`setup.exe.` e `setup.exe ` aprono lo stesso programma),
  // quindi vanno tolti PRIMA di guardare l'estensione, o il controllo si salta
  // con un carattere.
  function estensione(nome) {
    const s = nomeVisibile(nome).replace(/[.\s ]+$/, '');
    const i = s.lastIndexOf('.');
    if (i <= 0) return '';
    return s.slice(i + 1).toLowerCase();
  }

  // Conta l'ULTIMA estensione: `foto.jpg.exe` è un programma, non una foto.
  function eEseguibile(nome) {
    const ext = estensione(nome);
    return !!ext && SET.has(ext);
  }

  // Il sito da cui arriva, come lo si mostra a chi deve decidere: senza `www.`
  // e senza porta. Vuoto se l'indirizzo non è leggibile.
  function sito(url) {
    try {
      const h = new URL(String(url || '')).hostname.toLowerCase();
      return h.replace(/^www\./, '');
    } catch (_) { return ''; }
  }

  // Righe scritte a mano nelle impostazioni → elenco di domini confrontabili.
  // Tollera l'indirizzo intero incollato (`https://sito.it/percorso` → `sito.it`).
  function normalizzaSiti(righe) {
    const fonte = Array.isArray(righe) ? righe : String(righe || '').split(/[\n,]/);
    const out = [];
    for (const raw of fonte) {
      let s = String(raw || '').trim().toLowerCase();
      if (!s) continue;
      if (s.includes('/') || s.includes(':')) s = sito(s.includes('://') ? s : `https://${s}`);
      s = s.replace(/^www\./, '').replace(/^\.+|\.+$/g, '');
      if (!s || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) continue;
      if (!out.includes(s)) out.push(s);
    }
    return out;
  }

  // Un dominio in elenco vale anche per i suoi sottodomini (`sito.it` copre
  // `cdn.sito.it`), mai al contrario: `sito.it` non deve coprire `sito.it.evil.com`.
  function fidato(url, elenco) {
    const host = sito(url);
    if (!host) return false;
    for (const d of normalizzaSiti(elenco)) {
      if (host === d || host.endsWith('.' + d)) return true;
    }
    return false;
  }

  // Le frasi vivono qui perché le dicono tre superfici diverse (l'avviso della
  // barra, la pagina elenco, il pannello): devono dire la stessa cosa.
  const ETICHETTA = 'Programma';

  function daSito(url) {
    const s = sito(url);
    return s ? ` da ${s}` : '';
  }

  function testoScarica(nome, url) {
    return `«${nomeVisibile(nome)}» è un programma${daSito(url)}. Se lo apri può cambiare il computer. Scaricarlo?`;
  }

  function testoApri(nome, url) {
    return `«${nomeVisibile(nome)}» è un programma scaricato${daSito(url)}. Aprirlo vuol dire eseguirlo. Fallo solo se sai da chi arriva.`;
  }

  const TITOLO_APRI = 'Aprire un programma?';

  global.SN_ESEGUIBILI = {
    ESTENSIONI,
    nomeVisibile,
    estensione,
    eEseguibile,
    sito,
    normalizzaSiti,
    fidato,
    ETICHETTA,
    testoScarica,
    testoApri,
    TITOLO_APRI,
  };
})(globalThis);

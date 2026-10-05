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
    'appref-ms', 'xll', 'library-ms', 'settingcontent-ms', 'diagcab',
    // Immagini disco che Windows monta al doppio clic: il programma sta dentro,
    // e il disco montato non porta la marca di file scaricato (#588.1).
    'iso', 'img', 'vhd', 'vhdx',
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

  // Aprirle non esegue niente: monta un disco dove i programmi sono a un doppio
  // clic. La frase deve dire questo, o chi legge «è un programma» su un .iso
  // pensa a un errore e prosegue.
  const IMMAGINI_DISCO = new Set(['iso', 'img', 'vhd', 'vhdx', 'dmg']);

  function eImmagineDisco(nome) {
    return IMMAGINI_DISCO.has(estensione(nome));
  }

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
    let s = String(url || '').trim();
    // `blob:https://sito.it/uuid`: l'origine di chi l'ha fabbricato sta dentro
    // l'indirizzo, e senza toglierla il nome del sito si perderebbe proprio
    // dove è il sito a scegliere come consegnare il file (#588).
    if (/^blob:/i.test(s)) s = s.slice(5);
    try {
      const h = new URL(s).hostname.toLowerCase();
      return h.replace(/^www\./, '');
    } catch (_) { return ''; }
  }

  // Da dove arriva un file lo si decide UNA volta, all'inizio dello
  // scaricamento; da lì in poi gira come nome di sito, non come indirizzo.
  // Chi confronta o scrive una frase accetta le due forme, o la stessa regola
  // direbbe due cose diverse a seconda di chi la chiama (#588).
  function comeSito(x) {
    const s = String(x == null ? '' : x).trim();
    if (!s) return '';
    if (/[:/]/.test(s)) return sito(s);
    return /^[a-z0-9.-]+$/i.test(s) ? s.toLowerCase().replace(/^www\./, '') : '';
  }

  // Nel main e nei test lo porta require; nelle pagine lo carica prima un <script>.
  function nomiSito() {
    return global.SN_NOMI_SITO || require('./nomiSito.js');
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
      if (!s || !nomiSito().valido(s)) continue;
      if (!out.includes(s)) out.push(s);
    }
    return out;
  }

  // Un dominio in elenco vale anche per i suoi sottodomini (`sito.it` copre
  // `cdn.sito.it`), mai al contrario: `sito.it` non deve coprire `sito.it.evil.com`.
  function fidato(url, elenco) {
    const host = comeSito(url);
    if (!host) return false;
    for (const d of normalizzaSiti(elenco)) {
      if (host === d || host.endsWith('.' + d)) return true;
    }
    return false;
  }

  // Le frasi vivono qui perché le dicono tre superfici diverse (l'avviso della
  // barra, la pagina elenco, il pannello): devono dire la stessa cosa.
  const ETICHETTA = 'Programma';

  // `incerto`: il file non porta la sua origine e la pagina ha riquadri di
  // altri siti, quindi il sito della pagina non basta a dire chi l'ha fatto.
  function provenienza(url, incerto) {
    const s = comeSito(url);
    if (!s) return '';
    return incerto ? `da una pagina di ${s} con parti di altri siti` : `da ${s}`;
  }

  function daSito(url, incerto) {
    const p = provenienza(url, incerto);
    return p ? ` ${p}` : '';
  }

  function testoScarica(nome, url, incerto) {
    if (eImmagineDisco(nome)) {
      return `«${nomeVisibile(nome)}» è un'immagine disco${daSito(url, incerto)}. Aperta diventa un disco, e i programmi che contiene partono con un doppio clic. Scaricarla?`;
    }
    return `«${nomeVisibile(nome)}» è un programma${daSito(url, incerto)}. Se lo apri può cambiare il computer. Scaricarlo?`;
  }

  function testoApri(nome, url, incerto) {
    if (eImmagineDisco(nome)) {
      return `«${nomeVisibile(nome)}» è un'immagine disco scaricata${daSito(url, incerto)}. Aperta diventa un disco, e i programmi che contiene partono con un doppio clic. Fallo solo se sai da chi arriva.`;
    }
    return `«${nomeVisibile(nome)}» è un programma scaricato${daSito(url, incerto)}. Aprirlo vuol dire eseguirlo. Fallo solo se sai da chi arriva.`;
  }

  const TITOLO_APRI = 'Aprire un programma?';

  function titoloApri(nome) {
    return eImmagineDisco(nome) ? 'Aprire un\'immagine disco?' : TITOLO_APRI;
  }

  global.SN_ESEGUIBILI = {
    ESTENSIONI,
    nomeVisibile,
    estensione,
    eEseguibile,
    eImmagineDisco,
    sito,
    comeSito,
    normalizzaSiti,
    fidato,
    ETICHETTA,
    provenienza,
    testoScarica,
    testoApri,
    TITOLO_APRI,
    titoloApri,
  };
})(globalThis);

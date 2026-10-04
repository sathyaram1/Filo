// Nomi sensati per i file dell'utente (#950): quali file Filo sa leggere per dargli un nome, come si pulisce
// il nome proposto da un modello, quando un nome «non dice niente». Logica pura, niente disco: il servizio è
// src/main/services/nomiFile.js. Regole: tests/unit/nomiFile.test.mjs.

(function (global) {
  'use strict';

  // Senza estensione. Un nome che riassume un documento sta in poche parole: il tetto ferma solo una risposta
  // andata storta, e tagliando lo si dice a chi guarda (la casella mostra il nome intero, modificabile).
  const MAX_BASE = 120;

  const IMMAGINI = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
  const DOCUMENTI = new Set(['.docx', '.odt', '.pptx', '.odp', '.xlsx', '.ods']);
  // I file di configurazione (.ini, .env, .conf…) restano fuori: un programma li cerca per nome.
  const TESTO = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.log', '.json', '.xml', '.srt', '.vtt', '.tex']);

  function scomponi(nome) {
    const s = String(nome == null ? '' : nome);
    const i = s.lastIndexOf('.');
    if (i <= 0 || i === s.length - 1) return { base: s, ext: '' };
    return { base: s.slice(0, i), ext: s.slice(i) };
  }

  // 'pdf' | 'immagine' | 'documento' | 'testo' | null (Filo non sa leggerlo).
  function tipoDi(nome) {
    const s = String(nome == null ? '' : nome);
    const base = s.split(/[\\/]/).pop();
    if (!base || base.startsWith('.')) return null;
    const ext = scomponi(base).ext.toLowerCase();
    if (ext === '.pdf') return 'pdf';
    if (IMMAGINI.has(ext)) return 'immagine';
    if (DOCUMENTI.has(ext)) return 'documento';
    if (TESTO.has(ext)) return 'testo';
    return null;
  }

  // Caratteri che girano il testo o non si vedono: «fattura<RLO>fdp.exe» si leggerebbe al contrario.
  const INVISIBILI = /[​-‏‪-‮⁠-⁯﻿­]/g;
  const CONTROLLO = /[\u0000-\u001f\u007f-\u009f]/g;
  const RISERVATI_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const ESTENSIONI_NOTE = /\.(pdf|png|jpe?g|webp|gif|docx?|odt|pptx?|odp|xlsx?|ods|txt|md|markdown|csv|tsv|log|json|xml|srt|vtt|tex)$/i;
  const NESSUN_NOME = /^nessun\s+nome\b/i;

  function nomeVisibile(nome) {
    return String(nome == null ? '' : nome).replace(INVISIBILI, '').replace(CONTROLLO, ' ');
  }

  function tagliaAllaParola(s, max) {
    const segni = Array.from(s);
    if (segni.length <= max) return s;
    const corto = segni.slice(0, max).join('');
    const spazio = corto.lastIndexOf(' ');
    return (spazio > max / 2 ? corto.slice(0, spazio) : corto).trim();
  }

  // Dal testo del modello (o scritto dall'utente nella casella) al nome senza estensione; '' se non resta niente.
  // L'estensione non la decide mai chi propone: se la riscrive in coda, si toglie.
  function pulisci(proposta, { ext = '' } = {}) {
    let s = String(proposta == null ? '' : proposta).replace(/\r/g, '');
    s = s.split('\n').map((r) => r.trim()).find(Boolean) || '';
    s = s.replace(INVISIBILI, '').replace(CONTROLLO, ' ');
    s = s.replace(/^(nome( del file)?|nome proposto|file ?name|name)\s*[:=]\s*/i, '');
    s = s.replace(/[*_`#]{2,}|^[*_`#]+|[*_`#]+$/g, '').trim();
    s = s.replace(/^["'«“‘]+|["'»”’]+$/g, '').trim();
    if (NESSUN_NOME.test(s)) return '';
    const e = String(ext || '');
    if (e && s.toLowerCase().endsWith(e.toLowerCase())) s = s.slice(0, s.length - e.length);
    else s = s.replace(ESTENSIONI_NOTE, '');
    s = s.replace(/\s*:\s*/g, ' - ').replace(/[\\/]/g, '-').replace(/[<>"|?*]/g, '');
    s = s.replace(/\s+/g, ' ').replace(/\s*-\s*-+\s*/g, ' - ').trim();
    s = s.replace(/^[.\-\s]+/, '').replace(/[.\s]+$/, '');
    s = tagliaAllaParola(s, MAX_BASE).replace(/[.\s]+$/, '');
    if (!s) return '';
    if (RISERVATI_WIN.test(s)) s = `${s} (file)`;
    return s;
  }

  // Mai sovrascrivere: «Bolletta.pdf» c'è già → «Bolletta (2).pdf». `esiste(nome)` lo dice il disco.
  function nomeLibero(nome, esiste) {
    if (!esiste(nome)) return nome;
    const { base, ext } = scomponi(nome);
    for (let n = 2; n < 10000; n++) {
      const c = `${base} (${n})${ext}`;
      if (!esiste(c)) return c;
    }
    return '';
  }

  // Parole che da sole non dicono cos'è un file: le mettono le fotocamere, gli scanner, i programmi.
  const GENERICHE = new Set([
    'scan', 'scans', 'scansione', 'scansionato', 'scanned', 'img', 'image', 'images', 'immagine', 'dsc', 'dscn', 'dcim',
    'pxl', 'mvimg', 'photo', 'foto', 'pic', 'picture', 'screenshot', 'screen', 'shot', 'schermata', 'cattura',
    'document', 'documento', 'doc', 'docs', 'file', 'files', 'download', 'downloads', 'untitled', 'senza', 'titolo',
    'unnamed', 'nuovo', 'nuova', 'new', 'copy', 'copia', 'export', 'output', 'out', 'print', 'stampa', 'temp', 'tmp',
    'page', 'pagina', 'attachment', 'allegato', 'whatsapp', 'telegram', 'signal', 'wa', 'pdf', 'jpg', 'jpeg', 'png',
    'at', 'alle', 'del', 'di', 'da', 'the', 'of', 'and', 'e', 'pm', 'am', 'version', 'versione', 'final', 'finale',
    'gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic', 'jan', 'may', 'jun', 'jul',
    'aug', 'sep', 'oct', 'dec', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
    'settembre', 'ottobre', 'novembre', 'dicembre', 'january', 'february', 'march', 'april', 'june', 'july',
    'august', 'september', 'october', 'november', 'december',
  ]);

  // Vero se il nome non dice niente del contenuto: «scan_00231», «IMG_20260301_1012», «document (3)», un codice.
  // Decide quali scaricamenti rinominare da soli e quali file di una cartella proporre: un nome scelto da
  // qualcuno non si tocca senza che l'utente lo chieda.
  function nomeSenzaSenso(nome) {
    const { base } = scomponi(nomeVisibile(nome).trim());
    const b = base.trim();
    if (!b) return true;
    if (/^[0-9a-f-]{8,}$/i.test(b)) return true;
    const pezzi = b.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (const p of pezzi) {
      const lettere = p.replace(/\p{N}+/gu, '');
      const misto = lettere.length && lettere.length < p.length;
      if (misto && (p.length >= 5 || /^[0-9a-f]+$/i.test(p))) continue;
      if (Array.from(lettere).length < 2) continue;
      if (GENERICHE.has(lettere.toLowerCase())) continue;
      return false;
    }
    return true;
  }

  global.SN_NOMI_FILE = { MAX_BASE, scomponi, tipoDi, pulisci, nomeLibero, nomeSenzaSenso, nomeVisibile };
})(typeof globalThis !== 'undefined' ? globalThis : self);

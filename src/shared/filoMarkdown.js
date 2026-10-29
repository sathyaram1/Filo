// SORGENTE UNICA del rendering «testo di Filo → HTML leggero» (#418).
// Il testo del modello NON è fidato: un link si rende cliccabile solo con schema http,
// https o mailto, perché filo://, javascript: e i relativi puntano dentro l'app.

(function (global) {
  'use strict';

  const LINK_CLASS = 'filo-md-link';
  // Sentinelle Private-Use dei segnaposto: tolte dal testo in arrivo, così ogni segnaposto è uno dei nostri.
  const S0 = '\uE000';
  const S1 = '\uE001';
  const SENTINELLE = /[\uE000\uE001]/g;
  const SEGNAPOSTO = /\uE000(\d+)\uE001/g;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // Ritorna l'URL solo se è un link esterno SICURO: niente filo://, javascript:, data:, file:,
  // né relativi o protocol-relative. Altrimenti null: il testo resta visibile, non cliccabile.
  function safeLinkUrl(rawUrl) {
    const u = String(rawUrl || '').trim();
    if (!u) return null;
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(u);
    if (!m) return null; // nessuno schema -> relativo -> possibile pagina interna
    const scheme = m[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return u;
    return null;
  }

  function anchor(url, text) {
    // url e text arrivano GIA' escapati (operiamo su testo escapato a monte).
    return '<a class="' + LINK_CLASS + '" href="' + url + '" target="_blank" '
      + 'rel="noopener noreferrer nofollow">' + text + '</a>';
  }

  const conta = (s, c) => s.split(c).length - 1;

  // In coda a un URL nudo si stacca solo ciò che chiude la frase o una
  // formattazione che questo renderer disegna (gli asterischi): ogni altro
  // carattere da URL (_ ~ = / # e gli altri) resta nel link. Elenco chiuso,
  // sentinella in tests/unit/filoMarkdown.test.mjs.
  const STACCATI_IN_CODA = '.,;:!?…’*';

  // Una ) o ] in coda resta solo se chiude una ( o [ dell'URL
  // (wiki/Mercurio_(astronomia)). Lineare: una coda lunghissima non blocca.
  function separaCoda(m) {
    const aperte = { ')': conta(m, '('), ']': conta(m, '[') };
    const chiuse = { ')': conta(m, ')'), ']': conta(m, ']') };
    let fine = m.length;
    while (fine > 0 && !m.endsWith('&amp;', fine)) {
      if (m.endsWith('&#39;', fine)) { fine -= 5; continue; }
      const c = m[fine - 1];
      if (STACCATI_IN_CODA.includes(c)) { fine -= 1; continue; }
      if (!(c in chiuse) || chiuse[c] <= aperte[c]) break;
      chiuse[c] -= 1;
      fine -= 1;
    }
    return [m.slice(0, fine), m.slice(fine)];
  }

  // Grassetto poi corsivo: l'ordine evita che ** venga letto come due *.
  const enfasi = (s) => s
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');

  // Link markdown [testo](url). Il testo non contiene [ né ]: da ogni [ la ricerca
  // si ferma alla quadra seguente, così una fila di [ aperte resta lineare (#853).
  // L'url può contenere parentesi bilanciate (wiki/Mercurio_(astronomia)), mai un segnaposto.
  const LINK_MD = /\[([^[\]\n]+)\]\(((?:[^()\s\uE000\uE001]|\([^()\s\uE000\uE001]*\))+)\)/g;
  // Dove finisce un URL nudo lo decide separaCoda; qui si ferma ai caratteri che in un URL
  // non stanno mai (" < > già escapati, virgolette tipografiche) e al codice che gli sta attaccato.
  const URL_NUDO = /\bhttps?:\/\/(?:&amp;|&#39;|[^\s&«»“”\uE000\uE001])+/gi;

  // Formattazione inline su testo GIA' escapato. Codice e link si mettono da parte
  // con segnaposto, così autolink ed enfasi non ne toccano il contenuto; il testo
  // di un link ha la sua enfasi e il suo codice, rimessi dentro l'<a> (#853).
  function inlineMd(escaped) {
    const tokens = [];
    const stash = (html) => S0 + (tokens.push(html) - 1) + S1;
    const rimetti = (s) => s.replace(SEGNAPOSTO, (m, i) => tokens[Number(i)] || '');
    let t = String(escaped).replace(SENTINELLE, '');

    t = t.replace(/`([^`\n]+)`/g, (m, code) => stash('<code>' + code + '</code>'));

    t = t.replace(LINK_MD, (m, label, url) => {
      const safe = safeLinkUrl(url);
      return safe ? stash(anchor(safe, rimetti(enfasi(label)))) : label;
    });

    t = t.replace(URL_NUDO, (m) => {
      const [url, trail] = separaCoda(m);
      const safe = safeLinkUrl(url);
      return (safe ? stash(anchor(safe, url)) : url) + trail;
    });

    return rimetti(enfasi(t));
  }

  // I blocchi del testo (paragrafi, titoli, elenchi, codice ```), con le righe GIA' escapate. Li leggono sia
  // render sia testo: «Copia» copia la stessa lettura che si vede a schermo (#846).
  function blocchi(text) {
    if (!text) return [];
    const lines = escapeHtml(text).split('\n');
    const out = [];
    let lista = null;
    let para = [];
    let inCode = false;
    let codeBuf = [];
    const flushPara = () => {
      if (para.length) { out.push({ k: 'p', righe: para }); para = []; }
    };
    const flushList = () => {
      if (lista) { out.push(lista); lista = null; }
    };
    // Il tipo di voce d'elenco di una riga, o null.
    const tipoVoce = (s) => (/^[-*]\s+\S/.test(s) ? 'ul' : /^\d+\.\s+\S/.test(s) ? 'ol' : null);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trim().startsWith('```')) {
        if (inCode) {
          out.push({ k: 'code', righe: codeBuf });
          codeBuf = []; inCode = false;
        } else { flushPara(); flushList(); inCode = true; }
        continue;
      }
      if (inCode) { codeBuf.push(raw); continue; }
      const trimmed = raw.trim();
      if (trimmed === '') {
        flushPara();
        // Voci staccate da righe vuote restano un elenco solo: chiuso qui, «1.» «2.» «3.» ripartivano tutte da 1 (#703).
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (!lista || j >= lines.length || tipoVoce(lines[j].trim()) !== lista.k) flushList();
        continue;
      }
      let m;
      if ((m = trimmed.match(/^(#{1,6})\s+(.+)$/))) {
        flushPara(); flushList();
        out.push({ k: 'h', livello: Math.min(m[1].length + 2, 6), riga: m[2] });
      } else if ((m = trimmed.match(/^[-*]\s+(.+)$/))) {
        flushPara();
        if (!lista || lista.k !== 'ul') { flushList(); lista = { k: 'ul', voci: [] }; }
        lista.voci.push(m[1]);
      } else if ((m = trimmed.match(/^(\d+)\.\s+(.+)$/))) {
        flushPara();
        // Il numero scritto vale: un elenco spezzato da un paragrafo riprende da dove era, non da 1.
        if (!lista || lista.k !== 'ol') { flushList(); lista = { k: 'ol', da: Math.min(Number(m[1]), 1e6), voci: [] }; }
        lista.voci.push(m[2]);
      } else { flushList(); para.push(trimmed); }
    }
    if (inCode) out.push({ k: 'code', righe: codeBuf });
    flushPara();
    flushList();
    return out;
  }

  // Renderer a blocchi: paragrafi, titoli, elenchi puntati/numerati, blocchi di
  // codice ``` e formattazione inline. Escape dell'HTML PRIMA di trasformare.
  function render(text) {
    const out = [];
    for (const b of blocchi(text)) {
      if (b.k === 'p') out.push('<p>' + b.righe.map(inlineMd).join('<br>') + '</p>');
      else if (b.k === 'h') out.push('<h' + b.livello + '>' + inlineMd(b.riga) + '</h' + b.livello + '>');
      else if (b.k === 'code') out.push('<pre><code>' + b.righe.join('\n') + '</code></pre>');
      else {
        out.push(b.k === 'ol' && b.da !== 1 ? '<ol start="' + b.da + '">' : '<' + b.k + '>');
        for (const v of b.voci) out.push('<li>' + inlineMd(v) + '</li>');
        out.push('</' + b.k + '>');
      }
    }
    return out.join('\n');
  }

  // Il testo semplice di una risposta, per gli appunti: quello che si legge a schermo, senza asterischi, cancelletti
  // né parentesi dei link (resta la parola del link). Le voci d'elenco tengono il pallino o il numero che si vedono.
  const DISESCAPE = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
  const disescapa = (s) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => DISESCAPE[e]);
  // Il testo entra escapato, quindi gli unici < rimasti sono i tag messi da inlineMd.
  const inlineTesto = (riga) => disescapa(inlineMd(riga).replace(/<[^>]*>/g, ''));
  function testo(text) {
    return blocchi(text).map((b) => {
      if (b.k === 'p') return b.righe.map(inlineTesto).join('\n');
      if (b.k === 'h') return inlineTesto(b.riga);
      if (b.k === 'code') return disescapa(b.righe.join('\n'));
      return b.voci.map((v, i) => (b.k === 'ol' ? (b.da + i) + '. ' : '• ') + inlineTesto(v)).join('\n');
    }).join('\n\n');
  }

  // Aggancio comune per il click sui link renderizzati. Ogni superficie passa il
  // proprio "opener" (nuova scheda via IPC sulle pagine filo://, window.open sui
  // content script). Un solo listener delegato sul contenitore: sopravvive ai
  // re-render dello streaming. Ritorna una funzione per staccarlo.
  function bindLinks(rootEl, openUrl) {
    if (!rootEl || typeof openUrl !== 'function') return () => {};
    const onClick = (e) => {
      const a = e.target && e.target.closest && e.target.closest('a.' + LINK_CLASS);
      if (!a || !rootEl.contains(a)) return;
      const url = a.getAttribute('href');
      if (!url) return;
      e.preventDefault();
      e.stopPropagation();
      openUrl(url);
    };
    rootEl.addEventListener('click', onClick);
    return () => { try { rootEl.removeEventListener('click', onClick); } catch (_) {} };
  }

  // Un collegamento disegnato da qui, o dentro una frase di Filo, l'ha scritto un modello: senza verdetto della porta,
  // clic, tasto destro e anteprima lo trattano da indirizzo da confermare (#1505).
  function scrittoDaUnModello(el) {
    return !!(el && el.closest && (el.closest('a.' + LINK_CLASS) || el.closest('[data-filo-verdetti]')));
  }

  global.SN_MARKDOWN = { render, testo, inlineMd, escapeHtml, safeLinkUrl, bindLinks, scrittoDaUnModello, LINK_CLASS };
})(typeof globalThis !== 'undefined' ? globalThis : self);

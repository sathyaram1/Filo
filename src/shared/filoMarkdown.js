// SORGENTE UNICA del rendering «testo di Filo → HTML leggero» (#418).
// Il testo del modello NON è fidato: un link si rende cliccabile solo con schema http,
// https o mailto, perché filo://, javascript: e i relativi puntano dentro l'app.

(function (global) {
  'use strict';

  const LINK_CLASS = 'filo-md-link';
  // Sentinelle Private-Use: non compaiono nel testo del modello, quindi la prosa è al sicuro.
  const S0 = '';
  const S1 = '';

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

  // Codice e link si mettono da parte con segnaposto: così autolink e grassetto non ne
  // corrompono il contenuto e non ri-linkano l'href appena creato.
  function inlineMd(escaped) {
    const tokens = [];
    const stash = (html) => S0 + (tokens.push(html) - 1) + S1;
    let t = String(escaped);

    t = t.replace(/`([^`\n]+)`/g, (m, code) => stash('<code>' + code + '</code>'));

    t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const safe = safeLinkUrl(url);
      return safe ? stash(anchor(safe, label)) : label;
    });

    t = t.replace(/\bhttps?:\/\/[^\s<]+/gi, (m) => {
      let url = m;
      let trail = '';
      // La punteggiatura finale (. ) ] , ; : ! ?) non fa parte dell'URL.
      const tm = /[.,;:!?)\]]+$/.exec(url);
      if (tm) { trail = url.slice(url.length - tm[0].length); url = url.slice(0, -tm[0].length); }
      const safe = safeLinkUrl(url);
      return (safe ? stash(anchor(safe, url)) : url) + trail;
    });

    // Grassetto poi corsivo: l'ordine evita che ** venga letto come due *.
    t = t
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');

    t = t.replace(new RegExp(S0 + '(\\d+)' + S1, 'g'), (m, i) => tokens[Number(i)] || '');
    return t;
  }

  // Escape dell'HTML PRIMA di trasformare.
  function render(text) {
    if (!text) return '';
    const lines = escapeHtml(text).split('\n');
    const out = [];
    let listType = null;
    let para = [];
    let inCode = false;
    let codeBuf = [];
    const flushPara = () => {
      if (para.length) { out.push('<p>' + para.map(inlineMd).join('<br>') + '</p>'); para = []; }
    };
    const flushList = () => {
      if (listType) { out.push('</' + listType + '>'); listType = null; }
    };
    for (const raw of lines) {
      if (raw.trim().startsWith('```')) {
        if (inCode) {
          out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');
          codeBuf = []; inCode = false;
        } else { flushPara(); flushList(); inCode = true; }
        continue;
      }
      if (inCode) { codeBuf.push(raw); continue; }
      const trimmed = raw.trim();
      if (trimmed === '') { flushPara(); flushList(); continue; }
      let m;
      if ((m = trimmed.match(/^(#{1,6})\s+(.+)$/))) {
        flushPara(); flushList();
        const level = Math.min(m[1].length + 2, 6);
        out.push('<h' + level + '>' + inlineMd(m[2]) + '</h' + level + '>');
      } else if ((m = trimmed.match(/^[-*]\s+(.+)$/))) {
        flushPara();
        if (listType !== 'ul') { flushList(); out.push('<ul>'); listType = 'ul'; }
        out.push('<li>' + inlineMd(m[1]) + '</li>');
      } else if ((m = trimmed.match(/^\d+\.\s+(.+)$/))) {
        flushPara();
        if (listType !== 'ol') { flushList(); out.push('<ol>'); listType = 'ol'; }
        out.push('<li>' + inlineMd(m[1]) + '</li>');
      } else { flushList(); para.push(trimmed); }
    }
    if (inCode) out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');
    flushPara();
    flushList();
    return out.join('\n');
  }

  // Ogni superficie passa il proprio opener (IPC sulle pagine filo://, window.open altrove).
  // Un solo listener delegato: sopravvive ai re-render dello streaming. Ritorna il distacco.
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

  global.SN_MARKDOWN = { render, inlineMd, escapeHtml, safeLinkUrl, bindLinks, LINK_CLASS };
})(typeof globalThis !== 'undefined' ? globalThis : self);

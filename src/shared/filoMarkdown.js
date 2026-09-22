// SORGENTE UNICA del rendering "testo di Filo -> HTML leggero" (#418).
//
// Ovunque Filo scriva una risposta - la chat della home (filo://dashboard), il
// popup di risposta AI sulle pagine web, il riquadro "Spiega" del tasto destro,
// la sidebar - il testo del modello va mostrato con una formattazione leggera e
// COERENTE: grassetto, corsivo, codice, elenchi, titoli e LINK cliccabili. Prima
// il popup aveva una sua copia (senza link) e la home non interpretava nulla:
// due superfici, due comportamenti diversi. Da qui in poi tutte usano questo.
//
// SICUREZZA - il testo di Filo e' contenuto NON FIDATO (puo' nascere da una
// pagina web che il modello ha letto). Un link renderizzato:
//   - deve avere uno schema esplicito e sicuro (http/https). Tutto il resto
//     (mailto:, filo://, javascript:, data:, file:, about:, e i link RELATIVI o
//     protocol-relative //host, che su una pagina filo:// risolverebbero verso
//     le pagine INTERNE dell'app) viene scartato: il testo resta visibile ma non
//     cliccabile;
//   - NON ha `href`: l'indirizzo sta in `data-url` e ad aprirlo e' sempre
//     `bindLinks`, che passa dal motore. Con un `href` il browser apriva da se'
//     col tasto centrale, e quella strada non passava da nessun controllo
//     (#533, nono giro di verifica).
// La classe `filo-md-link` e' l'aggancio con cui ogni superficie intercetta il
// gesto e apre il link nel modo giusto (nuova scheda), invece di navigare via la
// pagina interna.

(function (global) {
  'use strict';

  const LINK_CLASS = 'filo-md-link';
  // Sentinelle Private-Use: non compaiono mai nel testo del modello, quindi un
  // innocente " T3 " nella prosa non viene scambiato per un segnaposto.
  const S0 = '';
  const S1 = '';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // Dato un URL (gia' HTML-escapato: & e' &amp;, ecc.), ritorna l'URL se e' un
  // link esterno SICURO da rendere cliccabile, altrimenti null. Solo schema
  // esplicito http/https: niente filo://, javascript:, data:, file:, niente
  // link relativi o protocol-relative (che punterebbero alle pagine interne
  // dell'app). Fuori anche mailto: il motore non lo sa valutare, e consegnarlo
  // al programma di posta gia' compilato da chi ha scritto la pagina che Filo
  // aveva letto e' una via d'uscita (#533, nono giro di verifica).
  function safeLinkUrl(rawUrl) {
    const u = String(rawUrl || '').trim();
    if (!u) return null;
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(u);
    if (!m) return null; // nessuno schema -> relativo -> possibile pagina interna
    const scheme = m[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https') return u;
    return null;
  }

  function anchor(url, text) {
    // url e text arrivano GIA' escapati (operiamo su testo escapato a monte).
    // La scritta la sceglie il modello, l'indirizzo pure, e i due non sono
    // legati da niente: dove porta si deve poter leggere PRIMA di premere, come
    // per i bottoni della schermata iniziale (#533, settimo giro di verifica).
    // Niente `href`: l'apertura la fa SEMPRE bindLinks, che passa dal motore.
    return '<a class="' + LINK_CLASS + '" data-url="' + url + '" role="link" tabindex="0" '
      + 'title="' + url + '">' + text + '</a>';
  }

  // Formattazione inline su testo GIA' escapato: codice, link markdown, autolink
  // di URL nudi, grassetto, corsivo. Codice e link vengono "messi da parte" con
  // segnaposto cosi' le trasformazioni successive (autolink, grassetto/corsivo)
  // non ne corrompono il contenuto e non ri-linkano l'href appena creato.
  function inlineMd(escaped) {
    const tokens = [];
    const stash = (html) => S0 + (tokens.push(html) - 1) + S1;
    let t = String(escaped);

    // Codice inline `...`
    t = t.replace(/`([^`\n]+)`/g, (m, code) => stash('<code>' + code + '</code>'));

    // Link markdown [testo](url)
    t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const safe = safeLinkUrl(url);
      return safe ? stash(anchor(safe, label)) : label;
    });

    // Autolink di URL nudi http(s)://... (mostrano l'URL stesso come testo).
    t = t.replace(/\bhttps?:\/\/[^\s<]+/gi, (m) => {
      let url = m;
      let trail = '';
      // La punteggiatura finale (. ) ] , ; : ! ?) non fa parte dell'URL.
      const tm = /[.,;:!?)\]]+$/.exec(url);
      if (tm) { trail = url.slice(url.length - tm[0].length); url = url.slice(0, -tm[0].length); }
      const safe = safeLinkUrl(url);
      return (safe ? stash(anchor(safe, url)) : url) + trail;
    });

    // Grassetto poi corsivo (l'ordine evita che ** venga letto come due *).
    t = t
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');

    // Ripristina i segnaposto (codice e link).
    t = t.replace(new RegExp(S0 + '(\\d+)' + S1, 'g'), (m, i) => tokens[Number(i)] || '');
    return t;
  }

  // Renderer a blocchi: paragrafi, titoli, elenchi puntati/numerati, blocchi di
  // codice ``` e formattazione inline. Escape dell'HTML PRIMA di trasformare.
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

  global.SN_MARKDOWN = { render, inlineMd, escapeHtml, safeLinkUrl, bindLinks, LINK_CLASS };
})(typeof globalThis !== 'undefined' ? globalThis : self);

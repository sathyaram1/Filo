// SORGENTE UNICA del rendering «testo di Filo → HTML leggero» (#418).
// Il testo del modello NON è fidato: un link si rende cliccabile solo con schema http,
// https o mailto, perché filo://, javascript: e i relativi puntano dentro l'app.

(function (global) {
  'use strict';

  const LINK_CLASS = 'filo-md-link';
  // Il corsivo di Filo vuol dire «qui c'è una spiegazione al passaggio» (#2388): la classe la leggono
  // src/shared/spiegazioni.js e src/styles/spiegazioni.css.
  const SPIEGA_CLASS = 'filo-spiega';
  // Segnaposto delle immagini (E004/E005: E002/E003 sono i posti delle fonti), stesse regole di quelli qui sotto.
  const S2 = String.fromCharCode(0xE004);
  const S3 = String.fromCharCode(0xE005);
  const TUTTE_LE_SENTINELLE = new RegExp('[' + String.fromCharCode(0xE000) + '-' + S3 + ']', 'g');
  // In prepara restano i posti delle fonti, messi da fontiCitate.conPosti prima del render.
  const FUORI_DAI_POSTI_FONTE = new RegExp('[\\uE000\\uE001' + S2 + S3 + ']', 'g');
  const SEGNAPOSTO_IMG = new RegExp(S2 + '(\\d+)' + S3, 'g');
  // Sentinelle Private-Use dei segnaposto: tolte dal testo in arrivo, così ogni segnaposto è uno dei nostri.
  const S0 = '\uE000';
  const S1 = '\uE001';
  const SENTINELLE = /[\uE000\uE001]/g;
  const SEGNAPOSTO = /\uE000(\d+)\uE001/g;
  const POSTO_FONTE = /\uE002(\d+)\uE003|[\uE002\uE003]/g;
  // I posti delle gallerie (E006/E007, src/shared/immaginiRisposta.js): un posto vale solo da riga a s\u00E9.
  const POSTI_GALLERIA = /[\uE006\uE007]/g;

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

  // Grassetto poi enfasi: l'ordine evita che ** venga letto come due *. L'enfasi esce dritta: in Filo il corsivo
  // è solo delle spiegazioni (#2388).
  const enfasi = (s) => s
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1$2');

  // Un disegno del modello entra solo come <img> con data: (#2388): da immagine un SVG non esegue script e non
  // carica indirizzi esterni. Senza xmlns il browser non lo disegnerebbe.
  function immagineSvg(svg) {
    const conNs = /^<svg\b[^>]*\bxmlns\s*=/i.test(svg) ? svg : svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return '<img class="filo-md-img" alt="" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(conNs) + '">';
  }

  // Il codice (``` e `…`) resta com'è: un SVG o un marcatore mostrati come codice non si interpretano. Un SVG
  // ancora aperto nell'ultimo paragrafo è quello che sta arrivando: non si mostra il suo sorgente.
  const SVG_O_CODICE = /(```[\s\S]*?(?:```|$)|`[^`\n]+`)|<svg\b[\s\S]*?<\/svg\s*>|<svg[\s>](?:(?!\n\s*\n)[\s\S])*$/gi;

  // Le parentesi graffe di una riga appaiate in un passaggio solo (lineare anche con mille «{{» aperte), saltando
  // il codice fra backtick. chiude[i] = indice della } che chiude la { in i; barra[i] = la prima | che ha la { in i
  // come graffa più interna; aperte = le { rimaste senza coppia.
  function graffe(s) {
    const chiude = {};
    const barra = {};
    const pila = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '`') { const j = s.indexOf('`', i + 1); if (j > i + 1) { i = j; continue; } }
      if (c === '{') pila.push(i);
      else if (c === '}' && pila.length) chiude[pila.pop()] = i;
      else if (c === '|' && pila.length && barra[pila[pila.length - 1]] == null) barra[pila[pila.length - 1]] = i;
    }
    return { chiude, barra, aperte: pila };
  }

  // Un marcatore {{termine|spiegazione}} in i: la fine (indice dopo «}}») e la barra che separa, o null.
  function marcatoreIn(s, i, g) {
    if (s[i] !== '{' || s[i + 1] !== '{') return null;
    const fine = g.chiude[i];
    if (fine == null || g.chiude[i + 1] !== fine - 1 || g.barra[i + 1] == null) return null;
    const corpo = s.slice(i + 2, fine - 1);
    const barra = g.barra[i + 1] - (i + 2);
    if (barra <= 0) return null;
    let termine = corpo.slice(0, barra).trim();
    const spiegazione = corpo.slice(barra + 1).trim();
    let tipo = 'testo';
    const p = /^pagina:\s*/i.exec(termine);
    if (p) { tipo = 'pagina'; termine = termine.slice(p[0].length).trim(); }
    if (!termine || !spiegazione) return null;
    return { fine: fine + 1, termine, spiegazione, tipo };
  }

  // Ogni marcatore della riga diventa un segnaposto; la spiegazione si disegna come una riga di Filo (con i suoi
  // marcatori: una spiegazione dentro una spiegazione) e va fra le definizioni del testo.
  // Oltre PROFONDITA_MAX livelli il marcatore resta scritto com'è: il testo si legge, e la pila non scoppia.
  const PROFONDITA_MAX = 8;
  function marcatori(s, ctx, stash) {
    if (s.indexOf('{{') < 0 || ctx.prof >= PROFONDITA_MAX) return s;
    const g = graffe(s);
    let out = '';
    for (let i = 0; i < s.length;) {
      if (s[i] === '`') {
        const j = s.indexOf('`', i + 1);
        if (j > i + 1) { out += s.slice(i, j + 1); i = j + 1; continue; }
      }
      const m = marcatoreIn(s, i, g);
      if (!m) { out += s[i]; i++; continue; }
      const n = ctx.defs.length;
      ctx.defs.push(null);
      const termineHtml = enfasi(m.termine);
      ctx.prof++;
      ctx.defs[n] = { tipo: m.tipo, termine: termineHtml.replace(/<[^>]*>/g, ''), html: inlineMd(m.spiegazione, ctx) };
      ctx.prof--;
      out += stash('<span class="' + SPIEGA_CLASS + '" data-spiega="' + n + '" tabindex="0">' + termineHtml + '</span>');
      i = m.fine;
    }
    return out;
  }

  // Le immagini vanno via prima delle righe (un SVG va a capo), e in coda a un testo che arriva un marcatore
  // ancora aperto mostra il solo termine invece delle graffe.
  function prepara(text, ctx) {
    let t = String(text == null ? '' : text).replace(FUORI_DAI_POSTI_FONTE, '');
    t = t.replace(SVG_O_CODICE, (m, codice) => {
      if (codice) return m;
      if (!/<\/svg\s*>$/i.test(m)) return '';
      return S2 + (ctx.immagini.push(immagineSvg(m)) - 1) + S3;
    });
    const ultimoCapo = t.lastIndexOf('\n');
    const coda = t.slice(ultimoCapo + 1);
    const { aperte } = graffe(coda);
    const insieme = new Set(aperte);
    const prima = aperte.find((i) => coda[i + 1] === '{' && insieme.has(i + 1));
    if (prima != null) {
      const resto = coda.slice(prima + 2);
      const barra = resto.indexOf('|');
      if (barra > 0) t = t.slice(0, ultimoCapo + 1) + coda.slice(0, prima) + resto.slice(0, barra).replace(/^pagina:\s*/i, '');
    }
    return t;
  }

  const nuovoCtx = (fonti = null) => ({ defs: [], immagini: [], prof: 0, fonti });

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
  // `ctx` porta spiegazioni, immagini e fonti del testo intero: senza, la riga fa da testo a sé.
  // `ctx.fonti`: le etichette delle fonti controllate dal main (src/shared/fontiCitate.js), una per posto; il testo
  // da solo non ne disegna nessuna, qualunque cosa contenga.
  function inlineMd(escaped, ctx) {
    const tokens = [];
    const stash = (html) => S0 + (tokens.push(html) - 1) + S1;
    const rimetti = (s) => s.replace(SEGNAPOSTO, (m, i) => tokens[Number(i)] || '');
    let t = String(escaped).replace(ctx ? SENTINELLE : TUTTE_LE_SENTINELLE, '');
    const c = ctx || nuovoCtx();

    t = marcatori(t, c, stash);
    const F = global.SN_FONTI_CITATE;
    const fonti = c.fonti;
    t = t.replace(POSTO_FONTE, (m, i) => (F && fonti && fonti[Number(i)] ? stash(F.html(fonti[Number(i)])) : ''));
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

    return rimetti(enfasi(t)).replace(SEGNAPOSTO_IMG, (m, i) => c.immagini[Number(i)] || '');
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
  // Le spiegazioni viaggiano con l'HTML in un <template> (inerte: niente si carica finché non si apre), così ogni
  // superficie che riceve il render le ha già; le apre src/shared/spiegazioni.js.
  function render(text, { fonti = null } = {}) {
    const F = global.SN_FONTI_CITATE;
    const conFonti = F && Array.isArray(fonti) && fonti.length ? F.conPosti(text, fonti) : null;
    const ctx = nuovoCtx(conFonti ? conFonti.fonti : null);
    const riga = (r) => inlineMd(r, ctx);
    const out = [];
    for (const b of blocchi(prepara(conFonti ? conFonti.text : text, ctx))) {
      if (b.k === 'p') out.push('<p>' + b.righe.map(riga).join('<br>') + '</p>');
      else if (b.k === 'h') out.push('<h' + b.livello + '>' + riga(b.riga) + '</h' + b.livello + '>');
      else if (b.k === 'code') out.push('<pre><code>' + b.righe.join('\n').replace(POSTO_FONTE, '') + '</code></pre>');
      else {
        out.push(b.k === 'ol' && b.da !== 1 ? '<ol start="' + b.da + '">' : '<' + b.k + '>');
        for (const v of b.voci) out.push('<li>' + riga(v) + '</li>');
        out.push('</' + b.k + '>');
      }
    }
    if (ctx.defs.length) {
      out.push('<template class="filo-spieghe">' + ctx.defs.map((d, i) => '<div data-spiega-def="' + i
        + '" data-tipo="' + d.tipo + '" data-termine="' + d.termine.replace(/"/g, '&quot;') + '">' + d.html + '</div>').join('')
        + '</template>');
    }
    return out.join('\n');
  }

  // Il testo semplice di una risposta, per gli appunti: quello che si legge a schermo, senza asterischi, cancelletti
  // né parentesi dei link (resta la parola del link). Le voci d'elenco tengono il pallino o il numero che si vedono.
  const DISESCAPE = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
  const disescapa = (s) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => DISESCAPE[e]);
  // Il testo entra escapato, quindi gli unici < rimasti sono i tag messi da inlineMd.
  function testo(text) {
    const ctx = nuovoCtx();
    const inlineTesto = (riga) => disescapa(inlineMd(riga, ctx).replace(/<[^>]*>/g, ''));
    return blocchi(prepara(text, ctx)).map((b) => {
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

  global.SN_MARKDOWN = { render, testo, inlineMd, escapeHtml, disescapa, safeLinkUrl, bindLinks, scrittoDaUnModello, LINK_CLASS, SPIEGA_CLASS };
})(typeof globalThis !== 'undefined' ? globalThis : self);

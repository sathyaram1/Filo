// Genera le tre rese dei documenti di trasparenza da UNA sola sorgente.
//
// PERCHÉ ESISTE
//   I documenti di trasparenza (politica sui modelli, privacy, sicurezza,
//   modello di business) devono comparire in tre posti: la pagina dentro Filo
//   (che deve funzionare anche offline), la pagina pubblica sul sito, e il testo
//   che Filo stesso legge quando l'utente gli chiede "che modelli usi e perché".
//   Tre copie mantenute a mano divergono nel giro di due revisioni, e un
//   documento di trasparenza che dice cose diverse in due posti è peggio che non
//   averlo. Quindi: si scrive UN markdown in `transparency/`, e da lì si genera
//   tutto il resto.
//
//   Le fonti diventano NUMERI in apice con l'elenco in fondo (non link inline):
//   l'elenco è esso stesso un argomento — un documento che finisce con trenta
//   riferimenti si vede che è documentato prima ancora di leggerlo — e la prosa
//   resta leggibile. URL identici condividono lo stesso numero.
//
//   I termini del glossario condiviso vengono resi in CORSIVO con una spiegazione
//   di una riga che compare al passaggio del mouse o al tocco. Il corsivo NON si
//   usa per altro nei documenti: è l'unica affordance della glossa.
//
// USO:
//   node scripts/build-transparency.mjs            # genera
//   node scripts/build-transparency.mjs --check    # verifica che sia allineato
//                                                  # (exit 1 se va rigenerato)

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_DIR = join(ROOT, 'transparency');
const OUT_MODULE = join(ROOT, 'src', 'shared', 'transparency.js');
const OUT_SITE = join(ROOT, 'site', 'transparency');
const CSS_FILE = join(ROOT, 'src', 'styles', 'transparency.css');

// ── Markdown minimale ────────────────────────────────────────────────────────
// Volutamente NON un parser generale: l'input è markdown che scriviamo noi, con
// un sottoinsieme fisso (titoli h2, paragrafi, liste, grassetto, link, riga
// orizzontale). Un parser generale qui aggiungerebbe superficie di bug senza
// servire nessun caso reale.

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Front matter `--- chiave: valore ---` in testa al file.
function parseFrontMatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

// Inline: link → nota numerata, poi grassetto. L'ordine conta: si escapa PRIMA
// (così il testo del documento non può iniettare HTML), poi si applicano i
// pattern, che sopravvivono all'escape perché usano solo [ ] ( ) e *.
function renderInline(text, sources) {
  let out = escapeHtml(text);

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_all, label, url) => {
    const clean = url.replace(/&amp;/g, '&');
    let idx = sources.findIndex((s) => s.url === clean);
    if (idx === -1) {
      sources.push({ url: clean, label: label.replace(/\*\*/g, ''), domain: domainOf(clean) });
      idx = sources.length - 1;
    }
    const n = idx + 1;
    return `${label}<sup class="sn-ref"><a href="#fonte-${n}" aria-label="fonte ${n}">${n}</a></sup>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return out;
}

function renderBody(body, sources) {
  const lines = body.split(/\r?\n/);
  const html = [];
  const sections = [];
  let list = null;      // 'ul' | 'ol' | null
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    html.push(`<p>${renderInline(para.join(' '), sources)}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) { flushPara(); flushList(); continue; }

    if (line === '---') { flushPara(); flushList(); html.push('<hr />'); continue; }

    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      flushPara(); flushList();
      const title = h2[1].trim();
      const id = slugify(title);
      sections.push({ id, title });
      html.push(`<h2 id="${id}">${renderInline(title, sources)}</h2>`);
      continue;
    }

    const ol = /^(\d+)\.\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (list !== 'ol') { flushList(); html.push('<ol>'); list = 'ol'; }
      html.push(`<li>${renderInline(ol[2], sources)}</li>`);
      continue;
    }

    const ul = /^-\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (list !== 'ul') { flushList(); html.push('<ul>'); list = 'ul'; }
      html.push(`<li>${renderInline(ul[1], sources)}</li>`);
      continue;
    }

    flushList();
    para.push(line);
  }
  flushPara(); flushList();

  return { html: html.join('\n'), sections };
}

// Testo piano per l'agente: niente marcatori, i numeri delle fonti restano come
// [1] così se Filo cita un passaggio può dire anche da dove viene.
function renderPlain(body, sources) {
  const seen = [];
  let out = body
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_a, label, url) => {
      let idx = seen.indexOf(url);
      if (idx === -1) { seen.push(url); idx = seen.length - 1; }
      return `${label} [${idx + 1}]`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^##\s+/gm, '\n')
    .replace(/^---$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (sources.length) {
    out += '\n\nFonti:\n' + sources.map((s, i) => `[${i + 1}] ${s.label} — ${s.url}`).join('\n');
  }
  return out;
}

function renderSources(sources) {
  if (!sources.length) return '';
  const items = sources.map((s, i) => {
    const n = i + 1;
    return `<li id="fonte-${n}"><span class="sn-fonte-n">${n}</span> `
      + `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.label)}</a>`
      + (s.domain ? ` <span class="sn-fonte-dom">${escapeHtml(s.domain)}</span>` : '')
      + `</li>`;
  }).join('\n');
  return `<section class="sn-fonti"><h2 id="fonti">Fonti</h2><ol class="sn-fonti-list">\n${items}\n</ol></section>`;
}

// ── Runtime del glossario + tooltip ──────────────────────────────────────────
// Sorgente UNICA del comportamento interattivo, emessa in due posti: come file
// `src/shared/transparencyUi.js` per la pagina dentro Filo (dove la CSP vieta
// gli script inline) e inlineata nella pagina pubblica. Scritta una volta, così
// le due superfici non possono comportarsi in modo diverso.
//
// Il glossario si applica sul DOM (non sull'HTML come stringa): lavorare sui
// nodi di testo è l'unico modo sicuro di non corrompere tag e attributi. Una
// sola occorrenza per termine — la prima — perché una pagina in cui ogni
// ripetizione è in corsivo diventa illeggibile. Mai dentro titoli, link o note.
const UI_RUNTIME = `
  function applyGlossary(root, glossary) {
    if (!root || !glossary) return;
    var terms = Object.keys(glossary).filter(function (t) { return t.charAt(0) !== '_'; });
    terms.sort(function (a, b) { return b.length - a.length; });
    var done = Object.create(null);
    var walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        while (p && p !== root) {
          var tag = p.tagName;
          if (tag === 'A' || tag === 'SUP' || tag === 'H1' || tag === 'H2' || tag === 'I') {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentElement;
        }
        return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var pending = [];
    var node;
    while ((node = walker.nextNode())) pending.push(node);

    for (var i = 0; i < pending.length; i++) {
      var textNode = pending[i];
      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        if (done[term]) continue;
        var value = textNode.nodeValue;
        var at = value.toLowerCase().indexOf(term.toLowerCase());
        if (at === -1) continue;
        var before = value.slice(0, at);
        var match = value.slice(at, at + term.length);
        var after = value.slice(at + term.length);
        var el = textNode.ownerDocument.createElement('i');
        el.className = 'sn-gloss';
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('data-gloss', glossary[term]);
        el.textContent = match;
        var frag = textNode.ownerDocument.createDocumentFragment();
        if (before) frag.appendChild(textNode.ownerDocument.createTextNode(before));
        frag.appendChild(el);
        var tail = null;
        if (after) { tail = textNode.ownerDocument.createTextNode(after); frag.appendChild(tail); }
        textNode.parentNode.replaceChild(frag, textNode);
        done[term] = true;
        if (tail) { textNode = tail; } else { break; }
      }
    }
  }

  // Tooltip: hover col mouse, tocco e tastiera ovunque. Il riquadro è UNO solo,
  // riposizionato — così il testo delle glosse non resta nel documento come
  // testo fantasma che il Ctrl+F della pagina troverebbe senza mostrarlo.
  function mountGlossaryUi(root, pop) {
    if (!root || !pop) return;
    function show(el) {
      pop.textContent = el.getAttribute('data-gloss') || '';
      pop.hidden = false;
      var r = el.getBoundingClientRect();
      pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
      pop.style.left = '0px';
      var left = r.left + window.scrollX;
      var max = document.documentElement.clientWidth - 12;
      if (left + pop.offsetWidth > max) left = Math.max(12, max - pop.offsetWidth);
      pop.style.left = left + 'px';
    }
    function hide() { pop.hidden = true; }
    function target(e) {
      return e.target && e.target.closest ? e.target.closest('.sn-gloss') : null;
    }
    document.addEventListener('mouseover', function (e) { var el = target(e); if (el) show(el); });
    document.addEventListener('mouseout', function (e) { if (target(e)) hide(); });
    document.addEventListener('click', function (e) {
      var el = target(e);
      if (el) { show(el); e.stopPropagation(); } else { hide(); }
    });
    document.addEventListener('focusin', function (e) { var el = target(e); if (el) show(el); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, { passive: true });
  }
`;

// ── Build ────────────────────────────────────────────────────────────────────

function buildDocs() {
  const glossaryRaw = JSON.parse(readFileSync(join(SRC_DIR, 'glossary.json'), 'utf8'));
  const glossary = {};
  for (const [k, v] of Object.entries(glossaryRaw)) if (k.charAt(0) !== '_') glossary[k] = v;

  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.md')).sort();
  const docs = files.map((file) => {
    const raw = readFileSync(join(SRC_DIR, file), 'utf8');
    const { meta, body } = parseFrontMatter(raw);
    const sources = [];
    const { html, sections } = renderBody(body, sources);
    const plain = renderPlain(body, sources);
    return {
      id: meta.id || file.replace(/\.md$/, ''),
      title: meta.title || file,
      subtitle: meta.subtitle || '',
      updated: meta.updated || '',
      order: Number(meta.order || 99),
      sections,
      sources,
      html: html + '\n' + renderSources(sources),
      text: plain,
    };
  }).sort((a, b) => a.order - b.order);

  return { docs, glossary };
}

// Le quattro voci della navigazione. Quelle senza documento compaiono comunque,
// spente: dire "in arrivo" è più onesto che far finta che la sezione non esista.
const NAV = [
  { id: 'models', label: 'Modelli' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'security', label: 'Sicurezza' },
  { id: 'business', label: 'Come si sostiene' },
];

function emitModule({ docs, glossary }) {
  const payload = docs.map((d) => ({
    id: d.id, title: d.title, subtitle: d.subtitle, updated: d.updated,
    sections: d.sections, sources: d.sources, html: d.html, text: d.text,
  }));
  return `// GENERATO da scripts/build-transparency.mjs — NON modificare a mano.
// La sorgente sono i markdown in transparency/. Per rigenerare:
//   node scripts/build-transparency.mjs
//
// Contiene i documenti di trasparenza in due forme: \`html\` per la pagina
// (dentro Filo e sul sito) e \`text\` per l'agente, che lo legge on-demand
// quando l'utente chiede conto di una scelta (azione LEGGI_TRASPARENZA).

(function (global) {
  'use strict';

  const NAV = ${JSON.stringify(NAV, null, 2).replace(/\n/g, '\n  ')};
  const GLOSSARY = ${JSON.stringify(glossary, null, 2).replace(/\n/g, '\n  ')};
  const DOCS = ${JSON.stringify(payload, null, 2).replace(/\n/g, '\n  ')};

  function all() { return DOCS.slice(); }
  function get(id) { return DOCS.find((d) => d.id === String(id || '').toLowerCase()) || null; }
  function ids() { return DOCS.map((d) => d.id); }

  // Testo per l'agente. Senza id torna l'indice dei documenti disponibili, così
  // può scegliere quale leggere invece di indovinare.
  function asText(id) {
    const doc = get(id);
    if (!doc) {
      return 'Documenti di trasparenza disponibili: '
        + DOCS.map((d) => d.id + ' (' + d.title + ')').join(', ') + '.';
    }
    return doc.title + (doc.updated ? ' — aggiornato ' + doc.updated : '') + '\\n\\n' + doc.text;
  }

  global.SN_TRANSPARENCY = {
    NAV, GLOSSARY, all, get, ids, asText,
    applyGlossary: function (root) { return applyGlossary(root, GLOSSARY); },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
`;
}

function emitSitePage(doc, { docs, glossary }, css) {
  const navHtml = NAV.map((n) => {
    const has = docs.some((d) => d.id === n.id);
    if (!has) return `<span class="sn-nav-item is-soon" title="in arrivo">${n.label}</span>`;
    const active = n.id === doc.id ? ' is-active' : '';
    return `<a class="sn-nav-item${active}" href="./${n.id}.html">${n.label}</a>`;
  }).join('\n      ');

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Filo — ${escapeHtml(doc.title)}</title>
<meta name="description" content="${escapeHtml(doc.subtitle)}" />
<style>
${css}
</style>
</head>
<body>
<main class="sn-doc">
  <header class="sn-doc-head">
    <a class="sn-doc-brand" href="../">Filo</a>
    <nav class="sn-nav">
      ${navHtml}
    </nav>
  </header>
  <h1>${escapeHtml(doc.title)}</h1>
  <p class="sn-doc-sub">${escapeHtml(doc.subtitle)}</p>
  <p class="sn-doc-meta">Ultima revisione: ${escapeHtml(doc.updated)}</p>
  <article id="doc-body">
${doc.html}
  </article>
</main>
<div class="sn-gloss-pop" id="gloss-pop" hidden></div>
<script>
(function () {
  'use strict';
  var GLOSSARY = ${JSON.stringify(glossary)};
${GLOSSARY_RUNTIME}
  applyGlossary(document.getElementById('doc-body'), GLOSSARY);
${TOOLTIP_RUNTIME}
})();
</script>
</body>
</html>
`;
}

// Tooltip della glossa: hover sul desktop, tocco/tastiera ovunque. Il riquadro è
// uno solo, riposizionato — così non ci sono N elementi nascosti nel documento e
// il testo della glossa non finisce nel Ctrl+F della pagina come testo fantasma.
const TOOLTIP_RUNTIME = `
  var pop = document.getElementById('gloss-pop');
  function showGloss(el) {
    if (!pop || !el) return;
    pop.textContent = el.getAttribute('data-gloss') || '';
    pop.hidden = false;
    var r = el.getBoundingClientRect();
    var top = r.bottom + window.scrollY + 6;
    var left = r.left + window.scrollX;
    pop.style.top = top + 'px';
    pop.style.left = '0px';
    var w = pop.offsetWidth;
    var max = document.documentElement.clientWidth - 12;
    if (left + w > max) left = Math.max(12, max - w);
    pop.style.left = left + 'px';
  }
  function hideGloss() { if (pop) pop.hidden = true; }
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest && e.target.closest('.sn-gloss');
    if (el) showGloss(el);
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest && e.target.closest('.sn-gloss')) hideGloss();
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('.sn-gloss');
    if (el) { showGloss(el); e.stopPropagation(); } else { hideGloss(); }
  });
  document.addEventListener('focusin', function (e) {
    var el = e.target.closest && e.target.closest('.sn-gloss');
    if (el) showGloss(el);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideGloss(); });
  window.addEventListener('scroll', hideGloss, { passive: true });
`;

function main() {
  const check = process.argv.includes('--check');
  const built = buildDocs();
  const css = existsSync(CSS_FILE) ? readFileSync(CSS_FILE, 'utf8') : '';

  const outputs = [[OUT_MODULE, emitModule(built)]];
  for (const doc of built.docs) {
    outputs.push([join(OUT_SITE, `${doc.id}.html`), emitSitePage(doc, built, css)]);
  }

  let stale = 0;
  for (const [path, content] of outputs) {
    const prev = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (prev === content) continue;
    stale++;
    if (check) {
      console.error(`  ✗ non allineato: ${path.replace(ROOT, '.')}`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    console.log(`  ✓ ${path.replace(ROOT, '.')}`);
  }

  if (check) {
    if (stale) {
      console.error(`\n${stale} file da rigenerare: node scripts/build-transparency.mjs`);
      process.exit(1);
    }
    console.log('Trasparenza allineata.');
    return;
  }

  const totalSources = built.docs.reduce((n, d) => n + d.sources.length, 0);
  console.log(`\n${built.docs.length} documento/i, ${totalSources} fonti, ${Object.keys(built.glossary).length} voci di glossario.`);
}

main();

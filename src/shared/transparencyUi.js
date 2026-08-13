// GENERATO da scripts/build-transparency.mjs — NON modificare a mano.
// Lo stesso codice è inlineato nelle pagine pubbliche del sito: si scrive una
// volta sola in scripts/build-transparency.mjs, così la pagina dentro Filo e
// quella sul sito non possono comportarsi in modo diverso.

(function (global) {
  'use strict';

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

  global.SN_TRANSPARENCY_UI = { applyGlossary, mountGlossaryUi };
})(typeof globalThis !== 'undefined' ? globalThis : self);

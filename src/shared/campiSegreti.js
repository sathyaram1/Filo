// Quali campi di un modulo tengono un valore che non esce mai verso un modello (#810.7): password, codici, carta.
// `crea` deve restare autosufficiente: il main la manda così com'è dentro ogni riquadro incorporato della pagina.
// Prove: tests/aiuto-campi-segreti.spec.mjs, tests/unit/campiSegreti.test.mjs.

(function (global) {
  'use strict';

  // `cartaValida(testo)`: il riconoscimento del numero di carta, quello di SN_GUARDIANO_STATICO. `ricorda`: solo chi
  // resta nella pagina (il content script), non la misura usa e getta del main.
  function crea(win, cartaValida, { ricorda = false } = {}) {
    const doc = win.document;
    // Da qui prende i nomi anche la ricerca del main nei componenti chiusi: un campo nuovo va aggiunto solo qui.
    const NOMI_DEI_CAMPI = ['input', 'textarea', 'select'];
    const CAMPO_CON_VALORE = new RegExp(`^(${NOMI_DEI_CAMPI.join('|')})$`, 'i');
    const INPUT_BOTTONE = /^(button|submit|reset|image|checkbox|radio|hidden|file|range|color)$/i;
    const AUTOCOMPLETE_SEGRETO = /(^|\s)(current-password|new-password|one-time-code|cc-[a-z-]+)(\s|$)/i;
    const PAROLE_SEGRETE = new RegExp(['pass ?word', 'passwd', 'pwd', 'passcode', 'pass_code', 'passwort', 'kennwort',
      'contrase[ñn]a', 'mot de passe', '\\bsenha\\b', 'parola d.ordine', '(^|[^a-z])(pin|otp|cvv2?|cvc2?|csc)([^a-z]|$)',
      '(^|[^a-z])cc[-_ ]?(num|number|no|csc|cvv|cvc)', 'codice (di )?(sicurezza|verifica)', 'security code',
      'verification code', 'carta di (credito|debito)', 'numero (della |di )?carta', 'credit ?card', 'debit ?card',
      'card ?number', 'card_number', 'cardnumber', 'n[uú]mero de (la )?tarjeta', 'tarjeta de (cr[eé]dito|d[eé]bito)',
      'num[eé]ro de (la )?carte', 'carte (bancaire|de cr[eé]dit)', 'kartennummer', 'kreditkarte'].join('|'), 'i');

    // Il testo di un'etichetta senza i campi che contiene: un <select> dentro la <label> porterebbe tutte le voci.
    function testoSenzaCampi(nodo) {
      let out = '';
      const giu = (n) => {
        for (const c of n.childNodes || []) {
          if (c.nodeType === 3) out += c.nodeValue;
          else if (c.nodeType === 1 && !/^(SELECT|TEXTAREA|SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName)) giu(c);
        }
      };
      giu(nodo);
      return out;
    }

    // L'etichetta che il sito lega al campo (aria-labelledby, <label for>, <label> che lo avvolge).
    function etichettaCollegata(el) {
      const parti = [];
      // Dentro un componente gli id si cercano nel suo albero, non nel documento.
      const radice = el.getRootNode?.();
      const d = radice && typeof radice.getElementById === 'function' ? radice : (el.ownerDocument || doc);
      for (const id of String(el.getAttribute?.('aria-labelledby') || '').split(/\s+/)) {
        const t = id && d.getElementById(id);
        if (t && t !== el) parti.push(testoSenzaCampi(t));
      }
      if (!parti.length) { try { for (const l of el.labels || []) parti.push(testoSenzaCampi(l)); } catch (_) {} }
      return parti.join(' ').replace(/\s+/g, ' ').trim();
    }

    // L'ultimo testo visibile di `n`, a ritroso; null se prima di trovarlo c'è un altro campo.
    function ultimoTesto(n, prof = 0) {
      if (n.nodeType === 3) return String(n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|BUTTON)$/.test(n.tagName)) return '';
      if (CAMPO_CON_VALORE.test(n.tagName)) return String(n.getAttribute?.('type') || '').toLowerCase() === 'hidden' ? '' : null;
      if (prof > 6) return '';
      try { if (typeof n.getClientRects === 'function' && !n.getClientRects().length) return ''; } catch (_) {}
      const figli = n.childNodes || [];
      for (let i = figli.length - 1; i >= 0; i--) {
        const t = ultimoTesto(figli[i], prof + 1);
        if (t === null || t) return t;
      }
      return '';
    }

    // Il testo scritto subito prima del campo quando il sito non gliel'ha legato: per chi guarda è il suo nome.
    // Si ferma al primo altro campo, per non prendere il nome di quello, e al confine del modulo.
    function etichettaVicina(el) {
      let cur = el;
      for (let livello = 0; cur && livello < 3; livello++) {
        for (let s = cur.previousSibling; s; s = s.previousSibling) {
          const t = ultimoTesto(s);
          if (t === null) return '';
          if (t) return t.slice(-80);
        }
        cur = cur.parentElement;
        if (!cur || /^(FORM|FIELDSET|BODY|HTML)$/.test(cur.tagName)) break;
      }
      return '';
    }

    // Il browser o il sito mostrano già i puntini al posto del testo.
    function copertoAschermo(el) {
      if (el.type === 'password' || String(el.getAttribute?.('type') || '').toLowerCase() === 'password') return true;
      try {
        const cs = win.getComputedStyle(el);
        const puntini = cs.webkitTextSecurity || cs.getPropertyValue('-webkit-text-security');
        return !!puntini && puntini !== 'none';
      } catch (_) { return false; }
    }

    // Una password resta tale quando il sito la mostra in chiaro: da lì il campo può non dire più cos'è.
    const eranoCoperti = new WeakSet();
    if (ricorda) {
      try {
        const segna = (e) => {
          const el = (typeof e.composedPath === 'function' && e.composedPath()[0]) || e.target;
          if (el && el.tagName === 'INPUT' && copertoAschermo(el)) eranoCoperti.add(el);
        };
        for (const tipo of ['focusin', 'input']) win.addEventListener(tipo, segna, true);
        new win.MutationObserver((lista) => {
          for (const m of lista) if (String(m.oldValue || '').toLowerCase() === 'password') eranoCoperti.add(m.target);
        }).observe(doc, { subtree: true, attributes: true, attributeFilter: ['type'], attributeOldValue: true });
      } catch (_) {}
    }

    // Un numero con la forma di una carta anche se sbagliato: l'utente chiede aiuto proprio quando il sito lo rifiuta.
    // Dalle 14 cifre in su e con la prima di un circuito, per lasciare fuori telefoni e codici a barre.
    function formaDiCarta(valore) {
      const t = String(valore || '').trim();
      if (!/^\d[\d\s-]*$/.test(t)) return false;
      const cifre = t.replace(/\D/g, '');
      if (cifre.length < 12 || cifre.length > 19) return false;
      if (typeof cartaValida === 'function' && cartaValida(t)) return true;
      return cifre.length >= 14 && /^[2-6]/.test(cifre);
    }

    // Lo dice il tipo, l'autocompletamento, i puntini, il nome che il sito gli dà, o il valore stesso quando ha la
    // forma di una carta: il nome lo sceglie il sito, e non sempre dice «carta».
    function segretoDaSe(el) {
      if (!el || el.nodeType !== 1 || !CAMPO_CON_VALORE.test(el.tagName)) return false;
      const tipo = String(el.getAttribute('type') || '').toLowerCase();
      if (el.tagName === 'INPUT' && INPUT_BOTTONE.test(tipo)) return false;
      if (copertoAschermo(el) || eranoCoperti.has(el)) return true;
      if (AUTOCOMPLETE_SEGRETO.test(String(el.getAttribute('autocomplete') || ''))) return true;
      const nomi = ['aria-label', 'placeholder', 'name', 'id', 'title'].map((a) => el.getAttribute(a) || '');
      nomi.push(etichettaCollegata(el), etichettaVicina(el));
      if (PAROLE_SEGRETE.test(nomi.join(' ').replace(/([a-z])([A-Z])/g, '$1 $2'))) return true;
      return formaDiCarta(el.value);
    }

    // Le caselle corte vicine sono un campo solo diviso in pezzi (carta in quattro, codice in sei): l'etichetta e
    // l'autocompletamento il sito li mette su una sola, e una casella da sola non ha la forma di niente.
    function casellaCorta(el) {
      if (!el || el.tagName !== 'INPUT') return false;
      const tipo = String(el.getAttribute?.('type') || '').toLowerCase();
      if (INPUT_BOTTONE.test(tipo)) return false;
      const max = Number(el.maxLength);
      return max >= 1 && max <= 6;
    }

    function caselleSorelle(el) {
      if (!casellaCorta(el)) return [];
      let cont = el.parentElement;
      for (let i = 0; cont && i < 3; i++, cont = cont.parentElement) {
        const corte = Array.from(cont.querySelectorAll?.('input') || []).filter(casellaCorta);
        if (corte.length >= 2) return corte;
      }
      return [];
    }

    function campoSegreto(el) {
      if (segretoDaSe(el)) return true;
      const sorelle = caselleSorelle(el);
      if (sorelle.length < 2) return false;
      if (sorelle.some((c) => c !== el && segretoDaSe(c))) return true;
      if (sorelle.length >= 4 && sorelle.every((c) => Number(c.maxLength) === 1)) return true;
      return formaDiCarta(sorelle.map((c) => String(c.value || '').trim()).join(''));
    }

    // Anche i campi dentro i componenti della pagina (ombra aperta): a schermo si vedono come gli altri.
    function tuttiICampi(radice, profondita = 0) {
      const out = Array.from(radice.querySelectorAll('input, textarea, select'));
      if (profondita > 8) return out;
      for (const n of radice.querySelectorAll('*')) {
        if (n.shadowRoot) out.push(...tuttiICampi(n.shadowRoot, profondita + 1));
      }
      return out;
    }

    // I campi segreti compilati che a schermo si leggono (un numero di carta, una password resa visibile), con
    // quanto serve a ridisegnarli coperti nell'immagine della pagina. Coordinate della finestra di questo documento.
    // `radice`: un componente chiuso, che solo il main sa raggiungere.
    function campiInVista(radice = doc) {
      const out = [];
      for (const el of tuttiICampi(radice)) {
        if (!el.value || !campoSegreto(el) || copertoAschermo(el)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom <= 0 || r.right <= 0 || r.top >= win.innerHeight || r.left >= win.innerWidth) continue;
        const cs = win.getComputedStyle(el);
        // Uno sfondo trasparente o velato lascerebbe trasparire le cifre sotto la copertura.
        const velato = /^transparent$|^rgba\(.*,\s*(0?\.\d+|0)\)$/.test(cs.backgroundColor);
        const sfondo = velato ? '#ffffff' : cs.backgroundColor;
        const bordo = (lato) => parseFloat(cs[`border${lato}Width`]) || 0;
        out.push({
          left: r.left + bordo('Left'), top: r.top + bordo('Top'),
          width: Math.max(1, r.width - bordo('Left') - bordo('Right')), height: Math.max(1, r.height - bordo('Top') - bordo('Bottom')),
          sfondo, testo: cs.color || '#000000', corpo: parseFloat(cs.fontSize) || 14,
        });
      }
      return out;
    }

    // I valori dei campi segreti compilati, anche fuori vista: un'anteprima della carta li ripete altrove (#810.16).
    function valoriSegreti(radice = doc) {
      const out = [];
      for (const el of tuttiICampi(radice)) if (el.value && campoSegreto(el)) out.push(String(el.value));
      return out;
    }

    return { campoSegreto, copertoAschermo, etichettaCollegata, etichettaVicina, campiInVista, valoriSegreti };
  }

  // Il testo a schermo che ripete il valore di un campo segreto (#810.16), come l'anteprima della carta che si compone
  // mentre si scrive: sei cifre consecutive del valore lo identificano, un valore più corto solo se una sequenza di
  // cifre del testo è lui intero («•••• 1234» resta). Autosufficiente come `crea`. Rettangoli nella finestra di `win`.
  function rettangoliRipetuti(win, valori, radice) {
    const doc = win.document;
    const NORMA = /[\s   \-‐-―]/g;
    const aghi = new Set();
    const interi = new Set();
    for (const v of valori || []) {
      const t = String(v || '').replace(NORMA, '');
      for (const seq of t.match(/\d+/g) || []) {
        if (seq.length >= 6) for (let i = 0; i + 6 <= seq.length; i++) aghi.add(seq.slice(i, i + 6));
        else if (seq.length >= 3 && seq === t) interi.add(seq);
      }
    }
    if (!aghi.size && !interi.size) return [];

    const SALTA = /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|TEXTAREA|SELECT|OPTION|INPUT)$/;
    const nodi = [];
    let flusso = '';
    const pila = [radice || doc];
    while (pila.length) {
      const n = pila.pop();
      if (n.nodeType === 3) {
        const t = String(n.nodeValue || '').replace(NORMA, '');
        if (t) { nodi.push({ n, da: flusso.length, a: flusso.length + t.length }); flusso += t; }
        continue;
      }
      if (n.nodeType === 1 && SALTA.test(n.tagName)) continue;
      const figli = Array.from(n.childNodes || []);
      if (n.shadowRoot) figli.push(n.shadowRoot);
      for (let i = figli.length - 1; i >= 0; i--) pila.push(figli[i]);
    }

    const corrisponde = (cifre) => {
      for (const seq of cifre.match(/\d+/g) || []) {
        if (interi.has(seq)) return true;
        if (seq.length >= 6) for (const a of aghi) if (seq.includes(a)) return true;
      }
      return false;
    };
    const rettangolo = (n) => {
      try {
        const rg = (n.ownerDocument || doc).createRange();
        rg.selectNodeContents(n);
        const q = rg.getBoundingClientRect();
        return q && q.width && q.height ? q : null;
      } catch (_) { return null; }
    };
    // Pezzi consecutivi sulla stessa riga sono un numero solo anche sparsi sulla carta disegnata (un gruppo per
    // <span>, distribuiti da un capo all'altro): nel documento fra loro ci sono solo spazi. Su righe diverse no.
    const affiancati = (p, q) => {
      const alto = Math.min(p.height, q.height);
      const insieme = Math.min(p.top + p.height, q.top + q.height) - Math.max(p.top, q.top);
      return insieme >= alto / 2 && q.left - (p.left + p.width) >= -alto;
    };
    const area = (r) => r.width * r.height;
    const out = [];
    const re = /\d+/g;
    for (let m = re.exec(flusso); m; m = re.exec(flusso)) {
      if (!corrisponde(m[0])) continue;
      const da = m.index, a = da + m[0].length;
      let pezzo = [];
      const pezzi = [pezzo];
      for (const x of nodi) {
        if (x.a <= da || x.da >= a) continue;
        if (x.r === undefined) x.r = rettangolo(x.n);
        const prec = pezzo[pezzo.length - 1];
        if (!x.r || (prec && !affiancati(prec.r, x.r))) { pezzo = []; pezzi.push(pezzo); }
        if (x.r) pezzo.push(x);
      }
      for (const p of pezzi) {
        if (!p.length || !corrisponde(p.map((x) => flusso.slice(Math.max(x.da, da), Math.min(x.a, a))).join(''))) continue;
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        for (const { r: q } of p) {
          l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.left + q.width); b = Math.max(b, q.top + q.height);
        }
        let box = { left: l, top: t, width: r - l, height: b - t };
        // L'elemento che tiene il numero, se non è molto più grande del testo: anche il suo sfondo è l'anteprima.
        let su = p[0].n.parentElement;
        while (su && !p.every((x) => su.contains(x.n))) su = su.parentElement;
        const e = su && su.getBoundingClientRect ? su.getBoundingClientRect() : null;
        if (e && e.left <= l && e.top <= t && e.left + e.width >= r && e.top + e.height >= b && area(e) <= 3 * area(box)) {
          box = { left: e.left, top: e.top, width: e.width, height: e.height };
        }
        if (box.left + box.width <= 0 || box.top + box.height <= 0 || box.left >= win.innerWidth || box.top >= win.innerHeight) continue;
        out.push(box);
      }
    }
    return out;
  }

  global.SN_CAMPI_SEGRETI = { crea, rettangoliRipetuti };
})(typeof globalThis !== 'undefined' ? globalThis : this);

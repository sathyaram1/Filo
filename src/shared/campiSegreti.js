// Quali campi di un modulo tengono un valore che non esce mai verso un modello (#810.7): password, codici, carta.
// `crea` deve restare autosufficiente: il main la manda così com'è dentro ogni riquadro incorporato della pagina.
// Prove: tests/aiuto-campi-segreti.spec.mjs, tests/unit/campiSegreti.test.mjs.

(function (global) {
  'use strict';

  // `cartaValida(testo)`: il riconoscimento del numero di carta, quello di SN_GUARDIANO_STATICO.
  function crea(win, cartaValida) {
    const doc = win.document;
    const CAMPO_CON_VALORE = /^(INPUT|TEXTAREA|SELECT)$/;
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
      const d = el.ownerDocument || doc;
      for (const id of String(el.getAttribute?.('aria-labelledby') || '').split(/\s+/)) {
        const t = id && d.getElementById(id);
        if (t && t !== el) parti.push(testoSenzaCampi(t));
      }
      if (!parti.length) { try { for (const l of el.labels || []) parti.push(testoSenzaCampi(l)); } catch (_) {} }
      return parti.join(' ').replace(/\s+/g, ' ').trim();
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

    // Lo dice il tipo, l'autocompletamento, i puntini, il nome che il sito gli dà, o il valore stesso quando ha la
    // forma di una carta: il nome lo sceglie il sito, e non sempre dice «carta».
    function campoSegreto(el) {
      if (!el || el.nodeType !== 1 || !CAMPO_CON_VALORE.test(el.tagName)) return false;
      const tipo = String(el.getAttribute('type') || '').toLowerCase();
      if (el.tagName === 'INPUT' && INPUT_BOTTONE.test(tipo)) return false;
      if (copertoAschermo(el)) return true;
      if (AUTOCOMPLETE_SEGRETO.test(String(el.getAttribute('autocomplete') || ''))) return true;
      const nomi = ['aria-label', 'placeholder', 'name', 'id', 'title'].map((a) => el.getAttribute(a) || '');
      nomi.push(etichettaCollegata(el));
      if (PAROLE_SEGRETE.test(nomi.join(' ').replace(/([a-z])([A-Z])/g, '$1 $2'))) return true;
      const valore = String(el.value || '');
      return /^[\d\s-]{12,30}$/.test(valore.trim()) && typeof cartaValida === 'function' && cartaValida(valore);
    }

    // I campi segreti compilati che a schermo si leggono (un numero di carta, una password resa visibile), con
    // quanto serve a ridisegnarli coperti nell'immagine della pagina. Coordinate della finestra di questo documento.
    function campiInVista() {
      const out = [];
      for (const el of doc.querySelectorAll('input, textarea, select')) {
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

    return { campoSegreto, copertoAschermo, etichettaCollegata, campiInVista };
  }

  global.SN_CAMPI_SEGRETI = { crea };
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Il copione che Filo esegue nel mondo isolato di una scheda per leggerla e guidarla come una persona (#534):
// testo visibile, elementi per nome, clic e scrittura senza gesti veri. Un clic che invia, paga o cancella non esiste.
// Chi lo chiama: src/main/services/schedeAperte.js e postaGmail.js. Prove: tests/schede-aperte.spec.mjs, tests/posta-gmail.spec.mjs.

// Quando un nome (già normalizzato: minuscolo, senza accenti) è un comando che invia, paga, pubblica o cancella.
// Gira dentro la pagina insieme al copione: niente riferimenti fuori da qui. Regole: tests/unit/schedeAperte.test.mjs.
function regoleComandi() {
  const P = (s) => new RegExp(`(?:^|[^a-z0-9])(?:${s})(?:$|[^a-z0-9])`);
  // Un verbo che da solo invia, paga o cancella, in qualunque forma lo scriva un sito.
  const AZIONE = P('invia(?:re)?|invio|send|manda(?:re)?|spedisci|spedire|enviar|envio|envoyer|senden|'
    + 'paga(?:re)?|pay|acquista(?:re)?|compra(?:re)?|buy|checkout|ordina ora|order now|place order|'
    + 'procedi al pagamento|elimina(?:re)?|delete|cancella(?:re)?|rimuovi|remove|trash|cestino|discard|scarta|spam|'
    + 'unsubscribe|annulla (?:l.)?iscrizione|disiscriviti|submit|dona(?:re)?|donate|abbonati|subscribe|'
    + 'pubblica(?:re)?|publish|tweet|condividi|share|post now|posta ora');
  // «Conferma ordine», «Esegui bonifico», «Autorizza pagamento»: un verbo che chiude più la cosa che chiude.
  const CHIUDE = P('conferma(?:re)?|confermo|confirm|autorizza(?:re)?|authori[sz]e|approva(?:re)?|approve|'
    + 'esegui(?:re)?|execute|effettua(?:re)?|completa(?:re)?|complete|procedi|proceed|finalizza(?:re)?|place|invia');
  const COSA = P('ordine|ordini|order|pagamento|pagamenti|payment|bonifico|bonifici|transfer|trasferimento|'
    + 'acquisto|acquisti|purchase|prenotazione|booking|ricarica|transazione|transaction|addebito|giroconto|'
    + 'operazione|operation|invio|spedizione|iscrizione|abbonamento|donazione|eliminazione|cancellazione|rimozione');
  // Il «Conferma» o l'«OK» nudo di un riquadro: dice cosa fa solo il riquadro intorno.
  const NUDO = /^(?:conferma|confermo|confirm|ok|okay|si|yes|autorizza|authori[sz]e|approva|approve|procedi|proceed|continua|continue|esegui|completa|complete)(?: ora| now)?$/;
  return {
    vietato: (n) => !!n && (AZIONE.test(n) || (CHIUDE.test(n) && COSA.test(n))),
    cosa: (n) => !!n && COSA.test(n),
    nudo: (n) => !!n && NUDO.test(n),
  };
}

function paginaGuidata(regoleComandi) {
  'use strict';

  const VERSIONE = 2;
  if (window.__filoPagina && window.__filoPagina.versione === VERSIONE) return;
  const RC = regoleComandi();

  const BLOCCHI = new Set(['block', 'flex', 'grid', 'list-item', 'table', 'table-row', 'table-caption', 'flow-root',
    'table-row-group', 'table-header-group', 'table-footer-group', 'inline-table']);
  const SALTA = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'CANVAS',
    'VIDEO', 'AUDIO', 'HEAD', 'SVG', 'MATH', 'LINK', 'META']);
  const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  const INTERATTIVI = 'a[href],button,input,textarea,select,summary,[role=button],[role=link],[role=menuitem],'
    + '[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=option],[role=checkbox],[role=switch],[role=radio],'
    + '[role=textbox],[role=searchbox],[role=combobox],[role=row],[role=treeitem],[contenteditable=""],'
    + '[contenteditable="true"],[contenteditable="plaintext-only"]';
  // Il nome di un comando che invia, paga, pubblica o cancella. Su questi Filo non clicca: l'utente lo fa da sé.
  const VIETATI = new RegExp('(?:^|[^a-z])(?:invia(?:re)?|invia ora|send|send now|manda(?:re)?|spedisci|spedire|'
    + 'enviar|envoyer|senden|paga(?:re)?|pay|paga ora|pay now|acquista(?:re)?|compra(?:re)?|buy|checkout|'
    + 'conferma (?:l.?ordine|il pagamento|l.?acquisto)|place order|procedi al pagamento|elimina(?:re)?|'
    + 'elimina definitivamente|delete|cancella(?:re)?|rimuovi|remove|trash|cestino|discard|scarta|spam|'
    + 'unsubscribe|annulla (?:l.)?iscrizione|disiscriviti|submit|dona(?:re)?|donate|abbonati|subscribe|'
    + 'pubblica(?:re)?|publish|tweet|condividi|share|post now|posta ora)(?:$|[^a-z])', 'i');

  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const breve = (s, n) => {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  function stile(el) { try { return getComputedStyle(el); } catch (_) { return null; } }

  // Fuori dalla pagina o ridotto a un punto: il trucco con cui si nasconde a chi guarda un testo per chi legge il codice.
  function nascostoAgliOcchi(el, cs) {
    if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
    if (/^rect\(\s*0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?\s*\)$/.test(cs.clip || '')) return true;
    if (/inset\(\s*50%/.test(cs.clipPath || '')) return true;
    const r = el.getBoundingClientRect();
    // Un contenitore fisso grande zero che porta figli visibili (finestre, avvisi) non nasconde niente: conta il ritaglio.
    const ritaglia = /(hidden|clip)/.test(`${cs.overflow} ${cs.overflowX} ${cs.overflowY}`);
    if (r.width <= 1 && r.height <= 1) return ritaglia;
    return (r.width > 1 && r.right + window.scrollX <= 0) || (r.height > 1 && r.bottom + window.scrollY <= 0);
  }
  function mostrato(el) {
    const cs = stile(el);
    if (!cs) return false;
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (cs.contentVisibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    return !nascostoAgliOcchi(el, cs);
  }
  function testoLeggibile(el) {
    const cs = stile(el);
    if (!cs) return true;
    if (parseFloat(cs.fontSize) < 4) return false;
    const c = String(cs.color || '');
    return !(c === 'transparent' || /rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(c));
  }
  function inVista(el) {
    try {
      if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })) return false;
    } catch (_) {}
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = stile(el);
    return !!cs && !nascostoAgliOcchi(el, cs);
  }

  function valoreVisibile(el) {
    const tag = el.tagName.toUpperCase();
    if (tag === 'SELECT') {
      const o = el.selectedOptions && el.selectedOptions[0];
      return o ? breve(o.text, 200) : '';
    }
    const tipo = String(el.type || '').toLowerCase();
    if (tag === 'INPUT' && !/^(text|search|email|url|tel|number|date|time|datetime-local|month|week|)$/.test(tipo)) return '';
    return breve(el.value, 4000);
  }

  // Il testo come lo legge una persona: niente di nascosto, a capo dove la pagina va a capo.
  function testoDi(radice, max = 400000) {
    const pezzi = [];
    let n = 0;
    let visti = 0;
    const leggibili = new Map();
    const capo = () => {
      const u = pezzi[pezzi.length - 1];
      if (u !== undefined && u !== '\n') pezzi.push('\n');
    };
    const giro = (nodo, prof) => {
      if (n >= max || visti > 300000 || prof > 400 || !nodo) return;
      visti++;
      if (nodo.nodeType === 3) {
        const p = nodo.parentElement;
        if (p) {
          let ok = leggibili.get(p);
          if (ok === undefined) { ok = testoLeggibile(p); leggibili.set(p, ok); }
          if (!ok) return;
        }
        const t = nodo.nodeValue.replace(/[\s\u00a0]+/g, ' ');
        if (!t.trim()) {
          const u = pezzi[pezzi.length - 1];
          if (u && u !== '\n' && !u.endsWith(' ')) pezzi.push(' ');
          return;
        }
        pezzi.push(t);
        n += t.length;
        return;
      }
      if (nodo.nodeType === 11) { for (const c of nodo.childNodes) giro(c, prof + 1); return; }
      if (nodo.nodeType !== 1) return;
      const el = nodo;
      const tag = el.tagName.toUpperCase();
      if (SALTA.has(tag)) return;
      if (tag === 'BR') { capo(); return; }
      if (tag === 'SLOT') {
        const a = el.assignedNodes ? el.assignedNodes({ flatten: true }) : [];
        for (const c of (a.length ? a : el.childNodes)) giro(c, prof + 1);
        return;
      }
      if (!mostrato(el)) return;
      const d = (stile(el) || {}).display;
      const blocco = BLOCCHI.has(d);
      if (blocco) capo();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        const v = valoreVisibile(el);
        if (v) { pezzi.push(` ${v} `); n += v.length; }
        if (blocco) capo();
        return;
      }
      for (const c of (el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes)) giro(c, prof + 1);
      if (blocco) capo();
      else if (d === 'table-cell') pezzi.push('  ');
    };
    giro(radice, 0);
    const testo = pezzi.join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{3,}/g, '  ').trim();
    return { testo, troncato: n >= max };
  }

  function tutti(sel, radice = document, out = [], prof = 0) {
    let lista = [];
    try { lista = radice.querySelectorAll(sel); } catch (_) {}
    for (const el of lista) out.push(el);
    if (prof < 6) {
      let tuttiEl = [];
      try { tuttiEl = radice.querySelectorAll('*'); } catch (_) {}
      for (const host of tuttiEl) if (host.shadowRoot) tutti(sel, host.shadowRoot, out, prof + 1);
    }
    return out;
  }

  function campo(el) {
    const tag = el.tagName.toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return /^(text|search|email|url|tel|number|)$/.test(String(el.type || '').toLowerCase());
    if (el.isContentEditable) return true;
    const r = el.getAttribute('role');
    return r === 'textbox' || r === 'searchbox';
  }
  function tipoDi(el) {
    const tag = el.tagName.toUpperCase();
    const r = el.getAttribute('role') || '';
    if (tag === 'INPUT' && /^(password|hidden|file)$/i.test(el.type || '')) return '';
    if (campo(el)) return 'campo';
    if ((tag === 'INPUT' && /^(checkbox|radio)$/i.test(el.type || ''))
      || /^(checkbox|switch|radio|menuitemcheckbox|menuitemradio)$/.test(r)) return 'casella';
    if (tag === 'SELECT' || r === 'option' || r === 'combobox') return 'scelta';
    if (r === 'row' || r === 'treeitem') return 'riga';
    if ((tag === 'A' && el.hasAttribute('href')) || r === 'link') return 'link';
    return 'pulsante';
  }
  function nomeDi(el) {
    let t = '';
    const ids = el.getAttribute('aria-labelledby');
    if (ids) {
      t = ids.split(/\s+/).map((id) => {
        const x = document.getElementById(id);
        return x ? (x.innerText || x.textContent || '') : '';
      }).join(' ');
    }
    const tag = el.tagName.toUpperCase();
    const scrivibile = tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    if (!t.trim()) t = el.getAttribute('aria-label') || '';
    if (!t.trim() && el.labels && el.labels.length) t = el.labels[0].innerText || '';
    if (!t.trim() && tag === 'INPUT' && /^(submit|button|reset)$/i.test(el.type || '')) t = el.value || '';
    if (!t.trim() && scrivibile) t = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || '';
    if (!t.trim() && !scrivibile) t = el.innerText || '';
    if (!t.trim()) t = el.getAttribute('title') || el.getAttribute('data-tooltip') || '';
    if (!t.trim()) {
      const img = el.querySelector && el.querySelector('img[alt]');
      if (img) t = img.getAttribute('alt') || '';
    }
    return breve(t, 160);
  }
  function leggiCampo(el) { return el.isContentEditable ? String(el.innerText || '') : String(el.value || ''); }

  function interattivi() {
    const visti = new Set();
    const out = [];
    for (const el of tutti(INTERATTIVI)) {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-hidden') === 'true') continue;
      if (!tipoDi(el) || !inVista(el)) continue;
      const padre = el.parentElement && el.parentElement.closest(INTERATTIVI);
      if (padre && visti.has(padre) && tipoDi(padre) !== 'riga') continue;
      visti.add(el);
      out.push(el);
    }
    return out;
  }

  let registro = [];
  function elementi(max = 200) {
    registro = interattivi();
    const lista = registro.slice(0, max).map((el, i) => {
      const voce = { n: i + 1, tipo: tipoDi(el), nome: breve(nomeDi(el), 90) };
      if (voce.tipo === 'campo') voce.valore = breve(leggiCampo(el), 90);
      return voce;
    });
    return { lista, totale: registro.length };
  }

  function trova(rif, { soloCampi = false } = {}) {
    const s = String(rif == null ? '' : rif).trim();
    if (/^\d+$/.test(s)) {
      const el = registro[Number(s) - 1];
      return el && el.isConnected && inVista(el) && (!soloCampi || campo(el)) ? el : null;
    }
    const q = norm(s.replace(/^[«"'“]+|[»"'”]+$/g, ''));
    if (!q) return null;
    // Una parola intera vale più di un pezzo: «Invia» è il pulsante Invia, non la cartella Inviati.
    const qq = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const testa = new RegExp(`^${qq}(?:$|[^\\p{L}\\p{N}])`, 'u');
    const parola = new RegExp(`(?:^|[^\\p{L}\\p{N}])${qq}(?:$|[^\\p{L}\\p{N}])`, 'u');
    const cand = [];
    for (const el of interattivi()) {
      if (soloCampi && !campo(el)) continue;
      const nm = norm(nomeDi(el));
      if (!nm) continue;
      const p = nm === q ? 5 : testa.test(nm) ? 4 : parola.test(nm) ? 3 : nm.startsWith(q) ? 2 : nm.includes(q) ? 1 : 0;
      if (p) cand.push({ el, p, l: nm.length });
    }
    cand.sort((a, b) => b.p - a.p || a.l - b.l);
    return cand.length ? cand[0].el : null;
  }

  // Un pulsante si giudica dal nome, comunque sia lungo; una riga o un link solo se il nome è un comando, non un testo
  // che parla di inviare («Come inviare un pacco» si apre).
  function nomiDi(el) {
    return [nomeDi(el), el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-tooltip'),
      el.tagName.toUpperCase() === 'INPUT' ? el.value : ''].filter(Boolean).map(norm);
  }
  const comando = (n) => !!n && n.split(' ').length <= 5 && VIETATI.test(n);
  function vietato(el) {
    const t = tipoDi(el);
    const nomi = nomiDi(el);
    if (t !== 'riga' && t !== 'link' && nomi.some((n) => VIETATI.test(n))) return true;
    if (nomi.some(comando)) return true;
    const capo = el.parentElement && el.parentElement.closest('button,[role=button],[role=menuitem]');
    return !!capo && nomiDi(capo).some((n) => VIETATI.test(n));
  }
  function moduloDiRicerca(form) {
    return form.getAttribute('role') === 'search' || !!form.closest('[role=search]')
      || !!form.querySelector('input[type=search],[role=searchbox]')
      || /\b(search|cerca|ricerca)\b/i.test(`${form.getAttribute('aria-label') || ''} ${form.getAttribute('action') || ''}`);
  }
  // Un pulsante che spedisce un modulo è un invio, qualunque cosa ci sia scritto sopra.
  function inviaModulo(el) {
    const tag = el.tagName.toUpperCase();
    const tipo = String(el.getAttribute('type') || (tag === 'BUTTON' ? 'submit' : '')).toLowerCase();
    const sub = (tag === 'BUTTON' && tipo === 'submit') || (tag === 'INPUT' && (tipo === 'submit' || tipo === 'image'));
    if (!sub) return false;
    const form = el.form || el.closest('form');
    return !!form && !moduloDiRicerca(form);
  }

  // Eventi del mouse costruiti, mai un gesto vero: una pagina non ci apre finestre né chiede permessi.
  function clic(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0 };
    const P = (t, b) => { try { el.dispatchEvent(new PointerEvent(t, { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: b })); } catch (_) {} };
    const M = (t, b) => { try { el.dispatchEvent(new MouseEvent(t, { ...base, buttons: b })); } catch (_) {} };
    P('pointerover', 0); M('mouseover', 0); P('pointerdown', 1); M('mousedown', 1);
    try { if (typeof el.focus === 'function') el.focus({ preventScroll: true }); } catch (_) {}
    P('pointerup', 0); M('mouseup', 0); M('click', 0);
  }

  function apri(rif) {
    const el = trova(rif);
    if (!el) return { ok: false, motivo: 'non-trovato' };
    const nome = nomeDi(el);
    if (vietato(el)) return { ok: false, motivo: 'vietato', nome };
    if (inviaModulo(el)) return { ok: false, motivo: 'modulo', nome };
    const a = el.closest('a[href]');
    if (a) {
      let u = null;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (_) { u = null; }
      if (u && u.protocol !== 'javascript:') {
        if (u.origin !== location.origin) return { ok: false, motivo: 'esterno', nome, url: u.href };
        if (/^_blank$/i.test(a.getAttribute('target') || '')) return { ok: false, motivo: 'nuova-scheda', nome, url: u.href };
      }
    }
    if (campo(el)) {
      try { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); } catch (_) {}
      return { ok: true, nome, tipo: 'campo' };
    }
    clic(el);
    return { ok: true, nome, tipo: tipoDi(el) };
  }

  function scriviIn(el, testo, { inCima = false } = {}) {
    try { el.scrollIntoView({ block: 'center' }); } catch (_) {}
    try { el.focus({ preventScroll: true }); } catch (_) {}
    const sel = window.getSelection();
    if (el.isContentEditable) {
      const r = document.createRange();
      r.selectNodeContents(el);
      if (inCima) r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } else if (typeof el.select === 'function') {
      try { el.select(); } catch (_) {}
    }
    let fatto = false;
    try { fatto = document.execCommand('insertText', false, testo); } catch (_) { fatto = false; }
    const pulito = (s) => norm(s).replace(/\s+/g, '');
    if (!fatto || !pulito(leggiCampo(el)).includes(pulito(testo))) {
      if (el.isContentEditable) {
        if (inCima) el.insertBefore(document.createTextNode(testo), el.firstChild);
        else el.textContent = testo;
      } else {
        const proto = el.tagName.toUpperCase() === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const d = Object.getOwnPropertyDescriptor(proto, 'value');
        if (d && d.set) d.set.call(el, testo); else el.value = testo;
      }
      try { el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: testo })); } catch (_) {}
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
    }
    return leggiCampo(el);
  }

  function riservato(el) {
    if (el.tagName.toUpperCase() === 'INPUT' && /^password$/i.test(el.type || '')) return true;
    return /(^|\s)(cc-|current-password|new-password|one-time-code)/i.test(el.getAttribute('autocomplete') || '');
  }

  function scrivi(rif, testo) {
    const el = trova(rif, { soloCampi: true }) || trova(rif);
    if (!el) {
      // Le password non sono fra gli elementi che Filo vede: chi le nomina si sente dire perché.
      const q = norm(rif);
      const pw = q && tutti('input[type=password]').find((x) => inVista(x) && norm(nomeDi(x)).includes(q));
      return { ok: false, motivo: pw ? 'riservato' : 'non-trovato', nome: pw ? nomeDi(pw) : '' };
    }
    if (riservato(el)) return { ok: false, motivo: 'riservato', nome: nomeDi(el) };
    if (!campo(el)) return { ok: false, motivo: 'non-campo', nome: nomeDi(el) };
    const valore = scriviIn(el, String(testo == null ? '' : testo));
    return { ok: true, nome: nomeDi(el), valore: breve(valore, 600) };
  }

  function scorrevole() {
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight > se.clientHeight + 40) return se;
    let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    while (el && el !== document.body && el !== document.documentElement) {
      const cs = stile(el);
      if (cs && /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 40) return el;
      el = el.parentElement;
    }
    let meglio = se;
    let area = 0;
    for (const x of document.querySelectorAll('[role=main],main,div,section')) {
      if (x.scrollHeight <= x.clientHeight + 40) continue;
      const cs = stile(x);
      if (!cs || !/(auto|scroll|overlay)/.test(cs.overflowY)) continue;
      const a = x.clientWidth * x.clientHeight;
      if (a > area) { area = a; meglio = x; }
    }
    return meglio;
  }
  function scorri(verso) {
    const c = scorrevole();
    const prima = c.scrollTop;
    const passo = Math.max(100, (c === document.scrollingElement ? window.innerHeight : c.clientHeight) * 0.85);
    const v = String(verso || '').toLowerCase();
    if (v === 'su') c.scrollTop = prima - passo;
    else if (v === 'inizio') c.scrollTop = 0;
    else if (v === 'fine') c.scrollTop = c.scrollHeight;
    else c.scrollTop = prima + passo;
    const dopo = c.scrollTop;
    return { ok: true, spostato: Math.round(dopo - prima), inCima: dopo <= 0, inFondo: dopo + c.clientHeight >= c.scrollHeight - 2 };
  }

  let ultimoCambio = performance.now();
  let spia = null;
  function quiete() {
    if (!spia) {
      try {
        spia = new MutationObserver(() => { ultimoCambio = performance.now(); });
        spia.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      } catch (_) {}
    }
    return Math.round(performance.now() - ultimoCambio);
  }

  function leggi({ max = 400000, quanti = 200 } = {}) {
    const corpo = document.body || document.documentElement;
    const t = testoDi(corpo, max);
    const e = elementi(quanti);
    return { titolo: document.title, url: location.href, testo: t.testo, troncato: t.troncato, elementi: e.lista, totale: e.totale };
  }

  // Segni che in una pagina scrive più di un autore: chi la segna come fidata se lo sente dire.
  function segnaliAutori() {
    const campi = tutti('textarea,input,[contenteditable=""],[contenteditable="true"],[role=textbox]').filter((el) => campo(el) && inVista(el));
    const cosa = (el) => norm(`${nomeDi(el)} ${el.id || ''} ${el.getAttribute('name') || ''}`);
    const commenti = campi.some((el) => /(comment|rispond|reply|lascia un|aggiungi un|recension|review)/.test(cosa(el)));
    const editor = campi.some((el) => /(scrivi un post|crea (un )?post|nuovo post|new post|create post|start a post|write a post|a cosa stai pensando|what.s on your mind|what.s happening)/.test(cosa(el)))
      || interattivi().some((el) => /^(crea post|nuovo post|new post|create post|scrivi un post|tweet)$/.test(norm(nomeDi(el))));
    const nomi = new Set();
    for (const el of document.querySelectorAll('[rel~=author],[itemprop=author],[data-author],[class*=author],[class*=autore],[class*=username]')) {
      if (nomi.size > 30) break;
      if (!inVista(el)) continue;
      const t = norm((el.innerText || '').slice(0, 60));
      if (t) nomi.add(t);
    }
    return { commenti, editor, autori: nomi.size };
  }

  // ── posta: la casella di una scheda, guidata dai nomi che vede chi la usa ──────────────────────────────────
  const R = {
    rispondi: /^(rispondi|reply)$/,
    tutti: /^(rispondi a tutti|reply all|reply to all)$/,
    scrivi: /^(scrivi|compose|nuovo messaggio|new message)$/,
    arrivo: /^(posta in arrivo|in arrivo|inbox)\b/,
    inviati: /^(posta inviata|inviati|inviata|sent|sent mail)\b/,
    espandi: /^(espandi tutto|expand all)$/,
    cercaBtn: /^(cerca|cerca nella posta|search|search mail)$/,
    a: /^(a|destinatari|destinatari a|destinatario|to|recipients|to recipients)$/,
    oggetto: /^(oggetto|subject)$/,
    corpo: /(corpo del messaggio|message body|^corpo$|^messaggio$|^body$)/,
  };
  const emailIn = (s) => (String(s == null ? '' : s).match(EMAIL) || []).map((x) => x.toLowerCase());
  function indirizziIn(radice, max = 50) {
    const out = [];
    const add = (v) => { for (const e of emailIn(v)) if (out.length < max && !out.includes(e)) out.push(e); };
    const els = [radice, ...radice.querySelectorAll('[email],[data-hovercard-id],[data-email],[title],[aria-label],a[href^="mailto:"]')];
    for (const el of els) {
      if (out.length >= max) break;
      for (const k of ['email', 'data-hovercard-id', 'data-email', 'title', 'aria-label', 'href']) {
        const v = el.getAttribute && el.getAttribute(k);
        if (v) add(k === 'href' ? v.replace(/^mailto:/i, '') : v);
      }
    }
    add(testoDi(radice, 6000).testo);
    return out;
  }
  function conNome(re, radice, lista = null) {
    return (lista || interattivi()).filter((el) => (!radice || radice.contains(el)) && re.test(norm(nomeDi(el))));
  }
  function principale() {
    return [...document.querySelectorAll('[role=main]')].find(inVista) || document.querySelector('[role=main]') || document.body;
  }
  function campoRicerca() {
    const cand = tutti('input,textarea,[role=searchbox],[role=combobox]').filter((el) => campo(el) && inVista(el));
    const per = (el) => /\b(cerca|search|ricerca)\b/.test(norm(nomeDi(el)));
    return cand.find((el) => el.closest('[role=search]') && per(el))
      || cand.find((el) => String(el.type || '').toLowerCase() === 'search')
      || cand.find(per) || null;
  }
  function cartellaDa(titolo) {
    const t = norm(titolo);
    if (/^(posta in arrivo|in arrivo|inbox)\b/.test(t)) return 'arrivo';
    if (/^(posta inviata|inviati|inviata|sent)\b/.test(t)) return 'inviati';
    if (/^(risultati|search results)\b/.test(t)) return 'ricerca';
    return '';
  }
  function account() {
    const t = emailIn(document.title)[0];
    if (t) return t;
    for (const el of document.querySelectorAll('[aria-label]')) {
      const v = el.getAttribute('aria-label') || '';
      if (/account/i.test(v) && emailIn(v)[0]) return emailIn(v)[0];
    }
    return '';
  }
  function stato() {
    const ricerca = campoRicerca();
    const dentro = !!(ricerca && document.querySelector('[role=main]'));
    const els = dentro ? interattivi() : [];
    const conv = dentro && (conNome(R.rispondi, null, els).length > 0 || conNome(R.tutti, null, els).length > 0);
    return {
      dentro, vista: !dentro ? 'fuori' : (conv ? 'conversazione' : 'elenco'),
      account: account(), titolo: document.title, url: location.href, cartella: cartellaDa(document.title),
    };
  }

  function dataIn(radice) {
    for (const el of [radice, ...radice.querySelectorAll('[title],[aria-label]')]) {
      for (const k of ['title', 'aria-label']) {
        const v = el.getAttribute && el.getAttribute(k);
        if (v && v.length < 80 && /\d{1,2}[:/.\s]\d{1,2}|\d{4}/.test(v) && !/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(v)) return v.trim();
      }
    }
    return '';
  }
  function grassetto(c) {
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const cs = stile(n.parentElement);
      return !!cs && (cs.fontWeight === 'bold' || parseInt(cs.fontWeight, 10) >= 600);
    }
    return false;
  }
  function dividi(c, t) {
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    let prima = '';
    let dopo = '';
    let trovato = false;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (p && !mostrato(p)) continue;
      const v = n.nodeValue;
      if (!trovato && prima.trim() && /^[\s\u00a0]*[-–—][\s\u00a0]/.test(v)) {
        trovato = true;
        dopo += v.replace(/^[\s\u00a0]*[-–—][\s\u00a0]*/, '');
        continue;
      }
      if (trovato) dopo += v; else prima += v;
    }
    if (trovato) return { oggetto: breve(prima, 300), anteprima: breve(dopo, 400) };
    const m = t.match(/^(.*?)\s[-–—]\s(.*)$/);
    return m ? { oggetto: breve(m[1], 300), anteprima: breve(m[2], 400) } : { oggetto: breve(t, 300), anteprima: '' };
  }
  function celleDi(r) {
    const c = [...r.querySelectorAll('[role=gridcell],[role=cell],td')].filter((x) => x.closest('[role=row]') === r);
    return c.length ? c : [...r.children];
  }
  function firmaDi(d) { return norm(`${d.mittente}|${d.oggetto}|${d.data}`); }
  function rigaDa(r, i) {
    const conTesto = celleDi(r).map((c) => ({ c, t: breve(testoDi(c, 4000).testo, 600) })).filter((x) => x.t);
    if (!conTesto.length) return null;
    const primo = conTesto[0];
    const ultimo = conTesto.length > 1 ? conTesto[conTesto.length - 1] : null;
    const resto = conTesto.slice(1, ultimo ? -1 : undefined).sort((a, b) => b.t.length - a.t.length);
    const mezzo = resto[0] || null;
    const { oggetto, anteprima } = mezzo ? dividi(mezzo.c, mezzo.t) : { oggetto: '', anteprima: '' };
    const indirizzi = indirizziIn(primo.c, 20);
    const d = {
      i, mittente: breve(primo.t, 120), indirizzo: indirizzi[0] || '', indirizzi, oggetto, anteprima,
      data: ultimo ? breve(dataIn(ultimo.c) || ultimo.t, 80) : '', nuovo: grassetto(primo.c),
    };
    d.firma = firmaDi(d);
    return { d, bersaglio: mezzo ? mezzo.c : r };
  }
  function righeVive(max = 100) {
    const rows = [...principale().querySelectorAll('[role=row]')]
      .filter((r) => !r.querySelector('[role=columnheader]') && inVista(r));
    const out = [];
    for (const r of rows) {
      if (out.length >= max) break;
      const x = rigaDa(r, out.length + 1);
      if (x) out.push(x);
    }
    return out;
  }
  function righe(max = 100) { return righeVive(max).map((x) => x.d); }
  function apriRiga(rif = {}) {
    const tutte = righeVive(200);
    let scelta = null;
    if (rif.firma) scelta = tutte.find((x) => x.d.firma === rif.firma);
    if (!scelta && rif.parole) {
      const p = norm(rif.parole).split(' ').filter(Boolean);
      scelta = tutte.find((x) => {
        const t = norm(`${x.d.mittente} ${x.d.indirizzi.join(' ')} ${x.d.oggetto} ${x.d.anteprima}`);
        return p.length && p.every((w) => t.includes(w));
      });
    }
    if (!scelta && rif.i) scelta = tutte[rif.i - 1];
    if (!scelta) return { ok: false };
    clic(scelta.bersaglio);
    return { ok: true, riga: scelta.d };
  }
  function espandi() {
    const b = conNome(R.espandi, principale())[0];
    if (!b) return { ok: false };
    clic(b);
    return { ok: true };
  }
  function conversazione() {
    const main = principale();
    const titoli = [...main.querySelectorAll('h1,h2,[role=heading]')].filter(inVista);
    const oggetto = titoli.length ? breve(testoDi(titoli[0], 600).testo, 300) : '';
    let items = [...main.querySelectorAll('[role=listitem]')].filter(inVista);
    items = items.filter((x) => !items.some((y) => y !== x && y.contains(x)));
    const messaggi = [];
    for (const it of items.slice(0, 100)) {
      const t = testoDi(it, 120000).testo;
      if (!t) continue;
      const nomeEl = it.querySelector('[email][name]') || it.querySelector('[email]');
      messaggi.push({
        mittente: breve(nomeEl ? (nomeEl.getAttribute('name') || nomeEl.innerText) : t.split('\n')[0], 120),
        indirizzo: indirizziIn(it, 20)[0] || '',
        data: breve(dataIn(it), 80),
        testo: t,
      });
    }
    if (!messaggi.length) {
      const t = testoDi(main, 200000).testo;
      if (t) messaggi.push({ mittente: '', indirizzo: '', data: '', testo: t });
    }
    return { oggetto, messaggi };
  }
  function vaiA(cartella) {
    const re = cartella === 'inviati' ? R.inviati : R.arrivo;
    const b = conNome(re).find((el) => tipoDi(el) === 'link' || tipoDi(el) === 'pulsante' || tipoDi(el) === 'riga');
    if (!b) return { ok: false };
    clic(b);
    return { ok: true, nome: nomeDi(b) };
  }
  function cerca(q) {
    const c = campoRicerca();
    if (!c) return { ok: false, motivo: 'nessuna-ricerca' };
    scriviIn(c, String(q || ''));
    const k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    try { c.dispatchEvent(new KeyboardEvent('keydown', k)); } catch (_) {}
    try { c.dispatchEvent(new KeyboardEvent('keypress', k)); } catch (_) {}
    try { c.dispatchEvent(new KeyboardEvent('keyup', k)); } catch (_) {}
    return { ok: true };
  }
  // Se l'Invio costruito non è bastato: il pulsante della lente, o il modulo di ricerca.
  function inviaRicerca() {
    const c = campoRicerca();
    const form = c && c.closest('form');
    const radice = (c && (c.closest('[role=search]') || form)) || null;
    const b = radice ? conNome(R.cercaBtn, radice).find((el) => !campo(el)) : null;
    if (b) { clic(b); return { ok: true, via: 'pulsante' }; }
    if (form && moduloDiRicerca(form) && typeof form.requestSubmit === 'function') {
      try { form.requestSubmit(); return { ok: true, via: 'modulo' }; } catch (_) {}
    }
    return { ok: false };
  }
  function area(el) { const r = el.getBoundingClientRect(); return r.width * r.height; }
  function campiBozza(radice) {
    const campi = tutti('input,textarea,[contenteditable=""],[contenteditable="true"],[role=textbox],[role=combobox]', radice)
      .filter((el) => inVista(el) && (campo(el) || el.getAttribute('role') === 'combobox'));
    // Gmail cambia l'etichetta del campo A fra versioni e lingue («Destinatari A», «A destinatari»): conta la parola, non Cc e Ccn.
    const a = campi.find((el) => {
      const n = norm(nomeDi(el));
      return R.a.test(n) || /^(destinatari|to\b)/.test(n) || (/\b(destinatari|destinatario|recipients)\b/.test(n) && !/\b(cc|ccn|bcc)\b/.test(n));
    });
    const oggetto = campi.find((el) => R.oggetto.test(norm(nomeDi(el))));
    const corpi = campi.filter((el) => el.isContentEditable);
    const corpo = corpi.find((el) => R.corpo.test(norm(nomeDi(el)))) || corpi.sort((x, y) => area(y) - area(x))[0] || null;
    return { a, oggetto, corpo };
  }
  function bozzaAperta() {
    const dialoghi = [...document.querySelectorAll('[role=dialog]')].filter(inVista).reverse();
    for (const d of dialoghi) {
      const c = campiBozza(d);
      if (c.corpo) return { radice: d, ...c };
    }
    const c = campiBozza(principale());
    return c.corpo ? { radice: principale(), ...c } : null;
  }
  function apriScrivi() {
    const b = conNome(R.scrivi)[0];
    if (!b) return { ok: false };
    clic(b);
    return { ok: true };
  }
  function apriRisposta(aTutti) {
    const lista = conNome(aTutti ? R.tutti : R.rispondi, principale());
    const b = lista[lista.length - 1] || (aTutti ? null : conNome(R.rispondi)[0]);
    if (!b) return { ok: false };
    clic(b);
    return { ok: true };
  }
  function letturaBozza() {
    const f = bozzaAperta();
    if (!f) return { aperta: false };
    const destinatari = [];
    // Il riquadro della bozza, non la conversazione intorno: i mittenti dei messaggi sopra non sono destinatari.
    let intestazione = f.corpo.parentElement;
    for (let k = 0; intestazione && intestazione !== f.radice && k < 12; k++) {
      if (intestazione.querySelector('[email],[data-hovercard-id]') || (f.a && intestazione.contains(f.a))) break;
      intestazione = intestazione.parentElement;
    }
    intestazione = intestazione || f.radice;
    for (const el of intestazione.querySelectorAll('[email],[data-hovercard-id]')) {
      if (f.corpo && f.corpo.contains(el)) continue;
      for (const e of emailIn(`${el.getAttribute('email') || ''} ${el.getAttribute('data-hovercard-id') || ''}`)) if (!destinatari.includes(e)) destinatari.push(e);
    }
    if (f.a) for (const e of emailIn(leggiCampo(f.a))) if (!destinatari.includes(e)) destinatari.push(e);
    return {
      aperta: true, destinatari, oggetto: f.oggetto ? leggiCampo(f.oggetto) : '',
      testo: f.corpo ? String(f.corpo.innerText || '') : '',
    };
  }
  // `prima` è il testo che Filo aveva scritto in questa bozza: quello si sostituisce, quello dell'utente resta sotto.
  function compila({ a = '', oggetto = '', testo = '', prima = '' } = {}) {
    const f = bozzaAperta();
    if (!f || !f.corpo) return { ok: false, motivo: 'nessuna-bozza' };
    if (a) {
      if (!f.a) return { ok: false, motivo: 'nessun-destinatario' };
      // Una bozza ripresa ha già il destinatario fra le etichette: riscriverlo lo raddoppierebbe.
      const gia = [...f.radice.querySelectorAll('[email]')].some((x) => norm(x.getAttribute('email')) === norm(a));
      if (!gia) scriviIn(f.a, String(a));
    }
    if (oggetto && f.oggetto) scriviIn(f.oggetto, String(oggetto));
    if (testo) {
      const attuale = norm(f.corpo.innerText || '');
      if (!attuale) scriviIn(f.corpo, String(testo), { inCima: f.corpo.childNodes.length > 0 });
      else if (prima && attuale === norm(prima)) scriviIn(f.corpo, String(testo));
      else scriviIn(f.corpo, `${testo}\n\n`, { inCima: true });
    }
    return { ok: true };
  }

  window.__filoPagina = {
    versione: VERSIONE,
    leggi, elementi, apri, scrivi, scorri, quiete, segnaliAutori,
    posta: {
      stato, righe, apriRiga, espandi, conversazione, vaiA, cerca, inviaRicerca,
      apriScrivi, apriRisposta, compila, letturaBozza, bozzaAperta: () => {
        const f = bozzaAperta();
        return f ? { a: !!f.a, oggetto: !!f.oggetto, corpo: !!f.corpo, dialogo: f.radice.getAttribute('role') === 'dialog' } : null;
      },
    },
  };
}

const MONDO = 1534;
const CODICE = `(${paginaGuidata.toString()})();`;

module.exports = { MONDO, CODICE };

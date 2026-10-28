// Copia e Rispondi sotto una risposta di Filo (#1620): i tasti al passaggio del mouse, la citazione sopra il campo e in
// testa alla bolla che parte, il salto alla risposta citata. Non tocca il DOM al caricamento. Cosa si salva della
// citazione e come la legge il modello: src/shared/rispostaA.js.
(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  let d = null;
  // Il testo come l'ha scritto Filo, bolla per bolla: a schermo è già formattato, e il posto nel filo si ritrova da lui.
  const scritti = new WeakMap();
  let barra = null;
  let anteprima = null;
  let citata = null;
  const COPIATO_MS = 1600;

  const icona = (nome, size = 16) => (global.SN_ICONS && typeof global.SN_ICONS[nome] === 'function' ? global.SN_ICONS[nome](size) : '');
  const elDi = (t) => (t && t.nodeType === 1 ? t : (t && t.parentElement) || null);

  function ricorda(bolla, testo) {
    if (bolla) scritti.set(bolla, String(testo == null ? '' : testo));
  }

  // Quello che si legge nella bolla, senza i bottoni sotto né le note: è quello che va negli appunti.
  function testoDi(bolla) {
    if (!bolla) return '';
    if (scritti.has(bolla)) {
      const s = scritti.get(bolla);
      const Md = global.SN_MARKDOWN;
      return (bolla.classList.contains('dash-bubble-md') && Md && Md.testo ? Md.testo(s) : s).trim();
    }
    const copia = bolla.cloneNode(true);
    for (const n of copia.querySelectorAll('.dash-bubble-actions, .dash-msg-azioni, .dash-bubble-img, button')) n.remove();
    return String(copia.textContent || '').trim();
  }

  // Una risposta di Filo nel filo, finita e con qualcosa da leggere: le bolle dentro il blocco di attività sono passi.
  function rispondibile(b) {
    return !!b && !!d && b.parentElement === d.bubblesEl && !b.hidden && b.classList.contains('dash-bubble-filo')
      && !b.classList.contains('dash-bubble-streaming') && !b.classList.contains('dash-bubble-pending')
      && !!testoDi(b);
  }
  function bollaDi(target) {
    const el = elDi(target);
    const b = el && el.closest ? el.closest('.dash-bubble-filo') : null;
    return rispondibile(b) ? b : null;
  }

  // ── I tasti sotto la risposta ─────────────────────────────────────────────
  // Uno solo, che va sulla bolla sotto il mouse: lo spazio sotto ogni risposta lo tiene il CSS, così comparendo non
  // sposta niente. Le etichette sono attributi: nella bolla non entra testo, e chi la confronta col filo la ritrova.
  function tasto(azione, nome, etichetta) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dash-msg-azione';
    b.dataset.azione = azione;
    b.dataset.etichetta = etichetta;
    b.setAttribute('aria-label', etichetta);
    b.innerHTML = icona(nome, 15);
    return b;
  }
  function creaBarra() {
    const el = document.createElement('div');
    el.className = 'dash-msg-azioni';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Azioni sul messaggio');
    el.append(tasto('copia', 'copy', 'Copia'), tasto('rispondi', 'reply', 'Rispondi'));
    // Il fuoco resta nel campo: chi copia o cita sta per scrivere.
    el.addEventListener('mousedown', (e) => { if (e.target.closest('.dash-msg-azione')) e.preventDefault(); });
    el.addEventListener('click', (e) => {
      const t = e.target.closest('.dash-msg-azione');
      const b = el.parentElement;
      if (!t || !rispondibile(b)) return;
      e.stopPropagation();
      if (t.dataset.azione === 'copia') copia(b, t).catch(() => {});
      else rispondi(b);
    });
    return el;
  }
  function mettiBarra(b) {
    if (!barra) barra = creaBarra();
    if (barra.parentElement === b) return;
    for (const t of barra.querySelectorAll('.dash-msg-azione')) esito(t, null);
    b.appendChild(barra);
  }

  function esito(t, ok) {
    clearTimeout(t._timer);
    const copiaTasto = t.dataset.azione === 'copia';
    t.classList.toggle('dash-copiato', ok === true);
    t.classList.toggle('dash-non-copiato', ok === false);
    if (!copiaTasto) return;
    const etichetta = ok === true ? 'Copiato' : ok === false ? 'Non copiato' : 'Copia';
    t.dataset.etichetta = etichetta;
    t.setAttribute('aria-label', etichetta);
    t.innerHTML = icona(ok === true ? 'check' : 'copy', 15);
    if (ok != null) t._timer = setTimeout(() => esito(t, null), COPIATO_MS);
  }

  // Gli appunti li scrive il main, che mette il testo anche nella cronologia degli appunti come il Copia del tasto
  // destro; se dice no, ci prova la pagina.
  async function copia(b, t = null) {
    const testo = testoDi(b);
    if (!testo) return false;
    let ok = false;
    try {
      const r = await d.send({ type: MSG.COPY_TEXT_TO_CLIPBOARD, text: testo });
      ok = !!(r && r.ok);
    } catch (_) { ok = false; }
    if (!ok) {
      try { await navigator.clipboard.writeText(testo); ok = true; } catch (_) { ok = false; }
    }
    if (ok) d.contaCopia(b);
    if (t) esito(t, ok);
    return ok;
  }

  // ── La citazione sopra il campo ───────────────────────────────────────────
  // Il posto nel filo lo sa la bolla quando il filo l'ha riconosciuta (`data-key`); appena scritta no, e il main la
  // ritrova dal testo nella chat di adesso.
  function rispondi(b) {
    const k = /^m:(.+):(\d+)$/.exec(b.dataset.key || '');
    citata = {
      bolla: b,
      chat: k ? k[1] : '',
      i: k ? Number(k[2]) : null,
      ts: b.dataset.ts || '',
      role: 'filo',
      scritto: scritti.has(b) ? scritti.get(b) : testoDi(b),
      testo: testoDi(b),
    };
    disegnaAnteprima();
    d.inputEl.focus();
  }

  function disegnaAnteprima() {
    if (!anteprima) return;
    anteprima.hidden = !citata;
    if (!citata) return;
    anteprima.querySelector('.dash-citazione-testo').textContent = citata.testo;
    anteprima.querySelector('.dash-citazione-chi').textContent = citata.role === 'user' ? 'Tu' : 'Filo';
  }

  function creaAnteprima(host) {
    host.innerHTML = '';
    const vai = document.createElement('button');
    vai.type = 'button';
    vai.className = 'dash-citazione-vai';
    vai.title = 'Vai al messaggio';
    const chi = document.createElement('span');
    chi.className = 'dash-citazione-chi';
    const testo = document.createElement('span');
    testo.className = 'dash-citazione-testo';
    vai.append(chi, testo);
    vai.addEventListener('click', () => { if (citata) vaiA(citata).catch(() => {}); });
    const togli = document.createElement('button');
    togli.type = 'button';
    togli.className = 'dash-citazione-togli';
    togli.setAttribute('aria-label', 'Non rispondere');
    togli.title = 'Non rispondere';
    togli.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    togli.addEventListener('click', () => { annulla(); d.inputEl.focus(); });
    host.append(vai, togli);
    anteprima = host;
    disegnaAnteprima();
  }

  function annulla() {
    if (!citata) return false;
    citata = null;
    disegnaAnteprima();
    return true;
  }

  // Quello che parte col messaggio, preso dal campo che si svuota.
  function prendi() {
    const c = citata;
    annulla();
    return c;
  }
  // Un messaggio che non parte torna nel campo con la sua citazione.
  function rimetti(c) {
    if (!c) return;
    citata = c;
    disegnaAnteprima();
  }

  // Quello che il main riceve: il posto se si sa, e il testo per ritrovarlo o per stare al suo posto.
  function perIlMain(c) {
    const R = global.SN_RISPOSTA_A;
    if (!c || !R) return null;
    return R.daPagina({ chat: c.chat, i: c.i, testo: c.scritto });
  }
  // Quello che resta nello storico della scheda: al main serve solo se il filo non si legge, e ne basta l'inizio.
  function perLoStorico(c) {
    const p = perIlMain(c);
    const R = global.SN_RISPOSTA_A;
    return p ? { ...p, testo: R.taglia(p.testo, R.PER_IL_MODELLO) } : null;
  }

  // ── La citazione in testa alla bolla che parte ────────────────────────────
  // Il testo sta in attributi disegnati dal CSS: la bolla resta fatta delle sole parole dell'utente, che è come il filo
  // la riconosce, la cerca e la copia.
  // `c.testo` è già quello che si legge: dalla bolla citata (rispondi) o dal filo (dalFilo).
  function citaIn(bolla, c) {
    if (!bolla || !c) return null;
    const vecchia = bolla.querySelector(':scope > .dash-citata');
    if (vecchia) vecchia.remove();
    const q = document.createElement('span');
    q.className = 'dash-citata';
    const chi = c.role === 'user' ? 'Tu' : 'Filo';
    const testo = c.manca ? 'Messaggio non più nel filo' : String(c.testo || '').trim();
    q.dataset.chi = chi;
    q.dataset.testo = testo;
    q.setAttribute('aria-label', `In risposta a ${chi}: ${testo}`);
    if (c.manca) q.classList.add('dash-citata-manca');
    else {
      q.setAttribute('role', 'button');
      q.tabIndex = 0;
      q.title = 'Vai al messaggio';
    }
    q._citata = c;
    bolla.insertBefore(q, bolla.firstChild);
    return q;
  }

  // La citazione come la manda il filo (src/shared/rispostaA.js, risolvi): il testo è quello scritto da Filo.
  function dalFilo(r) {
    if (!r || typeof r !== 'object') return null;
    const Md = global.SN_MARKDOWN;
    const scritto = String(r.testo == null ? '' : r.testo);
    return {
      chat: typeof r.chat === 'string' ? r.chat : '', i: Number.isInteger(r.i) ? r.i : null, ts: r.ts || '',
      role: r.role === 'user' ? 'user' : 'filo', manca: r.manca === true,
      testo: (Md && Md.testo ? Md.testo(scritto) : scritto).trim(),
    };
  }

  function luce(n) {
    n.classList.remove('dash-trovato');
    void n.offsetWidth;
    n.classList.add('dash-trovato');
  }
  async function vaiA(c) {
    const chiave = c.chat && c.i != null ? `m:${c.chat}:${c.i}` : '';
    const qui = (c.bolla && c.bolla.isConnected ? c.bolla : null)
      || (chiave ? [...d.bubblesEl.querySelectorAll('[data-key]')].find((n) => n.dataset.key === chiave) : null);
    if (qui) {
      qui.scrollIntoView({ block: 'center' });
      luce(qui);
      return true;
    }
    return chiave ? d.vaiA({ chat: c.chat, i: c.i, ts: c.ts || null }) : false;
  }
  async function vaiDallaCitazione(q) {
    const c = q && q._citata;
    if (!c || c.manca) return;
    if (await vaiA(c)) return;
    // Non c'è più (la sua conversazione è stata tolta o nascosta): la citazione lo dice, invece di non fare niente.
    citaIn(q.parentElement, { ...c, manca: true, bolla: null });
  }

  // ── Tasto destro ──────────────────────────────────────────────────────────
  function vociMenu(target) {
    const el = elDi(target);
    if (!el || !d) return [];
    const q = el.closest('.dash-citata');
    if (q && d.bubblesEl.contains(q) && q._citata && !q._citata.manca) {
      return [{ type: 'item', icon: icona('reply', 16), label: 'Vai al messaggio citato', onClick: () => { vaiDallaCitazione(q).catch(() => {}); } }];
    }
    if (anteprima && anteprima.contains(el) && citata) {
      return [{ type: 'item', icon: icona('close', 16), label: 'Non rispondere', onClick: () => { annulla(); d.inputEl.focus(); } }];
    }
    const b = d.bubblesEl.contains(el) ? bollaDi(el) : null;
    if (!b) return [];
    return [
      { type: 'item', icon: icona('reply', 16), label: 'Rispondi', onClick: () => rispondi(b) },
      { type: 'item', icon: icona('copy', 16), label: 'Copia il messaggio', onClick: () => { copia(b).catch(() => {}); } },
    ];
  }

  function init(deps) {
    d = deps;
    creaAnteprima(d.anteprimaEl);
    const sopra = (e) => {
      const b = bollaDi(e.target);
      if (b) mettiBarra(b);
    };
    d.bubblesEl.addEventListener('mouseover', sopra);
    d.bubblesEl.addEventListener('focusin', sopra);
    d.bubblesEl.addEventListener('click', (e) => {
      const q = elDi(e.target) && elDi(e.target).closest('.dash-citata');
      if (q && d.bubblesEl.contains(q)) { e.stopPropagation(); vaiDallaCitazione(q).catch(() => {}); }
    });
    d.bubblesEl.addEventListener('keydown', (e) => {
      const q = e.target && e.target.classList && e.target.classList.contains('dash-citata') ? e.target : null;
      if (q && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); vaiDallaCitazione(q).catch(() => {}); }
    });
    // Esc nel campo lascia la risposta, dopo chi l'ha già preso (la dettatura che ascolta).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !citata) return;
      if (!d.formEl.contains(document.activeElement)) return;
      e.preventDefault();
      annulla();
    });
    global.SN_VOCI_PAGINA = Array.isArray(global.SN_VOCI_PAGINA) ? global.SN_VOCI_PAGINA : [];
    if (!global.SN_VOCI_PAGINA.includes(vociMenu)) global.SN_VOCI_PAGINA.push(vociMenu);
  }

  global.SN_DASH_RISPONDI = {
    init, ricorda, testoDi, prendi, rimetti, annulla, citaIn, dalFilo, perIlMain, perLoStorico, rispondi, copia,
    inCorso: () => !!citata,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

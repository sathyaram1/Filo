// I tasti al passaggio del mouse sotto i messaggi di tutte le chat (#2096): il filo della home, l'Aiuto, il riquadro, i
// Mazzi, gli scambi delle app. Non tocca il layout: la barra è assoluta e lo spazio sotto i messaggi lo tiene il CSS di
// chi la usa. Le azioni proprie di una chat (Modifica, Cita della home) entrano come `extra`, non come una copia di qui.
(function (global) {
  'use strict';
  if (global.SN_AZIONI_MESSAGGIO) return;

  const COPIATO_MS = 1600;
  // Quanto della risposta citata entra nel campo: abbastanza per riconoscerla, non tanto da coprire la domanda.
  const CITA_MAX = 280;
  const icona = (nome, size = 15) => (global.SN_ICONS && typeof global.SN_ICONS[nome] === 'function' ? global.SN_ICONS[nome](size) : '');
  const elDi = (t) => (t && t.nodeType === 1 ? t : (t && t.parentElement) || null);
  const CLASSI = { barra: 'sn-azioni-msg', tasto: 'sn-azioni-msg-tasto', ok: 'sn-azioni-msg-ok', no: 'sn-azioni-msg-no', destra: 'sn-azioni-msg-destra' };
  // Nome, icona e voce del tasto destro delle azioni comuni: chi ha un tasto suo (la risposta del riquadro) li prende da qui.
  const AZIONI = Object.freeze({
    copia: Object.freeze({ icona: 'copy', etichetta: 'Copia', voce: 'Copia il messaggio' }),
    rispondi: Object.freeze({ icona: 'reply', etichetta: 'Rispondi', voce: 'Rispondi' }),
  });
  // Le azioni che citano: con del testo selezionato nel messaggio citano quello.
  const CITANO = new Set(['rispondi', 'cita']);
  // Un tasto della barra: l'etichetta (aria-label e quella che compare al passaggio) e l'icona vengono dalla definizione.
  function tasto(def, classe, size = 15) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = classe;
    b.dataset.etichetta = def.etichetta;
    b.setAttribute('aria-label', def.etichetta);
    b.innerHTML = icona(def.icona, size);
    return b;
  }

  // Gli appunti li scrive il main, che mette il testo anche nella cronologia degli appunti come il Copia del tasto
  // destro; se dice no (o il canale non c'è), ci prova la pagina.
  async function copiaTesto(testo) {
    const MSG = global.SN_MSG && global.SN_MSG.MSG;
    try {
      const r = MSG && global.chrome && global.chrome.runtime
        ? await global.chrome.runtime.sendMessage({ type: MSG.COPY_TEXT_TO_CLIPBOARD, text: testo })
        : null;
      if (r && r.ok) return true;
    } catch (_) {}
    try { await navigator.clipboard.writeText(testo); return true; } catch (_) { return false; }
  }

  // La citazione che apre il messaggio dopo, come nelle email: una riga che comincia con «>», che il modello legge. In un
  // campo di una riga sola fra virgolette basse.
  function citazione(testo, { unaRiga = false } = {}) {
    let t = String(testo == null ? '' : testo).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (t.length > CITA_MAX) t = `${t.slice(0, CITA_MAX).trimEnd()}…`;
    return unaRiga ? `«${t}» ` : `> ${t}\n`;
  }
  // La prima citazione va in testa al campo, sopra quello che c'è già scritto; le altre in fondo, ognuna dopo il commento
  // a quella prima (#2346). In un campo di una riga ne sta una sola: la nuova sostituisce quella di prima.
  function citaNelCampo(campo, testo) {
    if (!campo) return;
    const unaRiga = campo.tagName !== 'TEXTAREA';
    const q = citazione(testo, { unaRiga });
    if (!q) return;
    const valore = String(campo.value || '');
    if (unaRiga) campo.value = q + valore.replace(/^«[^»]*» /, '');
    else campo.value = /^> /.test(valore) ? `${valore.replace(/\s+$/, '')}\n${q}` : q + valore;
    try { campo.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    campo.focus();
    try { campo.setSelectionRange(campo.value.length, campo.value.length); } catch (_) {}
  }

  // La parte della selezione che sta nel messaggio `el` (`testo`), e quello che la precede in `el` (`prima`); `null` se
  // non ne tocca niente. Dentro un'ombra (l'Aiuto sui siti) la selezione è della sua radice.
  function selezioneIn(el) {
    if (!el || typeof document === 'undefined') return null;
    const radice = el.getRootNode ? el.getRootNode() : null;
    let sel = null;
    try { sel = (radice && radice !== document && typeof radice.getSelection === 'function' && radice.getSelection()) || global.getSelection(); } catch (_) { sel = null; }
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0).cloneRange();
    if (!r.intersectsNode(el)) return null;
    const tutto = document.createRange();
    tutto.selectNodeContents(el);
    if (r.compareBoundaryPoints(Range.START_TO_START, tutto) < 0) r.setStart(tutto.startContainer, tutto.startOffset);
    if (r.compareBoundaryPoints(Range.END_TO_END, tutto) > 0) r.setEnd(tutto.endContainer, tutto.endOffset);
    const testo = r.toString();
    if (!testo.trim()) return null;
    const prima = document.createRange();
    prima.setStart(tutto.startContainer, tutto.startOffset);
    prima.setEnd(r.startContainer, r.startOffset);
    return { testo, prima: prima.toString() };
  }

  // `o`: { messaggio (selettore), testo(el), ruolo(el) → 'user'|'filo', pronto(el)?, rispondi(el, testo)?,
  // copia(testo, el)?, azioni(el)? → ['copia', …], extra? { id: { icona, etichetta, voce, fai(el, testo, sel) } },
  // classi? }. Rispondi con del testo selezionato nel messaggio cita quello (#2346). Dà `voci(target)` per il tasto destro.
  function attacca(contenitore, o) {
    if (!contenitore || !o || !o.messaggio) return { voci: () => [] };
    const testoDi = (el) => String((o.testo ? o.testo(el) : el.textContent) || '').trim();
    const copia = typeof o.copia === 'function' ? o.copia : copiaTesto;
    const cl = { ...CLASSI, ...(o.classi || {}) };
    const DEF = {
      copia: AZIONI.copia,
      ...(typeof o.rispondi === 'function' ? { rispondi: { ...AZIONI.rispondi, fai: (m, t, sel) => o.rispondi(m, t, sel) } } : {}),
      ...(o.extra || {}),
    };
    let barra = null;

    const azioniDi = (m) => {
      const a = typeof o.azioni === 'function' ? o.azioni(m) : (testoDi(m) ? ['copia', ...(DEF.rispondi ? ['rispondi'] : [])] : []);
      return a.filter((x) => DEF[x]);
    };
    const messaggioDi = (target) => {
      const el = elDi(target);
      const m = el && el.closest ? el.closest(o.messaggio) : null;
      if (!m || !contenitore.contains(m)) return null;
      if (typeof o.pronto === 'function' && !o.pronto(m)) return null;
      return azioniDi(m).length ? m : null;
    };

    function esito(t, ok) {
      clearTimeout(t._timer);
      t.classList.toggle(cl.ok, ok === true);
      t.classList.toggle(cl.no, ok === false);
      if (t.dataset.azione !== 'copia') return;
      const etichetta = ok === true ? 'Copiato' : ok === false ? 'Non copiato' : 'Copia';
      t.dataset.etichetta = etichetta;
      t.setAttribute('aria-label', etichetta);
      t.innerHTML = icona(ok === true ? 'check' : 'copy');
      if (ok != null) t._timer = setTimeout(() => esito(t, null), COPIATO_MS);
    }
    // `fissata`: la selezione di quando si è aperto il menu, che il clic sulla voce può aver già spento.
    async function fai(azione, m, t = null, fissata = null) {
      const testo = testoDi(m);
      if (azione !== 'copia') {
        const sel = CITANO.has(azione) ? (selezioneIn(m) || fissata) : null;
        DEF[azione].fai(m, sel ? sel.testo.trim() : testo, sel);
        return true;
      }
      if (!testo) return false;
      let ok = false;
      try { ok = await copia(testo, m); } catch (_) { ok = false; }
      if (t) esito(t, ok);
      return ok;
    }
    function tastoDi(azione) {
      const b = tasto(DEF[azione], cl.tasto);
      b.dataset.azione = azione;
      return b;
    }
    function creaBarra() {
      const el = document.createElement('div');
      el.className = cl.barra;
      el.setAttribute('role', 'toolbar');
      el.setAttribute('aria-label', 'Azioni sul messaggio');
      // Il fuoco resta nel campo: chi copia o cita sta per scrivere.
      el.addEventListener('mousedown', (e) => { if (e.target.closest(`.${cl.tasto}`)) e.preventDefault(); });
      el.addEventListener('click', (e) => {
        const t = e.target.closest(`.${cl.tasto}`);
        const m = el.parentElement;
        if (!t || !m || !messaggioDi(m)) return;
        e.stopPropagation();
        fai(t.dataset.azione, m, t).catch(() => {});
      });
      return el;
    }
    function metti(m) {
      if (!barra) barra = creaBarra();
      if (barra.parentElement === m) return;
      const volute = azioniDi(m);
      if (volute.join() !== [...barra.children].map((t) => t.dataset.azione).join()) barra.replaceChildren(...volute.map(tastoDi));
      for (const t of barra.querySelectorAll(`.${cl.tasto}`)) esito(t, null);
      if (cl.destra) barra.classList.toggle(cl.destra, o.ruolo ? o.ruolo(m) === 'user' : false);
      m.appendChild(barra);
    }
    const sopra = (e) => { const m = messaggioDi(e.target); if (m) metti(m); };
    contenitore.addEventListener('mouseover', sopra);
    contenitore.addEventListener('focusin', sopra);

    // Prima le azioni che portano avanti la conversazione, poi Copia: come i tasti a schermo dopo Copia.
    function voci(target) {
      const m = messaggioDi(target);
      if (!m) return [];
      const a = azioniDi(m);
      const sel = selezioneIn(m);
      return [...a.filter((x) => x !== 'copia'), ...a.filter((x) => x === 'copia')].map((x) => ({
        azione: x, label: sel && CITANO.has(x) ? `${DEF[x].voce} a questo passo` : DEF[x].voce, icona: DEF[x].icona,
        fai: () => fai(x, m, null, sel),
      }));
    }
    // Le stesse voci già nella forma del menu del tasto destro: ogni chat le passa così com'è.
    // `elemento`: il messaggio, che il menu a icone contorna passando sull'azione (#2555).
    const vociMenu = (target) => voci(target).map((v) => ({
      type: 'item', icon: icona(v.icona, 16), label: v.label, elemento: messaggioDi(target), onClick: () => { v.fai(); },
    }));
    return { voci, vociMenu, messaggioDi };
  }

  global.SN_AZIONI_MESSAGGIO = { attacca, tasto, AZIONI, citazione, citaNelCampo, copiaTesto, selezioneIn, CITA_MAX };
})(typeof globalThis !== 'undefined' ? globalThis : self);

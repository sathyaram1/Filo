// Copia e Rispondi al passaggio del mouse sotto i messaggi delle chat che non sono il filo della home (#2096): l'Aiuto,
// il riquadro, i Mazzi, gli scambi delle app nella home. Non tocca il layout: la barra è assoluta e lo spazio sotto i
// messaggi lo tiene il CSS di chi la usa (popup.css). Il filo della home ha la sua: src/pages/dashboard/dashboard-rispondi.js.
(function (global) {
  'use strict';
  if (global.SN_AZIONI_MESSAGGIO) return;

  const COPIATO_MS = 1600;
  // Quanto della risposta citata entra nel campo: abbastanza per riconoscerla, non tanto da coprire la domanda.
  const CITA_MAX = 280;
  const icona = (nome) => (global.SN_ICONS && typeof global.SN_ICONS[nome] === 'function' ? global.SN_ICONS[nome](15) : '');
  const elDi = (t) => (t && t.nodeType === 1 ? t : (t && t.parentElement) || null);

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

  // La citazione che apre il messaggio dopo, come nelle email: righe che cominciano con «>», che il modello legge.
  function citazione(testo) {
    let t = String(testo == null ? '' : testo).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (t.length > CITA_MAX) t = `${t.slice(0, CITA_MAX).trimEnd()}…`;
    return `> ${t}\n`;
  }
  // Mette la citazione in testa al campo, una sola: citare un altro messaggio sostituisce quella di prima.
  function citaNelCampo(campo, testo) {
    if (!campo) return;
    const q = citazione(testo);
    if (!q) return;
    const resto = String(campo.value || '').replace(/^> [^\n]*\n/, '');
    campo.value = q + resto;
    try { campo.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    campo.focus();
    try { campo.setSelectionRange(campo.value.length, campo.value.length); } catch (_) {}
  }

  // `o`: { messaggio (selettore), testo(el), ruolo(el) → 'user'|'filo', pronto(el)?, rispondi(el, testo)?, copia(testo)? }.
  // Dà `voci(target)`: le stesse azioni per il tasto destro.
  function attacca(contenitore, o) {
    if (!contenitore || !o || !o.messaggio) return { voci: () => [] };
    const testoDi = (el) => String((o.testo ? o.testo(el) : el.textContent) || '').trim();
    const copia = typeof o.copia === 'function' ? o.copia : copiaTesto;
    let barra = null;

    const messaggioDi = (target) => {
      const el = elDi(target);
      const m = el && el.closest ? el.closest(o.messaggio) : null;
      if (!m || !contenitore.contains(m)) return null;
      if (typeof o.pronto === 'function' && !o.pronto(m)) return null;
      return testoDi(m) ? m : null;
    };
    const azioni = () => (typeof o.rispondi === 'function' ? ['copia', 'rispondi'] : ['copia']);

    function esito(t, ok) {
      clearTimeout(t._timer);
      t.classList.toggle('sn-azioni-msg-ok', ok === true);
      t.classList.toggle('sn-azioni-msg-no', ok === false);
      if (t.dataset.azione !== 'copia') return;
      const etichetta = ok === true ? 'Copiato' : ok === false ? 'Non copiato' : 'Copia';
      t.dataset.etichetta = etichetta;
      t.setAttribute('aria-label', etichetta);
      t.innerHTML = icona(ok === true ? 'check' : 'copy');
      if (ok != null) t._timer = setTimeout(() => esito(t, null), COPIATO_MS);
    }
    async function fai(azione, m, t = null) {
      const testo = testoDi(m);
      if (azione === 'rispondi') { o.rispondi(m, testo); return true; }
      let ok = false;
      try { ok = await copia(testo); } catch (_) { ok = false; }
      if (t) esito(t, ok);
      return ok;
    }
    function tasto(azione) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sn-azioni-msg-tasto';
      b.dataset.azione = azione;
      const etichetta = azione === 'copia' ? 'Copia' : 'Rispondi';
      b.dataset.etichetta = etichetta;
      b.setAttribute('aria-label', etichetta);
      b.innerHTML = icona(azione === 'copia' ? 'copy' : 'reply');
      return b;
    }
    function creaBarra() {
      const el = document.createElement('div');
      el.className = 'sn-azioni-msg';
      el.setAttribute('role', 'toolbar');
      el.setAttribute('aria-label', 'Azioni sul messaggio');
      el.append(...azioni().map(tasto));
      // Il fuoco resta nel campo: chi copia o cita sta per scrivere.
      el.addEventListener('mousedown', (e) => { if (e.target.closest('.sn-azioni-msg-tasto')) e.preventDefault(); });
      el.addEventListener('click', (e) => {
        const t = e.target.closest('.sn-azioni-msg-tasto');
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
      for (const t of barra.querySelectorAll('.sn-azioni-msg-tasto')) esito(t, null);
      barra.classList.toggle('sn-azioni-msg-destra', o.ruolo ? o.ruolo(m) === 'user' : false);
      m.appendChild(barra);
    }
    const sopra = (e) => { const m = messaggioDi(e.target); if (m) metti(m); };
    contenitore.addEventListener('mouseover', sopra);
    contenitore.addEventListener('focusin', sopra);

    function voci(target) {
      const m = messaggioDi(target);
      if (!m) return [];
      const out = [];
      if (typeof o.rispondi === 'function') out.push({ azione: 'rispondi', label: 'Rispondi', icona: 'reply', fai: () => fai('rispondi', m) });
      out.push({ azione: 'copia', label: 'Copia il messaggio', icona: 'copy', fai: () => fai('copia', m) });
      return out;
    }
    return { voci };
  }

  global.SN_AZIONI_MESSAGGIO = { attacca, citazione, citaNelCampo, copiaTesto, CITA_MAX };
})(typeof globalThis !== 'undefined' ? globalThis : self);

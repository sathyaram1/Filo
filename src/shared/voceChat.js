// Il tasto microfono delle chat di Filo: si preme, si parla, e la richiesta parte da sola (o resta da correggere).
// Non trascrive e non invia da sé: l'ascolto è di SN_ASCOLTO, l'invio della chat che lo collega. Solo gesti veri.
// Regole: patterns/voce-dettatura-e-vettori-passano-dal-router-come-le-chat.md; prova: tests/voce-chat.spec.mjs.

(function (global) {
  'use strict';
  // Caricato sia dalla pagina sia dal preload: la seconda volta non deve dimenticare le chat collegate.
  if (global.SN_VOCE_CHAT) return;

  const TASTO = 'Ctrl+Shift+Spazio';
  // L'attimo per annullare: il testo è nella casella, la richiesta non è ancora partita.
  const ATTESA_MS = 2500;
  // Chi ha detto qualcosa e tace da due secondi ha finito; chi in otto non ha detto niente non parlerà.
  const FINE = { silenceMs: 2000, waitMs: 8000 };

  const controlli = new Set();
  let invioDaSolo = true;
  let ascoltaImpostazioni = false;

  function t(k, ...a) {
    const I = global.SN_I18N;
    return I ? I.t(k, ...a) : k;
  }
  function etichettaTasto() {
    const T = global.SN_TASTI;
    return T ? T.etichetta(TASTO) : TASTO;
  }
  function conTasto(nome, tasto) {
    const T = global.SN_TASTI;
    return T ? T.frase(nome, tasto) : `${nome} (${tasto})`;
  }

  function leggiInvio(settings) {
    if (settings && typeof settings === 'object') invioDaSolo = !(settings.dictation && settings.dictation.autoSend === false);
    return invioDaSolo;
  }
  async function impostazioneFresca() {
    try {
      const r = await chrome.runtime.sendMessage({ type: global.SN_MSG.MSG.GET_SETTINGS });
      return leggiInvio(r && r.settings);
    } catch (_) { return invioDaSolo; }
  }
  function seguiImpostazioni() {
    if (ascoltaImpostazioni) return;
    ascoltaImpostazioni = true;
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === global.SN_MSG.MSG.SETTINGS_UPDATED) leggiInvio(msg.settings);
      });
    } catch (_) {}
    impostazioneFresca();
  }
  async function salvaInvio(si) {
    invioDaSolo = si;
    try {
      await chrome.runtime.sendMessage({ type: global.SN_MSG.MSG.UPDATE_SETTINGS, settings: { dictation: { autoSend: si } } });
    } catch (_) {}
  }

  function svg(inner) {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" `
      + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }
  const MIC = '<rect x="9" y="3.5" width="6" height="10" rx="3"/><path d="M6 11.5a6 6 0 0 0 12 0"/>'
    + '<path d="M12 17.5v3"/><path d="M9 20.5h6"/>';
  const X = '<path d="M7 7l10 10"/><path d="M17 7L7 17"/>';

  function perCampo(el) {
    for (const c of controlli) {
      if (!c.campo.isConnected) { controlli.delete(c); continue; }
      if (c.campo === el) return c;
    }
    return null;
  }

  function caretInFondo(campo) {
    try {
      campo.focus();
      const n = campo.value.length;
      campo.setSelectionRange(n, n);
    } catch (_) {}
  }

  // `campo`: la casella; `invia()`: quello che fa la chat col tasto d'invio; `contenitore`/`prima`: dove va il tasto;
  // `occupato()`: la chat sta ancora rispondendo (l'invio aspetta); `ambito`: dove vale la scorciatoia (di serie la casella).
  function collega({ campo, invia, contenitore, prima = null, occupato = null, ambito = null } = {}) {
    if (!campo || !contenitore || typeof invia !== 'function') return null;
    const gia = perCampo(campo);
    if (gia) return gia.api;
    seguiImpostazioni();

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sn-voce-btn';
    b.innerHTML = `<span class="sn-voce-mic">${svg(MIC)}</span><span class="sn-voce-x">${svg(X)}</span>`
      + '<svg class="sn-voce-anello" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" pathLength="100"/></svg>';
    b.style.setProperty('--sn-voce-attesa', `${ATTESA_MS}ms`);
    contenitore.insertBefore(b, prima && prima.parentNode === contenitore ? prima : null);
    // Un sito che ospita la chat non accende il microfono di Filo con un clic fabbricato.
    try { global.SN_FILO_UI && global.SN_FILO_UI.soloGestiVeri(b); } catch (_) {}

    const c = { campo, bottone: b, stato: 'pronto', giro: 0, sessione: null, toccato: false, daSolo: true, timer: 0, atteso: '', dal: 0 };

    function imposta(stato) {
      c.stato = stato;
      b.dataset.stato = stato;
      delete b.dataset.occupato;
      const nome = {
        pronto: t('voce_parla'), avvio: t('voce_parla'), ascolta: t('voce_ferma'),
        trascrive: t('voce_trascrivo'), attesa: t('voce_annulla_invio'),
      }[stato];
      const tasto = stato === 'attesa' ? 'Esc' : stato === 'trascrive' ? '' : TASTO;
      b.title = tasto ? conTasto(nome, tasto) : nome;
      b.setAttribute('aria-label', nome);
      b.setAttribute('aria-pressed', stato === 'ascolta' ? 'true' : 'false');
      if (stato !== 'ascolta') b.style.removeProperty('--sn-voce-livello');
    }
    imposta('pronto');

    // La voce entra dove sta il cursore, staccata da quello che c'è intorno.
    function inserisci(testo) {
      if (!campo.isConnected) return;
      const v = campo.value;
      let da = campo.selectionStart;
      let a = campo.selectionEnd;
      if (typeof da !== 'number' || typeof a !== 'number') { da = v.length; a = v.length; }
      const prima = v.slice(0, da);
      const dopo = v.slice(a);
      const pezzo = (prima && !/\s$/.test(prima) ? ' ' : '') + testo + (dopo && !/^\s/.test(dopo) ? ' ' : '');
      campo.setRangeText(pezzo, da, a, 'end');
      // La chat ricalcola altezza e colori come per un tasto premuto; questo evento non è un tocco dell'utente.
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    }

    async function ascolta() {
      const Ascolto = global.SN_ASCOLTO;
      if (!Ascolto) return;
      const giro = ++c.giro;
      imposta('avvio');
      c.toccato = false;
      if (document.activeElement !== campo) caretInFondo(campo);
      c.daSolo = await impostazioneFresca();
      if (giro !== c.giro) return;
      const sessione = await Ascolto.avvia({
        fineDaSola: FINE,
        suLivello: (v) => {
          if (giro !== c.giro) return;
          // La chat è sparita (l'Aiuto chiuso, il modulo tolto): il microfono non resta acceso per nessuno.
          if (!campo.isConnected) { if (c.sessione) c.sessione.ferma('annulla'); return; }
          b.style.setProperty('--sn-voce-livello', Number(v || 0).toFixed(2));
        },
        suFrase: (testo) => { if (giro === c.giro) inserisci(testo); },
        suStato: (st) => { if (giro === c.giro && st === 'trascrive' && c.stato === 'ascolta') imposta('trascrive'); },
        suFine: (esito) => finito(giro, esito),
      });
      if (giro !== c.giro) { if (sessione) sessione.ferma('altro'); return; }
      if (!sessione) { imposta('pronto'); return; }
      c.sessione = sessione;
      if (c.stato === 'avvio') imposta('ascolta');
    }

    function finito(giro, esito) {
      if (giro !== c.giro) return;
      c.sessione = null;
      const parte = esito.frasi > 0 && !esito.errore && ['utente', 'finito', 'tempo'].includes(esito.motivo)
        && c.daSolo && !c.toccato && campo.isConnected && campo.value.trim();
      if (parte) { attendi(); return; }
      imposta('pronto');
      if (esito.frasi > 0 && campo.isConnected) caretInFondo(campo);
    }

    function attendi() {
      imposta('attesa');
      caretInFondo(campo);
      c.atteso = campo.value;
      c.dal = Date.now();
      c.timer = setInterval(controlla, 100);
    }
    // Ogni decimo di secondo: se la casella è cambiata (inviata a mano, corretta) l'attesa finisce senza inviare.
    function controlla() {
      if (c.stato !== 'attesa') { smetti(); return; }
      if (!campo.isConnected || campo.value !== c.atteso || !campo.value.trim()) { smetti(); imposta('pronto'); return; }
      if (Date.now() - c.dal < ATTESA_MS) return;
      if (typeof occupato === 'function' && occupato()) { b.dataset.occupato = '1'; return; }
      smetti();
      imposta('pronto');
      try { invia(); } catch (e) { console.error('[Filo voce]', e); }
    }
    function smetti() {
      if (c.timer) clearInterval(c.timer);
      c.timer = 0;
    }
    function annullaInvio() {
      smetti();
      imposta('pronto');
      caretInFondo(campo);
    }

    function premi() {
      if (c.stato === 'pronto') { ascolta(); return; }
      if (c.stato === 'ascolta' && c.sessione) { c.sessione.ferma('utente'); return; }
      if (c.stato === 'attesa') annullaInvio();
    }
    // Esc tiene quello che è stato detto e non invia.
    function esc() {
      if (c.stato === 'ascolta' && c.sessione) { c.toccato = true; c.sessione.ferma('utente'); return true; }
      if (c.stato === 'attesa') { annullaInvio(); return true; }
      return false;
    }

    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      // Il clic è del microfono: il riquadro che lo contiene (un modulo dell'Editor) non lo prende per sé.
      e.preventDefault();
      e.stopPropagation();
      premi();
    });
    const suInput = (e) => {
      if (!e.isTrusted) return;
      c.toccato = true;
      if (c.stato === 'attesa') annullaInvio();
    };
    campo.addEventListener('input', suInput);
    const suTasto = (e) => {
      if (!e.isTrusted) return;
      // Invio a mano (la chat l'ha già preso): manda da sé quello che c'è, l'attesa finisce, e quello che si
      // stava ancora dicendo resta nella casella invece di partire dopo come un secondo messaggio.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target === campo) {
        if (c.stato === 'attesa') { smetti(); imposta('pronto'); }
        if (c.stato === 'ascolta' && c.sessione) { c.toccato = true; c.sessione.ferma('utente'); }
        return;
      }
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        if (esc()) { e.preventDefault(); e.stopPropagation(); }
        return;
      }
      if (!global.SN_TASTI || !global.SN_TASTI.combacia(e, TASTO)) return;
      // Nella pagina intera vale solo se il fuoco non sta scrivendo in un'altra casella.
      const dove = e.target;
      if (dove !== campo && dove && dove.nodeType === 1
        && (dove.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(dove.tagName))) return;
      e.preventDefault();
      e.stopPropagation();
      premi();
    };
    const doveTasti = ambito || campo;
    doveTasti.addEventListener('keydown', suTasto);

    function scollega() {
      c.giro++;
      smetti();
      if (c.sessione) { c.sessione.ferma('altro'); c.sessione = null; }
      campo.removeEventListener('input', suInput);
      doveTasti.removeEventListener('keydown', suTasto);
      b.remove();
      controlli.delete(c);
    }

    c.premi = premi;
    c.api = { bottone: b, premi, scollega, stato: () => c.stato };
    controlli.add(c);
    return c.api;
  }

  // Il tasto destro sul microfono (pagine di Filo, letto da src/content/content.js): parla, e come finire.
  function vociMenu(target) {
    const el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    if (!el) return [];
    let c = null;
    for (const x of controlli) if (x.bottone.isConnected && x.bottone.contains(el)) c = x;
    if (!c) return [];
    const segno = (si) => (si ? '✓ ' : '   ');
    const voce = c.stato === 'ascolta' ? t('voce_ferma') : c.stato === 'attesa' ? t('voce_annulla_invio') : t('voce_parla');
    return [
      { type: 'item', label: voce, shortcut: c.stato === 'attesa' ? 'Esc' : etichettaTasto(), onClick: () => c.premi() },
      { type: 'item', label: segno(invioDaSolo) + t('voce_invia_da_solo'), onClick: () => salvaInvio(true) },
      { type: 'item', label: segno(!invioDaSolo) + t('voce_lascia_testo'), onClick: () => salvaInvio(false) },
    ];
  }
  global.SN_VOCI_PAGINA = Array.isArray(global.SN_VOCI_PAGINA) ? global.SN_VOCI_PAGINA : [];
  if (!global.SN_VOCI_PAGINA.includes(vociMenu)) global.SN_VOCI_PAGINA.push(vociMenu);

  global.SN_VOCE_CHAT = {
    collega,
    gestisce: (el) => Boolean(el && perCampo(el)),
    premi: (el) => { const c = perCampo(el); if (c) c.premi(); },
    etichettaTasto,
    TASTO, ATTESA_MS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

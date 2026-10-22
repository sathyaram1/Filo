// Scheda «In pausa» di Gestione (#1592): le levette «Bacheca aperta a tutti» e «Deck builder aperto a tutti».
// Legge e scrive solo attraverso il main, solo da owner; il Red Team, accanto, è di manageRedteam.js.
// Prove: tests/in-pausa.spec.mjs.

(function () {
  'use strict';

  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const GET = MSG.IN_PAUSA_GET || 'in_pausa_get';
  const SET = MSG.IN_PAUSA_SET || 'in_pausa_set';
  const root = document.getElementById('mgIpRoot');
  if (!root) return;

  // Come si dice ognuna, con l'effetto: chi la vede adesso. E la pagina che il tasto destro apre.
  const FUNZIONI = {
    bacheca: {
      url: 'filo://board/board.html', apri: 'Apri la Bacheca',
      soloOwner: 'Solo l’owner apre o mette in pausa la Bacheca.',
      aperta: 'Aperta: la vede chiunque usi Filo.',
      pausa: 'In pausa: la vedi solo tu. Gli altri trovano solo le segnalazioni che hanno mandato.',
      dopoAperta: 'Aperta: la vede chiunque usi Filo. Chi ha Filo già aperto la ritrova entro un quarto d’ora.',
      dopoPausa: 'In pausa: la vedi solo tu. Da chi ha Filo già aperto sparisce entro un quarto d’ora.',
      rimasta: (aperta) => `Salvataggio non riuscito: la Bacheca è rimasta ${aperta ? 'aperta a tutti' : 'in pausa'}.`,
    },
    mazzi: {
      url: 'filo://decks/decks.html', apri: 'Apri il Deck builder',
      soloOwner: 'Solo l’owner apre o mette in pausa il Deck builder.',
      aperta: 'Aperto: lo vede chiunque usi Filo.',
      pausa: 'In pausa: lo vedi solo tu. I mazzi di chi ne aveva restano sul suo computer.',
      dopoAperta: 'Aperto: lo vede chiunque usi Filo. Chi ha Filo già aperto lo ritrova entro un quarto d’ora.',
      dopoPausa: 'In pausa: lo vedi solo tu. Da chi ha Filo già aperto sparisce entro un quarto d’ora.',
      rimasta: (aperto) => `Salvataggio non riuscito: il Deck builder è rimasto ${aperto ? 'aperto a tutti' : 'in pausa'}.`,
    },
  };

  let owner = false;

  // Chiamato a ogni invio: le prove sostituiscono window.filo.message dopo il caricamento.
  function send(m) {
    if (window.filo && window.filo.message) return window.filo.message(m);
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) return chrome.runtime.sendMessage(m);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  const levette = Object.keys(FUNZIONI).map((chiave) => {
    const f = FUNZIONI[chiave];
    const lv = {
      chiave, f, aperto: false, letto: false, salva: false,
      blocco: root.querySelector(`[data-in-pausa="${chiave}"]`),
      sw: document.getElementById(`mgIpSwitch-${chiave}`),
      toggle: document.getElementById(`mgIpToggle-${chiave}`),
      stateEl: document.getElementById(`mgIpState-${chiave}`),
      msgEl: document.getElementById(`mgIpMsg-${chiave}`),
    };
    return lv.toggle ? lv : null;
  }).filter(Boolean);

  function dici(lv, testo, tipo) {
    lv.msgEl.textContent = testo || '';
    lv.msgEl.classList.toggle('mg-err', tipo === 'err');
  }

  // Lo stato si dice sempre con l'effetto: chi la vede, adesso.
  function frase(lv) {
    if (!owner) return lv.f.soloOwner;
    if (!lv.letto) return 'Non riesco a leggere l’interruttore: finché non torna, per tutti gli altri vale «in pausa».';
    return lv.aperto ? lv.f.aperta : lv.f.pausa;
  }

  function riflette(lv) {
    lv.toggle.checked = lv.aperto;
    lv.toggle.disabled = !owner || lv.salva;
    lv.stateEl.textContent = lv.aperto ? 'On' : 'Off';
    lv.sw.classList.toggle('mg-switch--disabled', !owner);
    lv.sw.classList.toggle('mg-rt-salva', lv.salva);
  }

  async function caricaUna(lv) {
    if (owner) {
      try {
        const r = await send({ type: GET, nome: lv.chiave });
        if (r && r.ok) { lv.aperto = r.openToAll === true; lv.letto = r.letto !== false; } else { lv.letto = false; }
      } catch (_) { lv.letto = false; }
    }
    if (lv.salva) return;
    riflette(lv);
    dici(lv, frase(lv));
  }

  async function carica() {
    try {
      const a = await send({ type: 'auth_status' });
      owner = !!(a && a.isAdmin);
    } catch (_) { owner = false; }
    await Promise.all(levette.map(caricaUna));
  }

  async function imposta(lv, voglio) {
    if (!owner || lv.salva) return;
    lv.salva = true;
    const prima = lv.aperto;
    lv.aperto = voglio;
    riflette(lv);
    dici(lv, 'Salvo…');
    try {
      const r = await send({ type: SET, nome: lv.chiave, openToAll: voglio });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'errore sconosciuto');
      lv.aperto = r.openToAll === true;
      lv.letto = true;
      lv.salva = false;
      riflette(lv);
      // Le altre installazioni lo rileggono da sole entro un quarto d'ora; questa subito.
      dici(lv, lv.aperto ? lv.f.dopoAperta : lv.f.dopoPausa);
    } catch (err) {
      // Non scritto = non cambiato: la levetta non deve dire il contrario.
      lv.aperto = prima;
      lv.salva = false;
      riflette(lv);
      dici(lv, lv.f.rimasta(prima), 'err');
      console.error('[manage] interruttore non salvato:', lv.chiave, err);
    }
  }

  for (const lv of levette) {
    lv.toggle.addEventListener('change', () => imposta(lv, lv.toggle.checked));
    // Tasto destro: lo stesso gesto, la pagina e la rilettura dal server.
    lv.blocco.addEventListener('contextmenu', (e) => {
      const menu = window.SN_MANAGE_MENU;
      if (!menu || !owner) return;
      e.preventDefault();
      menu.apri(e.clientX, e.clientY, [
        { testo: lv.aperto ? 'Metti in pausa' : 'Apri a tutti', azione: () => imposta(lv, !lv.aperto) },
        { testo: lv.f.apri, azione: () => { send({ type: MSG.OPEN_URL || 'open_url', url: lv.f.url }).catch(() => {}); } },
        { testo: 'Rileggi dal server', titolo: 'Se l’hai cambiato da un’altra installazione', azione: () => { caricaUna(lv); } },
      ]);
    });
  }

  // Si rilegge a ogni apertura della scheda, e quando chi guarda entra o esce.
  document.addEventListener('mg-scheda', (e) => { if (e.detail && e.detail.tab === 'stats') carica(); });
  if (window.filo && window.filo.onBroadcast) {
    window.filo.onBroadcast((m) => { if (m && m.type === (MSG.AUTH_CHANGED || 'auth_changed')) carica(); });
  }

  window.__mgInPausa = { carica };
  carica();
})();

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

  // Come si dice ognuna: il nome per le frasi e la pagina che il tasto destro apre.
  const FUNZIONI = {
    bacheca: { nome: 'la Bacheca', aperta: 'Aperta', pausa: 'In pausa', url: 'filo://board/board.html',
      altri: 'gli altri trovano solo le loro segnalazioni' },
    mazzi: { nome: 'il Deck builder', aperta: 'Aperto', pausa: 'In pausa', url: 'filo://decks/decks.html',
      altri: 'gli altri non lo trovano da nessuna parte' },
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
    if (!owner) return `Solo l’owner apre o mette in pausa ${lv.f.nome}.`;
    if (!lv.letto) return 'Non riesco a leggere l’interruttore: finché non torna, per tutti gli altri vale «in pausa».';
    return lv.aperto ? `${lv.f.aperta}: lo vede chiunque usi Filo.` : `${lv.f.pausa}: lo vedi solo tu, ${lv.f.altri}.`;
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
      dici(lv, lv.aperto
        ? `${lv.f.aperta}: lo vede chiunque usi Filo. Chi ha Filo già aperto lo ritrova entro un quarto d’ora.`
        : `${lv.f.pausa}: lo vedi solo tu. Da chi ha Filo già aperto sparisce entro un quarto d’ora.`);
    } catch (err) {
      // Non scritto = non cambiato: la levetta non deve dire il contrario.
      lv.aperto = prima;
      lv.salva = false;
      riflette(lv);
      dici(lv, `Salvataggio non riuscito: ${lv.f.nome} è rimast${lv.chiave === 'bacheca' ? 'a' : 'o'} ${prima ? 'aperto a tutti' : 'in pausa'}.`
        .replace('aperto a tutti', lv.chiave === 'bacheca' ? 'aperta a tutti' : 'aperto a tutti'), 'err');
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
        { testo: `Apri ${lv.f.nome.replace(/^(la|il) /, '')}`, azione: () => { send({ type: MSG.OPEN_URL || 'open_url', url: lv.f.url }).catch(() => {}); } },
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

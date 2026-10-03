// Scheda Red Team di Gestione (#896): l'interruttore «Red Team aperto a tutti» (config/redteam.openToAll).
// Legge e scrive solo attraverso il main, solo da owner. Prove: tests/redteam-pausa.spec.mjs.

(function () {
  'use strict';

  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const GET = MSG.REDTEAM_OPEN_GET || 'redteam_open_get';
  const SET = MSG.REDTEAM_OPEN_SET || 'redteam_open_set';
  const $ = (id) => document.getElementById(id);
  const root = $('mgRtRoot');
  const sw = $('mgRtOpenSwitch');
  const toggle = $('mgRtOpenToggle');
  const stateEl = $('mgRtOpenState');
  const msgEl = $('mgRtOpenMsg');
  if (!root || !toggle) return;

  let owner = false;
  let aperto = false;
  let letto = false;
  let salva = false;

  // Chiamato a ogni invio: le prove sostituiscono window.filo.message dopo il caricamento.
  function send(m) {
    if (window.filo && window.filo.message) return window.filo.message(m);
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) return chrome.runtime.sendMessage(m);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  function dici(testo, tipo) {
    msgEl.textContent = testo || '';
    msgEl.classList.toggle('mg-err', tipo === 'err');
  }

  // Lo stato si dice sempre con l'effetto: chi lo vede, adesso.
  function frase() {
    if (!owner) return 'Solo l’owner apre o mette in pausa il Red Team.';
    if (!letto) return 'Non riesco a leggere l’interruttore: finché non torna, per tutti gli altri vale «in pausa».';
    return aperto ? 'Aperto: lo vede chiunque usi Filo.' : 'In pausa: lo vedi solo tu.';
  }

  function riflette() {
    toggle.checked = aperto;
    toggle.disabled = !owner || salva;
    stateEl.textContent = aperto ? 'On' : 'Off';
    sw.classList.toggle('mg-switch--disabled', !owner);
    sw.classList.toggle('mg-rt-salva', salva);
  }

  async function carica() {
    try {
      const a = await send({ type: 'auth_status' });
      owner = !!(a && a.isAdmin);
    } catch (_) { owner = false; }
    if (owner) {
      try {
        const r = await send({ type: GET });
        if (r && r.ok) { aperto = r.openToAll === true; letto = r.letto !== false; } else { letto = false; }
      } catch (_) { letto = false; }
    }
    riflette();
    dici(frase());
  }

  async function imposta(voglio) {
    if (!owner || salva) return;
    salva = true;
    const prima = aperto;
    aperto = voglio;
    riflette();
    dici('Salvo…');
    try {
      const r = await send({ type: SET, openToAll: voglio });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'errore sconosciuto');
      aperto = r.openToAll === true;
      letto = true;
      salva = false;
      riflette();
      // Le altre installazioni lo rileggono da sole; il server applica la scelta subito.
      dici(aperto
        ? 'Aperto: lo vede chiunque usi Filo. Chi ha Filo già aperto lo ritrova entro un quarto d’ora.'
        : 'In pausa: lo vedi solo tu. Il server rifiuta già gli invii degli altri; l’icona sparisce entro un quarto d’ora.');
    } catch (err) {
      // Non scritto = non cambiato: la levetta non deve dire il contrario.
      aperto = prima;
      salva = false;
      riflette();
      dici('Salvataggio non riuscito: il Red Team è rimasto ' + (prima ? 'aperto a tutti.' : 'in pausa.'), 'err');
      console.error('[manage] interruttore Red Team non salvato:', err);
    }
  }

  toggle.addEventListener('change', () => imposta(toggle.checked));

  // Tasto destro: lo stesso gesto, la pagina e la rilettura dal server.
  root.addEventListener('contextmenu', (e) => {
    const menu = window.SN_MANAGE_MENU;
    if (!menu || !owner) return;
    e.preventDefault();
    menu.apri(e.clientX, e.clientY, [
      { testo: aperto ? 'Metti in pausa' : 'Apri a tutti', azione: () => imposta(!aperto) },
      { testo: 'Apri la pagina del Red Team', azione: () => { send({ type: MSG.OPEN_URL || 'open_url', url: 'filo://redteam/redteam.html' }).catch(() => {}); } },
      { testo: 'Rileggi dal server', titolo: 'Se l’hai cambiato da un’altra installazione', azione: () => { carica(); } },
    ]);
  });

  // Si rilegge a ogni apertura della scheda, e quando chi guarda entra o esce.
  const tab = document.querySelector('.mg-tab[data-tab="stats"]');
  if (tab) tab.addEventListener('click', () => { carica(); });
  if (window.filo && window.filo.onBroadcast) {
    window.filo.onBroadcast((m) => { if (m && m.type === (MSG.AUTH_CHANGED || 'auth_changed')) carica(); });
  }

  window.__mgRedteam = { carica };
  carica();
})();

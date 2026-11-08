// Scheda Red Team di Gestione: l'interruttore «Red Team aperto a tutti» (#896) e i tetti dell'invio con la stima (#2296).
// Legge e scrive solo attraverso il main, solo da owner. Prove: tests/redteam-pausa.spec.mjs, tests/redteam-tetti.spec.mjs.

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
    caricaTetti();
  }

  // ── I tetti dell'invio (#2296) ─────────────────────────────────────────────
  // Numeri, intervalli e token di un tentativo li dice il server; qui il prezzo del listino e la cifra accanto al campo.
  const LIMITI = MSG.REDTEAM_LIMITI || 'redteam_limiti';
  const STIMA = MSG.STIMA_COSTO_MODELLI || 'stima_costo_modelli';
  const tetti = new Map(); // chiave → { blocco, input, stimaEl, campo }
  root.querySelectorAll('.mg-rt-tetto[data-tetto]').forEach((blocco) => {
    tetti.set(blocco.dataset.tetto, {
      blocco,
      input: blocco.querySelector('input'),
      stimaEl: blocco.querySelector('[data-tetto-stima]'),
      campo: null,
    });
  });
  let limiti = null; // l'ultima risposta del server
  let listino; // undefined = in lettura, null = non letto

  const dollari = (v) => (v < 0.01 ? 'meno di 0,01 $'
    : `${v.toLocaleString('it-IT', { minimumFractionDigits: v < 10 ? 2 : 0, maximumFractionDigits: v < 10 ? 2 : 0 })} $`);

  // Un tentativo lungo al massimo: la somma delle sue chiamate ai modelli, e i modelli senza prezzo nel listino.
  function costoTentativo() {
    const S = window.SN_STIMA_COSTO;
    let usd = 0;
    const senzaPrezzo = [];
    for (const c of (limiti && limiti.chiamate) || []) {
      const v = S && listino ? S.costoUsd(S.prezzoDi(listino, c.model), { prompt: c.prompt, completion: c.completion }) : null;
      if (v == null) senzaPrezzo.push(c.model); else usd += v;
    }
    return { usd, senzaPrezzo };
  }

  // La cifra per il numero scritto nel campo, anche prima di salvarlo: chi cambia il tetto legge cosa compra.
  function stima(chiave) {
    const t = tetti.get(chiave);
    if (!t || !t.stimaEl || !limiti) return;
    t.stimaEl.title = '';
    if (listino === undefined) { t.stimaEl.textContent = 'Sto leggendo il listino di OpenRouter…'; return; }
    if (!listino) { t.stimaEl.textContent = 'Senza il listino di OpenRouter la stima non c’è.'; return; }
    const n = Number(t.input.value);
    if (!Number.isInteger(n) || n < 1) { t.stimaEl.textContent = ''; return; }
    const { usd, senzaPrezzo } = costoTentativo();
    const giorno = n * usd;
    t.stimaEl.textContent = (chiave === 'globalDay'
      ? `Al tetto, fino a circa ${dollari(giorno)} al giorno e ${dollari(giorno * 30)} al mese.`
      : `Un account al tetto, fino a circa ${dollari(giorno)} al giorno.`)
      + (senzaPrezzo.length ? ` Per difetto: manca il prezzo di ${senzaPrezzo.join(', ')}.` : '');
    t.stimaEl.title = `Tentativi lunghi al massimo (${Number(limiti.maxAttackChars).toLocaleString('it-IT')} caratteri), `
      + `${(limiti.chiamate || []).length} chiamate ai modelli: circa ${dollari(usd)} a tentativo coi prezzi di OpenRouter. `
      + 'Il tetto non cambia i tempi di risposta.';
  }
  function stime() { for (const k of tetti.keys()) stima(k); }

  async function salvaTetto(chiave, valore) {
    let r = null;
    try { r = await send({ type: LIMITI, [chiave]: valore }); } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
    if (!r || r.ok === false) return { ok: false, errore: String((r && r.error) || 'il server non ha risposto').replace(/\.\s*$/, '') };
    limiti = r;
    stime();
    return { ok: true, valore: r[chiave] };
  }

  async function leggiListino() {
    try {
      const r = await send({ type: STIMA });
      listino = r && r.ok && r.contesto && r.contesto.listino ? r.contesto.listino : null;
    } catch (_) { listino = null; }
    stime();
  }

  async function caricaTetti() {
    if (!owner) { for (const t of tetti.values()) t.blocco.hidden = true; return; }
    let r = null;
    try { r = await send({ type: LIMITI }); } catch (_) { r = null; }
    if (!r || r.ok === false) {
      // Il campo resta, spento: un tetto che sparisce sembrerebbe un tetto che non c'è.
      const perche = `Non letto: ${String((r && r.error) || 'il server non ha risposto').replace(/\.\s*$/, '')}.`;
      for (const t of tetti.values()) {
        if (!t.campo) t.input.disabled = true;
        t.stimaEl.textContent = perche;
        t.stimaEl.title = '';
        t.blocco.hidden = false;
      }
      return;
    }
    limiti = r;
    for (const [chiave, t] of tetti) {
      const regole = r.regole && r.regole[chiave];
      if (!regole || !t.input) continue;
      t.input.disabled = false;
      if (!t.campo && window.SN_CAMPO_NUMERO) {
        t.campo = window.SN_CAMPO_NUMERO.collega({
          input: t.input,
          salvaBtn: t.blocco.querySelector('[data-tetto-salva]'),
          rimetti: t.blocco.querySelector('[data-tetto-rimetti]'),
          msg: t.blocco.querySelector('[data-tetto-msg]'),
          regole: { min: regole.min, max: regole.max, intero: true, etichetta: regole.etichetta },
          salva: (valore) => salvaTetto(chiave, valore),
        });
        t.input.addEventListener('input', () => stima(chiave));
      }
      // Un numero scritto e non ancora partito resta sotto le dita di chi lo scrive.
      if (t.campo && t.campo.stato().pulito) t.campo.mostra(r[chiave], { daCapo: true });
      t.blocco.hidden = false;
    }
    stime();
    if (!listino) leggiListino();
  }

  async function tettiDiFabbrica() {
    if (!limiti || !limiti.regole) return;
    const fabbrica = {};
    for (const k of tetti.keys()) if (limiti.regole[k]) fabbrica[k] = limiti.regole[k].fabbrica;
    const r = await send({ type: LIMITI, ...fabbrica }).catch((e) => ({ ok: false, error: e && e.message }));
    if (!r || r.ok === false) { dici(`Tetti non rimessi: ${(r && r.error) || 'il server non ha risposto'}`, 'err'); return; }
    limiti = r;
    for (const [k, t] of tetti) if (t.campo) t.campo.mostra(r[k], { daCapo: true });
    stime();
    dici('Tetti di fabbrica rimessi.');
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
    ].concat(limiti && limiti.regole ? [
      { testo: 'Rimetti i tetti di fabbrica', titolo: 'Tentativi al giorno per account e in tutto', azione: () => { tettiDiFabbrica(); } },
    ] : []));
  });

  // Si rilegge a ogni apertura della scheda, e quando chi guarda entra o esce.
  document.addEventListener('mg-scheda', (e) => { if (e.detail && e.detail.tab === 'stats') carica(); });
  if (window.filo && window.filo.onBroadcast) {
    window.filo.onBroadcast((m) => { if (m && m.type === (MSG.AUTH_CHANGED || 'auth_changed')) carica(); });
  }

  window.__mgRedteam = { carica, tettiDiFabbrica };
  carica();
})();

// Gestione → Automazioni: il recap del manutentore, un foglio al giorno, e la sua N accanto al freno d'emergenza
// (SPEC-MANUTENTORE § 2, § 9). Sola lettura, solo owner, attraverso il main (ownerManutentore). Il recap è testo scritto
// leggendo testo di chiunque: entra solo come textContent. Prove: tests/manage-recap.spec.mjs.

(function () {
  'use strict';

  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const GET = MSG.MANUTENTORE_RECAP_GET || 'manutentore_recap_get';
  const $ = (id) => document.getElementById(id);
  const blocco = $('mgRecap');
  if (!blocco) return;
  const testo = $('mgRecapTesto');
  const giorno = $('mgRecapGiorno');
  const prima = $('mgRecapPrima');
  const dopo = $('mgRecapDopo');
  const msg = $('mgRecapMsg');
  const nRiga = $('mgManutentoreN');

  let owner = false;
  // Dal più nuovo: l'indice 0 è l'ultimo foglio, quello che si apre.
  let fogli = [];
  let qui = 0;
  let errore = '';
  let tick = 0;

  function send(m) {
    if (window.filo && window.filo.message) return window.filo.message(m);
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) return chrome.runtime.sendMessage(m);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  const FMT = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  function nomeGiorno(g) {
    const ms = Date.parse(`${g}T12:00:00Z`);
    if (!Number.isFinite(ms)) return g;
    const oggi = new Date();
    const chiave = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (g === chiave(oggi)) return 'oggi';
    const ieri = new Date(oggi); ieri.setDate(ieri.getDate() - 1);
    if (g === chiave(ieri)) return 'ieri';
    return FMT.format(new Date(ms));
  }

  function rifletti() {
    blocco.hidden = !owner;
    if (!owner) { if (nRiga) nRiga.textContent = ''; return; }
    const f = fogli[qui] || null;
    testo.textContent = f ? f.testo : '';
    giorno.textContent = f ? nomeGiorno(f.giorno) : '';
    giorno.title = f ? f.giorno : '';
    prima.disabled = qui >= fogli.length - 1;
    dopo.disabled = qui <= 0;
    msg.textContent = errore ? `Non ho potuto leggere il recap: ${errore}` : (fogli.length ? '' : 'Nessun recap ancora: il manutentore lo scrive ogni mattina.');
    msg.classList.toggle('is-error', !!errore);
  }

  function rigaN(stato) {
    if (!nRiga) return;
    if (!owner || !stato) { nRiga.textContent = ''; return; }
    const n = stato.parallelismoEffettivo;
    nRiga.textContent = Number.isInteger(stato.parallelismo)
      ? `Il manutentore ne fa lavorare ${n} insieme.`
      : `Il manutentore non ha scelto quante: ne lavorano fino a ${n}.`;
  }

  async function carica() {
    try {
      const a = await send({ type: 'auth_status' });
      owner = !!(a && a.isAdmin);
    } catch (_) { owner = false; }
    if (!owner) { fogli = []; errore = ''; rifletti(); return; }
    const nato = ++tick;
    let r = null;
    try { r = await send({ type: GET }); } catch (e) { r = { ok: false, error: (e && e.message) || 'canale giù' }; }
    if (nato !== tick) return;
    if (!r || !r.ok) {
      errore = String((r && r.error) || 'nessuna risposta');
      rigaN(null);
    } else {
      const giornoAperto = fogli[qui] && fogli[qui].giorno;
      errore = '';
      fogli = (Array.isArray(r.recap) ? r.recap : []).filter((f) => f && typeof f.testo === 'string' && f.giorno)
        .sort((x, y) => String(y.giorno).localeCompare(String(x.giorno)));
      // Una rilettura resta sul giorno che si stava leggendo.
      const i = giornoAperto ? fogli.findIndex((f) => f.giorno === giornoAperto) : -1;
      qui = i >= 0 ? i : 0;
      rigaN(r.stato || null);
    }
    rifletti();
  }

  prima.addEventListener('click', () => { if (qui < fogli.length - 1) { qui += 1; rifletti(); } });
  dopo.addEventListener('click', () => { if (qui > 0) { qui -= 1; rifletti(); } });

  blocco.addEventListener('contextmenu', (e) => {
    const menu = window.SN_MANAGE_MENU;
    if (!menu || !owner) return;
    e.preventDefault();
    const f = fogli[qui];
    const voci = [];
    if (f) {
      voci.push({ testo: 'Copia il recap', azione: () => { navigator.clipboard?.writeText(`${f.giorno}\n\n${f.testo}`).catch(() => {}); } });
      // La selezione vince sul foglio intero: si copia quello che si è scelto.
      const sel = String(window.getSelection ? window.getSelection() : '').trim();
      if (sel) voci.unshift({ testo: 'Copia la selezione', azione: () => { navigator.clipboard?.writeText(sel).catch(() => {}); } });
    }
    if (qui !== 0 && fogli.length) voci.push({ testo: 'Torna all’ultimo', azione: () => { qui = 0; rifletti(); } });
    voci.push({ testo: 'Rileggi dal server', azione: () => { carica(); } });
    menu.apri(e.clientX, e.clientY, voci);
  });

  document.addEventListener('mg-scheda', (e) => { if (e.detail && e.detail.tab === 'automation') carica(); });
  if (window.filo && window.filo.onBroadcast) {
    window.filo.onBroadcast((m) => { if (m && m.type === (MSG.AUTH_CHANGED || 'auth_changed')) carica(); });
  }

  window.__mgManutentore = { carica };
  rifletti();
  if (document.querySelector('.mg-tab[data-tab="automation"].mg-tab--active')) carica();
})();

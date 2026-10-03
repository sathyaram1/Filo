// Ora, batteria, rete e Bluetooth in fondo alla colonna destra della home (#873).
// Non legge il computer (lo fa il main) e non sceglie le parole (src/shared/sistema.js): disegna, e si aggiorna senza
// rifare i nodi. Al caricamento registra e basta; il DOM lo tocca init().
(function (global) {
  'use strict';

  const ORDINE = ['ora', 'batteria', 'rete', 'bluetooth'];
  const NOMI = { ora: "l'ora", batteria: 'la batteria', rete: 'la rete', bluetooth: 'il Bluetooth' };
  // Il main legge finché qualcuno chiede: una home in vista chiede più spesso di quanto il lettore si addormenti.
  const RICHIAMO_MS = 30 * 1000;
  const ICONA_PX = 16;

  let send = null;
  let MSG = null;
  let host = null;
  let riga = null;
  let ICONS = {};
  let stato = null;
  let visibili = { ora: true, batteria: true, rete: true, bluetooth: true };
  const voci = {};
  let box = null;
  let richiamo = null;
  let tickOra = null;

  const Sis = () => global.SN_SISTEMA;
  const descrizione = () => Sis().descrivi(stato, new Date());

  function init(deps) {
    send = deps.send;
    MSG = deps.MSG;
    host = deps.host;
    ICONS = deps.ICONS || {};
    // L'ora sopra, grande; sotto la riga delle icone, che in una colonna stretta va a capo da sola.
    riga = document.createElement('div');
    riga.className = 'dash-sis-icone';
    for (const v of ORDINE) voci[v] = creaVoce(v);
    disegna();
    chiedi();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { disegna(); chiedi(); }
      programmaRichiamo();
    });
    // Il browser se ne accorge per primo: il main rilegge subito invece di aspettare il suo giro.
    window.addEventListener('online', chiedi);
    window.addEventListener('offline', chiedi);
    programmaRichiamo();
    programmaOra();
  }

  async function chiedi() {
    let r = null;
    try { r = await send({ type: MSG.SISTEMA_STATO }); } catch (_) {}
    if (r && r.ok && r.stato) aggiornato(r.stato);
  }

  function programmaRichiamo() {
    if (richiamo) clearInterval(richiamo);
    richiamo = document.visibilityState === 'hidden' ? null : setInterval(chiedi, RICHIAMO_MS);
  }

  // L'ora cambia al minuto pieno, non un minuto dopo l'apertura della scheda.
  function programmaOra() {
    if (tickOra) clearTimeout(tickOra);
    const adesso = new Date();
    const mancano = (60 - adesso.getSeconds()) * 1000 - adesso.getMilliseconds() + 50;
    tickOra = setTimeout(() => { disegna(); programmaOra(); }, mancano);
  }

  function aggiornato(nuovo) {
    stato = nuovo && typeof nuovo === 'object' ? nuovo : null;
    disegna();
  }

  function applicaImpostazioni(settings) {
    visibili = Sis().vociVisibili(settings);
    disegna();
  }

  function creaVoce(v) {
    const el = document.createElement('div');
    el.className = 'dash-sis-voce';
    el.dataset.voce = v;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.draggable = true;
    el.hidden = true;
    const icona = document.createElement('span');
    icona.className = 'dash-sis-icona';
    const testo = document.createElement('span');
    testo.className = 'dash-sis-testo';
    el.append(icona, testo);
    el.addEventListener('click', () => apriBox(v, el));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      apriBox(v, el, { x: e.clientX, y: e.clientY });
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        apriBox(v, el);
      }
    });
    // Trascinata in una chat, la voce porta la sua frase: «Batteria al 42%, in carica».
    el.addEventListener('dragstart', (e) => {
      const d = descrizione()[v];
      if (!d || !e.dataTransfer) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', d.copia);
      e.dataTransfer.effectAllowed = 'copy';
    });
    if (v === 'ora') host.append(el, riga);
    else riga.appendChild(el);
    return { el, icona, testo, chiaveIcona: null };
  }

  function svgDi(d) {
    const f = ICONS[d.icona];
    if (typeof f !== 'function') return '';
    return d.icona === 'battery' ? f(ICONA_PX, d.livello) : f(ICONA_PX);
  }

  function disegna() {
    if (!host) return;
    const d = descrizione();
    let qualcuna = false;
    let icone = false;
    for (const v of ORDINE) {
      const x = d[v];
      const voce = voci[v];
      const mostra = !!x && visibili[v] !== false;
      if (voce.el.hidden !== !mostra) voce.el.hidden = !mostra;
      if (!mostra) continue;
      qualcuna = true;
      if (v !== 'ora') icone = true;
      const chiave = x.icona ? `${x.icona}:${x.livello == null ? '' : x.livello}` : '';
      if (voce.chiaveIcona !== chiave) {
        voce.icona.innerHTML = x.icona ? svgDi(x) : '';
        voce.chiaveIcona = chiave;
      }
      if (voce.testo.textContent !== x.testo) voce.testo.textContent = x.testo;
      voce.testo.hidden = !x.testo;
      voce.el.title = x.hover;
      voce.el.setAttribute('aria-label', x.dettaglio.join(', '));
      voce.el.dataset.stato = x.offline ? 'offline' : x.bassa ? 'bassa' : x.spento ? 'spento' : '';
    }
    host.hidden = !qualcuna;
    riga.hidden = !icone;
    if (box) aggiornaBox(d);
  }

  // ── Il riquadro della voce: tasto destro, clic, Invio. Dice tutto quello che la voce sa, e la toglie ──

  function chiudiBox() {
    if (!box) return;
    box.el.remove();
    box = null;
    document.removeEventListener('mousedown', fuori, true);
    document.removeEventListener('keydown', tasto, true);
    window.removeEventListener('scroll', chiudiBox, true);
    window.removeEventListener('resize', chiudiBox);
  }
  function fuori(e) { if (box && !box.el.contains(e.target)) chiudiBox(); }
  function tasto(e) {
    if (!box) return;
    if (e.key === 'Escape') { e.preventDefault(); const da = box.ancora; chiudiBox(); if (da && da.isConnected) da.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const opzioni = [...box.el.querySelectorAll('.sn-select-option')];
    if (!opzioni.length) return;
    e.preventDefault();
    const i = opzioni.indexOf(document.activeElement);
    const passo = e.key === 'ArrowDown' ? 1 : -1;
    opzioni[(i + passo + opzioni.length) % opzioni.length].focus();
  }

  function righeInfo(contenitore, d) {
    contenitore.replaceChildren(...d.dettaglio.map((r) => {
      const riga = document.createElement('div');
      riga.textContent = r;
      return riga;
    }));
  }

  function aggiornaBox(d) {
    const x = d[box.voce];
    if (!x || visibili[box.voce] === false) { chiudiBox(); return; }
    const testo = x.dettaglio.join('\n');
    if (box.info.dataset.testo !== testo) {
      righeInfo(box.info, x);
      box.info.dataset.testo = testo;
    }
    box.copia = x.copia;
  }

  function imposta(voce, mostra) {
    visibili = { ...visibili, [voce]: mostra };
    disegna();
    send({ type: MSG.UPDATE_SETTINGS, settings: { homeSistema: { [voce]: mostra } } }).catch(() => {});
  }

  async function copia(opt) {
    try { await navigator.clipboard.writeText(box ? box.copia : ''); } catch (_) { chiudiBox(); return; }
    opt.textContent = 'Copiato';
    setTimeout(chiudiBox, 700);
  }

  function apriBox(v, ancora, punto) {
    chiudiBox();
    const d = descrizione();
    const x = d[v];
    if (!x) return;
    const el = document.createElement('div');
    el.className = 'sn-select-pop dash-sis-box';
    el.setAttribute('role', 'menu');
    el.dataset.voce = v;
    const info = document.createElement('div');
    info.className = 'dash-sis-info';
    righeInfo(info, x);
    info.dataset.testo = x.dettaglio.join('\n');
    el.appendChild(info);
    const azioni = [['Copia', (opt) => copia(opt)], [`Nascondi ${NOMI[v]}`, () => { chiudiBox(); imposta(v, false); }]];
    for (const altra of ORDINE) {
      if (altra !== v && visibili[altra] === false && d[altra]) {
        azioni.push([`Mostra ${NOMI[altra]}`, () => { chiudiBox(); imposta(altra, true); }]);
      }
    }
    for (const [etichetta, fn] of azioni) {
      const opt = document.createElement('div');
      opt.className = 'sn-select-option';
      opt.setAttribute('role', 'menuitem');
      opt.tabIndex = 0;
      opt.textContent = etichetta;
      opt.addEventListener('click', () => fn(opt));
      opt.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(opt); }
      });
      el.appendChild(opt);
    }
    document.body.appendChild(el);
    posiziona(el, ancora, punto);
    box = { el, info, voce: v, ancora, copia: x.copia };
    setTimeout(() => {
      document.addEventListener('mousedown', fuori, true);
      document.addEventListener('keydown', tasto, true);
      window.addEventListener('scroll', chiudiBox, true);
      window.addEventListener('resize', chiudiBox);
    }, 0);
  }

  // Al clic il riquadro sale sopra la voce, che sta in fondo alla pagina; al tasto destro parte dal puntatore.
  function posiziona(el, ancora, punto) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x;
    let y;
    if (punto) {
      x = punto.x;
      y = punto.y + h > vh - 4 ? punto.y - h : punto.y;
    } else {
      const r = ancora.getBoundingClientRect();
      x = r.right - w;
      y = r.top - h - 6 >= 4 ? r.top - h - 6 : r.bottom + 6;
    }
    el.style.left = `${Math.max(4, Math.min(x, vw - w - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, vh - h - 4))}px`;
  }

  global.SN_DASH_SISTEMA = { init, aggiornato, applicaImpostazioni, chiudiBox };
})(typeof globalThis !== 'undefined' ? globalThis : self);

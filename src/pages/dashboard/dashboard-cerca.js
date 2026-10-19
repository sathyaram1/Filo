// Cercare nel filo dalla home senza passare dalla chat (#869): parole nei messaggi, nelle pagine visitate e nel contenuto
// delle schede chiuse. Un messaggio porta al suo punto del filo, una pagina si riapre. Cosa trova lo decide il main
// (src/shared/filoCoda.js); non tocca il DOM al caricamento.
(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  let d = null;
  let campo = null;
  let pannello = null;
  let giro = 0;
  let attesa = null;
  let voci = [];
  let scelta = -1;

  function icona(nome, size = 14) {
    const I = global.SN_ICONS;
    return I && typeof I[nome] === 'function' ? I[nome](size) : '';
  }
  function el(tag, cls, testo) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (testo != null) n.textContent = testo;
    return n;
  }
  function quando(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const giorno = global.SN_DASH_CODA ? global.SN_DASH_CODA.nomeDelGiorno(t) : '';
    const x = new Date(t);
    return `${giorno} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`.trim();
  }

  function chiudi({ svuota = false } = {}) {
    pannello.hidden = true;
    pannello.replaceChildren();
    voci = [];
    scelta = -1;
    campo.setAttribute('aria-expanded', 'false');
    if (svuota) campo.value = '';
  }

  function voce(r) {
    const b = el('button', `dash-cerca-voce dash-cerca-${r.k === 'pagina' ? 'pagina' : 'msg'}`);
    b.type = 'button';
    b.setAttribute('role', 'option');
    const ic = el('span', 'dash-cerca-ico');
    ic.innerHTML = icona(r.k === 'pagina' ? 'globe' : (r.role === 'user' ? 'user' : 'filoLogo'), 13);
    const corpo = el('span', 'dash-cerca-corpo');
    if (r.k === 'pagina') {
      corpo.append(el('span', 'dash-cerca-titolo', r.titolo || global.SN_FILO_CODA.sito(r.url)));
      corpo.append(el('span', 'dash-cerca-sotto', r.estratto || global.SN_FILO_CODA.sito(r.url)));
      b.title = r.url;
    } else {
      corpo.append(el('span', 'dash-cerca-titolo', r.testo));
      corpo.append(el('span', 'dash-cerca-sotto', r.role === 'user' ? 'tu' : 'Filo'));
    }
    b.append(ic, corpo, el('span', 'dash-cerca-quando', quando(r.ts)));
    b._risultato = r;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { apri(r).catch(() => {}); });
    return b;
  }

  async function apri(r) {
    if (r.k === 'pagina') {
      if (/^https?:\/\//i.test(String(r.url || ''))) d.send({ type: MSG.OPEN_URL, url: r.url });
      return;
    }
    chiudi();
    await d.coda.vaiA({ chat: r.chat, i: r.i, app: !!r.app, ts: r.ts });
  }

  async function togli(r) {
    const res = await d.send({ type: MSG.FILO_CODA_TOGLI_PAGINE, url: r.url });
    if (!res || !res.ok) return;
    if (d.coda.togliIndirizzo) d.coda.togliIndirizzo(r.url);
    if (!pannello.hidden) await cerca();
  }

  function disegna(res, q) {
    pannello.replaceChildren();
    const messaggi = Array.isArray(res.messaggi) ? res.messaggi : [];
    const pagine = Array.isArray(res.pagine) ? res.pagine : [];
    voci = [];
    scelta = -1;
    if (!messaggi.length && !pagine.length) {
      pannello.append(el('div', 'dash-cerca-niente', `Niente nel filo per «${q}»`));
    } else {
      for (const r of [...messaggi, ...pagine]) {
        const b = voce(r);
        voci.push(b);
        pannello.append(b);
      }
      const altri = (Number(res.tanti) || 0) - voci.length;
      if (altri > 0) pannello.append(el('div', 'dash-cerca-niente', `e altri ${altri}: aggiungi una parola per trovarli`));
    }
    pannello.hidden = false;
    campo.setAttribute('aria-expanded', 'true');
  }

  async function cerca() {
    const q = campo.value.trim();
    const mio = ++giro;
    if (q.length < 2) { chiudi(); return; }
    const res = await d.send({ type: MSG.FILO_CERCA, q });
    if (mio !== giro || !res || !res.ok) return;
    disegna(res, q);
  }

  function evidenzia(i) {
    if (!voci.length) return;
    scelta = (i + voci.length) % voci.length;
    voci.forEach((b, j) => b.classList.toggle('scelta', j === scelta));
    voci[scelta].scrollIntoView({ block: 'nearest' });
  }

  function vociMenu(target) {
    const e = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    const b = e && e.closest ? e.closest('.dash-cerca-voce') : null;
    if (!b || !b._risultato) return [];
    const r = b._risultato;
    if (r.k === 'pagina') {
      return [
        { type: 'item', icon: icona('globe', 16), label: 'Riapri la pagina', onClick: () => { apri(r).catch(() => {}); } },
        { type: 'item', icon: icona('copy', 16), label: 'Copia l’indirizzo', onClick: () => { navigator.clipboard.writeText(r.url).catch(() => {}); } },
        { type: 'item', icon: icona('trash', 16), label: 'Togli dal filo', onClick: () => { togli(r).catch(() => {}); } },
      ];
    }
    return [
      { type: 'item', icon: icona('filoLogo', 16), label: 'Vai a questo punto del filo', onClick: () => { apri(r).catch(() => {}); } },
      { type: 'item', icon: icona('copy', 16), label: 'Copia il testo', onClick: () => { navigator.clipboard.writeText(r.testo).catch(() => {}); } },
    ];
  }

  function init(deps) {
    d = deps;
    const host = deps.input;
    if (!host) return;
    const box = el('label', 'dash-cerca-campo');
    const ic = el('span', 'dash-cerca-lente');
    ic.innerHTML = icona('search', 14);
    campo = el('input', 'dash-cerca-input');
    campo.id = 'cercaInput';
    campo.type = 'search';
    campo.placeholder = 'Cerca nel filo';
    campo.autocomplete = 'off';
    campo.spellcheck = false;
    campo.setAttribute('aria-label', 'Cerca nel filo');
    campo.setAttribute('aria-expanded', 'false');
    box.append(ic, campo);
    pannello = el('div', 'dash-cerca-risultati');
    pannello.id = 'cercaRisultati';
    pannello.setAttribute('role', 'listbox');
    pannello.hidden = true;
    host.append(box, pannello);
    campo.addEventListener('input', () => {
      clearTimeout(attesa);
      attesa = setTimeout(() => { cerca().catch(() => {}); }, 180);
    });
    campo.addEventListener('focus', () => { if (campo.value.trim().length >= 2) cerca().catch(() => {}); });
    campo.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== campo) chiudi(); }, 150); });
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); chiudi({ svuota: true }); campo.blur(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); evidenzia(scelta + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); evidenzia(scelta - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const b = voci[scelta >= 0 ? scelta : 0];
        if (b) apri(b._risultato).catch(() => {});
      }
    });
    global.SN_VOCI_PAGINA = Array.isArray(global.SN_VOCI_PAGINA) ? global.SN_VOCI_PAGINA : [];
    if (!global.SN_VOCI_PAGINA.includes(vociMenu)) global.SN_VOCI_PAGINA.push(vociMenu);
  }

  global.SN_DASH_CERCA = { init };
})(typeof globalThis !== 'undefined' ? globalThis : window);

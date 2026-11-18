// La barra dei siti della nuova scheda e la freccia che ripiega la chat (#1803). Le voci le scrive il main
// (src/main/services/barraSiti.js): qui si disegnano e si mandano le mosse, mai la barra intera.
// Regole in tests/newtab-barra-siti.spec.mjs; una barra sola, la stessa a chat aperta e ripiegata.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const TIPO_VOCE = 'application/x-filo-barra-voce';
  const ATTESA_RIMETTI_MS = 8000;

  let d = null;
  let voci = [];
  const nodi = new Map();
  let ripiegata = false;
  let pronta = false;
  let trascinata = null;
  let tolta = null;
  let toltaTimer = null;

  const el = (tag, cls, testo) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (testo != null) n.textContent = testo;
    return n;
  };
  const avviso = (t) => { try { global.SN_DASH_CARTE.avviso(t); } catch (_) {} };

  function muovi(mossa) {
    return d.send({ type: MSG.BARRA_SITI_MODIFICA, mossa }).then((r) => {
      if (r && Array.isArray(r.voci)) disegna(r.voci);
      if (r && r.ok === false && r.error) avviso(maiuscola(r.error));
      if (r && r.ok && r.gia && r.voce) giaQui(r.voce);
      return r || { ok: false };
    });
  }
  // Lasciata di nuovo una voce che c'è già: quella voce si fa vedere, o il gesto sembra non riuscito.
  function giaQui(v) {
    const n = nodi.get(v.id);
    if (n) {
      n.classList.remove('dash-barra-gia');
      void n.offsetWidth;
      n.classList.add('dash-barra-gia');
      try { n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
      n.addEventListener('animationend', () => n.classList.remove('dash-barra-gia'), { once: true });
    }
    avviso(`${v.nome} è già nella barra`);
  }
  const maiuscola = (t) => String(t || '').charAt(0).toUpperCase() + String(t || '').slice(1);

  function apri(v) {
    if (v.tipo === 'app') {
      d.send({ type: MSG.BARRA_SITI_AVVIA, id: v.id }).then((r) => { if (!r || !r.ok) avviso(maiuscola((r && r.error) || 'il programma non è partito')); });
      return;
    }
    d.send({ type: MSG.OPEN_URL, url: v.url, via: 'barra_siti' }).then((r) => { if (r && r.aperto === false && r.frase) avviso(r.frase); });
  }

  // ===== Disegno: ogni voce resta lo stesso nodo finché c'è (fuoco e menu non si chiudono sotto le mani) =====
  function iconaDi(v, posto) {
    posto.textContent = '';
    const lettera = () => {
      posto.textContent = '';
      posto.appendChild(el('span', 'dash-barra-lettera', (v.nome.trim().charAt(0) || '·').toUpperCase()));
    };
    const metti = (src) => {
      const img = el('img');
      img.alt = '';
      img.draggable = false;
      img.addEventListener('error', lettera, { once: true });
      img.src = src;
      posto.textContent = '';
      posto.appendChild(img);
    };
    if (v.icona) { metti(v.icona); return; }
    lettera();
    if (v.tipo !== 'sito' || !d.iconaDelSito) return;
    d.iconaDelSito(v.url).then((dato) => {
      if (!dato || !posto.isConnected || posto.dataset.per !== v.id) return;
      metti(dato);
      // La prossima apertura non la richiede: l'icona trovata resta con la voce.
      d.send({ type: MSG.BARRA_SITI_MODIFICA, mossa: { tipo: 'icona', id: v.id, icona: dato } }).catch(() => {});
    }).catch(() => {});
  }

  function nodoDi(v) {
    let n = nodi.get(v.id);
    if (!n) {
      n = el('button', 'dash-barra-voce');
      n.type = 'button';
      n.draggable = true;
      n.dataset.id = v.id;
      const posto = el('span', 'dash-barra-icona');
      posto.dataset.per = v.id;
      n.append(posto, el('span', 'dash-barra-nome'));
      n.addEventListener('click', () => { const x = voceDi(n); if (x) apri(x); });
      n.addEventListener('auxclick', (e) => { if (e.button === 1) { const x = voceDi(n); if (x) apri(x); } });
      n.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menuVoce(n, e); });
      n.addEventListener('keydown', (e) => {
        if (e.key === 'Delete') { e.preventDefault(); const x = voceDi(n); if (x) togli(x); }
      });
      n.addEventListener('dragstart', (e) => iniziaTrascino(e, n));
      n.addEventListener('dragend', fineTrascino);
      nodi.set(v.id, n);
      n._voce = null;
    }
    const prima = n._voce;
    n._voce = v;
    if (!prima || prima.nome !== v.nome || prima.url !== v.url || prima.percorso !== v.percorso) {
      n.querySelector('.dash-barra-nome').textContent = v.nome;
      n.setAttribute('aria-label', v.nome);
      n.title = `${v.nome}\n${v.tipo === 'app' ? v.percorso : v.url}`;
      n.dataset.tipo = v.tipo;
    }
    if (!prima || prima.icona !== v.icona) iconaDi(v, n.querySelector('.dash-barra-icona'));
    return n;
  }
  const voceDi = (n) => n && n._voce;

  function disegna(lista) {
    if (Array.isArray(lista)) voci = lista;
    const ids = new Set(voci.map((v) => v.id));
    for (const [id, n] of nodi) if (!ids.has(id)) { n.remove(); nodi.delete(id); }
    const ordine = voci.map(nodoDi);
    ordine.push(d.piu);
    if (tolta && d.rimetti) ordine.push(d.rimetti);
    ordine.forEach((n, i) => { if (d.barra.children[i] !== n) d.barra.insertBefore(n, d.barra.children[i] || null); });
    while (d.barra.children.length > ordine.length) d.barra.lastElementChild.remove();
    d.barra.dataset.vuota = voci.length ? '0' : '1';
  }

  // ===== Togli, con «Rimetti» per qualche secondo: una voce trascinata fuori per sbaglio torna dov'era =====
  function togli(v) {
    const i = voci.findIndex((x) => x.id === v.id);
    const dopo = i >= 0 ? voci[i + 1] : null;
    muovi({ tipo: 'togli', id: v.id, cosa: v.nome }).then((r) => {
      if (!r || !r.ok) return;
      tolta = { voce: v, prima: dopo ? dopo.id : null };
      d.rimetti.textContent = `Rimetti ${v.nome}`;
      d.rimetti.title = `Rimetti ${v.nome} nella barra`;
      clearTimeout(toltaTimer);
      toltaTimer = setTimeout(() => { tolta = null; disegna(); }, ATTESA_RIMETTI_MS);
      disegna();
    });
  }
  function rimetti() {
    if (!tolta) return;
    const { voce: v, prima } = tolta;
    tolta = null;
    clearTimeout(toltaTimer);
    disegna();
    muovi({ tipo: 'aggiungi', ...(v.tipo === 'app' ? { percorso: v.percorso } : { url: v.url }), nome: v.nome, icona: v.icona, ...(prima ? { prima } : {}) });
  }

  // ===== Un campo piccolo sopra la barra: l'indirizzo da aggiungere, il nome nuovo =====
  function chiediTesto({ ancora, valore = '', segnaposto = '', etichetta }) {
    return new Promise((resolve) => {
      document.querySelector('.dash-barra-campo')?.remove();
      const f = el('form', 'dash-barra-campo');
      const i = el('input');
      i.type = 'text';
      i.value = valore;
      i.placeholder = segnaposto;
      i.setAttribute('aria-label', etichetta);
      i.spellcheck = false;
      f.appendChild(i);
      document.body.appendChild(f);
      const r = (ancora || d.barra).getBoundingClientRect();
      const w = f.offsetWidth;
      f.style.left = `${Math.max(8, Math.min(r.left, global.innerWidth - w - 8))}px`;
      f.style.top = `${Math.max(8, r.top - f.offsetHeight - 8)}px`;
      let finito = false;
      const fine = (v) => { if (finito) return; finito = true; f.remove(); resolve(v); };
      f.addEventListener('submit', (e) => { e.preventDefault(); fine(i.value.trim() || null); });
      i.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fine(null); } });
      i.addEventListener('blur', () => fine(null));
      i.focus();
      i.select();
    });
  }
  async function chiediSito(ancora) {
    const testo = await chiediTesto({ ancora, segnaposto: 'youtube.com', etichetta: 'Indirizzo del sito da aggiungere' });
    if (testo) muovi({ tipo: 'aggiungi', url: testo });
  }
  async function rinomina(v, ancora) {
    const nome = await chiediTesto({ ancora, valore: v.nome, etichetta: `Nome nuovo per ${v.nome}` });
    if (nome && nome !== v.nome) muovi({ tipo: 'rinomina', id: v.id, nome, cosa: v.nome });
  }

  function menuVoce(n, e) {
    const v = voceDi(n);
    if (!v) return;
    const i = voci.indexOf(v);
    const r = n.getBoundingClientRect();
    const x = e && e.clientX ? e.clientX : r.left;
    const y = e && e.clientY ? e.clientY : r.bottom;
    const lista = [{ etichetta: v.tipo === 'app' ? `Avvia ${v.nome}` : `Apri ${v.nome}`, fai: () => apri(v) }];
    lista.push({ etichetta: 'Rinomina…', fai: () => rinomina(v, n) });
    if (i > 0) lista.push({ etichetta: 'Sposta a sinistra', fai: () => muovi({ tipo: 'sposta', id: v.id, verso: 'su', cosa: v.nome }) });
    if (i < voci.length - 1) lista.push({ etichetta: 'Sposta a destra', fai: () => muovi({ tipo: 'sposta', id: v.id, verso: 'giu', cosa: v.nome }) });
    if (v.tipo === 'sito') lista.push({ etichetta: 'Copia l\'indirizzo', fai: () => copia(v.url) });
    lista.push(null, { etichetta: 'Togli dalla barra', fai: () => togli(v) });
    global.SN_DASH_CARTE.apriMenu(x, y, lista);
  }
  function menuBarra(e) {
    global.SN_DASH_CARTE.apriMenu(e.clientX, e.clientY, [
      { etichetta: 'Aggiungi sito…', fai: () => chiediSito(d.piu) },
      { etichetta: ripiegata ? 'Riapri la chat' : 'Ripiega la chat', fai: () => ripiega(!ripiegata) },
      { etichetta: 'Nascondi la barra', fai: () => d.send({ type: MSG.UPDATE_SETTINGS, settings: { barraSiti: { visibile: false } } }) },
    ]);
  }
  function copia(testo) {
    try { navigator.clipboard.writeText(testo).then(() => avviso('Indirizzo copiato'), () => {}); } catch (_) {}
  }

  // ===== Trascinare: dentro la barra riordina, fuori dalla barra toglie, nel campo scrive l'indirizzo =====
  function iniziaTrascino(e, n) {
    const v = voceDi(n);
    if (!v) return;
    trascinata = v;
    n.classList.add('dash-barra-presa');
    const dt = e.dataTransfer;
    dt.effectAllowed = 'copyMove';
    dt.setData(TIPO_VOCE, v.id);
    dt.setData('text/plain', v.tipo === 'app' ? v.percorso : v.url);
    if (v.tipo === 'sito') dt.setData('text/uri-list', v.url);
  }
  function fineTrascino() {
    for (const n of nodi.values()) n.classList.remove('dash-barra-presa');
    segnaPunto(null);
    d.riga.classList.remove('dash-barra-fuori');
    trascinata = null;
  }
  // La voce davanti a cui cadrebbe quella presa: la prima che il punto precede, riga per riga.
  function cadePrima(x, y) {
    for (const v of voci) {
      if (trascinata && v.id === trascinata.id) continue;
      const r = nodi.get(v.id).getBoundingClientRect();
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return v.id;
    }
    return null;
  }
  function segnaPunto(id) {
    for (const [k, n] of nodi) n.classList.toggle('dash-barra-cade', k === id);
    d.piu.classList.toggle('dash-barra-cade', id === '');
  }
  const portaVoce = (dt) => Array.from((dt && dt.types) || []).includes(TIPO_VOCE);
  const portaFile = (dt) => Array.from((dt && dt.types) || []).includes('Files');
  const portaIndirizzo = (dt) => Array.from((dt && dt.types) || []).includes('text/uri-list');

  function sopraBarra(e) {
    const dt = e.dataTransfer;
    if (portaVoce(dt) && trascinata) {
      e.preventDefault();
      e.stopPropagation();
      dt.dropEffect = 'move';
      d.riga.classList.remove('dash-barra-fuori');
      const p = cadePrima(e.clientX, e.clientY);
      segnaPunto(p === null ? '' : p);
      return;
    }
    if (portaFile(dt) || portaIndirizzo(dt)) {
      e.preventDefault();
      e.stopPropagation();
      dt.dropEffect = 'copy';
      d.inputForm.classList.remove('dash-input-bersaglio');
      d.riga.classList.add('dash-barra-bersaglio');
    }
  }
  function lasciaSullaBarra(e) {
    const dt = e.dataTransfer;
    d.riga.classList.remove('dash-barra-bersaglio');
    if (portaVoce(dt) && trascinata) {
      e.preventDefault();
      e.stopPropagation();
      const v = trascinata;
      const p = cadePrima(e.clientX, e.clientY);
      fineTrascino();
      muovi({ tipo: 'sposta', id: v.id, prima: p, cosa: v.nome });
      return;
    }
    if (portaFile(dt)) {
      e.preventDefault();
      e.stopPropagation();
      const leggi = global.filo && global.filo.percorsoDelFile;
      const percorsi = Array.from(dt.files || []).map((f) => (leggi ? leggi(f) : '')).filter(Boolean);
      if (!percorsi.length) { avviso('Non riesco a leggere da dove viene questo file'); return; }
      percorsi.reduce((p, percorso) => p.then(() => muovi({ tipo: 'aggiungi', percorso })), Promise.resolve());
      return;
    }
    if (portaIndirizzo(dt)) {
      e.preventDefault();
      e.stopPropagation();
      const url = String(dt.getData('text/uri-list') || '').split(/\r?\n/).find((r) => r && !r.startsWith('#'));
      if (url) muovi({ tipo: 'aggiungi', url });
    }
  }
  // Fuori dalla barra (non nel campo, che prende l'indirizzo) una voce trascinata si toglie; Esc non lascia niente.
  function sopraPagina(e) {
    if (!trascinata || !portaVoce(e.dataTransfer) || e.defaultPrevented) return;
    if (d.inputForm.contains(e.target)) { d.riga.classList.remove('dash-barra-fuori'); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    segnaPunto(null);
    d.riga.classList.add('dash-barra-fuori');
  }
  function lasciaSullaPagina(e) {
    if (!trascinata || !portaVoce(e.dataTransfer) || e.defaultPrevented || d.inputForm.contains(e.target)) return;
    e.preventDefault();
    const v = trascinata;
    fineTrascino();
    togli(v);
  }

  // ===== La chat ripiegata =====
  function mostraRipiegata(b) {
    ripiegata = !!b;
    d.dash.dataset.chatRipiegata = ripiegata ? '1' : '0';
    const parola = ripiegata ? 'Riapri la chat' : 'Ripiega la chat';
    d.freccia.title = parola;
    d.freccia.setAttribute('aria-label', parola);
    d.freccia.setAttribute('aria-expanded', String(!ripiegata));
    if (!ripiegata) delete d.freccia.dataset.nuovo;
  }
  function ripiega(b) {
    if (!!b === ripiegata) return;
    mostraRipiegata(b);
    d.send({ type: MSG.UPDATE_SETTINGS, settings: { chatRipiegata: !!b } }).catch(() => {});
  }
  // Una risposta di Filo arrivata a chat ripiegata: la freccia lo dice, così niente si legge nel vuoto.
  function guardaRisposte() {
    if (!global.MutationObserver || !d.bubbles) return;
    new MutationObserver((cambi) => {
      if (!ripiegata || !pronta) return;
      // Anche la risposta che cresce in una bolla nata prima del ripiego (lo streaming scrive dentro, non aggiunge bolle).
      const dentro = (n) => {
        const e = n && (n.nodeType === 1 ? n : n.parentElement);
        return !!(e && e.closest('.dash-bubble-filo'));
      };
      const porta = (n) => dentro(n) || (n.nodeType === 1 && !!n.querySelector('.dash-bubble-filo'));
      const nuova = cambi.some((c) => dentro(c.target) || [...c.addedNodes].some(porta));
      if (nuova) d.freccia.dataset.nuovo = '1';
    }).observe(d.bubbles, { childList: true, subtree: true, characterData: true });
  }

  function applicaImpostazioni(s) {
    if (!s || !d) return;
    if (s.barraSiti && typeof s.barraSiti === 'object') d.dash.dataset.barraSiti = s.barraSiti.visibile === false ? '0' : '1';
    if (typeof s.chatRipiegata === 'boolean') mostraRipiegata(s.chatRipiegata);
  }

  async function carica() {
    const r = await d.send({ type: MSG.BARRA_SITI_GET });
    if (r && r.ok && Array.isArray(r.voci)) disegna(r.voci);
  }

  function init(deps) {
    d = deps;
    d.piu = el('button', 'dash-barra-voce dash-barra-piu');
    d.piu.type = 'button';
    d.piu.title = 'Aggiungi un sito';
    d.piu.setAttribute('aria-label', 'Aggiungi un sito');
    d.piu.innerHTML = '<span class="dash-barra-icona"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>';
    d.piu.addEventListener('click', () => chiediSito(d.piu));
    d.rimetti = el('button', 'dash-barra-rimetti');
    d.rimetti.type = 'button';
    d.rimetti.addEventListener('click', rimetti);
    d.freccia.addEventListener('click', () => ripiega(!ripiegata));
    // A chat aperta la fila scorre di lato: la rotella la porta, così ogni voce si raggiunge anche senza touchpad.
    d.barra.addEventListener('wheel', (e) => {
      if (ripiegata || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || d.barra.scrollWidth <= d.barra.clientWidth) return;
      d.barra.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    d.barra.addEventListener('contextmenu', (e) => { if (e.target === d.barra || e.target.closest('.dash-barra-piu')) { e.preventDefault(); menuBarra(e); } });
    d.riga.addEventListener('dragover', sopraBarra);
    d.riga.addEventListener('dragleave', (e) => { if (!d.riga.contains(e.relatedTarget)) { d.riga.classList.remove('dash-barra-bersaglio'); segnaPunto(null); } });
    d.riga.addEventListener('drop', lasciaSullaBarra);
    document.addEventListener('dragover', sopraPagina);
    document.addEventListener('drop', lasciaSullaPagina);
    // Una scheda portata giù dalla fila (#2084) arriva dal main come per la chat: qui diventa una voce.
    if (global.SN_SCHEDA_TRASCINATA) {
      // Anche una pagina di Filo o un file: quello che non entra lo dice il main, con l'avviso.
      global.SN_SCHEDA_TRASCINATA.registraChat(d.riga, (s) => {
        if (!s || !s.url) return false;
        muovi({ tipo: 'aggiungi', url: s.url, nome: s.titolo, icona: s.icona });
        return true;
      }, { ogniScheda: true });
    }
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.BARRA_SITI_CAMBIATA && Array.isArray(msg.voci)) disegna(msg.voci);
    });
    guardaRisposte();
    disegna([]);
    carica().catch(() => {});
  }

  global.SN_DASH_BARRA_SITI = {
    init,
    applicaImpostazioni,
    ripiegata: () => ripiegata,
    ripiega,
    // Chi scrive a chat ripiegata la riapre: la risposta arriva dove la si vede.
    perInvio() { if (ripiegata) ripiega(false); },
    pronta() { pronta = true; },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

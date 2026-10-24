// Le conversazioni dell'Editor, dei Mazzi e dell'Aiuto nel filo a schermo (#974): una riga ripiegata ciascuna, che si
// apre sullo scambio. Quali righe e in quale conversazione lo decide il main (src/shared/filoApp.js): qui il disegno.
// Non tocca il DOM al caricamento.
(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  let d = null;
  const righe = new Map();
  const fisse = new Set();
  let giro = 0;
  let attesa = null;

  const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const VAI = Object.freeze({ editor: "Apri nell'Editor", mazzi: 'Apri nei Mazzi', aiuto: 'Apri la pagina' });
  // Il Deck builder in pausa (#1592) non si apre da qui: la conversazione resta, la strada per l'app no.
  const vai = (app) => (app === 'mazzi' && !(global.SN_DASH_CARTE && global.SN_DASH_CARTE.aperta('mazzi')) ? '' : VAI[app] || '');

  function icona(nome, size = 14) {
    const I = global.SN_ICONS;
    return I && typeof I[nome] === 'function' ? I[nome](size) : '';
  }

  function quando(iso) {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return '';
    const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const oggi = new Date();
    const giorno = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((giorno(oggi) - giorno(t)) / 86400000);
    if (diff === 0) return hm;
    if (diff === 1) return `ieri ${hm}`;
    return `${GIORNI[t.getDay()]} ${t.getDate()} ${MESI[t.getMonth()]}, ${hm}`;
  }

  function contenitore() {
    return d.inThread() ? d.bubblesEl : d.homeEl;
  }

  // Al suo posto nel tempo: prima del primo elemento datato più nuovo di lei (bolle, altre righe).
  function posa(r, cont) {
    const t = Date.parse(r.vista.inizio);
    let prima = null;
    for (const el of cont.children) {
      if (el === r.el || !el.dataset || !el.dataset.ts) continue;
      if (Date.parse(el.dataset.ts) > t) { prima = el; break; }
    }
    if (prima) cont.insertBefore(r.el, prima); else cont.appendChild(r.el);
  }

  function crea(v) {
    const el = document.createElement('div');
    el.className = 'dash-riga-app';
    const testa = document.createElement('button');
    testa.type = 'button';
    testa.className = 'dash-riga-app-testa';
    testa.setAttribute('aria-expanded', 'false');
    const ic = document.createElement('span');
    ic.className = 'dash-riga-app-icona';
    const testo = document.createElement('span');
    testo.className = 'dash-riga-app-testo';
    const ora = document.createElement('span');
    ora.className = 'dash-riga-app-ora';
    testa.append(ic, testo, ora);
    const corpo = document.createElement('div');
    corpo.className = 'dash-riga-app-corpo';
    corpo.hidden = true;
    el.append(testa, corpo);
    const r = { el, testa, ic, testo, ora, corpo, vista: null, aperta: false, n: -1 };
    testa.addEventListener('click', (e) => { e.stopPropagation(); alterna(r).catch(() => {}); });
    // Un link di una risposta apre una scheda nuova, anche fuori dalla conversazione (home vuota).
    corpo.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a.filo-md-link') : null;
      if (!a || !corpo.contains(a)) return;
      e.preventDefault();
      e.stopPropagation();
      const url = a.getAttribute('href');
      if (url) d.send({ type: MSG.OPEN_URL, url });
    });
    disegna(r, v);
    return r;
  }

  function disegna(r, v) {
    const prima = r.vista;
    r.vista = v;
    r.el.dataset.chat = v.id;
    r.el.dataset.app = v.app;
    r.el.dataset.ts = v.inizio;
    if (!prima || prima.icona !== v.icona) r.ic.innerHTML = icona(v.icona);
    r.testo.textContent = v.testo;
    r.ora.textContent = quando(v.inizio);
    r.testa.title = r.aperta ? 'Chiudi lo scambio' : 'Mostra lo scambio';
    // Aperta mentre l'app continua a parlare: lo scambio si rilegge.
    if (r.aperta && prima && prima.n !== v.n) riempi(r).catch(() => {});
  }

  function messaggio(m) {
    const div = document.createElement('div');
    div.className = `dash-riga-app-msg dash-riga-app-msg-${m.role === 'user' ? 'user' : 'filo'}`;
    // Le risposte di Filo con la formattazione leggera della home (come nell'app dove sono nate): il renderer escapa
    // l'HTML e filtra i link. Le domande dell'utente restano letterali.
    const testo = String(m.text || '');
    if (m.role !== 'user' && global.SN_MARKDOWN) {
      div.innerHTML = global.SN_MARKDOWN.render(testo);
      div.classList.add('dash-bubble-md');
    } else {
      div.textContent = testo;
    }
    return div;
  }

  async function riempi(r) {
    const res = await d.send({ type: MSG.FILO_CHAT_GET, id: r.vista.id });
    const chat = res && res.ok && res.chat;
    if (!chat) {
      r.corpo.replaceChildren(Object.assign(document.createElement('div'), {
        className: 'dash-riga-app-vuoto', textContent: 'Questa conversazione non c’è più.',
      }));
      return;
    }
    const parti = (chat.messages || []).filter((m) => m && String(m.text || '').trim()).map(messaggio);
    const v = r.vista;
    if (v.dove && vai(v.app)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dash-riga-app-vai';
      b.textContent = vai(v.app);
      b.title = v.app === 'aiuto' ? v.dove : vai(v.app);
      b.addEventListener('click', (e) => { e.stopPropagation(); apri(r); });
      parti.push(b);
    }
    r.corpo.replaceChildren(...parti);
  }

  async function alterna(r, aperta = !r.aperta) {
    r.aperta = aperta;
    r.el.classList.toggle('dash-riga-app-aperta', aperta);
    r.testa.setAttribute('aria-expanded', aperta ? 'true' : 'false');
    r.testa.title = aperta ? 'Chiudi lo scambio' : 'Mostra lo scambio';
    r.corpo.hidden = !aperta;
    if (aperta) await riempi(r);
  }

  function apri(r) {
    const url = r.vista && r.vista.dove;
    if (url) d.send({ type: MSG.OPEN_URL, url });
  }

  async function copia(r) {
    const res = await d.send({ type: MSG.FILO_CHAT_GET, id: r.vista.id });
    const msgs = (res && res.ok && res.chat && res.chat.messages) || [];
    const testo = [r.vista.testo, ...msgs.filter((m) => m && String(m.text || '').trim())
      .map((m) => `${m.role === 'user' ? 'Tu' : 'Filo'}: ${m.text}`)].join('\n\n');
    let ok = true;
    try { await navigator.clipboard.writeText(testo); } catch (_) { ok = false; }
    // La conferma sta sulla riga stessa, al posto dell'ora, per un attimo.
    r.ora.textContent = ok ? 'copiato' : 'non copiato';
    setTimeout(() => { if (r.vista) r.ora.textContent = quando(r.vista.inizio); }, 1600);
  }

  async function togli(r) {
    const C = global.SN_CONFIRM_UI;
    const a = global.SN_FILO_APP && global.SN_FILO_APP.APP[r.vista.app];
    // L'Aiuto non tiene la sua conversazione: il filo è l'unica copia. Editor e Mazzi la tengono.
    const resta = a && r.vista.app !== 'aiuto' ? ` ${a.nel[0].toUpperCase()}${a.nel.slice(1)} la conversazione resta.` : '';
    const testo = `«${r.vista.testo}» sparisce dal filo, e Filo non la ritrova più cercando.${resta}`;
    // Il soggetto lo scrive chi ha dato il nome alla conversazione (per l'Aiuto, il sito): nel suo riquadro (#592.7).
    const parti = ['La conversazione', { citazione: String(r.vista.testo || '') }, `sparisce dal filo, e Filo non la ritrova più cercando.${resta}`];
    const ok = C ? await C.confirm({ title: 'Togliere la conversazione dal filo?', text: testo, parti, okLabel: 'Togli' }) : false;
    if (!ok) return;
    await d.send({ type: MSG.FILO_CHAT_DELETE, id: r.vista.id });
    r.el.remove();
    righe.delete(r.vista.id);
    fisse.delete(r.vista.id);
    vuoto();
  }

  function rigaDi(target) {
    const el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    const box = el && el.closest ? el.closest('.dash-riga-app') : null;
    return box ? [...righe.values()].find((r) => r.el === box) || null : null;
  }

  // Il tasto destro sulla riga (letto da src/content/content.js): le stesse cose della riga, più copiare e togliere.
  function vociMenu(target) {
    const r = rigaDi(target);
    if (!r) return [];
    const voci = [
      { type: 'item', icon: icona('caretDown', 16), label: r.aperta ? 'Chiudi lo scambio' : 'Mostra lo scambio', onClick: () => alterna(r).catch(() => {}) },
    ];
    if (r.vista.dove && vai(r.vista.app)) voci.push({ type: 'item', icon: icona(r.vista.icona, 16), label: vai(r.vista.app), onClick: () => apri(r) });
    voci.push({ type: 'item', icon: icona('copy', 16), label: 'Copia lo scambio', onClick: () => copia(r).catch(() => {}) });
    // #1295 — come una conversazione della home: nascosta si rimette, «Togli dal filo» la cancella.
    if (global.SN_DASH_CODA && global.SN_DASH_CODA.nascondi) {
      voci.push({ type: 'item', icon: icona('eyeOff', 16), label: 'Nascondi la conversazione', azione: 'chat-archive', onClick: () => { global.SN_DASH_CODA.nascondi(r.vista.id, { vicino: r.el }).catch(() => {}); } });
    }
    voci.push({ type: 'item', icon: icona('trash', 16), label: 'Togli dal filo', azione: 'chat-archive', onClick: () => togli(r).catch(() => {}) });
    return voci;
  }

  function vuoto() {
    if (d && d.homeEl) d.homeEl.hidden = !d.homeEl.querySelector('.dash-riga-app');
  }

  // `riposa`: la conversazione è stata ridisegnata da capo (riaperta), ogni riga torna al suo posto nel tempo.
  async function aggiorna({ riposa = false } = {}) {
    if (!d) return;
    const mio = ++giro;
    const chat = d.inThread() ? d.chatId() : null;
    const res = await d.send({ type: MSG.FILO_RIGHE_APP, chat });
    if (mio !== giro || !res || !res.ok || !Array.isArray(res.righe)) return;
    const cont = contenitore();
    for (const id of [...fisse]) if (!righe.has(id) || !righe.get(id).el.isConnected) fisse.delete(id);
    const ids = new Set(res.righe.map((v) => v.id));
    for (const [id, r] of righe) {
      if (!ids.has(id) && !fisse.has(id)) { r.el.remove(); righe.delete(id); }
    }
    for (const v of res.righe) {
      let r = righe.get(v.id);
      if (!r) { r = crea(v); righe.set(v.id, r); posa(r, cont); continue; }
      disegna(r, v);
      // Passata dalla home vuota alla conversazione (o tornata indietro): la stessa riga, aperta com'era.
      if (riposa || r.el.parentElement !== cont) posa(r, cont);
    }
    vuoto();
  }

  function presto() {
    clearTimeout(attesa);
    attesa = setTimeout(() => { aggiorna().catch(() => {}); }, 80);
  }

  // Una conversazione mostrata da sola e aperta (dalla Cronologia, o da un link con ?chat=): resta finché la
  // conversazione a schermo è questa, anche se non è fra le righe del momento.
  async function mostraSola(chat) {
    const A = global.SN_FILO_APP;
    if (!A || !A.eApp(chat && chat.app) || !(chat.messages || []).length) return false;
    const v = A.vista(chat);
    let r = righe.get(chat.id);
    if (!r) { r = crea(v); righe.set(chat.id, r); } else disegna(r, v);
    fisse.add(chat.id);
    posa(r, d.bubblesEl);
    await alterna(r, true);
    return true;
  }

  // Una riga che arriva con la coda del filo (#869): resta finché la coda la mostra, anche fuori dalle righe del momento.
  function daCoda(v) {
    let r = righe.get(v.id);
    if (!r) { r = crea(v); righe.set(v.id, r); } else disegna(r, v);
    fisse.add(v.id);
    return r.el;
  }

  function apriRiga(el) {
    const r = [...righe.values()].find((x) => x.el === el);
    if (r && !r.aperta) alterna(r, true).catch(() => {});
  }

  function init(deps) {
    d = deps;
    global.SN_VOCI_PAGINA = Array.isArray(global.SN_VOCI_PAGINA) ? global.SN_VOCI_PAGINA : [];
    if (!global.SN_VOCI_PAGINA.includes(vociMenu)) global.SN_VOCI_PAGINA.push(vociMenu);
    try {
      global.chrome.runtime.onMessage.addListener((m) => {
        if (!m) return;
        if (m.type === MSG.FILO_RIGHE_APP_CAMBIATE) presto();
        else if (m.type === MSG.FILO_CHATS_UPDATED && m.rimessa) presto();
        else if (m.type === MSG.FILO_CHATS_UPDATED && (m.cancellata || m.nascosta) && righe.has(m.cancellata || m.nascosta)) {
          const via = m.cancellata || m.nascosta;
          // Nascosta altrove: al suo posto resta «Rimetti», come col tasto destro (#1295).
          if (m.nascosta && global.SN_DASH_CODA && global.SN_DASH_CODA.nascostaAltrove) global.SN_DASH_CODA.nascostaAltrove(via);
          righe.get(via).el.remove();
          righe.delete(via);
          vuoto();
        }
      });
    } catch (_) {}
  }

  global.SN_DASH_RIGHE = { init, aggiorna, mostraSola, quando, daCoda, apri: apriRiga };
})(typeof globalThis !== 'undefined' ? globalThis : window);

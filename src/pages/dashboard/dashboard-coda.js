// La coda del filo al centro della home (#869): i segni dei giorni, i giorni prima sbiaditi, le azioni fatte
// dall'interfaccia, le pagine visitate ripiegate, «risali» a pezzi. Quali righe lo decide il main (src/shared/filoCoda.js).
// Non tocca il DOM al caricamento. Regole: patterns/la-home-e-la-coda-del-filo.md.
(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  let d = null;
  let primo = null;
  let ultimo = null;
  let finito = false;
  let caricando = null;
  let risali = null;
  let coda = Promise.resolve();

  const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const ICONE_CAMBIO = { impostazioni: 'options', timer: 'timer', proxy: 'globe', zoom: 'zoom', icone: 'pin', desktop: 'desktopIcons' };

  function icona(nome, size = 14) {
    const I = global.SN_ICONS;
    return I && typeof I[nome] === 'function' ? I[nome](size) : '';
  }
  const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN; };
  const inizioGiorno = (t) => { const x = new Date(t); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
  const ora = (iso) => {
    const t = new Date(iso);
    return Number.isNaN(t.getTime()) ? '' : `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  };

  // «oggi», «ieri», il nome del giorno per la settimana appena passata, poi la data.
  function nomeDelGiorno(t) {
    const oggi = inizioGiorno(Date.now());
    const g = inizioGiorno(t);
    const diff = Math.round((oggi - g) / 86400000);
    if (diff <= 0) return 'oggi';
    if (diff === 1) return 'ieri';
    const x = new Date(t);
    if (diff < 7) return GIORNI[x.getDay()];
    const anno = x.getFullYear() !== new Date().getFullYear() ? ` ${x.getFullYear()}` : '';
    return `${x.getDate()} ${MESI[x.getMonth()]}${anno}`;
  }

  function el(tag, cls, testo) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (testo != null) n.textContent = testo;
    return n;
  }

  // I clic su «risali» di fila, per i contatori (#1473): la serie finisce con un'altra cosa fatta nella home, con
  // l'inizio del filo o con la pagina che se ne va; se la scheda si chiude la conta il main.
  let pezziDiFila = 0;
  function contaRisali(misura, campi = {}) {
    try { Promise.resolve(d.send({ type: MSG.CONTATORI_EVENTO, misura, ...campi })).catch(() => {}); } catch (_) {}
  }
  function fineRisali() {
    if (!pezziDiFila) return;
    pezziDiFila = 0;
    contaRisali('risali-fine');
  }
  async function risaliCliccato() {
    if (caricando || finito || !primo) return;
    pezziDiFila += 1;
    contaRisali('risali', { pezzi: pezziDiFila });
    await sali();
    if (finito) fineRisali();
  }

  function bottoneRisali() {
    if (risali && risali.isConnected) return risali;
    risali = el('div', 'dash-risali');
    const b = el('button', 'dash-risali-btn', 'risali il filo');
    b.type = 'button';
    b.addEventListener('click', () => { risaliCliccato().catch(() => {}); });
    risali.appendChild(b);
    d.bubblesEl.insertBefore(risali, d.bubblesEl.firstChild);
    return risali;
  }
  function statoRisali(testo, { spento = false, nascosto = false } = {}) {
    const r = bottoneRisali();
    const b = r.firstChild;
    b.textContent = testo;
    b.disabled = spento;
    r.hidden = nascosto;
  }

  // ── Le righe ──────────────────────────────────────────────────────────────

  function rigaCambio(v) {
    const r = el('div', 'dash-cambio');
    r.dataset.id = v.id;
    const ic = el('span', 'dash-cambio-ico');
    ic.innerHTML = icona(ICONE_CAMBIO[v.tipo] || 'check', 13);
    const stato = el('span', 'dash-cambio-stato');
    const btn = el('button', 'dash-cambio-annulla');
    btn.type = 'button';
    btn.addEventListener('click', (e) => { e.stopPropagation(); annullaCambio(r).catch(() => {}); });
    r.append(el('span', 'dash-cambio-ora'), ic, el('span', 'dash-cambio-testo'), stato, btn);
    statoCambio(r, v);
    return r;
  }
  // Anche la frase: un ritocco fuso nel cambio (cambi.js, fondi) la riscrive, «125% → 114%» diventa «125% → 100%».
  function statoCambio(r, v) {
    r._vista = v;
    r.querySelector('.dash-cambio-ora').textContent = ora(v.ts);
    r.querySelector('.dash-cambio-testo').textContent = `${v.annulla ? 'rimesso com’era · ' : ''}${v.frase || 'era già così'} · ${v.provenienza}`;
    const btn = r.querySelector('.dash-cambio-annulla');
    const stato = r.querySelector('.dash-cambio-stato');
    r.classList.toggle('dash-cambi-annullato', !!v.annullatoDa);
    stato.textContent = v.annullatoDa ? 'annullato' : (!v.annullabile && !v.annulla ? 'non si annulla' : '');
    if (v.annullatoDa) { btn.textContent = 'rifai'; btn.title = 'Rimetti questo cambio'; btn.hidden = false; }
    else if (v.annullabile) { btn.textContent = 'annulla'; btn.title = 'Rimetti com’era prima'; btn.hidden = false; }
    else btn.hidden = true;
  }
  async function annullaCambio(r) {
    const v = r._vista;
    if (!v) return;
    const btn = r.querySelector('.dash-cambio-annulla');
    btn.disabled = true;
    const res = await d.send({ type: MSG.CAMBI_ANNULLA, id: v.annullatoDa || v.id });
    btn.disabled = false;
    if (!res || !res.ok) {
      btn.textContent = 'non riuscito';
      btn.title = res && res.error ? `Non riuscito: ${res.error}` : 'Non riuscito';
      return;
    }
    await rileggiCambi([r]);
  }
  async function rileggiCambi(righe = [...d.bubblesEl.querySelectorAll('.dash-cambio')]) {
    if (!righe.length) return;
    const res = await d.send({ type: MSG.CAMBI_LEGGI, ids: righe.map((r) => r.dataset.id) });
    if (!res || !res.ok) return;
    const per = new Map((res.eventi || []).map((v) => [v.id, v]));
    let tolte = false;
    for (const r of righe) {
      const v = per.get(r.dataset.id);
      if (v) statoCambio(r, { ...r._vista, frase: v.frase, annullabile: v.annullabile, annullatoDa: v.annullatoDa });
      // Ritoccato fino al valore di partenza, il cambio non c'è più (cambi.js, fondi): nemmeno la sua riga.
      else if (r.isConnected) { r.remove(); tolte = true; }
    }
    if (tolte) segnaGiorni();
  }

  const sito = (url) => global.SN_FILO_CODA.sito(url);
  function testoGruppo(g) {
    const n = g.pagine.length;
    const nome = global.SN_FILO_CODA.nomeDelGruppo(g);
    if (n === 1) return `1 pagina: ${nome}`;
    return `${n} pagine, fra cui ${nome}`;
  }

  function rigaPagine(g) {
    const r = el('div', 'dash-pagine');
    const testa = el('button', 'dash-pagine-testa');
    testa.type = 'button';
    testa.setAttribute('aria-expanded', 'false');
    const ic = el('span', 'dash-pagine-ico');
    ic.innerHTML = icona('globe', 13);
    testa.append(el('span', 'dash-pagine-ora', ora(g.ts)), ic, el('span', 'dash-pagine-testo'));
    const elenco = el('div', 'dash-pagine-elenco');
    elenco.hidden = true;
    r.append(testa, elenco);
    testa.addEventListener('click', () => apriGruppo(r));
    disegnaGruppo(r, g);
    return r;
  }
  function disegnaGruppo(r, g) {
    r._gruppo = g;
    r.querySelector('.dash-pagine-ora').textContent = ora(g.ts);
    r.querySelector('.dash-pagine-testo').textContent = testoGruppo(g);
    r.querySelector('.dash-pagine-testa').title = r.classList.contains('dash-pagine-aperte') ? 'Chiudi le pagine' : 'Mostra le pagine';
    const elenco = r.querySelector('.dash-pagine-elenco');
    elenco.replaceChildren(...g.pagine.slice().reverse().map((p) => {
      const a = el('a', 'dash-pagina');
      a.dataset.id = p.id;
      const dove = global.SN_FILO_CODA.daAprire(p);
      a.href = dove ? dove.url : '#';
      a.title = dove && dove.sito ? `${dove.url} · indirizzo troppo lungo, si apre il sito` : p.url;
      a.append(el('span', 'dash-pagina-titolo', String(p.titolo || '').trim() || sito(p.url)), el('span', 'dash-pagina-sito', `${sito(p.url)} · ${ora(p.ts)}`));
      if (p.altrove) a.append(el('span', 'dash-pagina-sito', 'da un altro dispositivo'));
      a.addEventListener('click', (e) => { e.preventDefault(); riapri(p).catch(() => {}); });      return a;
    }));
  }
  function apriGruppo(r, aperta = !r.classList.contains('dash-pagine-aperte')) {
    r.classList.toggle('dash-pagine-aperte', aperta);
    r.querySelector('.dash-pagine-testa').setAttribute('aria-expanded', aperta ? 'true' : 'false');
    r.querySelector('.dash-pagine-testa').title = aperta ? 'Chiudi le pagine' : 'Mostra le pagine';
    r.querySelector('.dash-pagine-elenco').hidden = !aperta;
  }
  // Un indirizzo che il filo ricorda l'ha scritto un sito: si riapre solo se è una pagina web.
  // Una scheda chiusa prima del filo si riapre com'era (scroll, paese), dalla sua voce d'archivio (#872).
  async function riapri(p) {
    const dove = global.SN_FILO_CODA.daAprire(p);
    if (!dove) return;
    const riaperta = p.archivio ? await d.send({ type: MSG.REOPEN_ARCHIVED_TAB, id: p.archivio })
      : !dove.sito ? await d.send({ type: MSG.REOPEN_ARCHIVED_TAB, url: dove.url, perIndirizzo: true }) : null;
    if (!riaperta || !riaperta.ok) d.send({ type: MSG.OPEN_URL, url: dove.url });
  }

  async function togliPagine(r, ids) {
    const g = r._gruppo;
    if (!g || !ids.length) return;
    if (ids.length > 1) {
      const C = global.SN_CONFIRM_UI;
      const ok = C ? await C.confirm({
        title: 'Togliere queste pagine dal filo?',
        text: `${ids.length} pagine spariscono dal filo e dal disco, e Filo non le ritrova più cercando.`,
        okLabel: 'Togli',
      }) : false;
      if (!ok) return;
    }
    const res = await d.send({ type: MSG.FILO_CODA_TOGLI_PAGINE, ids });
    if (!res || !res.ok) return;
    const via = new Set(ids);
    senza(r, (p) => !via.has(p.id));
    segnaGiorni();
  }

  // Subito, senza aspettare che il filo lo ridica: la riga perde le pagine tolte (l'annuncio poi la rifà dal filo).
  function senza(r, tieni) {
    const g = r._gruppo;
    if (!g || !r.isConnected) return;
    const pagine = g.pagine.filter(tieni);
    if (!pagine.length) r.remove();
    else if (pagine.length !== g.pagine.length) disegnaGruppo(r, { ...g, pagine, ts: pagine[0].ts });
  }

  // Una pagina tolta altrove (dalla ricerca): via da ogni gruppo che la mostra.
  function togliIndirizzo(url) {
    if (!d) return;
    for (const r of [...d.bubblesEl.querySelectorAll('.dash-pagine')]) senza(r, (p) => p.url !== url);
    segnaGiorni();
  }

  function rigaDi(v) {
    if (v.k === 'cambio') return rigaCambio(v);
    if (v.k === 'pagine') return rigaPagine(v);
    if (v.k === 'app') return d.righe.daCoda(v.vista);
    return null;
  }

  // Le righe di un pezzo, in ordine, in un frammento: i messaggi di fila della stessa chat insieme, perché il segno di
  // un cambio cerca la bolla dell'utente che lo precede.
  function frammento(lista) {
    const f = document.createDocumentFragment();
    let serie = [];
    const svuota = () => { if (serie.length) { d.rendiMessaggi(serie, f); serie = []; } };
    for (const v of lista) {
      if (v.k === 'msg') {
        if (serie.length && serie[0].chat !== v.chat) svuota();
        serie.push(v);
        continue;
      }
      svuota();
      const n = rigaDi(v);
      if (!n) continue;
      n.dataset.key = v.key;
      n.dataset.ts = v.ts;
      if (v.chat) n.dataset.chat = v.chat;
      f.appendChild(n);
    }
    svuota();
    return f;
  }

  const conChiave = (key) => {
    for (const n of d.bubblesEl.querySelectorAll('[data-key]')) if (n.dataset.key === key) return n;
    return null;
  };

  // Al suo posto nel tempo: prima del primo elemento datato più nuovo.
  function posa(n) {
    const t = ms(n.dataset.ts);
    let prima = null;
    for (const x of d.bubblesEl.children) {
      if (x === n || !x.dataset || !x.dataset.ts || x.classList.contains('dash-giorno')) continue;
      if (ms(x.dataset.ts) > t) { prima = x; break; }
    }
    if (prima) d.bubblesEl.insertBefore(n, prima); else d.bubblesEl.appendChild(n);
  }

  // I segni dei giorni e i giorni prima di oggi sbiaditi, rifatti su tutto: un pezzo nuovo in cima, un messaggio dopo
  // mezzanotte, una riga posata in mezzo.
  function segnaGiorni() {
    if (!d) return;
    const area = d.bubblesEl;
    for (const m of [...area.querySelectorAll(':scope > .dash-giorno')]) m.remove();
    const oggi = inizioGiorno(Date.now());
    let giorno = null;
    let vecchio = false;
    for (const n of [...area.children]) {
      if (n === risali) continue;
      const t = n.dataset && n.dataset.ts ? ms(n.dataset.ts) : NaN;
      if (Number.isFinite(t)) {
        const g = inizioGiorno(t);
        if (g !== giorno) {
          giorno = g;
          vecchio = g < oggi;
          const segno = el('div', `dash-giorno${vecchio ? ' dash-vecchio' : ''}`);
          segno.append(el('span', 'dash-giorno-nome', nomeDelGiorno(t)));
          segno.dataset.giorno = String(g);
          area.insertBefore(segno, n);
        }
      }
      n.classList.toggle('dash-vecchio', vecchio && giorno != null);
    }
    unoDaTab();
  }

  // Il filo è una fermata sola del Tab (#1295): una bolla ce l'ha, le frecce passano alle altre, e da lì Shift+F10 apre
  // il suo menu. Cento fermate in fila separerebbero il campo di ricerca da quello per scrivere.
  const BOLLA = '.dash-bubble[data-chat]';
  function unoDaTab() {
    if (!d) return;
    const bolle = [...d.bubblesEl.querySelectorAll(BOLLA)];
    let zero = null;
    for (const b of bolle) {
      if (b.getAttribute('tabindex') === '0' && !zero) { zero = b; continue; }
      if (b.getAttribute('tabindex') !== '-1') b.tabIndex = -1;
    }
    if (!zero && bolle.length) bolle[bolle.length - 1].tabIndex = 0;
  }
  function frecceNelFilo(e) {
    const b = e.target;
    if (!b || !b.matches || !b.matches(BOLLA)) return;
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const bolle = [...d.bubblesEl.querySelectorAll(BOLLA)];
    const i = bolle.indexOf(b);
    const j = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : bolle.length - 1;
    e.preventDefault();
    if (j < 0 || j >= bolle.length || j === i) return;
    b.tabIndex = -1;
    bolle[j].tabIndex = 0;
    bolle[j].focus();
  }

  function inFondo() {
    const a = d.bubblesEl;
    return a.scrollHeight - a.scrollTop - a.clientHeight < 40;
  }

  // ── L'ultimo messaggio in cima (#1487) ────────────────────────────────────
  // Una home che si apre mostra in cima l'ultimo messaggio e sotto il vuoto: il resto sta sopra. Il vuoto in fondo è
  // quanto basta perché «in fondo» voglia dire proprio lì, così chi scorre al fondo non trova un salto; quello che
  // arriva dopo lo consuma. `fissa`: finché l'utente non scorre e non scrive, l'ancora resta in cima anche se la
  // pagina si ridispone.
  let ancora = null;
  let fissa = false;
  let vuoto = 0;
  let voluto = 0;
  const aSchermo = (n) => n.getClientRects().length > 0;
  const inApertura = () => !d.conversa() && !d.occupata();

  function ultimoMessaggio() {
    for (let n = d.bubblesEl.lastElementChild; n; n = n.previousElementSibling) {
      if (n.matches('.dash-bubble, .dash-riga-app') && aSchermo(n)) return n;
    }
    return null;
  }

  function misura() {
    const a = d.bubblesEl;
    if (fissa && !inApertura()) fissa = false;
    if (ancora && !ancora.isConnected) ancora = fissa ? ultimoMessaggio() : null;
    let serve = 0;
    let cima = null;
    if (ancora && a.clientHeight > 0) {
      const box = a.getBoundingClientRect();
      const y = (v) => v - box.top - a.clientTop + a.scrollTop;
      // Il segno del giorno subito sopra va su con lei: dice di quando è. Quello che c'è prima esce intero dalla vista.
      const prima = ancora.previousElementSibling;
      const testa = prima && prima.classList.contains('dash-giorno') ? prima : ancora;
      let sopra = testa.previousElementSibling;
      while (sopra && !aSchermo(sopra)) sopra = sopra.previousElementSibling;
      let fondo = ancora;
      for (let n = a.lastElementChild; n && n !== ancora; n = n.previousElementSibling) if (aSchermo(n)) { fondo = n; break; }
      cima = sopra ? Math.max(0, Math.ceil(y(sopra.getBoundingClientRect().bottom))) : 0;
      const base = (parseFloat(getComputedStyle(a).paddingBottom) || 0) - vuoto;
      serve = Math.max(0, Math.ceil(cima + a.clientHeight - y(fondo.getBoundingClientRect().bottom) - base));
      // Uno scambio che ha riempito lo schermo ha consumato il vuoto: non torna se poi qualcosa si accorcia.
      if (!serve && !inApertura()) ancora = null;
    }
    if (serve !== vuoto) {
      vuoto = serve;
      a.style.setProperty('--dash-vuoto', `${serve}px`);
    }
    if (fissa && cima != null) {
      voluto = Math.min(cima, a.scrollHeight - a.clientHeight);
      if (Math.abs(a.scrollTop - voluto) > 1) a.scrollTop = voluto;
    }
  }

  // Si riparte dall'ultimo messaggio: all'apertura, alla consegna della home pronta, e quando Filo scrive mentre la home
  // è ancora come si è aperta.
  function daCapo() {
    if (!d) return;
    ancora = ultimoMessaggio();
    fissa = !!ancora && inApertura();
    misura();
    if (!fissa) d.bubblesEl.scrollTop = d.bubblesEl.scrollHeight;
  }

  // Una riga nuova con l'utente in fondo: a home appena aperta diventa la cima se è un messaggio, se no la si segue.
  function seguiNuove(giu) {
    if (inApertura() && (fissa || giu)) daCapo();
    else if (giu) d.bubblesEl.scrollTop = d.bubblesEl.scrollHeight;
  }

  // ── I pezzi ───────────────────────────────────────────────────────────────

  // In fila con chi allinea e ripassa: un annuncio arrivato mentre la coda si legge rilegge dopo di lei, non a vuoto.
  function carica() {
    const p = coda.then(caricaOra, caricaOra);
    coda = p.then(() => {}, () => {});
    return p;
  }
  async function caricaOra() {
    fineRisali();
    primo = null;
    finito = false;
    const res = await d.send({ type: MSG.FILO_CODA });
    if (!res || !res.ok) return null;
    // A filo vuoto quello che arriva dopo è tutto: si parte dall'inizio dei tempi.
    ultimo = res.ultimo || new Date(0).toISOString();
    const lista = Array.isArray(res.elementi) ? res.elementi : [];
    // Un messaggio di Filo annunciato prima che la coda arrivasse è già posato: la coda non lo rimette, lo sposta al suo ora.
    const gia = [];
    const nuove = lista.filter((v) => { const c = conChiave(v.key); if (c) gia.push(c); return !c; });
    d.bubblesEl.insertBefore(frammento(nuove), d.bubblesEl.firstChild);
    for (const n of gia) posa(n);
    if (lista.length) primo = lista[0].ts;
    finito = !!res.inizio;
    bottoneRisali();
    aggiornaRisali(lista.length);
    segnaGiorni();
    daCapo();
    return res.chatCorrente || null;
  }

  function aggiornaRisali(quanti = 1) {
    if (!primo && !quanti) statoRisali('', { nascosto: true });
    else if (finito) statoRisali('l’inizio del filo', { spento: true });
    else statoRisali('risali il filo');
  }

  // Il pezzo prima, senza che quello che l'utente sta guardando si sposti. `fino`: fino a quel punto (una ricerca).
  function sali({ fino = null } = {}) {
    if (caricando) return caricando;
    if (finito || !primo) return Promise.resolve(false);
    caricando = (async () => {
      statoRisali('carico…', { spento: true });
      const res = await d.send({ type: MSG.FILO_CODA, prima: primo, ...(fino ? { fino } : {}) });
      const lista = res && res.ok && Array.isArray(res.elementi) ? res.elementi.filter((v) => !conChiave(v.key)) : [];
      const area = d.bubblesEl;
      const prima = area.scrollHeight;
      const sopra = area.scrollTop;
      const dopoRisali = risali && risali.isConnected ? risali.nextSibling : area.firstChild;
      area.insertBefore(frammento(lista), dopoRisali);
      if (res && res.ok && res.elementi && res.elementi.length) primo = res.elementi[0].ts;
      finito = !!(res && res.ok && res.inizio);
      segnaGiorni();
      area.scrollTop = sopra + (area.scrollHeight - prima);
      aggiornaRisali();
      return lista.length > 0;
    })().finally(() => { caricando = null; });
    return caricando;
  }

  // Quello che è arrivato dopo l'ultima lettura, al suo posto. I messaggi della conversazione di questa scheda li ha già
  // disegnati il turno: tornano solo se la scheda era nascosta e a scriverli è stata un'altra (`daAltrove`).
  function allinea({ daAltrove = false } = {}) {
    if (!d || ultimo == null) return Promise.resolve();
    const p = coda.then(() => allineaOra(daAltrove), () => allineaOra(daAltrove));
    coda = p.then(() => {}, () => {});
    return p;
  }
  async function allineaOra(daAltrove) {
    if (d.occupata()) return;
    const res = await d.send({ type: MSG.FILO_CODA, dopo: ultimo });
    if (!res || !res.ok) return;
    if (res.ultimo) ultimo = res.ultimo;
    const qui = d.chatId();
    const giu = inFondo();
    let messi = 0;
    for (const v of res.elementi || []) {
      const c = conChiave(v.key);
      if (c) { aggiorna(c, v); continue; }
      if (v.k === 'msg' && v.chat === qui && !daAltrove) { riconosci(v); continue; }
      // La riga tardiva di una chat lasciata da qui (#1295): se la sua bolla è già a schermo non se ne disegna un'altra.
      if (v.k === 'msg' && d.chatLasciata && d.chatLasciata(v.chat) && riconosci(v)) continue;
      metti(v, { scorri: false });
      messi++;
    }
    if (messi) segnaGiorni();
    if (messi) seguiNuove(giu);
  }

  // Una bolla disegnata dal turno prende il nome che ha nel filo, così una ricerca la ritrova.
  function riconosci(v) {
    const testo = String(v.text || '').trim();
    if (!testo) return false;
    for (const b of d.bubblesEl.querySelectorAll(`.dash-bubble-${v.role === 'user' ? 'user' : 'filo'}:not([data-key])`)) {
      // Una risposta formattata a schermo non ha più gli asterischi del filo: si confronta il testo com'era arrivato.
      const scritto = d.scritto ? d.scritto(b) : null;
      const suo = scritto || (b.dataset.cambiTesto != null ? b.dataset.cambiTesto : b.textContent);
      if (String(suo || '').trim() !== testo) continue;
      b.dataset.key = v.key;
      b.dataset.chat = v.chat;
      // Con l'ora la bolla fa da segno: una riga tardiva posata dopo si mette prima di lei, non in fondo (#1295).
      if (v.ts && !b.dataset.ts) b.dataset.ts = v.ts;
      unoDaTab();
      return true;
    }
    return false;
  }

  function aggiorna(n, v) {
    if (v.k === 'pagine' && n._gruppo) disegnaGruppo(n, v);
    else if (v.k === 'cambio' && n._vista) statoCambio(n, v);
    else if (v.k === 'msg' && v.spontaneo && n.classList.contains('dash-bubble')) d.setBubbleText(n, v.text);
  }

  // Pagine entrate, rititolate o tolte da qualunque strada: le righe si rifanno su quelle che il filo ha adesso, le nuove
  // entrano al loro posto. Un gruppo si chiama come la sua prima pagina: tolta quella, è un'altra riga e la vecchia va.
  // `importate`: un backup ha messo nel tratto già disegnato anche chat e pagine sue, che compaiono al loro posto (#1256).
  const stessoGruppo = (g, v) => !!g && g.ts === v.ts && JSON.stringify(g.pagine) === JSON.stringify(v.pagine);
  function ripassaPagine({ importate = false } = {}) {
    if (!d) return Promise.resolve();
    const fai = async () => {
      // Un filo che era vuoto si carica come all'apertura: l'ultimo pezzo, non tutto il backup una riga alla volta.
      if (!primo) {
        if (ultimo == null || d.occupata()) return;
        await (importate ? caricaOra() : allineaOra(false));
        return;
      }
      const res = await d.send({ type: MSG.FILO_CODA, fino: primo });
      if (!res || !res.ok || !primo) return;
      const giu = inFondo();
      let messi = 0;
      const da = ms(primo);
      const gruppi = new Map((res.elementi || []).filter((v) => v.k === 'pagine' && ms(v.ts) >= da).map((v) => [v.key, v]));
      const perPagina = new Map();
      for (const v of gruppi.values()) for (const p of v.pagine) perPagina.set(p.id, v);
      for (const r of [...d.bubblesEl.querySelectorAll('.dash-pagine')]) {
        // La riga resta la stessa (aperta, al suo posto) anche quando il gruppo ha cambiato nome.
        const v = gruppi.get(r.dataset.key)
          || ((r._gruppo && r._gruppo.pagine) || []).map((p) => perPagina.get(p.id)).find((x) => x && gruppi.has(x.key));
        if (!v) { r.remove(); continue; }
        gruppi.delete(v.key);
        r.dataset.key = v.key;
        r.dataset.ts = v.ts;
        // Ripassa a ogni visita: un gruppo che non è cambiato non si ridisegna, così non perde il fuoco né il passaggio.
        if (!stessoGruppo(r._gruppo, v)) disegnaGruppo(r, v);
      }
      for (const v of gruppi.values()) { metti(v, { scorri: false }); messi++; }
      if (importate) {
        const qui = d.chatId();
        for (const v of res.elementi || []) {
          if (v.k === 'pagine' || ms(v.ts) < da || conChiave(v.key)) continue;
          if (v.k === 'msg' && v.chat === qui) { riconosci(v); continue; }
          metti(v, { scorri: false });
          messi++;
        }
      }
      segnaGiorni();
      if (messi) seguiNuove(giu);
    };
    const p = coda.then(fai, fai);
    coda = p.then(() => {}, () => {});
    return p;
  }

  // Una riga sola al suo posto: un messaggio di Filo scritto di sua iniziativa, quello che è arrivato da altrove.
  function metti(v, { scorri = true } = {}) {
    if (!d) return;
    const c = conChiave(v.key);
    if (c) { aggiorna(c, v); return; }
    const giu = inFondo();
    const f = frammento([v]);
    const nodi = [...f.childNodes];
    for (const n of nodi) posa(n);
    if (!primo) { primo = v.ts; aggiornaRisali(); }
    if (scorri) {
      segnaGiorni();
      seguiNuove(giu);
    }
  }

  // Va al punto del filo dove sta una conversazione (o un suo messaggio), caricando i pezzi che mancano.
  async function vaiA({ chat, i = null, app = false, ts = null }) {
    fineRisali();
    const chiave = app ? `a:${chat}` : (i != null ? `m:${chat}:${i}` : null);
    const trova = () => (chiave && conChiave(chiave))
      || [...d.bubblesEl.querySelectorAll('[data-chat]')].find((n) => n.dataset.chat === chat) || null;
    let n = trova();
    if (!n && ts && !finito) {
      await sali({ fino: ts });
      n = trova();
    }
    if (!n) return false;
    fissa = false;
    n.scrollIntoView({ block: 'center' });
    n.classList.remove('dash-trovato');
    void n.offsetWidth;
    n.classList.add('dash-trovato');
    if (app && n.classList.contains('dash-riga-app') && d.righe.apri) d.righe.apri(n);
    return true;
  }

  function togliChat(id) {
    for (const n of [...d.bubblesEl.querySelectorAll('[data-chat]')]) if (n.dataset.chat === id && !n.classList.contains('dash-riga-app')) n.remove();
    segnaGiorni();
  }

  // #1295 — una conversazione rimessa nel filo torna al suo posto nel tempo, se quel tratto è già a schermo.
  async function rimettiChat(id) {
    if (!d || !id) return;
    for (const n of [...d.bubblesEl.querySelectorAll('.dash-nascosta')]) if (n.dataset.nascosta === id) n.remove();
    if (!primo) { segnaGiorni(); return; }
    const res = await d.send({ type: MSG.FILO_CODA, fino: primo });
    const da = ms(primo);
    for (const v of (res && res.ok && res.elementi) || []) {
      if (v.chat === id && (v.k === 'msg' || v.k === 'app') && ms(v.ts) >= da && !conChiave(v.key)) metti(v, { scorri: false });
    }
    segnaGiorni();
  }

  function rigaNascosta(id, prima) {
    const riga = el('div', 'dash-nascosta');
    riga.dataset.nascosta = id;
    riga.dataset.ts = prima.dataset.ts || '';
    const ic = el('span', 'dash-nascosta-ico');
    ic.innerHTML = icona('eyeOff', 13);
    const b = el('button', 'dash-nascosta-rimetti', 'Rimetti');
    b.type = 'button';
    b.title = 'Rimetti la conversazione nel filo';
    b.addEventListener('click', () => {
      b.disabled = true;
      d.send({ type: MSG.FILO_CHAT_NASCONDI, id, nascosta: false })
        .then((r) => (r && r.ok ? rimettiChat(id) : null))
        .catch(() => {})
        .finally(() => { b.disabled = false; });
    });
    riga.append(ic, el('span', 'dash-nascosta-testo', 'Conversazione nascosta'), b);
    prima.parentNode.insertBefore(riga, prima);
    return riga;
  }

  // Nascosta altrove (a parole, da un'altra scheda): resta la stessa riga che lascia il tasto destro, una sola.
  function nascostaAltrove(id) {
    if (!d || !id) return;
    const gia = [...d.bubblesEl.querySelectorAll('.dash-nascosta')].some((n) => n.dataset.nascosta === id);
    const primo = [...d.bubblesEl.querySelectorAll('[data-chat]')].find((n) => n.dataset.chat === id);
    if (!gia && primo && primo.parentNode) rigaNascosta(id, primo);
    togliChat(id);
  }

  // Nascondere si disfa (#1295): al posto della conversazione resta una riga che la rimette, finché la pagina è aperta.
  // La riga nasce prima della risposta: l'annuncio del main toglie le bolle anche da qui, e potrebbe arrivare prima.
  // `vicino`: la riga di un'altra app (#974), che può stare nel filo senza la targa della chat.
  async function nascondiConversazione(id, { vicino = null } = {}) {
    const nodi = [...d.bubblesEl.querySelectorAll('[data-chat]')].filter((n) => n.dataset.chat === id);
    if (vicino && vicino.isConnected && !nodi.includes(vicino)) nodi.unshift(vicino);
    // Chi l'ha nascosta da tastiera ritrova il fuoco su «Rimetti», non sulla pagina.
    const daTastiera = nodi.some((n) => n.contains(document.activeElement));
    const riga = nodi[0] && nodi[0].parentNode ? rigaNascosta(id, nodi[0]) : null;
    const b = riga && riga.querySelector('button');
    if (riga) riga.hidden = true;
    let res = null;
    try { res = await d.send({ type: MSG.FILO_CHAT_NASCONDI, id, nascosta: true }); } catch (_) { res = null; }
    if (!res || !res.ok) { if (riga) riga.remove(); return; }
    togliChat(id);
    if (riga) {
      riga.hidden = false;
      if (daTastiera) b.focus();
    }
  }

  // ── Tasto destro ──────────────────────────────────────────────────────────

  function vociMenu(target) {
    const e = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    if (!e || !d || !d.bubblesEl.contains(e)) return [];
    const pagina = e.closest('.dash-pagina');
    const gruppo = e.closest('.dash-pagine');
    if (pagina && gruppo && gruppo._gruppo) {
      const p = gruppo._gruppo.pagine.find((x) => x.id === pagina.dataset.id);
      if (!p) return [];
      const dove = global.SN_FILO_CODA.daAprire(p);
      return [
        { type: 'item', icon: icona('globe', 16), label: dove && dove.sito ? 'Apri il sito' : 'Riapri la pagina', onClick: () => { riapri(p).catch(() => {}); } },
        { type: 'item', icon: icona('copy', 16), label: dove && dove.sito ? 'Copia l’indirizzo del sito' : 'Copia l’indirizzo', onClick: () => { navigator.clipboard.writeText(dove && dove.sito ? dove.url : p.url).catch(() => {}); } },
        { type: 'item', icon: icona('trash', 16), label: 'Togli dal filo', onClick: () => { togliPagine(gruppo, [p.id]).catch(() => {}); } },
      ];
    }
    if (gruppo && gruppo._gruppo) {
      const n = gruppo._gruppo.pagine.length;
      const aperta = gruppo.classList.contains('dash-pagine-aperte');
      return [
        { type: 'item', icon: icona('caretDown', 16), label: aperta ? 'Chiudi le pagine' : 'Mostra le pagine', onClick: () => apriGruppo(gruppo) },
        { type: 'item', icon: icona('trash', 16), label: n === 1 ? 'Togli dal filo' : `Togli queste ${n} pagine dal filo`, onClick: () => { togliPagine(gruppo, gruppo._gruppo.pagine.map((x) => x.id)).catch(() => {}); } },
      ];
    }
    const cambio = e.closest('.dash-cambio');
    if (cambio && cambio._vista) {
      const v = cambio._vista;
      if (v.annullatoDa) return [{ type: 'item', icon: icona('undo', 16), label: `Rifai · ${v.frase}`, onClick: () => annullaCambio(cambio) }];
      if (v.annullabile) return [{ type: 'item', icon: icona('undo', 16), label: `Annulla · ${v.frase}`, onClick: () => annullaCambio(cambio) }];
    }
    // Una conversazione della home si toglie dal filo da una sua bolla: la Cronologia, che lo faceva, non c'è più (#872).
    // `azione`: il menu del tasto destro misura l'attesa delle voci del catalogo (#1461).
    const bolla = e.closest('.dash-bubble[data-chat]');
    if (bolla && bolla.dataset.chat) {
      const id = bolla.dataset.chat;
      return [
        { type: 'item', icon: icona('eyeOff', 16), label: 'Nascondi la conversazione', azione: 'chat-archive', onClick: () => { nascondiConversazione(id).catch(() => {}); } },
        { type: 'item', icon: icona('trash', 16), label: 'Togli la conversazione dal filo', azione: 'chat-archive', onClick: () => { togliConversazione(id).catch(() => {}); } },
      ];
    }
    const nascosta = e.closest('.dash-nascosta');
    if (nascosta && nascosta.dataset.nascosta) {
      return [{ type: 'item', icon: icona('restore', 16), label: 'Rimetti la conversazione nel filo', azione: 'chat-archive', onClick: () => { nascosta.querySelector('button').click(); } }];
    }
    return [];
  }

  async function togliConversazione(id) {
    const C = global.SN_CONFIRM_UI;
    const ok = C ? await C.confirm({
      title: 'Togliere la conversazione dal filo?',
      text: 'Tutti i suoi messaggi spariscono dal filo e dal computer, e Filo non la ritrova più cercando.',
      okLabel: 'Togli',
    }) : false;
    if (!ok) return;
    await d.send({ type: MSG.FILO_CHAT_DELETE, id });
    togliChat(id);
  }

  let attesaCambi = null;
  let attesaPagine = null;
  function init(deps) {
    d = deps;
    global.SN_VOCI_PAGINA = Array.isArray(global.SN_VOCI_PAGINA) ? global.SN_VOCI_PAGINA : [];
    if (!global.SN_VOCI_PAGINA.includes(vociMenu)) global.SN_VOCI_PAGINA.push(vociMenu);
    const occhio = new ResizeObserver(() => misura());
    occhio.observe(d.bubblesEl, { box: 'border-box' });
    new MutationObserver((cambi) => {
      for (const c of cambi) {
        for (const n of c.removedNodes) if (n.nodeType === 1) occhio.unobserve(n);
        for (const n of c.addedNodes) if (n.nodeType === 1) occhio.observe(n);
      }
      misura();
    }).observe(d.bubblesEl, { childList: true });
    for (const ev of ['wheel', 'touchstart', 'pointerdown', 'keydown']) d.bubblesEl.addEventListener(ev, () => { fissa = false; }, { passive: true });
    d.bubblesEl.addEventListener('keydown', frecceNelFilo);
    d.bubblesEl.addEventListener('focusin', (e) => {
      const b = e.target;
      if (!b || !b.matches || !b.matches(BOLLA) || b.tabIndex === 0) return;
      for (const x of d.bubblesEl.querySelectorAll(`${BOLLA}[tabindex="0"]`)) x.tabIndex = -1;
      b.tabIndex = 0;
    });
    d.bubblesEl.addEventListener('scroll', () => {
      const a = d.bubblesEl;
      // Uno scorrimento che non è quello dell'ancora (barra, tasti, un'altra pagina che porta qui) la lascia andare.
      if (fissa && Math.abs(a.scrollTop - voluto) > 1) fissa = false;
      if (a.scrollTop < 40 && a.scrollHeight > a.clientHeight + 40 && !finito && primo) sali().catch(() => {});
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') allinea({ daAltrove: true }).catch(() => {});
      else fineRisali();
    });
    try {
      global.chrome.runtime.onMessage.addListener((m) => {
        if (m && m.type === MSG.FILO_PAGINE_CAMBIATE) {
          // Una visita e il titolo che la pagina si dà subito dopo: una rilettura sola.
          clearTimeout(attesaPagine);
          attesaPagine = setTimeout(() => { ripassaPagine().catch(() => {}); }, 120);
          return;
        }
        if (m && m.type === MSG.DATI_IMPORTATI) { ripassaPagine({ importate: true }).catch(() => {}); return; }
        if (!m || m.type !== MSG.CAMBI_AGGIORNATI) return;
        clearTimeout(attesaCambi);
        attesaCambi = setTimeout(() => {
          allinea().catch(() => {});
          rileggiCambi().catch(() => {});
        }, 120);
      });
    } catch (_) {}
  }

  global.SN_DASH_CODA = {
    init, carica, sali, fineRisali, allinea, metti, vaiA, daCapo, togliChat, rimettiChat, nascondi: nascondiConversazione, nascostaAltrove, togliIndirizzo, segnaGiorni, nomeDelGiorno,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

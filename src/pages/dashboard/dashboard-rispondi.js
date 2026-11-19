// Le azioni sui messaggi della home (#1620, #2096): quali tasti ha ogni bolla, le citazioni sopra il campo e dentro la
// bolla che parte (citazione, commento, citazione, commento: #2346), il salto al testo citato. Non tocca il DOM al
// caricamento. Cosa si salva di una citazione e come la legge il modello: src/shared/rispostaA.js.
(function (global) {
  'use strict';

  let d = null;
  // Il testo come l'ha scritto Filo, bolla per bolla: a schermo è già formattato, e il posto nel filo si ritrova da lui.
  const scritti = new WeakMap();
  let anteprima = null;
  // Le citazioni nel campo, in ordine. `commento` è il testo che le segue; quello dell'ultima è il campo stesso.
  let citate = [];
  // Un commento venuto da fuori (incollato, trascinato, o spostato dal campo che lo era): il messaggio lo è tutto.
  let fuori = false;

  const R = () => global.SN_RISPOSTA_A;
  const icona = (nome, size = 16) => (global.SN_ICONS && typeof global.SN_ICONS[nome] === 'function' ? global.SN_ICONS[nome](size) : '');
  const elDi = (t) => (t && t.nodeType === 1 ? t : (t && t.parentElement) || null);
  const unisci = (...parti) => parti.map((p) => String(p || '').trim()).filter(Boolean).join('\n');

  function ricorda(bolla, testo) {
    if (bolla) scritti.set(bolla, String(testo == null ? '' : testo));
  }
  const scritto = (bolla) => (bolla && scritti.has(bolla) ? scritti.get(bolla) : null);

  // Quello che si legge nella bolla, senza i bottoni sotto né le note: è quello che va negli appunti.
  function testoDi(bolla) {
    if (!bolla) return '';
    if (scritti.has(bolla)) {
      const s = scritti.get(bolla);
      const Md = global.SN_MARKDOWN;
      return (bolla.classList.contains('dash-bubble-md') && Md && Md.testo ? Md.testo(s) : s).trim();
    }
    const copia = bolla.cloneNode(true);
    for (const n of copia.querySelectorAll('.dash-bubble-actions, .dash-msg-azioni, .dash-bubble-img, button')) n.remove();
    return String(copia.textContent || '').trim();
  }

  // Un passo come si legge: dello scritto di Filo restano le parole, senza i segni rimasti a metà del taglio.
  function testoDelPasso(pezzo, role) {
    const Md = global.SN_MARKDOWN;
    if (role === 'user' || !Md || !Md.testo) return String(pezzo || '').trim();
    return Md.testo(pezzo).replace(/\]\([^)\s]*\)?/g, '').replace(/\*\*|__|~~|`/g, '').replace(/^[\s[*_]+|[\s*_]+$/g, '').trim();
  }

  const diUtente = (b) => b.classList.contains('dash-bubble-user');
  const modificabile = (b) => diUtente(b) && !!d.modificabile && d.modificabile(b);
  // Un messaggio nel filo, finito e con qualcosa da leggere (o, dell'utente, da rimettere nel campo): le bolle dentro il
  // blocco di attività sono passi, il seguito in attesa ha il suo menu.
  function rispondibile(b) {
    if (!b || !d || b.parentElement !== d.bubblesEl || b.hidden) return false;
    if (diUtente(b)) return !b.classList.contains('dash-bubble-attesa') && (!!testoDi(b) || modificabile(b));
    return b.classList.contains('dash-bubble-filo')
      && !b.classList.contains('dash-bubble-streaming') && !b.classList.contains('dash-bubble-pending')
      && !!testoDi(b);
  }
  // Le azioni di una bolla, le stesse per i tasti e per il tasto destro: Copia e Rispondi sotto una risposta, Copia,
  // Modifica e Cita sotto un messaggio dell'utente. La barra è quella di tutte le chat (src/shared/azioniMessaggio.js);
  // le sue etichette sono attributi: nella bolla non entra testo, e chi la confronta col filo la ritrova.
  function azioniDi(b) {
    const a = [];
    if (testoDi(b)) a.push('copia');
    if (diUtente(b)) {
      if (modificabile(b)) a.push('modifica');
      if (testoDi(b)) a.push('cita');
    } else a.push('rispondi');
    return a;
  }
  let tasti = null;

  // Copia il testo come si legge; la copia conta come le altre della home.
  async function copia(b) {
    const testo = testoDi(b);
    if (!testo) return false;
    const ok = await global.SN_AZIONI_MESSAGGIO.copiaTesto(testo);
    if (ok) d.contaCopia(b);
    return ok;
  }

  // ── Il testo selezionato ──────────────────────────────────────────────────
  // I nodi di testo che si leggono nella bolla, senza la barra dei tasti.
  function nodiDiTesto(el) {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest('.dash-msg-azioni, button, .dash-citata') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
    return out;
  }
  // Il passo selezionato (`sel`, da src/shared/azioniMessaggio.js → selezioneIn) misurato sullo scritto del messaggio;
  // `null` se la selezione è il messaggio intero o non c'è.
  function passoSelezionato(el, scrittoDelMessaggio, sel = null) {
    const s = sel || global.SN_AZIONI_MESSAGGIO.selezioneIn(el);
    const Ra = R();
    if (!s || !Ra || !scrittoDelMessaggio) return null;
    const t = Ra.trovaPasso(scrittoDelMessaggio, s.testo, Ra.lettere(s.prima));
    return t && !t.tutto ? { da: t.da, a: t.a } : null;
  }

  // ── Le citazioni sopra il campo ───────────────────────────────────────────
  // Il posto nel filo lo sa la bolla quando il filo l'ha riconosciuta (`data-key`); appena scritta no, e il main la
  // ritrova dal testo nella chat di adesso. Con del testo selezionato nella bolla si cita quel passo soltanto.
  function rispondi(b, sel = null) {
    const k = /^m:(.+):(\d+)$/.exec(b.dataset.key || '');
    const role = diUtente(b) ? 'user' : 'filo';
    const s = scritto(b) ?? testoDi(b);
    const passo = passoSelezionato(b, s, sel);
    return aggiungi({
      bolla: b,
      chat: k ? k[1] : '',
      i: k ? Number(k[2]) : null,
      ts: b.dataset.ts || '',
      role,
      scritto: s,
      testo: passo ? testoDelPasso(s.slice(passo.da, passo.a), role) : testoDi(b),
      ...(passo ? { passo: true, da: passo.da, a: passo.a } : {}),
    });
  }

  // Un messaggio del filo che non è una bolla della home (uno scambio di un'altra app, #2096): si cita col suo posto.
  // `el`: dove sta a schermo, per citarne solo il passo selezionato (`sel`, quella di quando si è aperto il menu).
  function cita({ chat = '', i = null, ts = '', role = 'filo', scritto: s = '', testo = '', el = null, sel = null } = {}) {
    const tutto = String(s || testo || '');
    if (!d || !tutto.trim()) return false;
    const ruolo = role === 'user' ? 'user' : 'filo';
    const passo = el ? passoSelezionato(el, tutto, sel) : null;
    const Md = global.SN_MARKDOWN;
    const intero = s ? (ruolo === 'filo' && Md && Md.testo ? Md.testo(s) : s).trim() : String(testo).trim();
    return aggiungi({
      bolla: null, chat, i: Number.isInteger(i) ? i : null, ts, role: ruolo, scritto: tutto,
      testo: passo ? testoDelPasso(tutto.slice(passo.da, passo.a), ruolo) : intero,
      ...(passo ? { passo: true, da: passo.da, a: passo.a } : {}),
    });
  }

  const stessa = (x, y) => !!x && !!y && x.chat === y.chat && x.i === y.i && x.da === y.da && x.a === y.a
    && (x.chat ? true : x.bolla === y.bolla && x.scritto === y.scritto);

  // Una citazione nuova va in fondo: quello che l'utente ha scritto finora diventa il commento di quella prima.
  function aggiungi(c) {
    const ultima = citate[citate.length - 1];
    const scrittoOra = d.inputEl.value;
    if (ultima && stessa(ultima, c) && !scrittoOra.trim()) { d.inputEl.focus(); return true; }
    if (citate.length >= (R() ? R().MAX_CITAZIONI : 200)) return false;
    if (ultima && scrittoOra.trim()) {
      if (d.daFuori && d.daFuori()) fuori = true;
      ultima.commento = scrittoOra;
      campo('');
    }
    citate.push({ ...c, commento: '' });
    disegnaAnteprima();
    d.inputEl.focus();
    return true;
  }

  function campo(valore) {
    d.inputEl.value = valore;
    try { d.inputEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    if (fuori && valore.trim() && d.segnaDaFuori) d.segnaDaFuori();
  }

  function disegnaAnteprima() {
    if (!anteprima) return;
    anteprima.hidden = !citate.length;
    anteprima.replaceChildren(...citate.map((c, k) => pezzo(c, k)));
  }

  function pezzo(c, k) {
    const el = document.createElement('div');
    el.className = 'dash-citazione-pezzo';
    el._citata = c;
    const riga = document.createElement('div');
    riga.className = 'dash-citazione-riga';
    const vai = document.createElement('button');
    vai.type = 'button';
    vai.className = 'dash-citazione-vai';
    vai.title = 'Vai al messaggio';
    if (c.role === 'user') {
      const chi = document.createElement('span');
      chi.className = 'dash-citazione-chi';
      chi.textContent = 'Tu';
      vai.append(chi);
    }
    const testo = document.createElement('span');
    testo.className = 'dash-citazione-testo';
    testo.textContent = c.testo;
    vai.append(testo);
    vai.addEventListener('click', () => { vaiA(c).catch(() => {}); });
    const togli = document.createElement('button');
    togli.type = 'button';
    togli.className = 'dash-citazione-togli';
    togli.setAttribute('aria-label', 'Non rispondere');
    togli.title = 'Non rispondere';
    togli.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    togli.addEventListener('click', () => { togliCitazione(citate.indexOf(c)); d.inputEl.focus(); });
    riga.append(vai, togli);
    el.append(riga);
    // Il commento di una citazione che non è l'ultima: si scrive dove sta, e Invio manda il messaggio come dal campo.
    if (k < citate.length - 1 && String(c.commento || '').trim()) {
      const t = document.createElement('textarea');
      t.className = 'dash-citazione-commento';
      t.rows = 1;
      t.value = c.commento;
      t.setAttribute('aria-label', 'Commento alla citazione');
      t.addEventListener('input', () => { c.commento = t.value; d.campoCambiato && d.campoCambiato(); });
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        e.preventDefault();
        d.formEl.requestSubmit();
      });
      el.append(t);
    }
    return el;
  }

  function creaAnteprima(host) {
    host.innerHTML = '';
    anteprima = host;
    disegnaAnteprima();
  }

  // Tolta una citazione, il suo commento resta: va a quella prima (o, se era la prima, a quella dopo).
  function togliCitazione(k) {
    if (k < 0 || k >= citate.length) return false;
    const c = citate[k];
    const ultima = k === citate.length - 1;
    if (ultima) {
      const prima = citate[k - 1];
      if (prima && String(prima.commento || '').trim()) campo(unisci(prima.commento, d.inputEl.value));
      if (prima) prima.commento = '';
    } else if (String(c.commento || '').trim()) {
      if (k > 0) citate[k - 1].commento = unisci(citate[k - 1].commento, c.commento);
      else if (k + 1 === citate.length - 1) campo(unisci(c.commento, d.inputEl.value));
      else citate[k + 1].commento = unisci(c.commento, citate[k + 1].commento);
    }
    citate.splice(k, 1);
    disegnaAnteprima();
    return true;
  }

  // Lascia tutte le citazioni; i commenti restano nel campo, in ordine.
  function annulla() {
    if (!citate.length) return false;
    const testi = citate.slice(0, -1).map((c) => c.commento);
    citate = [];
    campo(unisci(...testi, d.inputEl.value));
    disegnaAnteprima();
    return true;
  }

  const commenti = () => citate.some((c, k) => k < citate.length - 1 && String(c.commento || '').trim());

  // Quello che parte col messaggio: le parole, commento dopo commento, e le citazioni col posto del loro commento. Il
  // campo l'ha già letto chi chiama (`ultimo`).
  function prendi(ultimo = '') {
    if (!citate.length) return null;
    let testo = '';
    const lista = citate.map((c, k) => {
      const parole = String(k === citate.length - 1 ? ultimo : c.commento || '').trim();
      if (parole && testo) testo += '\n';
      const pos = testo.length;
      testo += parole;
      const { commento, ...resto } = c;
      return { ...resto, pos };
    });
    citate = [];
    disegnaAnteprima();
    return { testo, citate: lista };
  }
  // Un messaggio che non parte torna nel campo con le sue citazioni: ognuna col suo commento, l'ultimo nel campo (che
  // torna a chi chiama).
  function rimetti(l, testo = '') {
    const lista = (Array.isArray(l) ? l : l ? [l] : []).filter((c) => c && typeof c === 'object' && !c.manca);
    const t = String(testo || '');
    if (!lista.length) return t.trim();
    const ord = lista.map((c, k) => ({ c, k, pos: Math.min(Number.isInteger(c.pos) && c.pos > 0 ? c.pos : 0, t.length) }))
      .sort((x, y) => x.pos - y.pos || x.k - y.k);
    citate = ord.map(({ c, pos }, j) => {
      const fine = j + 1 < ord.length ? ord[j + 1].pos : t.length;
      const { pos: _p, ...resto } = c;
      return { ...resto, commento: t.slice(pos, fine).trim() };
    });
    const testa = t.slice(0, ord[0].pos).trim();
    if (testa) citate[0].commento = unisci(testa, citate[0].commento);
    const ultimo = citate[citate.length - 1].commento;
    citate[citate.length - 1].commento = '';
    disegnaAnteprima();
    return ultimo;
  }

  // Quello che il main riceve: il posto se si sa, e il testo per ritrovarlo o per stare al suo posto.
  function perIlMain(l) {
    const Ra = R();
    const lista = (Array.isArray(l) ? l : l ? [l] : []).filter(Boolean);
    if (!lista.length || !Ra) return null;
    const out = lista.map((c) => Ra.daPagina({ chat: c.chat, i: c.i, testo: c.scritto, role: c.role, da: c.da, a: c.a, pos: c.pos })).filter(Boolean);
    return out.length ? out : null;
  }
  // Quello che resta nello storico della scheda: al main serve solo se il filo non si legge, e ne basta quello che si legge.
  function perLoStorico(l) {
    const Ra = R();
    const lista = (Array.isArray(l) ? l : l ? [l] : []).filter((c) => c && !c.manca);
    if (!lista.length || !Ra) return null;
    const out = lista.map((c) => Ra.daPagina({
      chat: c.chat, i: c.i, role: c.role, testo: Ra.taglia(c.testo, Ra.PER_IL_MODELLO), passo: c.passo === true, pos: c.pos,
    })).filter(Boolean);
    return out.length ? out : null;
  }

  // ── Le citazioni dentro la bolla che parte ────────────────────────────────
  // Il testo sta in attributi disegnati dal CSS: la bolla resta fatta delle sole parole dell'utente, che è come il filo
  // la riconosce, la cerca e la copia. Ognuna sta prima del suo commento (`pos` sulle parole dell'utente).
  function citazione(c) {
    const q = document.createElement('span');
    q.className = 'dash-citata';
    const testo = c.manca ? 'Messaggio non più nel filo' : (String(c.testo || '').trim() || '…');
    if (c.role === 'user') q.dataset.chi = 'Tu';
    q.dataset.testo = testo;
    q.setAttribute('aria-label', `In risposta a ${c.role === 'user' ? 'te' : 'Filo'}: ${testo}`);
    if (c.manca) q.classList.add('dash-citata-manca');
    else {
      q.setAttribute('role', 'button');
      q.tabIndex = 0;
      q.title = 'Vai al messaggio';
    }
    q._citata = c;
    return q;
  }
  // Dove inserire una citazione a `pos` caratteri dalle parole della bolla: un figlio diretto, spezzando il testo.
  function punto(bolla, pos) {
    if (pos <= 0) return bolla.firstChild;
    let fatti = 0;
    for (const n of nodiDiTesto(bolla)) {
      const l = n.data.length;
      if (fatti + l >= pos) {
        let figlio = n;
        while (figlio.parentNode && figlio.parentNode !== bolla) figlio = figlio.parentNode;
        if (figlio !== n) return pos - fatti < l / 2 ? figlio : figlio.nextSibling;
        return pos - fatti >= l ? n.nextSibling : n.splitText(pos - fatti);
      }
      fatti += l;
    }
    const azioni = bolla.querySelector(':scope > .dash-msg-azioni');
    return azioni || null;
  }
  // `l`: l'elenco (o una sola, come prima di #2346) con `testo` già da leggere.
  function citaIn(bolla, l) {
    const lista = (Array.isArray(l) ? l : l ? [l] : []).filter((c) => c && typeof c === 'object');
    if (!bolla || !lista.length) return null;
    for (const v of bolla.querySelectorAll(':scope > .dash-citata')) v.remove();
    const ord = lista.map((c, k) => ({ c, k, pos: Number.isInteger(c.pos) && c.pos > 0 ? c.pos : 0 }))
      .sort((x, y) => y.pos - x.pos || y.k - x.k);
    let prima = null;
    for (const { c, pos } of ord) {
      const q = citazione(c);
      bolla.insertBefore(q, punto(bolla, pos));
      // L'a capo fra due commenti lo fa già la citazione, che sta su una riga sua.
      const p = q.previousSibling;
      if (p && p.nodeType === 3 && p.data.endsWith('\n')) p.data = p.data.slice(0, -1);
      const n = q.nextSibling;
      if (n && n.nodeType === 3 && n.data.startsWith('\n')) n.data = n.data.slice(1);
      prima = q;
    }
    return prima;
  }

  // Le citazioni come le manda il filo (src/shared/rispostaA.js, risolviTutte): il testo è quello scritto.
  function dalFilo(r) {
    const Md = global.SN_MARKDOWN;
    return (Array.isArray(r) ? r : r && typeof r === 'object' ? [r] : []).filter((x) => x && typeof x === 'object').map((x) => {
      const role = x.role === 'user' ? 'user' : 'filo';
      const s = String(x.testo == null ? '' : x.testo);
      return {
        chat: typeof x.chat === 'string' ? x.chat : '', i: Number.isInteger(x.i) ? x.i : null, ts: x.ts || '',
        role, manca: x.manca === true, scritto: '',
        ...(x.passo === true && Number.isInteger(x.da) && Number.isInteger(x.a) ? { passo: true, da: x.da, a: x.a } : {}),
        ...(Number.isInteger(x.pos) && x.pos > 0 ? { pos: x.pos } : {}),
        testo: x.passo === true ? testoDelPasso(s, role) : (Md && Md.testo ? Md.testo(s) : s).trim(),
      };
    });
  }

  // ── Il salto al testo citato ──────────────────────────────────────────────
  function luce(n) {
    n.classList.remove('dash-trovato');
    void n.offsetWidth;
    n.classList.add('dash-trovato');
  }
  // Seleziona nella bolla il testo citato: il passo, o tutto il messaggio. Il campo lascia il fuoco, o la selezione
  // resterebbe spenta.
  function seleziona(bolla, c) {
    const nodi = nodiDiTesto(bolla);
    const dom = nodi.map((n) => n.data).join('');
    if (!dom.trim()) return false;
    let da = dom.length - dom.trimStart().length;
    let a = dom.trimEnd().length;
    const s = scritto(bolla);
    if (c.passo && s != null && Number.isInteger(c.da) && Number.isInteger(c.a)) {
      const Ra = R();
      const t = Ra ? Ra.trovaPasso(dom, s.slice(c.da, c.a), Ra.lettere(s.slice(0, c.da))) : null;
      if (t) ({ da, a } = t);
    }
    const dove = (k, fine) => {
      let fatti = 0;
      for (const n of nodi) {
        if (k < fatti + n.data.length || (fine && k === fatti + n.data.length)) return [n, k - fatti];
        fatti += n.data.length;
      }
      const u = nodi[nodi.length - 1];
      return [u, u.data.length];
    };
    const range = document.createRange();
    range.setStart(...dove(da, false));
    range.setEnd(...dove(a, true));
    const att = document.activeElement;
    if (att && d.formEl.contains(att) && typeof att.blur === 'function') att.blur();
    const sel = global.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const vista = elDi(range.startContainer);
    if (vista && vista !== bolla) vista.scrollIntoView({ block: 'center' });
    return true;
  }
  const bollaDi = (chiave) => (chiave ? [...d.bubblesEl.querySelectorAll('[data-key]')].find((n) => n.dataset.key === chiave) : null);
  async function vaiA(c) {
    const chiave = c.chat && c.i != null ? `m:${c.chat}:${c.i}` : '';
    let qui = (c.bolla && c.bolla.isConnected ? c.bolla : null) || bollaDi(chiave);
    if (qui) {
      qui.scrollIntoView({ block: 'center' });
      luce(qui);
    } else {
      if (!chiave || !(await d.vaiA({ chat: c.chat, i: c.i, ts: c.ts || null }))) return false;
      qui = bollaDi(chiave);
    }
    if (qui) seleziona(qui, c);
    return true;
  }
  async function vaiDallaCitazione(q) {
    const c = q && q._citata;
    if (!c || c.manca) return;
    if (await vaiA(c)) return;
    // Non c'è più (la sua conversazione è stata tolta o nascosta): la citazione lo dice, invece di non fare niente.
    const nuova = citazione({ ...c, manca: true, bolla: null });
    q.replaceWith(nuova);
  }

  // ── Tasto destro ──────────────────────────────────────────────────────────
  function vociMenu(target) {
    const el = elDi(target);
    if (!el || !d) return [];
    const q = el.closest('.dash-citata');
    if (q && d.bubblesEl.contains(q) && q._citata && !q._citata.manca) {
      return [{ type: 'item', icon: icona('reply', 16), label: 'Vai al messaggio citato', onClick: () => { vaiDallaCitazione(q).catch(() => {}); } }];
    }
    const p = anteprima && anteprima.contains(el) ? el.closest('.dash-citazione-pezzo') : null;
    if (p && citate.includes(p._citata)) {
      return [{ type: 'item', icon: icona('close', 16), label: 'Non rispondere', onClick: () => { togliCitazione(citate.indexOf(p._citata)); d.inputEl.focus(); } }];
    }
    if (!tasti || !d.bubblesEl.contains(el)) return [];
    return tasti.vociMenu(el);
  }

  function init(deps) {
    d = deps;
    creaAnteprima(d.anteprimaEl);
    tasti = global.SN_AZIONI_MESSAGGIO.attacca(d.bubblesEl, {
      messaggio: '.dash-bubble-filo, .dash-bubble-user',
      pronto: rispondibile,
      testo: testoDi,
      ruolo: (b) => (diUtente(b) ? 'user' : 'filo'),
      azioni: azioniDi,
      copia: (_testo, b) => copia(b),
      classi: { barra: 'dash-msg-azioni', tasto: 'dash-msg-azione', ok: 'dash-copiato', no: 'dash-non-copiato', destra: '' },
      extra: {
        rispondi: { ...global.SN_AZIONI_MESSAGGIO.AZIONI.rispondi, fai: (b, _t, sel) => rispondi(b, sel) },
        modifica: { icona: 'pencil', etichetta: 'Modifica', voce: 'Modifica', fai: (b) => { if (d.modifica) d.modifica(b); } },
        cita: { icona: 'reply', etichetta: 'Cita', voce: 'Cita', fai: (b, _t, sel) => rispondi(b, sel) },
      },
    });
    d.bubblesEl.addEventListener('click', (e) => {
      const q = elDi(e.target) && elDi(e.target).closest('.dash-citata');
      if (q && d.bubblesEl.contains(q)) { e.stopPropagation(); vaiDallaCitazione(q).catch(() => {}); }
    });
    d.bubblesEl.addEventListener('keydown', (e) => {
      const q = e.target && e.target.classList && e.target.classList.contains('dash-citata') ? e.target : null;
      if (q && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); vaiDallaCitazione(q).catch(() => {}); }
    });
    // Esc nel campo lascia l'ultima citazione, dopo chi l'ha già preso (la dettatura che ascolta).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !citate.length) return;
      if (!d.formEl.contains(document.activeElement)) return;
      e.preventDefault();
      togliCitazione(citate.length - 1);
    });
    global.SN_VOCI_PAGINA = Array.isArray(global.SN_VOCI_PAGINA) ? global.SN_VOCI_PAGINA : [];
    if (!global.SN_VOCI_PAGINA.includes(vociMenu)) global.SN_VOCI_PAGINA.push(vociMenu);
  }

  global.SN_DASH_RISPONDI = {
    init, ricorda, scritto, testoDi, prendi, rimetti, annulla, citaIn, dalFilo, perIlMain, perLoStorico, rispondi, copia, cita,
    commenti, inCorso: () => citate.length > 0,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

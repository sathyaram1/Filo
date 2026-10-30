// Sezione Domande di Gestione (SPEC-DOMANDE §3): elenco, domanda aperta e risposte; scheda, ordine ed etichette da
// SN_DOMANDE, mai dal testo di chi chiede. Non decide l'apertura né i contatori (manage.js). Il testo degli agenti
// passa sempre dal formattatore che toglie l'HTML o da textContent. Prove: tests/manage-domande.spec.mjs.

(function () {
  'use strict';

  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const T = {
    elenco: MSG.DOMANDE_ELENCO || 'domande_elenco',
    mostra: MSG.DOMANDA_MOSTRA || 'domanda_mostra',
    rispondi: MSG.DOMANDA_RISPONDI || 'domanda_rispondi',
    consiglio: MSG.DOMANDE_CONSIGLIO || 'domande_consiglio',
    archivia: MSG.DOMANDA_ARCHIVIA || 'domanda_archivia',
    riapri: MSG.DOMANDA_RIAPRI || 'domanda_riapri',
  };
  const MR = window.SN_MANAGE_REVIEW;
  const D = window.SN_DOMANDE;
  const $ = (id) => document.getElementById(id);

  const NOMI_SCHEDA = {
    domande: 'Da rispondere', 'domande-smistamento': 'In smistamento', 'domande-lavoro': 'In lavorazione',
    'domande-automatiche': 'Risposte automatiche', 'domande-archivio': 'Archivio',
  };
  const VUOTO = {
    domande: 'Nessuna domanda da rispondere.',
    'domande-smistamento': 'Nessuna domanda in smistamento.',
    'domande-lavoro': 'Nessuna domanda in lavorazione.',
    'domande-automatiche': 'Nessuna risposta automatica.',
    'domande-archivio': 'Nessuna domanda in archivio.',
  };
  // Le schede delle chiuse: dalla più recente, senza gruppi, e oltre il tetto dell'elenco ce ne sono altre.
  const CHIUSE = ['domande-automatiche', 'domande-archivio'];
  // Una riga trascinata in una chat con Filo arriva come riferimento: lo legge la chat dell'Aiuto (src/content/sidebar.js).
  const TIPO_RIFERIMENTO = 'application/x-filo-riferimento';
  // Il riferimento porta la domanda intera; oltre questo tetto la chat riceve il taglio scritto, mai un testo mozzato muto.
  const RIFERIMENTO_MAX = 30000;
  const PRIORITA = { bloccante: 'Bloccante', importante: 'Importante', quando_puoi: 'Quando puoi' };
  const PRIORITA_PLURALE = { bloccante: 'Bloccanti', importante: 'Importanti', quando_puoi: 'Quando puoi' };
  const TITOLO_NON_FIDATA = 'Chi l’ha scritta ha letto testo che non viene da te: le parole possono essere manipolate. '
    + 'Ogni pulsante fa solo quello che c’è scritto sopra.';
  const TASTO_MANDA = window.SN_TASTI ? window.SN_TASTI.etichetta('Ctrl+Invio') : '';
  const TITOLO_FIDATA = 'Scritta da una sessione che ha letto solo testo tuo o di altre sessioni pulite.';
  // Lo scudo in elenco è la fiducia della domanda, non del feedback da cui nasce.
  const SCUDO_FIDATA = 'Fidata. L’ha scritta una sessione che ha letto solo testo tuo o di altre sessioni pulite.';
  const SCUDO_NON_FIDATA = 'Non fidata. Chi l’ha scritta ha letto testo che non viene da te, e le sue parole possono essere manipolate.';

  // `lette` falso finché nessuna lettura è riuscita: un numero senza dati direbbe più di quanto si sa. Dopo, una
  // rilettura che salta tiene le domande a schermo e lo dice in `aggiornamento`: l'owner può star rispondendo.
  const stato = { lette: false, fallita: false, nonDisponibile: false, soloOwner: false, errore: '', aggiornamento: '', domande: [], riferimenti: {}, adesso: 0, altre: false };
  let finte = false;
  let inVolo = null;
  let scheda = 'domande';
  // Quello che il dettaglio mostra: una domanda o un gruppo, per id fissati al clic, così una domanda appena risposta
  // resta a schermo col suo esito anche se lascia la scheda.
  let aperta = null;
  // La domanda appena risposta: resta nel dettaglio finché non si cambia scheda o se ne apre un'altra.
  let tieni = null;
  const scelte = new Set();
  // La risposta scritta e non mandata resta come bozza della sua domanda anche a una ricarica (#1331), come la frase
  // per chi ha segnalato: si toglie solo all'invio riuscito.
  const CHIAVE_BOZZE = 'filo.gestione.bozzeDomande';
  const BOZZE_MAX = 200;
  const bozze = leggiBozze();
  // Gli allegati della risposta, per domanda: partono col testo come righe d'allegato, che il server apre per chi
  // riprende (immagini `rK.j`), come quelli della risposta dalla pagina dei feedback.
  const allegati = window.SN_MG_ALLEGATI.crea({
    alCambio: () => disegnaDettaglio(),
    alMessaggio: (id, testo) => {
      if (testo) avvisi.set(id, { testo, tipo: 'err' });
      else if (avvisi.has(id) && avvisi.get(id).tipo === 'err') avvisi.delete(id);
      disegnaDettaglio();
    },
  });
  // Le domande riscritte di cui l'owner ha aperto il testo originale in cima.
  const originali = new Set();
  // Le domande chiuse chieste a parte per leggerne il principio (una risposta automatica che lo cita).
  const fontiChieste = new Set();
  const avvisi = new Map();
  const inCorso = new Set();
  let conferma = null;
  const ascoltatori = [];
  const dip = { apriFeedback: null, descriviFeedback: null, apriScheda: null, soloNonFidate: null, impostaSoloNonFidate: null };
  let firmaLista = '';
  let firmaDettaglio = '';

  // Chiamato a ogni invio: le prove sostituiscono window.filo.message dopo il caricamento.
  function send(m) {
    if (window.filo && window.filo.message) return window.filo.message(m);
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) return chrome.runtime.sendMessage(m);
    return Promise.reject(new Error('canale main non disponibile'));
  }
  async function chiedi(m) {
    try { return (await send(m)) || { ok: false, error: 'nessuna risposta' }; } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  }

  // Messaggio che il main non conosce ancora, o funzione del server non pubblicata: non è un guasto da riprovare.
  function nonPubblicata(err) {
    return /sconosciut|ancora pubblicat|not[ _-]?found/i.test(String(err || ''));
  }

  function leggiBozze() {
    try {
      const v = JSON.parse(localStorage.getItem(CHIAVE_BOZZE) || '{}');
      const voci = v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v) : [];
      return new Map(voci.filter(([id, t]) => D && D.numeroDi(id) !== null && typeof t === 'string' && t.trim()));
    } catch (_) { return new Map(); }
  }
  function salvaBozze() {
    // Oltre il tetto restano le più recenti: una Map ricorda l'ordine in cui sono state toccate.
    while (bozze.size > BOZZE_MAX) bozze.delete(bozze.keys().next().value);
    try {
      const piene = [...bozze].filter(([, t]) => String(t || '').trim());
      if (piene.length) localStorage.setItem(CHIAVE_BOZZE, JSON.stringify(Object.fromEntries(piene)));
      else localStorage.removeItem(CHIAVE_BOZZE);
    } catch (_) {}
  }
  function scriviBozza(id, testo) {
    bozze.delete(id);
    if (String(testo || '').trim()) bozze.set(id, testo);
    salvaBozze();
  }

  function cambia() {
    disegna();
    for (const fn of ascoltatori) {
      try { fn(); } catch (e) { console.error('[manage] domande:', e); }
    }
  }

  function fondi(vecchie, nuove) {
    const per = new Map(vecchie.map((d) => [d.id, d]));
    for (const d of nuove || []) if (d && d.id) per.set(d.id, d);
    return Array.from(per.values());
  }
  function trova(id) { return stato.domande.find((d) => d.id === id) || null; }
  function aggiorna(d) {
    if (!d || !d.id) return;
    stato.domande = fondi(stato.domande, [d]);
  }

  // La prima lettura le chiede tutte (l'archivio compreso), poi solo le cambiate: il delta del server.
  function carica() {
    if (finte) return Promise.resolve(stato);
    if (inVolo) return inVolo;
    inVolo = (async () => {
      let delta = stato.lette && stato.adesso > 0;
      let r = await chiedi(Object.assign({ type: T.elenco }, delta ? { dopo: stato.adesso } : { tutte: true }));
      // Un delta che sfora il tetto non è «tutto quello che è cambiato»: si rilegge da capo.
      if (delta && r.ok && r.altre) { delta = false; r = await chiedi({ type: T.elenco, tutte: true }); }
      // Oltre il tetto «tutte» sono le più recenti: quelle che aspettano l'owner si chiedono a parte, intere.
      const aperte = !delta && r.ok && r.altre ? await chiedi({ type: T.elenco }) : null;
      if (finte) return stato;
      const guasto = !r.ok || !Array.isArray(r.domande) ? r : (aperte && !aperte.ok ? aperte : null);
      if (!guasto) {
        let domande = delta ? fondi(stato.domande, r.domande) : r.domande.slice();
        if (aperte) domande = fondi(domande, aperte.domande);
        Object.assign(stato, {
          lette: true, fallita: false, nonDisponibile: false, soloOwner: false, errore: '', aggiornamento: '',
          domande,
          riferimenti: Object.assign({}, delta ? stato.riferimenti : {}, aperte ? aperte.riferimenti : {}, r.riferimenti || {}),
          adesso: Number(r.adesso) || stato.adesso,
          altre: delta ? stato.altre : r.altre === true,
        });
      } else {
        const errore = String(guasto.error || 'nessuna risposta');
        const soloOwner = guasto.code === 'not_admin';
        const nonDisponibile = nonPubblicata(errore);
        // Chi non è più owner, o un server che non le pubblica più, le toglie; un guasto qualunque no, e la lettura
        // dopo riparte dallo stesso `adesso`.
        if (stato.lette && !soloOwner && !nonDisponibile) stato.aggiornamento = errore;
        else {
          Object.assign(stato, {
            lette: false, fallita: true, nonDisponibile, soloOwner,
            errore, aggiornamento: '', domande: [], riferimenti: {}, adesso: 0, altre: false,
          });
        }
      }
      cambia();
      return stato;
    })().finally(() => { inVolo = null; });
    return inVolo;
  }

  // ── Elenco ────────────────────────────────────────────────────────────────
  function quando(ms, conOra) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    const o = conOra ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' };
    try { return new Date(n).toLocaleString('it-IT', o); } catch (_) { return ''; }
  }
  // «l’11 ott», «il 12 ott»: l'articolo segue il numero.
  function ilGiorno(ms) {
    const t = quando(ms, true);
    return /^(1|8|11)\D/.test(t) ? `l’${t}` : `il ${t}`;
  }
  function idDi(d) { return d.id || (Number.isInteger(d.numero) ? D.idDi(d.numero) : ''); }
  function chiaveDi(b) { return `${b.priorita}|${String(b.gruppo || '').toLocaleLowerCase('it')}`; }

  // «Solo non fidate» è della pagina (#1575): lo stesso filtro dei feedback, chiesto a chi lo possiede.
  function soloNonFidate() { return !!(dip.soloNonFidate && dip.soloNonFidate()); }
  function tutteDiScheda(tab) { return stato.domande.filter((d) => MR.schedaDomanda(d) === tab); }
  function diScheda(tab) { return MR.filtraFiducia(tutteDiScheda(tab), soloNonFidate()); }

  // Le schede che aspettano seguono §3.7 (priorità, gruppo, età); le chiuse vanno dalla più recente. In smistamento
  // l'ordine è lo stesso ma senza gruppi: lì non si risponde, e un gruppo serve a rispondere insieme.
  function blocchi(tab) {
    const mie = diScheda(tab);
    if (CHIUSE.includes(tab)) {
      const t = (d) => Number(d.modificataIl) || Number(d.creataIl) || 0;
      return mie.slice().sort((a, b) => (t(b) - t(a)) || ((b.numero || 0) - (a.numero || 0)))
        .map((d) => ({ priorita: '', gruppo: '', domande: [d] }));
    }
    if (tab === 'domande-smistamento') return D.ordina(mie).map((d) => ({ priorita: d.priorita, gruppo: '', domande: [d] }));
    return D.raggruppa(mie);
  }
  function inOrdine(tab) { return blocchi(tab).flatMap((b) => b.domande); }

  function el(tag, cls, testo) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (testo !== undefined && testo !== null) e.textContent = String(testo);
    return e;
  }

  function casella(ids, titolo) {
    const c = el('input', 'mg-dom-sel');
    c.type = 'checkbox';
    c.checked = ids.length > 0 && ids.every((id) => scelte.has(id));
    c.indeterminate = !c.checked && ids.some((id) => scelte.has(id));
    c.dataset.ids = ids.join(' ');
    c.setAttribute('aria-label', titolo);
    c.title = titolo;
    return c;
  }

  // Lo scudo della fiducia, come sulle righe dei feedback: pieno se fidata, vuoto se no; il bordo destro ne ripete il colore.
  function scudo(d) {
    const s = MR.segnoFiducia(d);
    const span = el('span', `mg-fiducia-segno mg-fiducia-segno--${s.classe}`);
    span.title = s.classe === 'fidata' ? SCUDO_FIDATA : SCUDO_NON_FIDATA;
    span.setAttribute('aria-label', s.parola);
    span.setAttribute('role', 'img');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', MR.FORME_SVG.scudo);
    svg.appendChild(path);
    span.appendChild(svg);
    return span;
  }

  // Il numero del lavoro che la domanda tiene fermo, o '' se non ne ferma nessuno.
  function lavoroFermo(d) {
    if (!d.blocca || !d.legata || d.attesa) return '';
    const r = stato.riferimenti && stato.riferimenti[d.legata];
    return r && typeof r.num === 'string' && r.num ? r.num : 'un lavoro';
  }

  function riga(d, tab, nelGruppo) {
    const li = el('li', `mg-domanda mg-fiducia--${MR.segnoFiducia(d).classe}`);
    li.dataset.id = idDi(d);
    li.dataset.priorita = String(d.priorita || '');
    li.tabIndex = 0;
    li.draggable = true;
    if (nelGruppo) li.classList.add('mg-domanda--gruppo');
    if (aperta && aperta.ids.includes(li.dataset.id)) li.classList.add('mg-domanda--aperta');
    if (tab === 'domande') li.appendChild(casella([li.dataset.id], `Scegli ${li.dataset.id} per «Applica il consiglio»`));
    li.appendChild(el('span', 'mg-domanda-num', li.dataset.id));
    const titolo = el('span', 'mg-domanda-titolo', d.illeggibile ? 'Non si legge' : String(d.titolo || '(senza titolo)'));
    // Sotto il titolo quello che la scheda deve dire senza aprire: la scelta e il principio di un'automatica,
    // il lavoro che una in smistamento tiene fermo.
    const sotto = [];
    if (tab === 'domande-automatiche') {
      const o = (d.opzioni || [])[sceltaFatta(d)];
      if (o && o.testo) sotto.push(`scelta: ${o.testo}`);
      const da = principioUsato(d);
      if (da) sotto.push(`principio di ${da}`);
    } else if (tab === 'domande-smistamento') {
      const fermo = lavoroFermo(d);
      if (fermo) sotto.push(`ferma ${fermo}`);
    }
    if (sotto.length) titolo.appendChild(el('span', 'mg-domanda-sotto', sotto.join(' · ')));
    li.appendChild(titolo);
    if (CHIUSE.includes(tab)) li.appendChild(el('span', 'mg-domanda-prio', PRIORITA[d.priorita] || ''));
    // In smistamento conta da quanto: un agente la tiene minuti, non giorni.
    const data = CHIUSE.includes(tab) ? quando(d.modificataIl || d.creataIl) : quando(d.creataIl, tab === 'domande-smistamento');
    if (data) {
      const t = el('span', 'mg-domanda-data', tab === 'domande-smistamento' ? `da ${data}` : data);
      if (tab === 'domande-smistamento') t.title = `Nata ${quando(d.creataIl, true)}`;
      li.appendChild(t);
    }
    li.appendChild(scudo(d));
    return li;
  }

  // La lista si aggiorna al suo posto (#1331): una riga che c'era resta lo stesso nodo, così un clic a metà (giù sulla
  // riga di prima, su sulla rifatta), il fuoco e il puntatore sopra non si perdono a una rilettura.
  function morfa(v, n) {
    if (v.nodeType !== n.nodeType || v.nodeName !== n.nodeName) { v.replaceWith(n); return n; }
    if (v.nodeType === 3) { if (v.nodeValue !== n.nodeValue) v.nodeValue = n.nodeValue; return v; }
    if (v.nodeType !== 1) return v;
    for (const a of Array.from(v.attributes)) if (!n.hasAttribute(a.name)) v.removeAttribute(a.name);
    for (const a of Array.from(n.attributes)) if (v.getAttribute(a.name) !== a.value) v.setAttribute(a.name, a.value);
    if (v.nodeName === 'INPUT') { v.checked = n.checked; v.indeterminate = n.indeterminate; }
    const vf = Array.from(v.childNodes);
    const nf = Array.from(n.childNodes);
    nf.forEach((x, i) => { if (vf[i]) morfa(vf[i], x); else v.appendChild(x); });
    for (const x of vf.slice(nf.length)) x.remove();
    return v;
  }
  function chiaveNodo(n) {
    if (n.dataset.id) return `d:${n.dataset.id}`;
    if (n.dataset.gruppo) return `g:${n.dataset.gruppo}`;
    return `p:${n.textContent}`;
  }
  function rimetti(lista, nuove) {
    const prima = Array.from(lista.children);
    const att = document.activeElement;
    const conFuoco = att && att !== lista && lista.contains(att) ? prima.findIndex((n) => n.contains(att)) : -1;
    const voluti = new Set(nuove.map(chiaveNodo));
    const vecchie = new Map();
    for (const n of prima) {
      const k = chiaveNodo(n);
      if (voluti.has(k) && !vecchie.has(k)) vecchie.set(k, n); else n.remove();
    }
    let cursore = lista.firstElementChild;
    for (const n of nuove) {
      const v = vecchie.get(chiaveNodo(n));
      const nodo = v && v.nodeName === n.nodeName ? morfa(v, n) : n;
      if (nodo === cursore) cursore = cursore.nextElementSibling;
      else lista.insertBefore(nodo, cursore);
    }
    // Chiusa la riga che aveva il fuoco, lo prende quella venuta al suo posto: la tastiera non riparte dall'inizio.
    if (conFuoco >= 0 && !lista.contains(document.activeElement)) {
      const ora = Array.from(lista.children);
      const da = Math.min(conFuoco, ora.length - 1);
      const vicina = ora.slice(da).concat(ora.slice(0, da).reverse()).find((n) => n.tabIndex >= 0);
      if (vicina) vicina.focus({ preventScroll: true });
    }
  }
  function listaCheScorre() {
    const lista = $('mgDomandeLista');
    return [lista && lista.parentElement, lista].find((x) => x && x.scrollHeight > x.clientHeight) || null;
  }

  function disegnaLista() {
    const lista = $('mgDomandeLista');
    if (!lista) return;
    const bl = blocchi(scheda);
    const firma = JSON.stringify([scheda, aperta && aperta.ids, [...scelte],
      bl.map((b) => [b.priorita, b.gruppo, b.domande.map((d) => [d.id, d.titolo, d.stato, d.modificataIl, d.illeggibile, d.fiducia,
        d.priorita, d.blocca, d.legata, lavoroFermo(d), principioUsato(d), sceltaFatta(d)])])]);
    if (firma === firmaLista && !lista.hidden) return;
    firmaLista = firma;
    const nuove = [];
    let prio = null;
    for (const b of bl) {
      if (!CHIUSE.includes(scheda) && b.priorita !== prio) {
        prio = b.priorita;
        nuove.push(el('li', 'mg-domande-prio', PRIORITA_PLURALE[prio] || 'Senza priorità'));
      }
      const gruppo = b.gruppo && b.domande.length > 1;
      if (gruppo) {
        const ids = b.domande.map(idDi);
        const g = el('li', 'mg-domande-gruppo');
        g.dataset.gruppo = chiaveDi(b);
        g.dataset.ids = ids.join(' ');
        g.tabIndex = 0;
        g.title = 'Apri tutto il gruppo';
        if (aperta && aperta.gruppo === g.dataset.gruppo) g.classList.add('mg-domande-gruppo--aperto');
        if (scheda === 'domande') g.appendChild(casella(ids, `Scegli tutto il gruppo «${b.gruppo}»`));
        g.appendChild(el('span', 'mg-domande-gruppo-nome', b.gruppo));
        g.appendChild(el('span', 'mg-domande-gruppo-n', b.domande.length));
        nuove.push(g);
      }
      for (const d of b.domande) nuove.push(riga(d, scheda, gruppo));
    }
    // La riga sotto il puntatore, o col fuoco, resta dov'è anche se ne arriva o se ne chiude una più su.
    const PAG = window.SN_FEEDBACK_LIVE_PAGINA;
    if (PAG && typeof PAG.alSuoPosto === 'function') PAG.alSuoPosto({ lista, voci: '.mg-domanda', scorre: listaCheScorre }, () => rimetti(lista, nuove));
    else rimetti(lista, nuove);
  }

  function disegnaTesta() {
    const titolo = $('mgDomandeTitolo');
    if (titolo) titolo.textContent = NOMI_SCHEDA[scheda] || '';
    const tutte = $('mgDomandeTutte');
    const btn = $('mgDomandeConsiglioSel');
    const ids = stato.lette && scheda === 'domande' ? inOrdine('domande').map(idDi) : [];
    for (const id of [...scelte]) if (!ids.includes(id)) scelte.delete(id);
    if (tutte) {
      tutte.hidden = !ids.length;
      tutte.checked = ids.length > 0 && ids.every((id) => scelte.has(id));
      tutte.indeterminate = !tutte.checked && scelte.size > 0;
    }
    if (btn) {
      btn.hidden = !scelte.size;
      btn.textContent = `Applica il consiglio (${scelte.size})`;
      btn.disabled = !!(conferma && conferma.inviando);
    }
    // Il numero dice quante ne resterebbero col filtro acceso, come quello della lista dei feedback.
    const filtro = $('mgDomandeFiduciaFiltro');
    if (filtro) {
      filtro.hidden = !stato.lette;
      filtro.setAttribute('aria-pressed', soloNonFidate() ? 'true' : 'false');
      filtro.title = soloNonFidate() ? 'Mostra anche le domande fidate' : 'Mostra solo le domande non fidate';
      const c = filtro.querySelector('.mg-livello-count');
      if (c) c.textContent = stato.lette ? ` (${MR.contaNonFidate(tutteDiScheda(scheda))}${stato.altre && CHIUSE.includes(scheda) ? '+' : ''})` : '';
    }
  }

  // ── Domanda aperta ────────────────────────────────────────────────────────
  function md(testo) {
    const box = el('div', 'mg-dq-md');
    if (window.SN_MARKDOWN) {
      box.classList.add('filo-md');
      box.innerHTML = window.SN_MARKDOWN.render(String(testo || ''));
    } else {
      box.textContent = String(testo || '');
    }
    return box;
  }

  function sezione(cls, titolo, ...figli) {
    const s = el('section', `mg-dq-sez ${cls || ''}`.trim());
    if (titolo) s.appendChild(el('h3', 'mg-dq-h', titolo));
    for (const f of figli) if (f) s.appendChild(f);
    return s;
  }

  function rif(id) {
    const r = stato.riferimenti && Object.prototype.hasOwnProperty.call(stato.riferimenti, id) ? stato.riferimenti[id] : null;
    return r && typeof r.num === 'string' ? r : null;
  }

  // Origine e collegamenti: un feedback noto al server si apre in Gestione, una domanda nel dettaglio. Il feedback si
  // apre per id, e accanto al numero stanno stato e mittente di quel documento: un numero può essere di più (#1517).
  function legame(tipo, id) {
    if (tipo === 'feedback') {
      const r = rif(id);
      if (!r) return el('span', 'mg-dq-legame mg-dq-legame--muto', 'un feedback');
      const a = el('button', 'mg-dq-legame', r.num);
      a.type = 'button';
      a.dataset.feedback = r.num;
      a.dataset.feedbackId = String(id);
      a.title = `Apri ${r.num} nei Feedback`;
      const info = dip.descriviFeedback ? dip.descriviFeedback(String(id), r.num, r) : null;
      if (!info) return a;
      const box = el('span', 'mg-dq-legame-fb');
      box.appendChild(a);
      if (info.testo) {
        const t = el('span', 'mg-dq-legame-info', info.testo);
        t.title = `Stato e mittente di ${r.num}, letti dal documento.`;
        box.appendChild(t);
      }
      if (info.doppi > 1) {
        const w = el('span', 'mg-dq-legame-doppio', 'numero doppio');
        w.title = `${r.num} è il numero di ${info.doppi} segnalazioni: il collegamento apre quella di questa domanda.`;
        box.appendChild(w);
      }
      return box;
    }
    if (tipo === 'domanda' && D.numeroDi(id) !== null) {
      const a = el('button', 'mg-dq-legame', id);
      a.type = 'button';
      a.dataset.domanda = id;
      a.title = `Apri ${id}`;
      return a;
    }
    return el('span', 'mg-dq-legame mg-dq-legame--muto', tipo === 'ramo' ? `ramo ${id}` : String(id || tipo));
  }

  // Stato e mittente dei feedback nominati cambiano con la lista dei Feedback, non con la domanda: anche loro ridisegnano.
  function firmaLegami(d) {
    if (!dip.descriviFeedback) return [];
    const legati = [d.origine, ...(Array.isArray(d.collegamenti) ? d.collegamenti : [])].filter((c) => c && c.tipo === 'feedback');
    return legati.map((c) => {
      const r = rif(c.id);
      return r ? dip.descriviFeedback(String(c.id), r.num, r) : null;
    });
  }

  function testata(d) {
    const meta = el('div', 'mg-dq-meta');
    meta.appendChild(el('span', 'mg-dq-num', idDi(d)));
    if (PRIORITA[d.priorita]) {
      const p = el('span', 'mg-dq-prio', PRIORITA[d.priorita]);
      p.dataset.priorita = d.priorita;
      meta.appendChild(p);
    }
    const fidata = d.fiducia === 'fidato';
    const f = el('span', `mg-dq-fiducia${fidata ? '' : ' mg-dq-fiducia--no'}`, fidata ? 'Fidata' : 'Non fidata');
    f.title = fidata ? TITOLO_FIDATA : TITOLO_NON_FIDATA;
    meta.appendChild(f);
    const nata = quando(d.creataIl, true);
    if (nata) meta.appendChild(el('span', 'mg-dq-data', `chiesta ${nata}`));
    if (Number(d.modificataIl) > Number(d.creataIl || 0) + 60000) meta.appendChild(el('span', 'mg-dq-data', `aggiornata ${quando(d.modificataIl, true)}`));
    const legami = [];
    if (d.origine && d.origine.tipo) legami.push(['da', d.origine.tipo, d.origine.id]);
    for (const c of Array.isArray(d.collegamenti) ? d.collegamenti : []) {
      if (!(d.origine && c.tipo === d.origine.tipo && c.id === d.origine.id)) legami.push(['', c.tipo, c.id]);
    }
    // L'origine e gli altri legami stanno in due gruppi: «da #902 #813» farebbe sembrare origine anche il secondo.
    for (const gruppo of [legami.filter((x) => x[0]), legami.filter((x) => !x[0])]) {
      if (!gruppo.length) continue;
      const l = el('span', 'mg-dq-legami');
      for (const [pre, tipo, id] of gruppo) {
        if (pre) l.appendChild(el('span', 'mg-dq-legami-pre', pre));
        l.appendChild(legame(tipo, id));
      }
      meta.appendChild(l);
    }
    const ferma = fermaIlLavoro(d);
    if (ferma) meta.appendChild(ferma);
    if (d.smistamento === 'fallito') {
      const s = el('span', 'mg-dq-segno', 'non riscritta');
      s.title = 'L’agente che la smista non è riuscito a riscriverla: la leggi come l’ha scritta chi chiedeva.';
      meta.appendChild(s);
    }
    if (riscritta(d)) {
      const aperto = originali.has(d.id);
      const b = el('button', 'mg-dq-originale-btn', 'Testo originale');
      b.type = 'button';
      b.dataset.fai = 'originale';
      b.setAttribute('aria-expanded', aperto ? 'true' : 'false');
      b.title = aperto ? 'Chiudi il testo di chi aveva chiesto' : 'Il testo di chi aveva chiesto, prima che un agente lo riscrivesse per te';
      meta.appendChild(b);
    }
    const h = el('h2', 'mg-dq-titolo', d.illeggibile ? 'Questa domanda non si legge' : String(d.titolo || '(senza titolo)'));
    const head = el('header', 'mg-dq-testa');
    head.append(meta, h);
    return head;
  }

  // Riscritta per l'owner dal compito che la smista (§3.5): il testo di chi chiedeva resta intero nelle note per gli
  // agenti. Non lo è una uscita com'era (smistamento fallito), né una chiusa prima di arrivare all'owner.
  function riscritta(d) {
    const e = d.esito && typeof d.esito === 'object' ? d.esito : {};
    return !!String(d.notePerAgenti || '').trim() && !d.illeggibile && d.stato !== 'in_smistamento' && d.smistamento !== 'fallito'
      && !d.soloOwner && !e.automatica && !e.smistata;
  }

  // Cosa fa al suo lavoro una domanda aperta o in smistamento (#1577): lo ferma, o lo lascia andare con la consigliata.
  function fermaIlLavoro(d) {
    if ((d.stato !== 'aperta' && d.stato !== 'in_smistamento') || !d.legata || d.attesa) return null;
    const r = stato.riferimenti && stato.riferimenti[d.legata];
    const num = r && typeof r.num === 'string' && r.num ? r.num : 'il lavoro';
    const s = el('span', `mg-dq-ferma${d.blocca ? ' mg-dq-ferma--si' : ''}`, d.blocca ? `ferma ${num}` : `${num} va avanti`);
    s.title = d.blocca
      ? 'Nessuna routine lo prende finché non rispondi.'
      : 'Il lavoro va avanti con la consigliata; se scegli altro riparte con la tua scelta, anche se è già fuso.';
    return s;
  }

  // L'ultima scelta fatta su questa domanda, per segnarla nell'archivio: dalla conversazione, o dall'esito.
  function sceltaFatta(d) {
    const turni = Array.isArray(d.conversazione) ? d.conversazione : [];
    for (let i = turni.length - 1; i >= 0; i--) if (Number.isInteger(turni[i].scelta)) return turni[i].scelta;
    return d.esito && Number.isInteger(d.esito.scelta) ? d.esito.scelta : null;
  }

  // La domanda chiusa di cui una risposta automatica ha usato il principio (§3.6): dall'esito, o dal testo che la cita.
  function principioUsato(d) {
    const e = d.esito && typeof d.esito === 'object' ? d.esito : null;
    if (!e || !e.automatica) return '';
    if (typeof e.principio === 'string' && D.numeroDi(e.principio) !== null) return e.principio.trim();
    const turni = Array.isArray(d.conversazione) ? d.conversazione : [];
    for (let i = turni.length - 1; i >= 0; i--) {
      for (const m of String(turni[i].testo || '').matchAll(/\bD-[1-9]\d{0,8}\b/g)) if (m[0] !== d.id) return m[0];
    }
    return '';
  }

  function etichettaDi(o) { return o ? D.etichettaAzione(o.azione, stato.riferimenti) : null; }
  function consigliata(d) {
    return d.consiglio && Number.isInteger(d.consiglio.opzione) ? (d.opzioni || [])[d.consiglio.opzione] || null : null;
  }

  function opzioni(d) {
    const ops = Array.isArray(d.opzioni) ? d.opzioni : [];
    if (!ops.length) return null;
    const rispondibile = d.stato === 'aperta';
    const occupata = inCorso.has(d.id);
    const fatta = d.stato === 'aperta' ? null : sceltaFatta(d);
    const lista = el('ol', 'mg-dq-opzioni');
    ops.forEach((o, i) => {
      const li = el('li', 'mg-dq-opzione');
      li.dataset.indice = String(i);
      const consigli = d.consiglio && d.consiglio.opzione === i;
      if (consigli) li.classList.add('mg-dq-opzione--consigliata');
      const testa = el('div', 'mg-dq-opzione-testa');
      testa.appendChild(el('span', 'mg-dq-opzione-n', `${i + 1}.`));
      testa.appendChild(el('span', 'mg-dq-opzione-testo', o.testo));
      if (consigli) testa.appendChild(el('span', 'mg-dq-badge', 'Consigliata'));
      if (fatta === i) testa.appendChild(el('span', 'mg-dq-badge mg-dq-badge--scelta', 'Scelta'));
      li.appendChild(testa);
      if (o.pro || o.contro) {
        const pc = el('div', 'mg-dq-procontro');
        if (o.pro) { const p = el('div', 'mg-dq-pro'); p.append(el('span', 'mg-dq-pc', 'Pro'), md(o.pro)); pc.appendChild(p); }
        if (o.contro) { const c = el('div', 'mg-dq-contro'); c.append(el('span', 'mg-dq-pc', 'Contro'), md(o.contro)); pc.appendChild(c); }
        li.appendChild(pc);
      }
      if (rispondibile) {
        const etichetta = etichettaDi(o);
        if (etichetta) {
          const b = el('button', 'sn-btn mg-dq-azione', etichetta);
          b.type = 'button';
          b.dataset.scelta = String(i);
          b.disabled = occupata;
          if ((bozze.get(d.id) || '').trim()) b.title = 'Con la scelta parte anche il testo che hai scritto';
          li.appendChild(b);
        } else {
          const n = el('span', 'mg-dq-senza-azione', 'Da qui non si applica');
          n.title = 'Il tipo d’azione o il feedback a cui punta non tornano coi dati del server: puoi rispondere a parole.';
          li.appendChild(n);
        }
      }
      lista.appendChild(li);
    });
    return sezione('mg-dq-opz', 'Opzioni', lista);
  }

  function consiglio(d) {
    const o = consigliata(d);
    if (!o) return null;
    const corpo = el('div', 'mg-dq-consiglio-corpo');
    corpo.appendChild(el('span', 'mg-dq-consiglio-n', `Opzione ${d.consiglio.opzione + 1}`));
    if (d.consiglio.perche) corpo.appendChild(md(d.consiglio.perche));
    const s = sezione('mg-dq-consiglio', 'Consiglio', corpo);
    // Con un'opzione sola il pulsante dell'opzione è già il consiglio: due pulsanti uguali non servono (#1640).
    const doppio = (d.opzioni || []).length === 1;
    const etichetta = d.stato === 'aperta' && !doppio ? etichettaDi(o) : null;
    if (etichetta) {
      const b = el('button', 'sn-btn mg-dq-applica', `Applica il consiglio: ${etichetta}`);
      b.type = 'button';
      b.dataset.fai = 'consiglio';
      b.disabled = inCorso.has(d.id);
      s.appendChild(b);
    }
    return s;
  }

  function esito(d) {
    const e = d.esito && typeof d.esito === 'object' ? d.esito : null;
    let testo = '';
    let tipo = '';
    if (d.stato === 'superata') testo = 'Superata da un’altra domanda.';
    // Il compito «Gestisci la domanda» (§3.5) la tiene prima che arrivi a te: si dice cosa sta succedendo e com'è finita.
    else if (d.stato === 'in_smistamento') testo = 'La sta smistando un agente: ti arriva riscritta, o si chiude da sola se è un guasto o se una decisione già presa la copre.';
    else if (e && e.smistata === 'guasto') testo = 'Era un guasto: l’ha preso un feedback del difetto, e il lavoro fermo lo aspetta.';
    else if (e && e.smistata === 'ricevuti') testo = 'Era una richiesta per te: il lavoro è nei Ricevuti.';
    else if (e && e.archiviata) testo = `Archiviata senza azioni${e.applicataIl ? ` ${ilGiorno(e.applicataIl)}` : ''}.`;
    else if (e && e.automatica) return null;
    else if (e && e.ok === false && e.errore === 'in_corso') testo = 'Risposta in corso sul server…';
    else if (e && e.ok === false) { testo = 'L’ultima risposta non è stata applicata: il motivo è nella conversazione.'; tipo = 'err'; }
    else if (d.stato === 'in_lavorazione') testo = e && e.compito && e.compito.da ? `Affidata a un agente ${ilGiorno(e.compito.da)}.` : 'Affidata a un agente.';
    // Una ripresa che non ha spostato il lavoro lo dice (#1577): non serviva, o accodata al giro dopo.
    else if (e && e.ok && d.stato === 'chiusa' && e.nonServiva) testo = 'Non serviva: il lavoro è già fuso con questa scelta.';
    else if (e && e.ok && d.stato === 'chiusa' && e.accodata) testo = `Fatto${e.applicataIl ? ` ${ilGiorno(e.applicataIl)}` : ''}: la prende il prossimo giro di lavoro.`;
    else if (e && e.ok && d.stato === 'chiusa' && e.rimandata) testo = `Fatto${e.applicataIl ? ` ${ilGiorno(e.applicataIl)}` : ''}: il lavoro torna in verifica con la tua risposta.`;
    else if (e && e.ok && d.stato === 'chiusa' && e.lavoroArchiviato) testo = 'Il lavoro è archiviato: la risposta non lo riapre.';
    // Una domanda riaperta da un chiarimento può portarsi dietro l'esito di prima: «fatto» solo se è chiusa.
    else if (e && e.ok && d.stato === 'chiusa') testo = `Fatto${e.applicataIl ? ` ${ilGiorno(e.applicataIl)}` : ''}.`;
    if (!testo) return null;
    return el('p', `mg-dq-esito${tipo ? ` mg-dq-esito--${tipo}` : ''}`, testo);
  }

  // Una risposta automatica dice quale principio ha usato e lo fa leggere; la riapertura lo segna da rivedere (§3.6).
  function automatica(d) {
    if (!(d.esito && d.esito.automatica)) return null;
    const da = principioUsato(d);
    const frase = el('p', 'mg-dq-esito');
    if (da) frase.append('Risposta automatica col principio di ', legame('domanda', da), '.');
    else frase.textContent = 'Risposta automatica.';
    if (!da) return frase;
    const fonte = trova(da);
    if (!fonte) chiediFonte(da);
    const box = el('div', 'mg-dq-auto');
    box.appendChild(frase);
    const testo = fonte && fonte.principio ? md(fonte.principio)
      : el('p', 'mg-dq-esito', fonte ? `${da} non ha più un principio scritto.` : `Leggo il principio di ${da}…`);
    const s = sezione('mg-dq-principio', `Principio di ${da}`, testo);
    if (fonte && fonte.principioContestato) s.querySelector('.mg-dq-h').appendChild(segnoContestato());
    box.appendChild(s);
    return box;
  }

  function segnoContestato() {
    const c = el('span', 'mg-dq-segno', 'da rivedere');
    c.title = 'L’hai contestato riaprendo una risposta automatica: nessuno lo riusa finché non rispondi alla domanda riaperta.';
    return c;
  }

  // Il principio citato da un'automatica sta su una domanda chiusa che l'elenco può non avere: la si chiede una volta.
  async function chiediFonte(id) {
    if (finte || fontiChieste.has(id)) return;
    fontiChieste.add(id);
    const m = await chiedi({ type: T.mostra, id });
    if (!m.ok || !m.domanda) return;
    aggiorna(m.domanda);
    if (m.riferimenti && typeof m.riferimenti === 'object') Object.assign(stato.riferimenti, m.riferimenti);
    cambia();
  }

  function autoreDi(a) {
    const t = a && a.tipo;
    if (t === 'owner') return 'Tu';
    if (t === 'server') return 'Server';
    return a && a.ruolo ? `Agente (${a.ruolo})` : 'Agente';
  }

  function conversazione(d) {
    const turni = Array.isArray(d.conversazione) ? d.conversazione : [];
    if (!turni.length) return null;
    const ol = el('ol', 'mg-dq-turni');
    for (const t of turni) {
      const li = el('li', 'mg-dq-turno');
      const tipoAutore = (t.autore && t.autore.tipo) || '';
      li.dataset.autore = tipoAutore;
      const head = el('div', 'mg-dq-turno-testa');
      head.appendChild(el('span', 'mg-dq-turno-chi', autoreDi(t.autore)));
      if (tipoAutore !== 'owner' && tipoAutore !== 'server' && !(t.autore && t.autore.fiducia === 'fidato')) {
        const f = el('span', 'mg-dq-fiducia mg-dq-fiducia--no', 'non fidato');
        f.title = TITOLO_NON_FIDATA;
        head.appendChild(f);
      }
      if (Number.isInteger(t.scelta)) head.appendChild(el('span', 'mg-dq-turno-scelta', `opzione ${t.scelta + 1}${t.consiglio ? ', il consiglio' : ''}`));
      const ora = quando(t.ora, true);
      if (ora) head.appendChild(el('span', 'mg-dq-data', ora));
      li.appendChild(head);
      if (t.testo) li.appendChild(tipoAutore === 'owner' ? testoConAllegati(t.testo) : md(t.testo));
      ol.appendChild(li);
    }
    return sezione('mg-dq-conv', 'Conversazione', ol);
  }

  function risposta(d) {
    const box = el('div', 'mg-dq-risposta');
    const occupata = inCorso.has(d.id);
    const rispondibile = d.stato === 'aperta' || d.stato === 'in_lavorazione';
    // In smistamento la tiene un agente: si legge e basta, e l'unica cosa che si può fare è archiviarla.
    const inSmistamento = d.stato === 'in_smistamento';
    if (rispondibile && !d.illeggibile) {
      const ta = el('textarea', 'mg-dq-testo');
      ta.rows = 3;
      ta.placeholder = d.stato === 'aperta' ? 'Rispondi a parole…' : 'Aggiungi qualcosa…';
      ta.value = bozze.get(d.id) || '';
      ta.dataset.id = d.id;
      ta.disabled = occupata;
      allegati.collega(ta, d.id);
      box.appendChild(ta);
      // D-186: l'azione parte solo dal pulsante di un'opzione, le parole le legge un agente.
      if (d.stato === 'aperta' && (d.opzioni || []).length) {
        box.appendChild(el('p', 'mg-dq-parole', 'Le parole non riprendono il lavoro: per riprenderlo scegli un’opzione'));
      }
      box.appendChild(allegati.riga(d.id, { disabilitata: occupata }));
    }
    const tasti = el('div', 'mg-dq-tasti');
    const tasto = (testo, fai, cls, titolo) => {
      const b = el('button', `sn-btn ${cls || ''}`.trim(), testo);
      b.type = 'button';
      b.dataset.fai = fai;
      b.disabled = occupata;
      if (titolo) b.title = titolo;
      tasti.appendChild(b);
    };
    if (rispondibile && !d.illeggibile) tasto(d.stato === 'aperta' ? 'Rispondi' : 'Aggiungi', 'testo', '', TASTO_MANDA ? `Manda il testo (${TASTO_MANDA})` : 'Manda il testo');
    if (!inSmistamento) tasto('Discutiamone', 'discuti', 'sn-btn-secondary', `Copia «Discutiamo la domanda ${idDi(d)}» da incollare in una sessione locale`);
    if (rispondibile || inSmistamento) tasto('Archivia', 'chiudi', 'sn-btn-secondary', 'Chiudi la domanda senza applicare niente; si può riaprire');
    else if (riapribile(d)) tasto('Riapri', 'riapri', 'sn-btn-secondary', titoloRiapri(d));
    box.appendChild(tasti);
    const a = avvisi.get(d.id);
    const msg = el('p', `mg-dq-msg${a && a.tipo ? ` mg-dq-msg--${a.tipo}` : ''}`, a ? a.testo : '');
    msg.setAttribute('role', 'status');
    box.appendChild(msg);
    return box;
  }

  // Si riapre un'archiviata senza azioni, e una risposta automatica che non torna (§3.6).
  function riapribile(d) {
    return !!(d.stato === 'chiusa' && d.esito && (d.esito.archiviata || d.esito.automatica));
  }
  function titoloRiapri(d) {
    if (!(d.esito && d.esito.automatica)) return 'Rimettila fra quelle da rispondere';
    const da = principioUsato(d);
    return `Rimettila fra quelle da rispondere: ${da ? `il principio di ${da}` : 'il principio usato'} resta da rivedere finché non rispondi`;
  }

  // Il turno dell'owner porta gli allegati come righe-marcatore: a schermo diventano i loro nomi.
  function testoConAllegati(testo) {
    const TH = window.SN_FEEDBACK_THREAD;
    const box = el('div', 'mg-dq-turno-tuo');
    const parole = [];
    const trovati = [];
    for (const riga of String(testo || '').split('\n')) {
      const a = TH && typeof TH.parseAttachmentLine === 'function' ? TH.parseAttachmentLine(riga) : null;
      if (a) trovati.push(a); else parole.push(riga);
    }
    const t = parole.join('\n').trim();
    if (t) box.appendChild(el('div', '', t));
    if (trovati.length) {
      const riga = el('div', 'mg-dq-allegati');
      let immagini = 0;
      for (const a of trovati) {
        if (a.kind === 'img') immagini += 1;
        riga.appendChild(el('span', 'mg-dq-allegato', a.kind === 'img' ? `Immagine ${immagini}` : (a.name || 'allegato')));
      }
      box.appendChild(riga);
    }
    return box;
  }

  function blocco(d) {
    const art = el('article', 'mg-dq');
    art.dataset.id = idDi(d);
    art.appendChild(testata(d));
    // «Testo originale» lo apre qui, sotto il titolo: chi lo chiede non deve scorrere fino in fondo.
    const originaleInCima = riscritta(d) && originali.has(d.id);
    if (originaleInCima) art.appendChild(sezione('mg-dq-originale', 'Testo originale', md(d.notePerAgenti)));
    if (d.illeggibile) {
      art.appendChild(el('p', 'mg-dq-esito mg-dq-esito--err', 'Il server non riesce ad aprire il testo di questa domanda.'));
      art.appendChild(risposta(d));
      return art;
    }
    if (d.contesto) art.appendChild(sezione('', 'Contesto', md(d.contesto)));
    if (d.problema) art.appendChild(sezione('', 'Problema', md(d.problema)));
    // Il principio (§3.6) lo scrive chi ha gestito la risposta: è la regola che entra nel registro, e l'owner la vede.
    const principio = d.principio ? sezione('mg-dq-principio', 'Principio', md(d.principio)) : null;
    if (principio && d.principioContestato) principio.querySelector('.mg-dq-h').appendChild(segnoContestato());
    for (const parte of [opzioni(d), consiglio(d), esito(d), automatica(d), principio, conversazione(d), risposta(d)]) if (parte) art.appendChild(parte);
    if (d.notePerAgenti && !originaleInCima) {
      const det = el('details', 'mg-dq-note');
      det.appendChild(el('summary', '', 'Note per gli agenti'));
      det.appendChild(md(d.notePerAgenti));
      art.appendChild(det);
    }
    return art;
  }

  function disegnaDettaglio() {
    const box = $('mgDomandaDettaglio');
    if (!box) return;
    const ds = aperta ? aperta.ids.map(trova).filter(Boolean) : [];
    const fonti = ds.map((d) => principioUsato(d)).filter(Boolean).map((id) => { const f = trova(id); return f ? [id, f.principio, f.principioContestato] : [id]; });
    const firma = JSON.stringify([ds.map((d) => [d.id, d.stato, d.modificataIl, d.esito, d.titolo, d.illeggibile, d.smistamento,
      d.principioContestato, ...(d.opzioni || []).map((o) => etichettaDi(o)), firmaLegami(d), lavoroFermo(d),
      allegati.di(d.id).map((a) => a.url), allegati.caricando(d.id), originali.has(d.id)]), [...inCorso], [...avvisi], stato.lette, fonti]);
    if (firma === firmaDettaglio) return;
    firmaDettaglio = firma;
    // Chi stava scrivendo ritrova il cursore dov'era: il dettaglio si ridisegna anche per un esito altrui.
    const att = document.activeElement;
    const fuoco = att && att.classList && att.classList.contains('mg-dq-testo') && box.contains(att)
      ? { id: att.dataset.id, a: att.selectionStart, b: att.selectionEnd } : null;
    const aperte = new Set([...box.querySelectorAll('details.mg-dq-note[open]')].map((x) => x.closest('.mg-dq').dataset.id));
    const scorre = box.scrollTop;
    box.replaceChildren();
    if (!stato.lette || !ds.length) {
      box.appendChild(el('p', 'mg-dq-vuoto', stato.lette && inOrdine(scheda).length ? 'Scegli una domanda.' : ''));
      return;
    }
    if (aperta.gruppo && ds.length > 1) box.appendChild(el('p', 'mg-dq-gruppo', `${String(ds[0].gruppo || '')} · ${ds.length} domande`));
    for (const d of ds) {
      const b = blocco(d);
      if (aperte.has(b.dataset.id)) { const n = b.querySelector('details.mg-dq-note'); if (n) n.open = true; }
      box.appendChild(b);
    }
    box.scrollTop = scorre;
    if (fuoco) {
      const ta = box.querySelector(`.mg-dq[data-id="${fuoco.id}"] .mg-dq-testo`);
      if (ta) { ta.focus(); try { ta.setSelectionRange(fuoco.a, fuoco.b); } catch (_) {} }
    }
  }

  // ── Conferma di «applica il consiglio» su più domande ───────────────────
  function piano(ids) {
    const voci = [];
    const fuori = [];
    const tante = ids.length > 1;
    for (const id of ids) {
      const d = trova(id);
      if (!d || d.stato !== 'aperta') { fuori.push({ id, perche: 'non aspetta più una risposta' }); continue; }
      const o = consigliata(d);
      const etichetta = etichettaDi(o);
      if (!etichetta) { fuori.push({ id, perche: o ? 'il consiglio da qui non si applica' : 'nessun consiglio' }); continue; }
      const v = D.validaAzione(o.azione);
      if (tante && v.ok && !D.TIPI[v.azione.tipo].bulk) { fuori.push({ id, perche: `una per una: ${etichetta}` }); continue; }
      voci.push({ id, etichetta });
    }
    return { voci, fuori };
  }

  function disegnaConferma() {
    const box = $('mgDomandeConferma');
    if (!box) return;
    box.hidden = !conferma;
    box.replaceChildren();
    if (!conferma) return;
    const elenco = (righe) => {
      const ul = el('ul', 'mg-dom-conferma-lista');
      for (const r of righe) {
        const li = el('li');
        li.append(el('span', 'mg-domanda-num', r.id), el('span', '', r.testo));
        ul.appendChild(li);
      }
      return ul;
    };
    const { voci, fuori, esiti, inviando } = conferma;
    if (esiti) {
      const ok = esiti.filter((e) => e.ok);
      const ko = esiti.filter((e) => !e.ok);
      if (ok.length) box.appendChild(el('p', 'mg-dom-conferma-ok', `Applicato a ${ok.length === 1 ? 'una domanda' : `${ok.length} domande`}:`));
      if (ok.length) box.appendChild(elenco(ok.map((e) => ({ id: e.id, testo: e.etichetta || '' }))));
      if (ko.length) box.appendChild(el('p', 'mg-dom-conferma-err', `Non applicato a ${ko.length === 1 ? 'una domanda' : `${ko.length} domande`}:`));
      if (ko.length) box.appendChild(elenco(ko.map((e) => ({ id: e.id, testo: e.dettaglio || e.errore || 'errore' }))));
    } else if (voci.length) {
      box.appendChild(el('p', '', `Applico il consiglio a ${voci.length === 1 ? 'una domanda' : `${voci.length} domande`}:`));
      box.appendChild(elenco(voci.map((v) => ({ id: v.id, testo: v.etichetta }))));
    } else {
      box.appendChild(el('p', '', 'Nessuna delle domande scelte ha un consiglio da applicare così.'));
    }
    if (!esiti && fuori.length) {
      box.appendChild(el('p', 'mg-dom-conferma-fuori', 'Restano fuori:'));
      box.appendChild(elenco(fuori.map((f) => ({ id: f.id, testo: f.perche }))));
    }
    if (conferma.errore) box.appendChild(el('p', 'mg-dom-conferma-err', conferma.errore));
    const tasti = el('div', 'mg-dq-tasti');
    const tasto = (testo, cosa, cls) => {
      const b = el('button', `sn-btn ${cls || ''}`.trim(), testo);
      b.type = 'button';
      b.dataset.conferma = cosa;
      b.disabled = !!inviando;
      tasti.appendChild(b);
    };
    if (!esiti && voci.length) tasto(inviando ? 'Applico…' : 'Applica', 'si');
    tasto(esiti || !voci.length ? 'Chiudi' : 'Annulla', 'no', 'sn-btn-secondary');
    box.appendChild(tasti);
  }

  async function applicaConferma() {
    if (!conferma || conferma.inviando || !conferma.voci.length) return;
    conferma.inviando = true;
    disegnaConferma();
    disegnaTesta();
    const ids = conferma.voci.map((v) => v.id);
    const r = await chiedi({ type: T.consiglio, ids });
    conferma.inviando = false;
    if (r.ok && Array.isArray(r.esiti)) {
      const etichette = new Map(conferma.voci.map((v) => [v.id, v.etichetta]));
      conferma.esiti = r.esiti.map((e) => Object.assign({}, e, { etichetta: e.etichetta || etichette.get(e.id) || '' }));
      for (const e of r.esiti) if (e.ok) scelte.delete(e.id);
    } else {
      conferma.errore = `Non riuscito: ${r.error || 'nessuna risposta'}`;
    }
    disegnaConferma();
    carica();
    cambia();
  }

  // ── Risposte su una domanda ───────────────────────────────────────────────
  async function manda(id, richiesta, attesa) {
    if (inCorso.has(id)) return null;
    inCorso.add(id);
    avvisi.set(id, { testo: attesa, tipo: '' });
    disegnaDettaglio();
    const r = await chiedi(richiesta);
    inCorso.delete(id);
    return r;
  }

  function dopo(id, r, fatto) {
    if (r.ok) {
      if (r.domanda) aggiorna(r.domanda);
      avvisi.set(id, { testo: fatto, tipo: 'ok' });
      tieni = id;
      carica();
    } else {
      avvisi.set(id, { testo: `Non riuscito: ${r.error || 'nessuna risposta'}`, tipo: 'err' });
    }
    cambia();
  }

  async function rispondi(id, scelta) {
    if (allegati.caricando(id)) {
      avvisi.set(id, { testo: 'Aspetta che gli allegati finiscano di caricarsi.', tipo: 'err' });
      disegnaDettaglio();
      return;
    }
    const testo = [(bozze.get(id) || '').trim(), allegati.righe(id)].filter(Boolean).join('\n');
    const req = { type: T.rispondi, id };
    if (Number.isInteger(scelta)) req.scelta = scelta;
    if (testo) req.testo = testo;
    if (req.scelta === undefined && !req.testo) {
      avvisi.set(id, { testo: 'Scrivi qualcosa o scegli un’opzione.', tipo: 'err' });
      disegnaDettaglio();
      return;
    }
    const r = await manda(id, req, 'Invio…');
    if (!r) return;
    if (r.ok) { scriviBozza(id, ''); allegati.svuota(id); }
    const d = r.domanda || trova(id);
    dopo(id, r, d && d.stato === 'in_lavorazione' ? 'Mandata: la prende un agente.' : 'Mandata.');
  }

  async function consiglioUna(id) {
    // Col testo scritto il consiglio è una scelta come le altre: le parole partono con lei.
    const d = trova(id);
    if (((bozze.get(id) || '').trim() || allegati.di(id).length) && d && d.consiglio) return rispondi(id, d.consiglio.opzione);
    if (inCorso.has(id)) return;
    inCorso.add(id);
    avvisi.set(id, { testo: 'Applico il consiglio…', tipo: '' });
    disegnaDettaglio();
    const r = await chiedi({ type: T.consiglio, ids: [id] });
    const e = r.ok && Array.isArray(r.esiti) ? r.esiti.find((x) => x.id === id) : null;
    let fine;
    if (!r.ok) fine = r;
    else if (!e) fine = { ok: false, error: 'il server non ha detto com’è andata' };
    else if (!e.ok) fine = { ok: false, error: e.dettaglio || e.errore };
    else {
      // L'esito del consiglio non porta la domanda: la si rilegge prima di riaccendere i pulsanti.
      const m = await chiedi({ type: T.mostra, id });
      if (m.ok && m.riferimenti) Object.assign(stato.riferimenti, m.riferimenti);
      fine = { ok: true, domanda: m.ok ? m.domanda : null };
    }
    inCorso.delete(id);
    dopo(id, fine, 'Mandata.');
  }

  async function discuti(id) {
    const testo = `Discutiamo la domanda ${id}`;
    try {
      await navigator.clipboard.writeText(testo);
      avvisi.set(id, { testo: `Copiato: «${testo}»`, tipo: 'ok' });
    } catch (_) {
      avvisi.set(id, { testo: `Non riesco a copiare. La riga è: ${testo}`, tipo: 'err' });
    }
    disegnaDettaglio();
  }

  async function archivia(id, riapri) {
    const r = await manda(id, { type: riapri ? T.riapri : T.archivia, id }, riapri ? 'Riapro…' : 'Archivio…');
    if (r) dopo(id, r, riapri ? 'Riaperta: ora è fra quelle da rispondere.' : 'Archiviata.');
  }

  // ── Disegno e scelta di cosa mostrare ─────────────────────────────────────
  function apri(ids, gruppo) {
    const nuove = ids && ids.length ? ids.slice() : [];
    // Un esito vale per la domanda su cui si è agito: aprendone un'altra se ne va.
    for (const id of [...avvisi.keys()]) if (!nuove.includes(id) && !inCorso.has(id)) avvisi.delete(id);
    if (tieni && !nuove.includes(tieni)) tieni = null;
    aperta = nuove.length ? { ids: nuove, gruppo: gruppo || null } : null;
  }

  // Si apre da sé la prima della scheda: la più urgente. Quella appena risposta resta finché non se ne sceglie un'altra.
  function scegliSeServe() {
    const visibili = inOrdine(scheda).map(idDi);
    if (aperta && aperta.ids.some((id) => trova(id))) {
      if (aperta.ids.some((id) => visibili.includes(id) || id === tieni)) return;
    }
    apri(visibili.length ? [visibili[0]] : null);
  }

  function disegna() {
    const el0 = $('mgDomandeStato');
    const lista = $('mgDomandeLista');
    const riprova = $('mgDomandeRiprova');
    const altre = $('mgDomandeAltre');
    if (!el0 || !lista || !MR) return;
    if (riprova) riprova.hidden = true;
    if (altre) altre.hidden = true;
    el0.hidden = false;
    if (!stato.lette || !D) {
      lista.hidden = true;
      lista.replaceChildren();
      firmaLista = '';
      if (!D) el0.textContent = 'Le domande non si possono mostrare: manca il modulo delle domande.';
      else if (stato.nonDisponibile) el0.textContent = 'Le domande non sono ancora disponibili: il server non le pubblica ancora.';
      else if (stato.soloOwner) el0.textContent = 'Le domande le vede solo l’owner: accedi col suo account.';
      else if (stato.fallita) {
        el0.textContent = `Non riesco a leggere le domande: ${stato.errore}`;
        if (riprova) riprova.hidden = false;
      } else el0.textContent = 'Caricamento…';
      conferma = null;
      disegnaConferma();
      disegnaTesta();
      aperta = null;
      disegnaDettaglio();
      return;
    }
    scegliSeServe();
    const n = inOrdine(scheda).length;
    const nascoste = !n && soloNonFidate() && tutteDiScheda(scheda).length > 0;
    const vuoto = n ? '' : (nascoste ? 'Qui sono tutte fidate.' : (VUOTO[scheda] || ''));
    if (stato.aggiornamento) {
      el0.textContent = `Non riesco ad aggiornare le domande: ${stato.aggiornamento}. Restano quelle dell’ultima lettura.${vuoto ? ` ${vuoto}` : ''}`;
      if (riprova) riprova.hidden = false;
    } else el0.textContent = vuoto;
    el0.hidden = !el0.textContent;
    lista.hidden = !n;
    disegnaLista();
    if (altre && stato.altre && CHIUSE.includes(scheda)) {
      altre.hidden = false;
      altre.textContent = scheda === 'domande-archivio' ? 'In archivio ci sono altre domande, più vecchie: qui si vedono le più recenti.'
        : 'Ci sono altre risposte automatiche, più vecchie: qui si vedono le più recenti.';
    }
    disegnaTesta();
    disegnaConferma();
    disegnaDettaglio();
  }

  // La domanda come la vede l'owner, in testo: è quello che Filo legge di una riga trascinata in chat.
  function riferimentoDi(d) {
    const id = idDi(d);
    const righe = [`Domanda ${id} (${[PRIORITA[d.priorita], NOMI_SCHEDA[MR.schedaDomanda(d)]].filter(Boolean).join(', ').toLowerCase()})`];
    if (d.illeggibile) righe.push('Il server non riesce ad aprire il testo di questa domanda.');
    if (d.contesto) righe.push('', 'Contesto:', String(d.contesto));
    if (d.problema) righe.push('', 'Problema:', String(d.problema));
    const ops = Array.isArray(d.opzioni) ? d.opzioni : [];
    if (ops.length) {
      righe.push('', 'Opzioni:');
      ops.forEach((o, i) => {
        const segni = [d.consiglio && d.consiglio.opzione === i ? 'consigliata' : '', sceltaFatta(d) === i && d.stato !== 'aperta' ? 'scelta' : ''].filter(Boolean);
        righe.push(`${i + 1}. ${o.testo}${segni.length ? ` (${segni.join(', ')})` : ''}`);
        if (o.pro) righe.push(`   Pro: ${o.pro}`);
        if (o.contro) righe.push(`   Contro: ${o.contro}`);
      });
    }
    if (d.consiglio && d.consiglio.perche) righe.push('', `Consiglio: opzione ${d.consiglio.opzione + 1}, ${d.consiglio.perche}`);
    const e = esito(d);
    if (e) righe.push('', `Esito: ${e.textContent}`);
    const da = principioUsato(d);
    if (da) righe.push('', `Risposta automatica col principio di ${da}${trova(da) && trova(da).principio ? `: ${trova(da).principio}` : ''}`);
    if (d.principio) righe.push('', `Principio: ${d.principio}`);
    if (d.notePerAgenti) righe.push('', riscritta(d) ? 'Testo originale di chi aveva chiesto:' : 'Note per gli agenti:', String(d.notePerAgenti));
    let testo = righe.join('\n');
    if (testo.length > RIFERIMENTO_MAX) testo = `${testo.slice(0, RIFERIMENTO_MAX)}\n[… tagliato qui: altri ${testo.length - RIFERIMENTO_MAX} caratteri]`;
    return { titolo: `${id} ${d.illeggibile ? '' : String(d.titolo || '')}`.trim(), testo };
  }

  // ── Eventi ────────────────────────────────────────────────────────────────
  const riprova = $('mgDomandeRiprova');
  if (riprova) riprova.addEventListener('click', () => { carica(); });

  const lista = $('mgDomandeLista');
  if (lista) {
    lista.addEventListener('change', (e) => {
      const c = e.target.closest('.mg-dom-sel');
      if (!c) return;
      for (const id of c.dataset.ids.split(' ').filter(Boolean)) { if (c.checked) scelte.add(id); else scelte.delete(id); }
      disegnaLista();
      disegnaTesta();
    });
    const apriDaRiga = (t) => {
      const g = t.closest('.mg-domande-gruppo');
      if (g) { apri(g.dataset.ids.split(' '), g.dataset.gruppo); return true; }
      const r = t.closest('.mg-domanda[data-id]');
      if (r) { apri([r.dataset.id]); return true; }
      return false;
    };
    lista.addEventListener('click', (e) => {
      if (e.target.closest('.mg-dom-sel')) return;
      if (!apriDaRiga(e.target)) return;
      disegnaLista();
      disegnaDettaglio();
      const box = $('mgDomandaDettaglio');
      if (box) box.scrollTop = 0;
    });
    lista.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('.mg-dom-sel')) return;
      if (!apriDaRiga(e.target)) return;
      e.preventDefault();
      disegnaLista();
      disegnaDettaglio();
    });
    lista.addEventListener('contextmenu', (e) => {
      const r = e.target.closest('.mg-domanda[data-id]');
      const d = r && trova(r.dataset.id);
      const menu = window.SN_MANAGE_MENU;
      if (!d || !menu) return;
      e.preventDefault();
      const voci = [{ testo: 'Apri', azione: () => { apri([d.id]); disegna(); } }];
      const et = d.stato === 'aperta' ? etichettaDi(consigliata(d)) : null;
      if (et) voci.push({ testo: `Applica il consiglio: ${et}`, azione: () => { apri([d.id]); disegna(); consiglioUna(d.id); } });
      if (d.stato !== 'in_smistamento') voci.push({ testo: `Copia «Discutiamo la domanda ${d.id}»`, azione: () => { apri([d.id]); disegna(); discuti(d.id); } });
      if (['aperta', 'in_lavorazione', 'in_smistamento'].includes(d.stato)) voci.push({ testo: 'Archivia senza azioni', azione: () => { apri([d.id]); disegna(); archivia(d.id, false); } });
      else if (riapribile(d)) voci.push({ testo: 'Riapri', titolo: titoloRiapri(d), azione: () => { apri([d.id]); disegna(); archivia(d.id, true); } });
      menu.apri(e.clientX, e.clientY, voci);
    });
    lista.addEventListener('dragstart', (e) => {
      const r = e.target.closest && e.target.closest('.mg-domanda[data-id]');
      const d = r && trova(r.dataset.id);
      if (!d || !e.dataTransfer) return;
      const rif = riferimentoDi(d);
      e.dataTransfer.setData(TIPO_RIFERIMENTO, JSON.stringify(rif));
      // Una chat che non conosce il riferimento riceve il testo: anche lì Filo ne legge il contenuto.
      e.dataTransfer.setData('text/plain', `${rif.titolo}\n\n${rif.testo}`);
      e.dataTransfer.effectAllowed = 'copy';
    });
  }

  const tutte = $('mgDomandeTutte');
  if (tutte) {
    tutte.addEventListener('change', () => {
      const ids = inOrdine('domande').map(idDi);
      if (tutte.checked) ids.forEach((id) => scelte.add(id)); else scelte.clear();
      disegnaLista();
      disegnaTesta();
    });
  }
  const selBtn = $('mgDomandeConsiglioSel');
  if (selBtn) {
    selBtn.addEventListener('click', () => {
      const ids = inOrdine('domande').map(idDi).filter((id) => scelte.has(id));
      if (!ids.length) return;
      conferma = Object.assign({ esiti: null, errore: '', inviando: false }, piano(ids));
      disegnaConferma();
    });
  }
  const confBox = $('mgDomandeConferma');
  if (confBox) {
    confBox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-conferma]');
      if (!b || b.disabled) return;
      if (b.dataset.conferma === 'si') { applicaConferma(); return; }
      conferma = null;
      disegnaConferma();
      disegnaTesta();
    });
  }

  const det = $('mgDomandaDettaglio');
  if (det) {
    det.addEventListener('input', (e) => {
      const ta = e.target.closest('.mg-dq-testo');
      if (!ta) return;
      const pieno = !!ta.value.trim();
      const prima = !!(bozze.get(ta.dataset.id) || '').trim();
      scriviBozza(ta.dataset.id, ta.value);
      if (avvisi.has(ta.dataset.id) && avvisi.get(ta.dataset.id).tipo === 'err') avvisi.delete(ta.dataset.id);
      // Il titolo dei pulsanti delle opzioni dice se il testo parte con la scelta.
      if (pieno !== prima) {
        const art = ta.closest('.mg-dq');
        art.querySelectorAll('.mg-dq-azione').forEach((b) => {
          if (pieno) b.title = 'Con la scelta parte anche il testo che hai scritto'; else b.removeAttribute('title');
        });
      }
    });
    det.addEventListener('keydown', (e) => {
      const ta = e.target.closest('.mg-dq-testo');
      if (!ta || e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      rispondi(ta.dataset.id);
    });
    det.addEventListener('click', (e) => {
      const fb = e.target.closest('[data-feedback]');
      if (fb) { if (dip.apriFeedback) dip.apriFeedback(fb.dataset.feedbackId, fb.dataset.feedback); return; }
      const dom = e.target.closest('[data-domanda]');
      if (dom) { apriDomanda(dom.dataset.domanda); return; }
      const b = e.target.closest('button[data-scelta], button[data-fai]');
      if (!b || b.disabled) return;
      const id = b.closest('.mg-dq').dataset.id;
      if (b.dataset.scelta !== undefined) { rispondi(id, Number(b.dataset.scelta)); return; }
      const fai = b.dataset.fai;
      if (fai === 'testo') rispondi(id);
      else if (fai === 'consiglio') consiglioUna(id);
      else if (fai === 'discuti') discuti(id);
      else if (fai === 'chiudi') archivia(id, false);
      else if (fai === 'riapri') archivia(id, true);
      else if (fai === 'originale') {
        if (originali.has(id)) originali.delete(id); else originali.add(id);
        disegnaDettaglio();
      }
    });
  }

  /**
   * Una domanda per id, da qualunque sezione (il segno «aspetta una domanda» di un feedback): si accende la sua scheda
   * con lei aperta. Una domanda che la pagina non ha ancora letto si chiede al main. @returns {Promise<boolean>}
   */
  async function apriDomanda(id) {
    const chiave = String(id || '').trim();
    if (D.numeroDi(chiave) === null) return false;
    let d = trova(chiave);
    if (!d && !finte) {
      const m = await chiedi({ type: T.mostra, id: chiave });
      if (m && m.ok && m.domanda) {
        aggiorna(m.domanda);
        Object.assign(stato.riferimenti, (m.riferimenti && typeof m.riferimenti === 'object') ? m.riferimenti : {});
        d = trova(chiave);
      }
    }
    if (!d) return false;
    // Aprire una domanda precisa la deve far vedere anche col filtro della fiducia acceso.
    if (soloNonFidate() && MR.isFidato(d) && dip.impostaSoloNonFidate) dip.impostaSoloNonFidate(false);
    // Prima di cambiare scheda: la scheda nuova apre da sé la prima, se quella aperta non è fra le sue.
    apri([d.id]);
    const tab = MR.schedaDomanda(d) || 'domande';
    if (dip.apriScheda) dip.apriScheda(tab); else { scheda = tab; disegna(); }
    return true;
  }

  window.SN_MG_DOMANDE = {
    carica,
    apriDomanda,
    stato: () => stato,
    mostra(tab) {
      if (VUOTO[tab] === undefined) return;
      if (tab !== scheda) { scheda = tab; conferma = null; tieni = null; }
      disegna();
    },
    alCambio(fn) { if (typeof fn === 'function') ascoltatori.push(fn); },
    // Un filtro della pagina è cambiato: lista, testa e numeri si rifanno.
    ridisegna() { cambia(); },
    // Quello che la pagina possiede: aprire un feedback nella sua scheda, accendere una scheda di Domande.
    collega(d) { Object.assign(dip, d || {}); },
    // Solo per le prove: domande finte (o un guasto finto) al posto del main, che da lì non le rimpiazza più.
    imposta(lista, opts) {
      finte = true;
      const errore = opts && opts.errore ? String(opts.errore) : '';
      Object.assign(stato, errore
        ? { lette: false, fallita: true, nonDisponibile: nonPubblicata(errore), soloOwner: !!(opts && opts.soloOwner), errore, aggiornamento: '', domande: [], riferimenti: {}, altre: false }
        : {
          lette: true, fallita: false, nonDisponibile: false, soloOwner: false, errore: '', aggiornamento: '',
          domande: Array.isArray(lista) ? lista : [], riferimenti: (opts && opts.riferimenti) || {}, altre: !!(opts && opts.altre),
        });
      cambia();
    },
  };
})();

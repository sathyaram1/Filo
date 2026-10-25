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

  const NOMI_SCHEDA = { domande: 'Da rispondere', 'domande-lavoro': 'In lavorazione', 'domande-archivio': 'Archivio' };
  const VUOTO = {
    domande: 'Nessuna domanda da rispondere.',
    'domande-lavoro': 'Nessuna domanda in lavorazione.',
    'domande-archivio': 'Nessuna domanda in archivio.',
  };
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
  const bozze = new Map();
  // Gli allegati della risposta, per domanda: partono col testo come righe d'allegato, che il server apre per chi
  // riprende (immagini `rK.j`), come quelli della risposta dalla pagina dei feedback.
  const allegati = new Map();
  const caricando = new Map();
  const ALLEGATI_MAX = { img: 5, file: 5 };
  const ALLEGATO_MAX_BYTE = 4 * 1024 * 1024;
  const ALLEGATI_ACCETTA = 'image/*,application/pdf,application/json,text/*,.pdf,.txt,.md,.markdown,.json,.csv,.log,.yml,.yaml';
  const avvisi = new Map();
  const inCorso = new Set();
  let conferma = null;
  const ascoltatori = [];
  const dip = { apriFeedback: null, apriScheda: null, soloNonFidate: null, impostaSoloNonFidate: null };
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

  // Le schede che aspettano seguono §3.7 (priorità, gruppo, età); l'archivio va dal più recente.
  function blocchi(tab) {
    const mie = diScheda(tab);
    if (tab === 'domande-archivio') {
      const t = (d) => Number(d.modificataIl) || Number(d.creataIl) || 0;
      return mie.slice().sort((a, b) => (t(b) - t(a)) || ((b.numero || 0) - (a.numero || 0)))
        .map((d) => ({ priorita: '', gruppo: '', domande: [d] }));
    }
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

  function riga(d, tab, nelGruppo) {
    const li = el('li', `mg-domanda mg-fiducia--${MR.segnoFiducia(d).classe}`);
    li.dataset.id = idDi(d);
    li.dataset.priorita = String(d.priorita || '');
    li.tabIndex = 0;
    if (nelGruppo) li.classList.add('mg-domanda--gruppo');
    if (aperta && aperta.ids.includes(li.dataset.id)) li.classList.add('mg-domanda--aperta');
    if (tab === 'domande') li.appendChild(casella([li.dataset.id], `Scegli ${li.dataset.id} per «Applica il consiglio»`));
    li.appendChild(el('span', 'mg-domanda-num', li.dataset.id));
    li.appendChild(el('span', 'mg-domanda-titolo', d.illeggibile ? 'Non si legge' : String(d.titolo || '(senza titolo)')));
    if (tab === 'domande-archivio') li.appendChild(el('span', 'mg-domanda-prio', PRIORITA[d.priorita] || ''));
    const data = quando(tab === 'domande-archivio' ? (d.modificataIl || d.creataIl) : d.creataIl);
    if (data) li.appendChild(el('span', 'mg-domanda-data', data));
    li.appendChild(scudo(d));
    return li;
  }

  function disegnaLista() {
    const lista = $('mgDomandeLista');
    if (!lista) return;
    const bl = blocchi(scheda);
    const firma = JSON.stringify([scheda, aperta && aperta.ids, [...scelte],
      bl.map((b) => [b.priorita, b.gruppo, b.domande.map((d) => [d.id, d.titolo, d.stato, d.modificataIl, d.illeggibile, d.fiducia])])]);
    if (firma === firmaLista && !lista.hidden) return;
    firmaLista = firma;
    lista.replaceChildren();
    let prio = null;
    for (const b of bl) {
      if (scheda !== 'domande-archivio' && b.priorita !== prio) {
        prio = b.priorita;
        lista.appendChild(el('li', 'mg-domande-prio', PRIORITA_PLURALE[prio] || 'Senza priorità'));
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
        lista.appendChild(g);
      }
      for (const d of b.domande) lista.appendChild(riga(d, scheda, gruppo));
    }
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
      if (c) c.textContent = stato.lette ? ` (${MR.contaNonFidate(tutteDiScheda(scheda))}${stato.altre && scheda === 'domande-archivio' ? '+' : ''})` : '';
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

  // Origine e collegamenti: un feedback noto al server si apre in Gestione, una domanda nel dettaglio.
  function legame(tipo, id) {
    if (tipo === 'feedback') {
      const r = rif(id);
      if (!r) return el('span', 'mg-dq-legame mg-dq-legame--muto', 'un feedback');
      const a = el('button', 'mg-dq-legame', r.num);
      a.type = 'button';
      a.dataset.feedback = r.num;
      a.title = `Apri ${r.num} nei Feedback`;
      return a;
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
    const h = el('h2', 'mg-dq-titolo', d.illeggibile ? 'Questa domanda non si legge' : String(d.titolo || '(senza titolo)'));
    const head = el('header', 'mg-dq-testa');
    head.append(meta, h);
    return head;
  }

  // Cosa fa al suo lavoro una domanda aperta (#1577): lo ferma, o lo lascia andare con la consigliata.
  function fermaIlLavoro(d) {
    if (d.stato !== 'aperta' || !d.legata || d.attesa) return null;
    const r = stato.riferimenti && stato.riferimenti[d.legata];
    const num = r && typeof r.num === 'string' && r.num ? r.num : 'il lavoro';
    const s = el('span', `mg-dq-ferma${d.blocca ? ' mg-dq-ferma--si' : ''}`, d.blocca ? `ferma ${num}` : `${num} va avanti`);
    s.title = d.blocca
      ? 'Nessuna routine lo prende finché non rispondi.'
      : 'Il lavoro va avanti con la consigliata; se scegli altro riparte con la tua scelta, anche se è già fuso.';
    return s;
  }

  // L'ultima scelta fatta su questa domanda, per segnarla nell'archivio.
  function sceltaFatta(d) {
    const turni = Array.isArray(d.conversazione) ? d.conversazione : [];
    for (let i = turni.length - 1; i >= 0; i--) if (Number.isInteger(turni[i].scelta)) return turni[i].scelta;
    return null;
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
    const etichetta = d.stato === 'aperta' ? etichettaDi(o) : null;
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
    else if (e && e.archiviata) testo = `Archiviata senza azioni${e.applicataIl ? ` ${ilGiorno(e.applicataIl)}` : ''}.`;
    else if (e && e.automatica) testo = 'Risposta automatica.';
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
    if (rispondibile && !d.illeggibile) {
      const ta = el('textarea', 'mg-dq-testo');
      ta.rows = 3;
      ta.placeholder = d.stato === 'aperta' ? 'Rispondi a parole…' : 'Aggiungi qualcosa…';
      ta.value = bozze.get(d.id) || '';
      ta.dataset.id = d.id;
      ta.disabled = occupata;
      box.appendChild(ta);
      box.appendChild(rigaAllegati(d.id, occupata));
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
    tasto('Discutiamone', 'discuti', 'sn-btn-secondary', `Copia «Discutiamo la domanda ${idDi(d)}» da incollare in una sessione locale`);
    if (rispondibile) tasto('Archivia', 'chiudi', 'sn-btn-secondary', 'Chiudi la domanda senza applicare niente; si può riaprire');
    else if (d.esito && d.esito.archiviata) tasto('Riapri', 'riapri', 'sn-btn-secondary', 'Rimettila fra quelle da rispondere');
    box.appendChild(tasti);
    const a = avvisi.get(d.id);
    const msg = el('p', `mg-dq-msg${a && a.tipo ? ` mg-dq-msg--${a.tipo}` : ''}`, a ? a.testo : '');
    msg.setAttribute('role', 'status');
    box.appendChild(msg);
    return box;
  }

  function etichettaAllegato(a, i) {
    return a.kind === 'img' ? `Immagine ${i + 1}` : (a.name || 'allegato');
  }

  function rigaAllegati(id, occupata) {
    const riga = el('div', 'mg-dq-allegati');
    const lista = allegati.get(id) || [];
    let immagini = 0;
    lista.forEach((a, i) => {
      if (a.kind === 'img') immagini += 1;
      const chip = el('span', 'mg-dq-allegato', a.kind === 'img' ? `Immagine ${immagini}` : (a.name || 'allegato'));
      chip.title = a.name || '';
      const x = el('button', 'mg-dq-allegato-x', '×');
      x.type = 'button';
      x.dataset.fai = 'togli-allegato';
      x.dataset.indice = String(i);
      x.title = 'Togli';
      x.setAttribute('aria-label', `Togli ${a.name || 'l’allegato'}`);
      x.disabled = occupata;
      chip.appendChild(x);
      riga.appendChild(chip);
    });
    const b = el('button', 'sn-btn sn-btn-secondary mg-dq-allega', caricando.get(id) ? 'Caricamento…' : '+ Allega');
    b.type = 'button';
    b.dataset.fai = 'allega';
    b.title = 'Immagini o file per chi riprende il lavoro; puoi anche incollarli nel testo';
    b.disabled = occupata || !!caricando.get(id);
    const input = el('input', 'mg-dq-file');
    input.type = 'file';
    input.multiple = true;
    input.accept = ALLEGATI_ACCETTA;
    input.hidden = true;
    input.dataset.id = id;
    riga.append(b, input);
    return riga;
  }

  async function aggiungiAllegati(id, files) {
    const AT = window.SN_FEEDBACK_ATTACH;
    const FB = window.SN_FEEDBACK;
    for (const file of files) {
      const lista = allegati.get(id) || [];
      const tipo = AT && typeof AT.classify === 'function' ? AT.classify(file) : (/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(file.type || '') ? 'image' : null);
      let errore = '';
      if (!tipo) errore = 'Tipo di file non supportato. Ammessi: immagini, PDF, testo, markdown, CSV e JSON.';
      else if (lista.filter((a) => (a.kind === 'img') === (tipo === 'image')).length >= ALLEGATI_MAX[tipo === 'image' ? 'img' : 'file']) errore = `Massimo ${ALLEGATI_MAX.img} immagini e ${ALLEGATI_MAX.file} file per risposta.`;
      else if (file.size > ALLEGATO_MAX_BYTE) errore = `«${file.name || 'file'}» è troppo grande (massimo 4 MB).`;
      else if (!FB || typeof FB.uploadAttachment !== 'function') errore = 'Il caricamento degli allegati non è disponibile qui.';
      if (errore) { avvisi.set(id, { testo: errore, tipo: 'err' }); disegnaDettaglio(); continue; }
      caricando.set(id, (caricando.get(id) || 0) + 1);
      disegnaDettaglio();
      try {
        const att = await FB.uploadAttachment(file, file.name);
        if (att && att.url) allegati.set(id, (allegati.get(id) || []).concat([att]));
        if (avvisi.has(id) && avvisi.get(id).tipo === 'err') avvisi.delete(id);
      } catch (e) {
        avvisi.set(id, { testo: `Allegato non caricato: ${(e && e.message) || e}`, tipo: 'err' });
      } finally {
        const n = (caricando.get(id) || 1) - 1;
        if (n > 0) caricando.set(id, n); else caricando.delete(id);
        disegnaDettaglio();
      }
    }
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
    if (d.illeggibile) {
      art.appendChild(el('p', 'mg-dq-esito mg-dq-esito--err', 'Il server non riesce ad aprire il testo di questa domanda.'));
      art.appendChild(risposta(d));
      return art;
    }
    if (d.contesto) art.appendChild(sezione('', 'Contesto', md(d.contesto)));
    if (d.problema) art.appendChild(sezione('', 'Problema', md(d.problema)));
    // Il principio (§3.6) lo scrive chi ha gestito la risposta: è la regola che entra nel registro, e l'owner la vede.
    const principio = d.principio ? sezione('mg-dq-principio', 'Principio', md(d.principio)) : null;
    for (const parte of [opzioni(d), consiglio(d), esito(d), principio, conversazione(d), risposta(d)]) if (parte) art.appendChild(parte);
    if (d.notePerAgenti) {
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
    const firma = JSON.stringify([ds.map((d) => [d.id, d.stato, d.modificataIl, d.esito, d.titolo, d.illeggibile,
      ...(d.opzioni || []).map((o) => etichettaDi(o))]), [...inCorso], [...avvisi], stato.lette,
      [...allegati].map(([k, v]) => [k, v.map((a) => a.url)]), [...caricando]]);
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
    if (caricando.get(id)) {
      avvisi.set(id, { testo: 'Aspetta che gli allegati finiscano di caricarsi.', tipo: 'err' });
      disegnaDettaglio();
      return;
    }
    const righe = window.SN_FEEDBACK_THREAD ? window.SN_FEEDBACK_THREAD.attachmentsBlock(allegati.get(id) || []) : '';
    const testo = [(bozze.get(id) || '').trim(), righe].filter(Boolean).join('\n');
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
    if (r.ok) { bozze.delete(id); allegati.delete(id); }
    const d = r.domanda || trova(id);
    dopo(id, r, d && d.stato === 'in_lavorazione' ? 'Mandata: la prende un agente.' : 'Fatto.');
  }

  async function consiglioUna(id) {
    // Col testo scritto il consiglio è una scelta come le altre: le parole partono con lei.
    const d = trova(id);
    if (((bozze.get(id) || '').trim() || (allegati.get(id) || []).length) && d && d.consiglio) return rispondi(id, d.consiglio.opzione);
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
    dopo(id, fine, 'Fatto.');
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
    if (r) dopo(id, r, riapri ? 'Riaperta.' : 'Archiviata.');
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
    if (altre && stato.altre && scheda === 'domande-archivio') {
      altre.hidden = false;
      altre.textContent = 'In archivio ci sono altre domande, più vecchie: qui si vedono le più recenti.';
    }
    disegnaTesta();
    disegnaConferma();
    disegnaDettaglio();
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
      voci.push({ testo: `Copia «Discutiamo la domanda ${d.id}»`, azione: () => { apri([d.id]); disegna(); discuti(d.id); } });
      if (d.stato === 'aperta' || d.stato === 'in_lavorazione') voci.push({ testo: 'Archivia senza azioni', azione: () => { apri([d.id]); disegna(); archivia(d.id, false); } });
      else if (d.esito && d.esito.archiviata) voci.push({ testo: 'Riapri', azione: () => { apri([d.id]); disegna(); archivia(d.id, true); } });
      menu.apri(e.clientX, e.clientY, voci);
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
      bozze.set(ta.dataset.id, ta.value);
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
      if (fb) { if (dip.apriFeedback) dip.apriFeedback(fb.dataset.feedback); return; }
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
      else if (fai === 'allega') { const f = b.closest('.mg-dq-allegati').querySelector('.mg-dq-file'); if (f) f.click(); }
      else if (fai === 'togli-allegato') {
        const lista = (allegati.get(id) || []).slice();
        lista.splice(Number(b.dataset.indice), 1);
        if (lista.length) allegati.set(id, lista); else allegati.delete(id);
        disegnaDettaglio();
      }
    });
    det.addEventListener('change', (e) => {
      const f = e.target.closest('.mg-dq-file');
      if (!f) return;
      const files = Array.from(f.files || []);
      f.value = '';
      if (files.length) aggiungiAllegati(f.dataset.id, files);
    });
    // Incolla: un'immagine negli appunti diventa un allegato, il testo resta testo.
    det.addEventListener('paste', (e) => {
      const ta = e.target.closest('.mg-dq-testo');
      const items = ta && e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const files = [];
      for (const it of items) if (it.kind === 'file') { const b = it.getAsFile(); if (b) files.push(b); }
      if (!files.length) return;
      e.preventDefault();
      aggiungiAllegati(ta.dataset.id, files);
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

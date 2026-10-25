// Scheda Contatori di Gestione (#1462): le somme dei contatori anonimi per intervallo, versione e sistema, chieste al main.
// Non riceve mai un dato di una copia sola: una cella sotto le cinque copie arriva come { sotto: true } e si scrive
// «meno di 5». Somme e soglia: src/main/services/contatoriSomme.js. Prove: tests/manage-contatori.spec.mjs.

(function () {
  'use strict';

  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const SOMME = MSG.CONTATORI_SOMME || 'contatori_somme';
  const $ = (id) => document.getElementById(id);
  const root = $('mgCtRoot');
  if (!root) return;
  const el = {
    negato: $('mgCtNegato'), corpo: $('mgCtCorpo'), finestra: $('mgCtFinestra'), date: $('mgCtDate'), dal: $('mgCtDal'),
    al: $('mgCtAl'), versione: $('mgCtVersione'), sistema: $('mgCtSistema'), rileggi: $('mgCtRileggi'), stato: $('mgCtStato'),
    guasto: $('mgCtGuasto'), dati: $('mgCtDati'), totale: $('mgCtTotale'), periodi: $('mgCtPeriodi'),
    periodiAsse: $('mgCtPeriodiAsse'), oreTitolo: $('mgCtOreTitolo'), ore: $('mgCtOre'), oreAsse: $('mgCtOreAsse'),
    blocchi: $('mgCtBlocchi'),
  };

  const SCELTA_KEY = 'filo_manage_contatori_scelta';
  // `da` e `a`: quanti giorni prima di oggi cominciano e finiscono.
  const PRESET = [
    { id: 'oggi', nome: 'Oggi', da: 0, a: 0 },
    { id: 'ieri', nome: 'Ieri', da: 1, a: 1 },
    { id: '7', nome: '7 giorni', da: 6, a: 0 },
    { id: '30', nome: '30 giorni', da: 29, a: 0 },
    { id: '90', nome: '90 giorni', da: 89, a: 0 },
    { id: 'mano', nome: 'Scegli tu' },
  ];
  const SISTEMI = { win: 'Windows', mac: 'macOS', linux: 'Linux', altro: 'Altri sistemi' };
  const FASCE = ['fino a 0,5 s', 'fino a 1 s', 'fino a 2 s', 'fino a 5 s', 'fino a 10 s', 'fino a 30 s', 'oltre 30 s'];
  const POSIZIONI = ['1ª voce', '2ª voce', '3ª voce', '4ª o 5ª voce', 'dalla 6ª alla 10ª', 'oltre la 10ª'];
  const SCELTE = {
    si: 'sì', no: 'no', completa: 'completa', anticipata: 'chiusa prima della fine', saltata: 'con «Salta»',
    uscita: 'uscendo da Filo', tetto: 'al tetto dei turni',
  };
  const nomeScelta = (k) => (Object.prototype.hasOwnProperty.call(SCELTE, k) ? SCELTE[k] : String(k));
  const GIORNO_RE = /^20\d{2}-[01]\d-[0-3]\d$/;
  const APP_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
  const SOTTO = 'meno di 5';
  const SPIEGA_SOTTO = 'Contato su meno di cinque copie di Filo: il numero non si mostra, per non leggere il comportamento di un tester.';

  // Chiamato a ogni invio: le prove sostituiscono window.filo.message dopo il caricamento.
  function send(m) {
    if (window.filo && window.filo.message) return window.filo.message(m);
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) return chrome.runtime.sendMessage(m);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  // ── Date ────────────────────────────────────────────────────────────────────
  const due = (n) => String(n).padStart(2, '0');
  const giornoDa = (d) => `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`;
  const dataDi = (g) => { const [y, m, d] = String(g).split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const valido = (g) => GIORNO_RE.test(String(g || '')) && giornoDa(dataDi(g)) === g;
  function giorniFa(n) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return giornoDa(d); }
  function breve(g) {
    try { return dataDi(g).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); } catch (_) { return String(g); }
  }
  function nomePeriodo(p, passo) {
    if (!p) return '';
    if (passo === 'mese') {
      try { return dataDi(`${p.chiave}-01`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }); } catch (_) { return p.chiave; }
    }
    if (passo === 'settimana') return p.dal === p.al ? breve(p.dal) : `dal ${breve(p.dal)} al ${breve(p.al)}`;
    return breve(p.dal);
  }

  // ── La scelta, ricordata intera ─────────────────────────────────────────────
  const PREDEFINITA = Object.freeze({ preset: '7', dal: '', al: '', app: '', os: '' });
  function leggiScelta() {
    try {
      const v = JSON.parse(localStorage.getItem(SCELTA_KEY) || 'null');
      if (!v || typeof v !== 'object' || !PRESET.some((p) => p.id === v.preset)) return { ...PREDEFINITA };
      if (v.preset === 'mano' && !(valido(v.dal) && valido(v.al) && v.dal <= v.al)) return { ...PREDEFINITA };
      if (typeof v.app !== 'string' || (v.app && !APP_RE.test(v.app))) return { ...PREDEFINITA };
      if (typeof v.os !== 'string' || (v.os && !Object.prototype.hasOwnProperty.call(SISTEMI, v.os))) return { ...PREDEFINITA };
      return { preset: v.preset, dal: v.preset === 'mano' ? v.dal : '', al: v.preset === 'mano' ? v.al : '', app: v.app, os: v.os };
    } catch (_) { return { ...PREDEFINITA }; }
  }
  function salvaScelta() { try { localStorage.setItem(SCELTA_KEY, JSON.stringify(scelta)); } catch (_) {} }

  function intervalloDi(preset) {
    if (preset === 'mano') return { dal: scelta.dal, al: scelta.al };
    const p = PRESET.find((x) => x.id === preset) || PRESET[2];
    return { dal: giorniFa(p.da), al: giorniFa(p.a) };
  }

  let owner = false;
  let scelta = leggiScelta();
  let somme = null;
  let lettura = 0;
  // Il periodo del grafico per ora; '' è tutto l'intervallo.
  let periodoOre = '';
  // La riga aperta sul suo andamento, come «blocco|id»; e i blocchi con le voci sotto soglia in vista.
  let aperta = '';
  const espansi = new Set();

  // ── Lettura ─────────────────────────────────────────────────────────────────
  function fraseGuasto(raw) {
    const t = String(raw || '');
    if (/^(Intervallo|Versione|Sistema)/.test(t)) return t.replace(/\.$/, '');
    if (typeof window.SN_MG_FRASE_CONTATORI === 'function') return window.SN_MG_FRASE_CONTATORI(t);
    return 'il server non risponde';
  }

  async function carica({ forza = false } = {}) {
    if (!owner) return;
    const mia = ++lettura;
    const { dal, al } = intervalloDi(scelta.preset);
    disegnaFiltri();
    el.dati.setAttribute('aria-busy', 'true');
    el.stato.textContent = 'Leggo i contatori…';
    let r;
    try {
      r = await send({ type: SOMME, dal, al, app: scelta.app, os: scelta.os, forza });
    } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (mia !== lettura) return;
    el.dati.removeAttribute('aria-busy');
    if (!r || !r.ok || !r.somme) {
      const err = r && r.error;
      if (err === 'not_admin') { owner = false; porta(); return; }
      // Un numero che non si è letto non resta a schermo come se fosse di adesso.
      somme = null;
      el.dati.hidden = true;
      el.stato.textContent = '';
      el.guasto.hidden = false;
      el.guasto.textContent = /^(Intervallo|Versione|Sistema)/.test(String(err || ''))
        ? `${fraseGuasto(err)}.` : `I contatori non si sono letti: ${fraseGuasto(err)}.`;
      return;
    }
    somme = r.somme;
    el.guasto.hidden = true;
    el.dati.hidden = false;
    disegna();
  }

  // ── Filtri ──────────────────────────────────────────────────────────────────
  function disegnaFiltri() {
    el.finestra.innerHTML = '';
    for (const p of PRESET) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mg-chip';
      b.dataset.preset = p.id;
      b.textContent = p.nome;
      const on = scelta.preset === p.id;
      b.classList.toggle('mg-chip--on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (p.id !== 'mano') {
        const { dal, al } = intervalloDi(p.id);
        b.title = dal === al ? breve(dal) : `Dal ${breve(dal)} al ${breve(al)}`;
      } else b.title = 'Scegli le due date';
      b.addEventListener('click', () => scegliPreset(p.id));
      el.finestra.appendChild(b);
    }
    el.date.hidden = scelta.preset !== 'mano';
    if (scelta.preset === 'mano') {
      if (document.activeElement !== el.dal) el.dal.value = scelta.dal;
      if (document.activeElement !== el.al) el.al.value = scelta.al;
    }
    opzioni(el.versione, [['', 'Tutte le versioni'], ...versioni().map((v) => [v, `Filo ${v}`])], scelta.app);
    opzioni(el.sistema, [['', 'Tutti i sistemi'], ...Object.entries(SISTEMI)], scelta.os);
  }

  // Una versione scelta resta nell'elenco anche se nell'intervallo nuovo non c'è: sparire la cambierebbe di nascosto.
  function versioni() {
    const l = somme && Array.isArray(somme.versioni) ? somme.versioni.slice() : [];
    if (scelta.app && !l.includes(scelta.app)) l.unshift(scelta.app);
    return l;
  }

  function opzioni(sel, voci, valore) {
    const prima = [...sel.options].map((o) => `${o.value}=${o.textContent}`).join('|');
    const dopo = voci.map(([v, t]) => `${v}=${t}`).join('|');
    if (prima !== dopo) {
      sel.innerHTML = '';
      for (const [v, t] of voci) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        sel.appendChild(o);
      }
    }
    sel.value = valore;
  }

  function scegliPreset(id) {
    if (id === 'mano' && scelta.preset !== 'mano') {
      const { dal, al } = intervalloDi(scelta.preset);
      scelta = { ...scelta, preset: 'mano', dal, al };
    } else if (id !== 'mano') {
      scelta = { ...scelta, preset: id, dal: '', al: '' };
    }
    salvaScelta();
    carica().catch(() => {});
    if (id === 'mano') el.dal.focus();
  }

  // Due date al rovescio si raddrizzano; una data vuota o storta lascia la finestra di prima.
  function dateCambiate() {
    let dal = el.dal.value;
    let al = el.al.value;
    if (!valido(dal) || !valido(al)) return;
    if (dal > al) [dal, al] = [al, dal];
    // Raddrizzate si riscrivono subito, anche nel campo col fuoco: il prossimo «change» le rilegge da lì.
    el.dal.value = dal;
    el.al.value = al;
    if (dal === scelta.dal && al === scelta.al) return;
    scelta = { ...scelta, preset: 'mano', dal, al };
    salvaScelta();
    carica().catch(() => {});
  }
  el.dal.addEventListener('change', dateCambiate);
  el.al.addEventListener('change', dateCambiate);
  el.versione.addEventListener('change', () => {
    if (el.versione.value === scelta.app) return;
    scelta = { ...scelta, app: el.versione.value };
    salvaScelta();
    carica().catch(() => {});
  });
  el.sistema.addEventListener('change', () => {
    if (el.sistema.value === scelta.os) return;
    scelta = { ...scelta, os: el.sistema.value };
    salvaScelta();
    carica().catch(() => {});
  });
  el.rileggi.addEventListener('click', () => { carica({ forza: true }).catch(() => {}); });

  // ── Disegno ─────────────────────────────────────────────────────────────────
  const formatInt = (n) => new Intl.NumberFormat('it-IT', { useGrouping: true }).format(Math.round(Number(n) || 0));
  const copieTesto = (n) => `${formatInt(n)} ${Number(n) === 1 ? 'copia' : 'copie'}`;
  const sotto = (c) => !c || c.sotto === true;

  function disegna() {
    if (!somme) return;
    disegnaFiltri();
    const ora = somme.lettoAlle ? new Date(somme.lettoAlle).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    el.stato.textContent = somme.completo === false
      ? 'Lettura parziale: oltre duecentomila documenti, i numeri qui sotto ne contano solo una parte.'
      : (ora ? `Letti alle ${ora}` : '');
    el.stato.classList.toggle('mg-err', somme.completo === false);
    if (!somme.periodi.some((p) => p.chiave === periodoOre)) periodoOre = '';
    disegnaCopie();
    disegnaBlocchi();
  }

  function disegnaCopie() {
    const c = somme.copie;
    el.totale.innerHTML = '';
    const b = document.createElement('b');
    if (sotto(c.totale)) { b.textContent = SOTTO; b.className = 'mg-ct-sotto'; b.title = SPIEGA_SOTTO; } else b.textContent = formatInt(c.totale.n);
    const t = document.createElement('span');
    t.textContent = !sotto(c.totale) && c.totale.n === 1 ? 'copia nell’intervallo' : 'copie nell’intervallo';
    el.totale.append(b, t);
    el.totale.title = c.mesi > 1
      ? 'Lo pseudonimo cambia ogni mese: una copia attiva in due mesi qui conta due volte.' : 'Copie di Filo che hanno mandato almeno un’ora di contatori.';

    const nomi = somme.periodi.map((p) => nomePeriodo(p, somme.passo));
    colonne(el.periodi, c.periodi, {
      nome: (i) => nomi[i],
      scelta: (i) => somme.periodi[i].chiave === periodoOre,
      clic: somme.periodi.length > 1 ? (i) => scegliPeriodo(somme.periodi[i].chiave) : null,
      menu: (i, ev) => menuPeriodo(i, ev),
    });
    asse(el.periodiAsse, [nomePeriodo(somme.periodi[0], somme.passo), nomePeriodo(somme.periodi[somme.periodi.length - 1], somme.passo)]);
    const i = somme.periodi.findIndex((p) => p.chiave === periodoOre);
    el.oreTitolo.textContent = i < 0 ? 'Per ora del giorno, in tutto l’intervallo' : `Per ora del giorno, ${nomi[i]}`;
    el.oreTitolo.title = 'L’ora di chi usa Filo, nel suo fuso. Una copia conta una volta per ogni ora in cui era aperta.';
    colonne(el.ore, i < 0 ? c.ore : c.orePer[periodoOre], { nome: (h) => `dalle ${h} alle ${h + 1}`, menu: (_h, ev) => menuGenerale(ev) });
    asse(el.oreAsse, ['0', '6', '12', '18', '23']);
  }

  function scegliPeriodo(chiave) {
    periodoOre = periodoOre === chiave ? '' : chiave;
    disegnaCopie();
  }

  function asse(box, etichette) {
    box.innerHTML = '';
    for (const e of etichette) { const s = document.createElement('span'); s.textContent = e; box.appendChild(s); }
  }

  // Una colonna per periodo, anche vuoto; sotto soglia una tacca a righe che non dice quanto.
  function colonne(box, celle, { nome, scelta: eScelta = () => false, clic = null, menu = null }) {
    box.innerHTML = '';
    const lista = Array.isArray(celle) ? celle : [];
    const max = Math.max(1, ...lista.filter((c) => !sotto(c)).map((c) => c.n));
    box.classList.toggle('mg-ct-grafico--poche', lista.length < 3);
    lista.forEach((c, i) => {
      const apribile = clic && !sotto(c);
      const col = document.createElement(apribile ? 'button' : 'span');
      col.className = 'mg-ct-col';
      col.dataset.i = String(i);
      if (apribile) col.type = 'button';
      else col.classList.add('mg-ct-col--muta');
      if (sotto(c)) {
        col.classList.add('mg-ct-col--sotto');
        col.title = `${nome(i)}: ${SOTTO} copie`;
      } else {
        col.style.height = `${Math.max(3, Math.round((c.n / max) * 100))}%`;
        col.title = `${nome(i)}: ${copieTesto(c.n)}`;
      }
      col.setAttribute('aria-label', col.title);
      if (!apribile) col.setAttribute('role', 'img');
      if (eScelta(i)) { col.classList.add('mg-ct-col--scelta'); col.setAttribute('aria-pressed', 'true'); }
      if (apribile) col.addEventListener('click', () => clic(i));
      if (menu) col.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); menu(i, ev); });
      box.appendChild(col);
    });
  }

  // ── I blocchi ───────────────────────────────────────────────────────────────
  const n = (titolo, di, piccolo) => ({ titolo, piccolo, tipo: 'n', di });
  const q = (titolo, di, piccolo) => ({ titolo, piccolo, tipo: 'quota', di });
  const f = (titolo, di, nomi, piccolo) => ({ titolo, piccolo, tipo: 'fasce', di, nomi });
  const ch = (titolo, di) => ({ titolo, tipo: 'chips', di });
  const tx = (titolo, di) => ({ titolo, tipo: 'testo', di });
  const C = (k) => (r) => r.celle[k];
  const PRINC = (r) => r.principale;
  const COPIE = (r) => (sotto(r.principale) ? r.principale : { n: r.principale.copie });
  const attese = (voce) => [
    tx(voce, (r) => r.etichetta),
    n('Volte', C('n')),
    f('Fino alla prima cosa a schermo', C('visto'), FASCE, '0,5 s → oltre 30 s'),
    f('Fino alla fine', C('fine'), FASCE, '0,5 s → oltre 30 s'),
    q('Rifatte subito', C('rifatteQuota'), 'entro 10 s'),
  ];
  const BLOCCHI = [
    { id: 'azioni', titolo: 'Quanto si aspetta un’azione', righe: (s) => s.attese.filter((r) => r.celle.tipo === 'azione'), colonne: attese('Azione'), chiuso: true },
    { id: 'funzioni', titolo: 'Quanto si aspetta una risposta di un modello', righe: (s) => s.attese.filter((r) => r.celle.tipo === 'funzione'), colonne: attese('Funzione'), chiuso: true },
    {
      id: 'ricerche', titolo: 'Ricerche nei pannelli', righe: (s) => s.ricerche, fisso: true, colonne: [
        tx('Pannello', (r) => r.etichetta), n('Aperture', C('aperte')), n('Scelte', C('scelte')),
        f('Tempo per scegliere', C('tempo'), FASCE, '0,5 s → oltre 30 s'),
        f('Posto della voce scelta', C('posizioni'), POSIZIONI, '1ª → oltre la 10ª'),
        n('Chiuse senza scelta', C('vuote')), q('Abbandoni', C('vuoteQuota')),
      ],
    },
    {
      id: 'correttore', titolo: 'Proposte del correttore', righe: (s) => s.correttore, fisso: true, colonne: [
        tx('Tipo e modello', (r) => r.etichetta), n('Mostrate', C('mostrate')), n('Accettate', C('accettate')),
        n('Rifiutate', C('rifiutate')), n('Ignorate', C('ignorate')), q('Accettazione', C('accettateQuota')),
      ],
    },
    {
      id: 'conferme', titolo: 'Azioni di Filo', righe: (s) => s.conferme, chiuso: true, colonne: [
        tx('Azione', (r) => r.etichetta),
        n('Partite da sole', (r) => (r.celle.soloPagina ? undefined : r.celle.automatica)),
        n('Approvate', (r) => (r.celle.soloPagina ? undefined : r.celle.approvata)),
        n('Rifiutate', (r) => (r.celle.soloPagina ? undefined : r.celle.rifiutata)),
        n('Senza risposta', (r) => (r.celle.soloPagina ? undefined : r.celle.senzaRisposta), 'dopo 10 minuti'),
        n('Fermate da Filo', (r) => (r.celle.soloPagina ? undefined : r.celle.negata)),
        n('Annullate subito dopo', C('annullati'), 'entro 30 s'),
      ],
    },
    {
      id: 'impostazioni', titolo: 'Impostazioni cambiate', righe: (s) => s.impostazioni, chiuso: true, copie: true, colonne: [
        tx('Impostazione', (r) => r.etichetta), n('Copie', PRINC),
        ch('Verso', (r) => r.celle.valori.map((v) => ({ etichetta: v.etichetta, cella: v.copie }))),
        n('A mano', (r) => r.celle.vie.mano), n('Chiedendolo a Filo', (r) => r.celle.vie.chat),
        n('Da Filo', (r) => r.celle.vie.auto), n('Da un import', (r) => r.celle.vie.import),
      ],
    },
    {
      id: 'anticipi', titolo: 'Risposte preparate in anticipo', righe: (s) => s.anticipi, chiuso: true, colonne: [
        tx('Funzione', (r) => r.etichetta), n('Preparate', C('preparati')), n('Aperte', C('aperti')),
        n('Mai viste', C('maiVisti')), q('Mai viste, sul totale', C('maiVistiQuota')),
      ],
    },
    {
      id: 'chiedi', titolo: 'Clic su «Chiedi»', righe: (s) => s.chiedi, chiuso: true, colonne: [
        tx('Funzione', (r) => r.etichetta), n('Clic', PRINC), n('Copie', COPIE),
      ],
    },
    {
      id: 'erroriVisti', titolo: 'Errori visti da chi usa Filo', righe: (s) => s.erroriVisti, colonne: [
        tx('Errore', (r) => r.etichetta), n('Volte', PRINC), n('Copie', COPIE),
      ],
    },
    {
      id: 'guasti', titolo: 'Guasti delle chiamate ai modelli', righe: (s) => s.guasti, colonne: [
        tx('Funzione', (r) => r.etichetta), tx('Modello', (r) => r.celle.modello), tx('Fornitore', (r) => r.celle.host || '—'),
        tx('Guasto', (r) => r.celle.tipo), n('Volte', PRINC), n('Copie', COPIE),
      ],
    },
    {
      id: 'intervista', titolo: 'Intervista di benvenuto', righe: (s) => s.intervista, fisso: true, copie: true, colonne: [
        tx('Passo', (r) => r.etichetta), n('Superato', C('spuntata'), 'copie'), n('Abbandonata qui', C('abbandono'), 'copie'),
        ch('Risposte e chiusure', (r) => r.celle.scelte.map((x) => ({ etichetta: nomeScelta(x.scelta), cella: x.copie }))),
      ],
    },
    {
      id: 'primeVolte', titolo: 'Prima volta nel mese', righe: (s) => s.primeVolte, chiuso: true, copie: true, colonne: [
        tx('Funzione o azione', (r) => r.etichetta), n('Copie', PRINC),
      ],
    },
  ];

  function disegnaBlocchi() {
    el.blocchi.innerHTML = '';
    for (const def of BLOCCHI) el.blocchi.appendChild(blocco(def));
  }

  function blocco(def) {
    const sez = document.createElement('section');
    sez.className = 'mg-ct-sez';
    sez.dataset.blocco = def.id;
    const h = document.createElement('h3');
    h.textContent = def.titolo;
    sez.appendChild(h);
    const righe = def.righe(somme) || [];
    if (!righe.length) {
      const p = document.createElement('p');
      p.className = 'mg-ct-vuoto';
      p.textContent = 'Nessuna voce contata su almeno cinque copie.';
      sez.appendChild(p);
      sez.addEventListener('contextmenu', (ev) => { ev.preventDefault(); menuGenerale(ev); });
      return sez;
    }
    const wrap = document.createElement('div');
    wrap.className = 'mg-ct-tabwrap';
    const tab = document.createElement('table');
    tab.className = 'mg-ct-tab';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    for (const col of def.colonne) {
      const th = document.createElement('th');
      th.textContent = col.titolo;
      if (col.piccolo) { const s = document.createElement('small'); s.textContent = col.piccolo; th.appendChild(s); }
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    tab.appendChild(thead);
    const tbody = document.createElement('tbody');
    const visibili = def.fisso ? righe : righe.filter((r) => !sotto(r.principale));
    const nascoste = def.fisso ? [] : righe.filter((r) => sotto(r.principale));
    for (const r of visibili) aggiungiRiga(tbody, def, r, false);
    if (nascoste.length) {
      const mostra = espansi.has(def.id);
      const tr = document.createElement('tr');
      tr.className = 'mg-ct-altre';
      const td = document.createElement('td');
      td.colSpan = def.colonne.length;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-expanded', mostra ? 'true' : 'false');
      const quante = `${formatInt(nascoste.length)} ${nascoste.length === 1 ? 'voce' : 'voci'}`;
      b.textContent = mostra ? `Nascondi le ${quante} contate su meno di cinque copie`
        : (visibili.length ? `Altre ${quante}, ognuna contata su meno di cinque copie` : `${quante}, tutte contate su meno di cinque copie`);
      b.addEventListener('click', () => {
        if (espansi.has(def.id)) espansi.delete(def.id); else espansi.add(def.id);
        const nuova = blocco(def);
        sez.replaceWith(nuova);
        const bott = nuova.querySelector('.mg-ct-altre button');
        if (bott) bott.focus();
      });
      td.appendChild(b);
      tr.appendChild(td);
      tbody.appendChild(tr);
      if (mostra) for (const r of nascoste) aggiungiRiga(tbody, def, r, true);
    }
    tab.appendChild(tbody);
    wrap.appendChild(tab);
    sez.appendChild(wrap);
    return sez;
  }

  function aggiungiRiga(tbody, def, r, sottoSoglia) {
    const tr = document.createElement('tr');
    tr.className = 'mg-ct-riga';
    tr.dataset.id = r.id;
    if (sottoSoglia) tr.classList.add('mg-ct-riga--sotto');
    if (def.id === 'correttore' && r.celle.modello) tr.classList.add('mg-ct-riga--sub');
    for (const col of def.colonne) tr.appendChild(cellaTd(col, r));
    tbody.appendChild(tr);
    const chiave = `${def.id}|${r.id}`;
    // L'andamento c'è solo con più di un periodo, e per una riga che si mostra: se no, la riga non finge.
    const apribile = !sotto(r.principale) && Array.isArray(r.periodi) && somme.periodi.length > 1;
    let andamento = null;
    const apriChiudi = () => {
      const ora = aperta === chiave ? '' : chiave;
      const prima = el.blocchi.querySelector('.mg-ct-andamento');
      if (prima) {
        const suaRiga = prima.previousElementSibling;
        if (suaRiga) { suaRiga.classList.remove('mg-ct-riga--aperta'); suaRiga.setAttribute('aria-expanded', 'false'); }
        prima.remove();
      }
      aperta = ora;
      if (ora) {
        andamento = rigaAndamento(def, r);
        tr.after(andamento);
        tr.classList.add('mg-ct-riga--aperta');
        tr.setAttribute('aria-expanded', 'true');
      }
    };
    if (apribile) {
      tr.classList.add('mg-ct-riga--apribile');
      tr.tabIndex = 0;
      tr.setAttribute('aria-expanded', 'false');
      tr.title = 'Clic per l’andamento nel tempo';
      tr.addEventListener('click', apriChiudi);
      tr.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); apriChiudi(); }
      });
      if (aperta === chiave) { aperta = ''; apriChiudi(); }
    }
    tr.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const menu = window.SN_MANAGE_MENU;
      if (!menu) return;
      menu.apri(ev.clientX, ev.clientY, [
        ...(apribile ? [{ testo: aperta === chiave ? 'Nascondi l’andamento' : 'Mostra l’andamento nel tempo', azione: apriChiudi }] : []),
        { testo: 'Copia la riga', azione: () => copia(testoRiga(def, r)) },
        { testo: 'Copia la tabella', azione: () => copia(testoTabella(def)) },
        { testo: 'Rileggi', azione: () => { carica({ forza: true }).catch(() => {}); } },
      ]);
    });
  }

  function rigaAndamento(def, r) {
    const tr = document.createElement('tr');
    tr.className = 'mg-ct-andamento';
    const td = document.createElement('td');
    td.colSpan = def.colonne.length;
    const box = document.createElement('div');
    box.className = 'mg-ct-grafico';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', `Andamento di ${r.etichetta}`);
    const nomi = somme.periodi.map((p) => nomePeriodo(p, somme.passo));
    const parola = def.copie ? null : (x) => `${formatInt(x)} ${x === 1 ? 'volta' : 'volte'}`;
    colonne(box, r.periodi, { nome: (i) => nomi[i], menu: (_i, ev) => menuGenerale(ev) });
    if (parola) {
      box.querySelectorAll('.mg-ct-col').forEach((c, i) => {
        const x = r.periodi[i];
        if (!sotto(x)) { c.title = `${nomi[i]}: ${parola(x.n)}`; c.setAttribute('aria-label', c.title); }
      });
    }
    const a = document.createElement('div');
    a.className = 'mg-ct-asse';
    asse(a, [nomi[0], nomi[nomi.length - 1]]);
    td.append(box, a);
    tr.appendChild(td);
    return tr;
  }

  function cellaTd(col, r) {
    const td = document.createElement('td');
    const v = col.di(r);
    if (col.tipo === 'testo') {
      td.textContent = String(v == null ? '' : v);
      return td;
    }
    if (v === undefined) return td;
    if (col.tipo === 'n') {
      if (sotto(v)) return scriviSotto(td);
      td.textContent = formatInt(v.n);
      if (v.copie != null && v.copie !== v.n) td.title = `${formatInt(v.n)} da ${copieTesto(v.copie)}`;
      else if (v.copie != null) td.title = copieTesto(v.copie);
      return td;
    }
    if (col.tipo === 'quota') {
      if (sotto(v)) return scriviSotto(td);
      td.textContent = v.quota == null ? '—' : `${Math.round(v.quota * 100)}%`;
      return td;
    }
    if (col.tipo === 'fasce') {
      const lista = Array.isArray(v) ? v : [];
      // Tutte sotto soglia: sette tacche uguali non dicono niente di più della scritta.
      if (lista.every(sotto)) return scriviSotto(td);
      const box = document.createElement('span');
      box.className = 'mg-ct-fasce';
      box.setAttribute('role', 'img');
      const max = Math.max(1, ...lista.filter((c) => !sotto(c)).map((c) => c.n));
      const detti = [];
      lista.forEach((c, i) => {
        const s = document.createElement('span');
        s.className = 'mg-ct-fascia';
        if (sotto(c)) { s.classList.add('mg-ct-fascia--sotto'); s.title = `${col.nomi[i]}: ${SOTTO}`; } else {
          s.style.height = `${Math.max(2, Math.round((c.n / max) * 22))}px`;
          s.title = `${col.nomi[i]}: ${formatInt(c.n)}`;
        }
        detti.push(s.title);
        box.appendChild(s);
      });
      box.setAttribute('aria-label', detti.join(', '));
      td.appendChild(box);
      return td;
    }
    if (col.tipo === 'chips') {
      const box = document.createElement('span');
      box.className = 'mg-ct-chips';
      for (const x of Array.isArray(v) ? v : []) {
        const s = document.createElement('span');
        s.className = 'mg-ct-chip';
        s.append(document.createTextNode(`${x.etichetta} `));
        const b = document.createElement('b');
        b.textContent = sotto(x.cella) ? SOTTO : formatInt(x.cella.n);
        s.appendChild(b);
        s.title = sotto(x.cella) ? SPIEGA_SOTTO : `${x.etichetta}: ${copieTesto(x.cella.n)}`;
        box.appendChild(s);
      }
      td.appendChild(box);
      return td;
    }
    return td;
  }

  function scriviSotto(td) {
    const s = document.createElement('span');
    s.className = 'mg-ct-sotto';
    s.textContent = SOTTO;
    td.title = SPIEGA_SOTTO;
    td.appendChild(s);
    return td;
  }

  // ── Copie in testo, menu, tasti ─────────────────────────────────────────────
  function testoCella(col, r) {
    const v = col.di(r);
    if (col.tipo === 'testo') return String(v == null ? '' : v);
    if (v === undefined) return '';
    if (col.tipo === 'n') return sotto(v) ? SOTTO : String(v.n);
    if (col.tipo === 'quota') return sotto(v) ? SOTTO : (v.quota == null ? '—' : `${Math.round(v.quota * 100)}%`);
    if (col.tipo === 'fasce') return (v || []).map((c, i) => `${col.nomi[i]}: ${sotto(c) ? SOTTO : c.n}`).join(', ');
    if (col.tipo === 'chips') return (v || []).map((x) => `${x.etichetta} ${sotto(x.cella) ? SOTTO : x.cella.n}`).join(', ');
    return '';
  }
  const testoRiga = (def, r) => def.colonne.map((col) => testoCella(col, r)).join('\t');
  function testoTabella(def) {
    const righe = (def.righe(somme) || []).filter((r) => def.fisso || !sotto(r.principale) || espansi.has(def.id));
    return [def.colonne.map((c) => c.titolo).join('\t'), ...righe.map((r) => testoRiga(def, r))].join('\n');
  }
  function copia(testo) { try { navigator.clipboard.writeText(testo); } catch (_) {} }

  function menuGenerale(ev) {
    const menu = window.SN_MANAGE_MENU;
    if (!menu || !owner) return;
    menu.apri(ev.clientX, ev.clientY, [{ testo: 'Rileggi', azione: () => { carica({ forza: true }).catch(() => {}); } }]);
  }

  function menuPeriodo(i, ev) {
    const menu = window.SN_MANAGE_MENU;
    if (!menu || !somme) return;
    const p = somme.periodi[i];
    const c = somme.copie.periodi[i];
    const nome = nomePeriodo(p, somme.passo);
    menu.apri(ev.clientX, ev.clientY, [
      ...(!sotto(c) && somme.periodi.length > 1
        ? [{ testo: periodoOre === p.chiave ? 'Torna a tutto l’intervallo' : `Mostra le ore di ${nome}`, azione: () => scegliPeriodo(p.chiave) }] : []),
      ...(!sotto(c) ? [{ testo: 'Copia il numero', azione: () => copia(String(c.n)) }] : []),
      { testo: 'Rileggi', azione: () => { carica({ forza: true }).catch(() => {}); } },
    ]);
  }

  root.addEventListener('contextmenu', (ev) => {
    if (ev.defaultPrevented || !owner) return;
    if (ev.target.closest('input, select, textarea')) return;
    ev.preventDefault();
    menuGenerale(ev);
  });

  // Esc chiude prima il menu aperto (lo chiude lui), poi l'andamento aperto.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !aperta || document.querySelector('.mg-ctxmenu')) return;
    if (!root.closest('.mg-panel--active')) return;
    e.preventDefault();
    const tr = el.blocchi.querySelector('.mg-ct-riga--aperta');
    if (tr) tr.click();
    else aperta = '';
  }, true);

  // ── Porta e caricamento pigro ───────────────────────────────────────────────
  function porta() {
    el.negato.hidden = owner;
    el.corpo.hidden = !owner;
  }

  async function aMostra() {
    try {
      const a = await send({ type: 'auth_status' });
      owner = !!(a && a.isAdmin);
    } catch (_) { owner = false; }
    porta();
    if (owner) await carica();
  }

  const mostrata = () => !!document.querySelector('.mg-tab[data-tab="contatori"].mg-tab--active');
  document.addEventListener('mg-scheda', (e) => { if (e.detail && e.detail.tab === 'contatori') aMostra().catch(() => {}); });
  if (window.filo && window.filo.onBroadcast) {
    window.filo.onBroadcast((m) => { if (m && m.type === (MSG.AUTH_CHANGED || 'auth_changed') && mostrata()) aMostra().catch(() => {}); });
  }

  window.__mgContatori = { aMostra, carica, scelta: () => ({ ...scelta }) };
  if (mostrata()) aMostra().catch(() => {});
})();

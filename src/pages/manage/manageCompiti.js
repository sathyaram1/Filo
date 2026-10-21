// Scheda Routine → Compiti di Gestione (#1196, SPEC-DOMANDE.md §6.5): aperti, in corso e storico, con modello, costo
// ed esito di ogni chiamata, letti dal server (ownerCompiti) attraverso il main; un compito senza feedback si crea e
// si annulla da qui. Regole: src/shared/compiti.js. Prove: tests/manage-compiti.spec.mjs.

(function () {
  'use strict';

  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const ELENCO = MSG.COMPITI_ELENCO || 'compiti_elenco';
  const CREA = MSG.COMPITO_CREA || 'compito_crea';
  const ANNULLA = MSG.COMPITO_ANNULLA || 'compito_annulla';
  const K = window.SN_COMPITI;
  const RM = window.SN_ROUTINE_MODELLI;
  const $ = (id) => document.getElementById(id);
  const root = $('mgCpRoot');
  if (!root || !K) return;

  const PAGINA = 100;
  // Mentre la scheda è a schermo i compiti cambiano a ogni biglietto: una rilettura al minuto, solo lì.
  const OGNI_MS = 60 * 1000;
  const el = {
    stato: $('mgCpStato'), apri: $('mgCpNuovoApri'), form: $('mgCpNuovo'), titolo: $('mgCpTitolo'),
    istruzioni: $('mgCpIstruzioni'), urgenza: $('mgCpUrgenza'), modello: $('mgCpModello'), sforzo: $('mgCpSforzo'),
    crea: $('mgCpCrea'), chiudi: $('mgCpChiudi'), msg: $('mgCpMsg'), carica: $('mgCpCarica'), negato: $('mgCpNegato'),
    parti: $('mgCpParti'), altri: $('mgCpAltri'),
  };
  const parte = (nome) => {
    const s = root.querySelector(`.mg-cp-parte[data-parte="${nome}"]`);
    return { sezione: s, lista: s.querySelector('.mg-cp-lista'), vuoto: s.querySelector('.mg-cp-vuoto'), n: s.querySelector('.mg-cp-n') };
  };
  const PARTI = { inAttesa: parte('inAttesa'), inCorso: parte('inCorso'), storico: parte('storico') };

  const stato = {
    verificato: false,
    owner: false,
    lette: false,
    errore: '',
    aperti: [],
    storico: [],
    altri: false,
    aperte: new Set(),
    conferma: '',
    inVolo: null,
    creando: false,
  };
  // Una risposta vale solo se è partita dopo l'ultima accolta: una lettura lenta non riscrive una più nuova.
  let tick = 0;
  let accolto = 0;

  // Chiamato a ogni invio: le prove sostituiscono window.filo.message dopo il caricamento.
  function send(m) {
    if (window.filo && window.filo.message) return window.filo.message(m);
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) return chrome.runtime.sendMessage(m);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  const quando = (ms) => (ms ? new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const da = (ms) => (ms ? K.durataTesto(Date.now() - ms) : '');

  function span(cls, testo, titolo) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = testo;
    if (titolo) s.title = titolo;
    return s;
  }

  function bottone(testo, titolo, azione) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sn-btn sn-btn-secondary';
    b.textContent = testo;
    if (titolo) b.title = titolo;
    b.addEventListener('click', (e) => { e.stopPropagation(); azione(b); });
    return b;
  }

  const annullabile = (c) => c.tipo === 'manuale' && c.aperto && c.stato === 'aperto';

  function riassunto(c) {
    const ultima = (c.biglietti || [])[c.biglietti.length - 1];
    if (c.stato === 'in_corso') return `in corso da ${da(ultima && ultima.inizio) || 'poco'}`;
    if (c.aperto) return c.creatoIl ? `in attesa da ${da(c.creatoIl)}` : 'in attesa';
    const esito = c.esito ? `${K.nomeStato(c)}: ${c.esito}` : K.nomeStato(c);
    return `${esito} · ${quando(c.chiusoIl)}`;
  }

  function chiamata(b) {
    const li = document.createElement('li');
    li.className = 'mg-cp-chiamata';
    const ruolo = RM && b.ruolo ? RM.nomeRuolo(b.ruolo) : (b.ruolo || 'agente');
    li.append(span('', ruolo), span('', K.modelloTesto(b.modello, b.sforzo)), span('', quando(b.inizio)));
    if (b.fine) li.append(span('', K.durataTesto(b.fine - b.inizio)));
    else if (b.vivo) li.append(span('', `al lavoro da ${da(b.inizio)}`));
    const costo = K.costoTesto(b.costo);
    if (costo) li.append(span('', costo, b.vivo ? 'Finora: il conto si chiude col rilascio' : 'Costo della chiamata'));
    if (b.guasto) li.append(span('mg-cp-guasto', b.guasto, 'Il guasto che il worker ha dichiarato'));
    else if (b.esito) li.append(span('', b.esito));
    return li;
  }

  function dettaglio(c) {
    const box = document.createElement('div');
    box.className = 'mg-cp-dettaglio';
    if (c.tipo === 'manuale' && c.istruzioni) {
      const p = document.createElement('p');
      p.className = 'mg-cp-istr';
      p.textContent = c.istruzioni;
      box.append(p);
    }
    const lista = document.createElement('ul');
    lista.className = 'mg-cp-chiamate';
    if (c.bigliettiTolti) {
      const li = document.createElement('li');
      li.className = 'mg-cp-chiamata';
      li.textContent = `${c.bigliettiTolti} chiamate più vecchie contate ma non tenute`;
      lista.append(li);
    }
    for (const b of c.biglietti || []) lista.append(chiamata(b));
    if (!lista.children.length) {
      const li = document.createElement('li');
      li.className = 'mg-cp-chiamata';
      li.textContent = c.tipo === 'manuale' && c.aperto ? 'Nessuna chiamata: aspetta il ruolo che esegue i compiti senza feedback.' : 'Nessuna chiamata.';
      lista.append(li);
    }
    box.append(lista);
    const azioni = document.createElement('div');
    azioni.className = 'mg-cp-azioni';
    if (c.tipo === 'fase' && c.feedbackId) azioni.append(bottone('Apri il feedback', c.feedbackNum, () => apriFeedback(c)));
    if (annullabile(c)) {
      const conferma = stato.conferma === c.id;
      azioni.append(bottone(conferma ? 'Sì, annullalo' : 'Annulla il compito', conferma ? 'Non si può riprendere' : '', () => annulla(c)));
    }
    if (azioni.children.length) box.append(azioni);
    return box;
  }

  function riga(c) {
    const li = document.createElement('li');
    li.className = 'mg-cp-riga';
    li.dataset.id = c.id;
    li.dataset.stato = c.stato;
    li.tabIndex = 0;
    li.title = `${c.id} · creato ${quando(c.creatoIl)}`;
    const aperta = stato.aperte.has(c.id);
    li.setAttribute('aria-expanded', aperta ? 'true' : 'false');
    if (aperta) li.classList.add('mg-cp-riga--aperta');
    const sopra = document.createElement('div');
    sopra.className = 'mg-cp-sopra';
    sopra.append(span('mg-cp-nome', K.etichetta(c)), span('mg-cp-urg', `u ${c.urgenza}`, K.urgenzaTesto(c)));
    const sotto = document.createElement('div');
    sotto.className = 'mg-cp-sotto';
    sotto.append(span('', K.modelloTesto(c.modello, c.sforzo), 'Modello e sforzo con cui parte il prossimo agente'));
    const n = (c.biglietti || []).length + (c.bigliettiTolti || 0);
    if (n) sotto.append(span('', n === 1 ? '1 chiamata' : `${n} chiamate`));
    const costo = K.costoTesto(K.costoTotale(c));
    if (costo) sotto.append(span('', costo, 'La somma delle chiamate che dichiarano un costo'));
    sotto.append(span('', riassunto(c)));
    li.append(sopra, sotto);
    if (aperta) li.append(dettaglio(c));
    return li;
  }

  // La firma di una riga: una riga uguale non si ridisegna, così un pulsante sotto il cursore non sparisce.
  const firma = (c) => JSON.stringify([c, stato.aperte.has(c.id), stato.conferma === c.id, riassunto(c)]);

  function disegnaParte(nome, lista) {
    const p = PARTI[nome];
    const prima = new Map([...p.lista.children].map((li) => [li.dataset.id, li]));
    const nuove = lista.map((c) => {
      const f = firma(c);
      const vecchia = prima.get(c.id);
      if (vecchia && vecchia.dataset.firma === f) return vecchia;
      const li = riga(c);
      li.dataset.firma = f;
      return li;
    });
    const uguale = nuove.length === p.lista.children.length && nuove.every((li, i) => p.lista.children[i] === li);
    if (!uguale) {
      const focus = document.activeElement && document.activeElement.closest && document.activeElement.closest('.mg-cp-riga');
      p.lista.replaceChildren(...nuove);
      if (focus) {
        const di = p.lista.querySelector(`.mg-cp-riga[data-id="${CSS.escape(focus.dataset.id || '')}"]`);
        if (di && di !== document.activeElement) di.focus({ preventScroll: true });
      }
    }
    p.vuoto.hidden = lista.length > 0;
    p.n.textContent = lista.length ? String(lista.length) + (nome === 'storico' && stato.altri ? '+' : '') : '';
  }

  // Quattro viste esclusive, come il Log: si controlla l'account, non è l'owner, si legge (o non si è potuto), lette.
  function disegna() {
    el.apri.disabled = !stato.owner;
    const vista = !stato.verificato ? 'carica'
      : !stato.owner ? 'negato'
        : !stato.lette ? (stato.errore ? 'errore' : 'carica')
          : 'parti';
    el.carica.hidden = vista !== 'carica';
    el.negato.hidden = vista !== 'negato';
    el.parti.hidden = vista !== 'parti';
    if (vista === 'negato') el.form.hidden = true;
    if (vista === 'errore') el.stato.textContent = `Non riesco a leggere i compiti: ${stato.errore}`;
    else if (vista === 'parti' && stato.errore) el.stato.textContent = `Non riesco ad aggiornare: ${stato.errore}`;
    else el.stato.textContent = '';
    if (vista !== 'parti') return;
    const d = K.dividi({ aperti: stato.aperti, storico: stato.storico });
    disegnaParte('inAttesa', d.inAttesa);
    disegnaParte('inCorso', d.inCorso);
    disegnaParte('storico', d.storico);
    el.altri.hidden = !stato.altri;
  }

  function fondiStorico(vecchi, nuovi) {
    const per = new Map(vecchi.map((c) => [c.id, c]));
    for (const c of nuovi) per.set(c.id, c);
    // Un compito riaperto dal server (non succede, ma in dubbio) non resta anche fra i chiusi.
    const aperti = new Set(stato.aperti.map((c) => c.id));
    return [...per.values()].filter((c) => !aperti.has(c.id)).sort((a, b) => (b.chiusoIl || 0) - (a.chiusoIl || 0));
  }

  async function leggiOwner() {
    try {
      const r = await send({ type: MSG.AUTH_STATUS || 'auth_status' });
      return !!(r && r.isAdmin);
    } catch (_) {
      return false;
    }
  }

  async function carica() {
    if (stato.inVolo) return stato.inVolo;
    const mio = ++tick;
    stato.inVolo = (async () => {
      stato.owner = await leggiOwner();
      stato.verificato = true;
      if (!stato.owner) return;
      let r;
      try {
        r = await send({ type: ELENCO, storico: PAGINA });
      } catch (e) {
        r = { ok: false, error: String((e && e.message) || e) };
      }
      if (mio < accolto) return;
      accolto = mio;
      if (!r || r.ok === false) {
        stato.errore = (r && r.error) || 'il server non ha risposto';
        return;
      }
      stato.errore = '';
      stato.aperti = Array.isArray(r.aperti) ? r.aperti : [];
      const primaPagina = Array.isArray(r.storico) ? r.storico : [];
      // Le pagine più vecchie già chieste restano: la prima pagina si aggiorna, il resto non sparisce.
      const giaOltre = stato.storico.length > primaPagina.length;
      stato.storico = fondiStorico(giaOltre ? stato.storico : [], primaPagina);
      if (!giaOltre) stato.altri = r.altri === true;
      stato.lette = true;
    })().finally(() => { stato.inVolo = null; disegna(); });
    disegna();
    return stato.inVolo;
  }

  async function piuVecchi() {
    const ultimo = stato.storico[stato.storico.length - 1];
    if (!ultimo || !ultimo.chiusoIl) return;
    el.altri.disabled = true;
    try {
      const r = await send({ type: ELENCO, storico: PAGINA, prima: ultimo.chiusoIl });
      if (!r || r.ok === false) {
        stato.errore = (r && r.error) || 'il server non ha risposto';
      } else {
        stato.errore = '';
        stato.storico = fondiStorico(stato.storico, Array.isArray(r.storico) ? r.storico : []);
        stato.altri = r.altri === true;
      }
    } catch (e) {
      stato.errore = String((e && e.message) || e);
    } finally {
      el.altri.disabled = false;
      disegna();
    }
  }

  function apriFeedback(c) {
    const apri = window.SN_MANAGE_FEEDBACK && window.SN_MANAGE_FEEDBACK.apri;
    if (apri) apri(c.feedbackId);
  }

  async function annulla(c) {
    if (stato.conferma !== c.id) {
      stato.conferma = c.id;
      stato.aperte.add(c.id);
      disegna();
      return;
    }
    stato.conferma = '';
    let r;
    try {
      r = await send({ type: ANNULLA, id: c.id });
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) };
    }
    if (!r || r.ok === false) {
      stato.errore = (r && r.error) || 'il server non ha risposto';
      disegna();
      return;
    }
    await carica();
  }

  function apriForm(si) {
    el.form.hidden = !si;
    if (si) {
      el.msg.textContent = '';
      el.titolo.focus();
    }
  }

  async function creaCompito() {
    if (stato.creando) return;
    const v = K.validaNuovo({
      titolo: el.titolo.value, istruzioni: el.istruzioni.value, urgenza: el.urgenza.value,
      modello: el.modello.value, sforzo: el.sforzo.value,
    });
    if (!v.ok) { el.msg.textContent = v.testo; return; }
    stato.creando = true;
    el.crea.disabled = true;
    el.msg.textContent = 'Lo creo…';
    let r;
    try {
      r = await send({ type: CREA, compito: v.compito });
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) };
    } finally {
      stato.creando = false;
      el.crea.disabled = false;
    }
    if (!r || r.ok === false) { el.msg.textContent = (r && r.error) || 'Il server non ha risposto.'; return; }
    el.titolo.value = '';
    el.istruzioni.value = '';
    el.msg.textContent = '';
    apriForm(false);
    if (r.id) stato.aperte.add(r.id);
    await carica();
    const nuova = root.querySelector(`.mg-cp-riga[data-id="${CSS.escape(String(r.id || ''))}"]`);
    if (nuova) nuova.focus();
  }

  function trovaCompito(id) {
    return stato.aperti.find((c) => c.id === id) || stato.storico.find((c) => c.id === id) || null;
  }

  function apriChiudi(id) {
    if (stato.aperte.has(id)) stato.aperte.delete(id); else stato.aperte.add(id);
    if (stato.conferma === id && !stato.aperte.has(id)) stato.conferma = '';
    disegna();
  }

  // Le scelte del modello sono le stesse di Automazioni: vuoto = la definizione dell'agente.
  function riempiScelte() {
    el.modello.append(new Option('dell’agente', ''));
    for (const m of K.MODELLI) el.modello.append(new Option(RM ? ((RM.SCELTE.model.find((s) => s.id === m) || {}).nome || m) : m, m));
    el.sforzo.append(new Option('dell’agente', ''));
    for (const s of K.SFORZI) el.sforzo.append(new Option(s, s));
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, textarea, select, .mg-cp-dettaglio')) return;
    const li = e.target.closest('.mg-cp-riga');
    if (li) apriChiudi(li.dataset.id);
  });
  root.addEventListener('keydown', (e) => {
    const li = e.target.closest && e.target.closest('.mg-cp-riga');
    if (!li || e.target !== li || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    apriChiudi(li.dataset.id);
  });
  root.addEventListener('contextmenu', (e) => {
    const menu = window.SN_MANAGE_MENU;
    if (!menu || !stato.owner || e.target.closest('input, textarea')) return;
    e.preventDefault();
    const li = e.target.closest('.mg-cp-riga');
    const c = li ? trovaCompito(li.dataset.id) : null;
    const voci = [];
    if (c) {
      if (c.tipo === 'fase' && c.feedbackId) voci.push({ testo: 'Apri il feedback', titolo: c.feedbackNum, azione: () => apriFeedback(c) });
      voci.push({ testo: stato.aperte.has(c.id) ? 'Chiudi le chiamate' : 'Mostra le chiamate', azione: () => apriChiudi(c.id) });
      if (annullabile(c)) voci.push({ testo: 'Annulla il compito', titolo: 'Chiede conferma', azione: () => { stato.conferma = ''; annulla(c); } });
      voci.push({ testo: 'Copia il nome', titolo: K.etichetta(c), azione: () => { navigator.clipboard && navigator.clipboard.writeText(K.etichetta(c)).catch(() => {}); } });
    }
    voci.push({ testo: 'Nuovo compito', azione: () => apriForm(true) });
    voci.push({ testo: 'Rileggi dal server', azione: () => { carica(); } });
    menu.apri(e.clientX, e.clientY, voci);
  });
  el.apri.addEventListener('click', () => apriForm(el.form.hidden));
  el.chiudi.addEventListener('click', () => apriForm(false));
  el.form.addEventListener('submit', (e) => { e.preventDefault(); creaCompito(); });
  el.form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); apriForm(false); el.apri.focus(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); creaCompito(); }
  });
  el.altri.addEventListener('click', piuVecchi);

  const attiva = () => !!document.querySelector('.mg-tab[data-tab="compiti"].mg-tab--active');
  document.addEventListener('mg-scheda', (e) => { if (e.detail && e.detail.tab === 'compiti') carica(); });
  if (window.filo && window.filo.onBroadcast) {
    window.filo.onBroadcast((m) => { if (m && m.type === (MSG.AUTH_CHANGED || 'auth_changed')) carica(); });
  }
  setInterval(() => { if (attiva() && !document.hidden && stato.owner) carica(); }, OGNI_MS);

  riempiScelte();
  window.__mgCompiti = { carica, stato: () => stato };
  disegna();
  // Aperta direttamente sui Compiti (scheda ricordata), la scheda può essersi mostrata prima di questo file.
  if (attiva()) carica();
})();

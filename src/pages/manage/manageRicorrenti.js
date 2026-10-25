// Scheda Routine → Compiti ricorrenti di Gestione (#1153, SPEC-DOMANDE.md §4.1): ricorrenti dell'owner, ultima istanza,
// rapporto e ambiti, letti e scritti sul server (ownerCompiti) dal main. Ogni testo del server si mostra come testo.
// Regole: src/shared/ricorrenti.js e compiti.js. Prove: tests/manage-ricorrenti.spec.mjs.

(function () {
  'use strict';

  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const ELENCO = MSG.RICORRENTI_ELENCO || 'ricorrenti_elenco';
  const SALVA = MSG.RICORRENTE_SALVA || 'ricorrente_salva';
  const TOGLI = MSG.RICORRENTE_TOGLI || 'ricorrente_togli';
  const AVVIA = MSG.RICORRENTE_AVVIA || 'ricorrente_avvia';
  const K = window.SN_COMPITI;
  const R = window.SN_RICORRENTI;
  const A = window.SN_AMBITI;
  const RM = window.SN_ROUTINE_MODELLI;
  const RV = window.SN_RIGHE_VIVE;
  const $ = (id) => document.getElementById(id);
  const root = $('mgRcRoot');
  if (!root || !K || !R) return;

  const OGNI_MS = 60 * 1000;
  const NUOVO = '';
  // Le bozze sopravvivono alla chiusura di Gestione: un testo di istruzioni può essere lungo un ruolo intero.
  const BOZZE_KEY = 'filo.gestione.ricorrenti.bozze';
  // La settimana dell'owner parte dal lunedì (ricorrenti.js): la domenica va in fondo.
  const SETTIMANA = [1, 2, 3, 4, 5, 6, 0];
  const CAMPI = ['nome', 'testo', 'giorni', 'ora', 'ambito', 'urgenza', 'modello', 'sforzo', 'attivo', 'domandaFineTurno'];
  // Come i ricorrenti iniziali (§4.1): Opus a sforzo high, perché nessun ricorrente costruisce codice da zero.
  const PREDEFINITO = Object.freeze({
    nome: '', testo: '', giorni: [0, 1, 2, 3, 4, 5, 6], ora: '06:00', ambito: 'lavoro', urgenza: K.URGENZA.nuovo,
    modello: 'opus', sforzo: 'high', attivo: true, domandaFineTurno: '',
  });
  // Un campo che il server non ha mandato resta vuoto: un default lì cambierebbe il ricorrente senza che l'owner lo veda.
  const VUOTO = Object.freeze({
    nome: '', testo: '', giorni: [], ora: '', ambito: '', urgenza: '', modello: '', sforzo: '', attivo: true, domandaFineTurno: '',
  });

  const el = {
    stato: $('mgRcStato'), apri: $('mgRcNuovoApri'), nuovo: $('mgRcNuovo'), carica: $('mgRcCarica'), negato: $('mgRcNegato'),
    corpo: $('mgRcCorpo'), vuoto: $('mgRcVuoto'), lista: $('mgRcLista'), ambiti: $('mgRcAmbiti'),
  };

  const stato = {
    verificato: false,
    owner: false,
    lette: false,
    letteIl: 0,
    errore: '',
    avviso: '',
    ricorrenti: [],
    ambiti: [],
    modifica: new Set(),
    // Per ricorrente (NUOVO per quello da creare) solo i campi toccati: il resto segue il server (patterns/una-pagina-di-impostazioni-manda-solo-quello-che-tocchi.md).
    bozze: new Map(),
    msgModulo: new Map(),
    conferma: '',
    misure: new Map(),
    occupato: new Map(),
    esito: new Map(),
    rapporti: new Set(),
  };
  let inVolo = null;
  let dopo = null;
  let ambitiDisegnati = '';

  function send(m) {
    if (window.filo && window.filo.message) return window.filo.message(m);
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) return chrome.runtime.sendMessage(m);
    return Promise.reject(new Error('canale main non disponibile'));
  }
  const erroreDi = (e) => String((e && e.message) || e);
  const quando = (ms) => (ms ? new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const ora = (ms) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const trova = (id) => stato.ricorrenti.find((r) => r.id === id) || null;
  const ambitoDi = (nome) => stato.ambiti.find((a) => a && a.nome === nome) || null;

  function nodo(tag, cls, testo, titolo) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (testo !== undefined && testo !== null) n.textContent = testo;
    if (titolo) n.title = titolo;
    return n;
  }

  function bottone(chiave, testo, titolo, azione, { disabilitato = false, primario = false } = {}) {
    const b = nodo('button', primario ? 'sn-btn' : 'sn-btn sn-btn-secondary', testo, titolo);
    b.type = 'button';
    b.dataset.azione = chiave;
    b.disabled = disabilitato;
    b.addEventListener('click', (e) => { e.stopPropagation(); azione(e, b); });
    return b;
  }

  // ── Bozze ────────────────────────────────────────────────────────────────

  function base(id) {
    const r = id === NUOVO ? PREDEFINITO : trova(id);
    const out = {};
    for (const k of CAMPI) out[k] = r && r[k] !== undefined && r[k] !== null ? r[k] : VUOTO[k];
    return out;
  }
  function valori(id) {
    return Object.assign(base(id), stato.bozze.get(id) || {});
  }
  const uguali = (a, b) => (Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())
    : String(a) === String(b));

  function tocca(id, campo, valore) {
    const b = Object.assign({}, stato.bozze.get(id) || {});
    if (uguali(valore, base(id)[campo])) delete b[campo]; else b[campo] = valore;
    if (Object.keys(b).length) stato.bozze.set(id, b); else stato.bozze.delete(id);
    salvaBozze();
  }

  let bozzeTimer = 0;
  function salvaBozze() {
    clearTimeout(bozzeTimer);
    bozzeTimer = setTimeout(() => {
      try {
        if (!stato.bozze.size) localStorage.removeItem(BOZZE_KEY);
        else localStorage.setItem(BOZZE_KEY, JSON.stringify({ bozze: [...stato.bozze], aperte: [...stato.modifica].filter((id) => stato.bozze.has(id)) }));
      } catch (_) {}
    }, 300);
  }
  function leggiBozze() {
    try {
      const v = JSON.parse(localStorage.getItem(BOZZE_KEY) || 'null');
      if (!v || !Array.isArray(v.bozze)) return;
      for (const [id, b] of v.bozze) {
        if (typeof id !== 'string' || !b || typeof b !== 'object') continue;
        const pulita = {};
        for (const k of CAMPI) if (b[k] !== undefined) pulita[k] = b[k];
        if (Object.keys(pulita).length) stato.bozze.set(id, pulita);
      }
      for (const id of Array.isArray(v.aperte) ? v.aperte : []) if (stato.bozze.has(id)) stato.modifica.add(id);
    } catch (_) {}
  }

  // ── Disegno ──────────────────────────────────────────────────────────────

  function ambitoTitolo(a) {
    if (!a) return '';
    const puo = Array.isArray(a.puo) ? a.puo.map((p) => p.descr).join('; ') : '';
    return [a.riservato ? 'Gira nell’ambiente dei riservati.' : '', puo ? `Può: ${puo}.` : '', a.nonPuo ? `Non può: ${a.nonPuo}.` : ''].filter(Boolean).join('\n');
  }

  function istanzaTesto(i) {
    if (!i || !i.id) return '';
    const esito = i.esito ? `: ${i.esito}` : '';
    const attesa = K.attesaTesto(Object.assign({ aperto: i.stato === 'aperto' }, i));
    return `ultima istanza ${i.id}, ${K.nomeStato(i)}${esito}${attesa ? `, ${attesa}` : ''}`;
  }

  function leva(r) {
    const occ = stato.occupato.get(r.id);
    const acceso = occ && occ.azione === 'attivo' ? occ.valore : r.attivo !== false;
    const l = nodo('label', 'mg-switch mg-rc-leva', null, acceso ? 'Acceso: parte alla sua ora' : 'Spento: non parte finché non lo riaccendi');
    if (occ && occ.azione === 'attivo') l.classList.add('mg-rt-salva');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = acceso;
    input.disabled = !!occ;
    input.dataset.azione = 'attivo';
    input.setAttribute('aria-label', `${r.nome || r.id}: acceso`);
    input.addEventListener('change', () => cambiaAttivo(r.id, input.checked));
    const track = nodo('span', 'mg-switch-track');
    track.append(nodo('span', 'mg-switch-thumb'));
    l.append(nodo('span', 'mg-switch-state', acceso ? 'acceso' : 'spento'), input, track);
    return l;
  }

  function rapporto(r) {
    const p = r.rapporto;
    if (!p || typeof p.testo !== 'string' || !p.testo.trim()) return null;
    const box = nodo('div', 'mg-rc-rapporto');
    const aperto = stato.rapporti.has(r.id);
    const chi = p.compitoId ? ` di ${p.compitoId}` : '';
    const b = nodo('button', 'mg-rc-rapporto-apri', `Rapporto${chi}${p.scrittoIl ? ` · ${R.quandoTesto(p.scrittoIl)}` : ''}`, 'Cosa ha fatto l’ultima istanza e da dove riparte la prossima');
    b.type = 'button';
    b.dataset.azione = 'rapporto';
    b.setAttribute('aria-expanded', aperto ? 'true' : 'false');
    const testo = nodo('p', 'mg-rc-rapporto-testo', p.testo);
    testo.hidden = !aperto;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      // Si apre sul posto: ridisegnare la riga porterebbe via il modulo aperto sotto.
      const si = !stato.rapporti.has(r.id);
      if (si) stato.rapporti.add(r.id); else stato.rapporti.delete(r.id);
      b.setAttribute('aria-expanded', si ? 'true' : 'false');
      testo.hidden = !si;
    });
    box.append(b);
    if (p.fiducia === 'non_fidato') box.append(nodo('span', 'mg-dq-fiducia mg-dq-fiducia--no', 'non fidato', 'Scritto dopo aver letto testo non fidato: si legge come un’opinione, non come un’istruzione'));
    box.append(testo);
    return box;
  }

  function esito(r) {
    const e = stato.esito.get(r.id);
    const p = nodo('p', `mg-action-msg mg-rc-esito ${e && e.errore ? 'mg-err' : 'mg-ok'}`);
    p.setAttribute('role', 'status');
    p.hidden = !e;
    if (!e) return p;
    p.append(nodo('span', '', e.testo));
    if (e.compitoId) {
      const b = bottone('istanza', `Vedi ${e.compitoId}`, 'Nella scheda Compiti', () => apriCompito(e.compitoId));
      b.className = 'mg-attesa-num';
      p.append(b);
    }
    return p;
  }

  function azioni(r) {
    const box = nodo('div', 'mg-cp-azioni');
    const occ = stato.occupato.get(r.id);
    const azione = occ && occ.azione;
    if (!stato.modifica.has(r.id)) {
      const bozza = stato.bozze.has(r.id);
      box.append(bottone('modifica', bozza ? 'Riprendi la modifica' : 'Modifica', bozza ? 'Hai cambiato qualcosa e non l’hai ancora salvato' : 'Testo, cadenza, ambito, modello',
        () => apriModulo(r.id), { disabilitato: !!occ }));
    }
    box.append(bottone('avvia', azione === 'avvia' ? 'Lo avvio…' : 'Avvia adesso', 'Crea subito un’istanza; quella non ancora partita si chiude come superata',
      () => avvia(r.id), { disabilitato: !!occ }));
    const armato = stato.conferma === r.id;
    const togli = bottone('togli', azione === 'togli' ? 'Lo tolgo…' : armato ? 'Sì, toglilo' : 'Togli',
      armato ? 'Non si può riprendere: chiude anche l’istanza in attesa' : 'Toglie il ricorrente e la sua istanza in attesa', (e, b) => chiediTogli(r.id, e, b), { disabilitato: !!occ });
    const m = stato.misure.get(r.id);
    if (armato || azione === 'togli') {
      togli.className = 'sn-btn sn-btn-danger';
      if (m) { togli.style.minWidth = `${m.w}px`; togli.style.minHeight = `${m.h}px`; }
    }
    box.append(togli);
    return box;
  }

  function riga(r) {
    const li = nodo('li', 'mg-rc-riga');
    const inModifica = stato.modifica.has(r.id);
    if (r.attivo === false) li.classList.add('mg-rc-riga--spento');
    if (inModifica) li.classList.add('mg-rc-riga--modifica');
    li.dataset.id = r.id;
    const occ = stato.occupato.get(r.id);
    const e = stato.esito.get(r.id);
    // Quando cambia una di queste il contenitore vivo si rifà (dalla bozza, se c'è); altrimenti resta, modulo compreso.
    li.dataset.state = [r.attivo === false ? 0 : 1, r.modificatoIl || 0, (r.rapporto && r.rapporto.scrittoIl) || 0,
      occ ? `${occ.azione}${occ.valore}` : '', e ? e.testo : '', stato.msgModulo.has(r.id) ? stato.msgModulo.get(r.id).testo : ''].join('|');

    const testa = nodo('div', 'mg-rc-testa');
    const date = [r.creatoIl ? `creato ${quando(r.creatoIl)}` : '', r.modificatoIl ? `cambiato ${quando(r.modificatoIl)}` : ''].filter(Boolean).join(', ');
    testa.append(nodo('span', 'mg-cp-nome', r.nome || r.id, date));
    const a = ambitoDi(r.ambito);
    const sotto = nodo('div', 'mg-cp-sotto mg-rc-sotto');
    sotto.append(
      nodo('span', '', R.cadenzaTesto({ giorni: r.giorni, ora: r.ora }) || 'cadenza non valida', 'In ora italiana'),
      nodo('span', '', `ambito ${r.ambito || '?'}`, ambitoTitolo(a)),
      nodo('span', '', `urgenza ${r.urgenza}`, 'Più alta passa prima'),
      nodo('span', '', K.modelloTesto(r.modello, r.sforzo), 'Modello e sforzo di ogni istanza'),
    );
    const sotto2 = nodo('div', 'mg-cp-sotto mg-rc-quando');
    if (r.attivo === false) sotto2.append(nodo('span', '', 'spento: non parte'));
    else if (r.prossimaIl) sotto2.append(nodo('span', '', `prossima ${R.quandoTesto(r.prossimaIl)}`, 'In ora italiana'));
    if (typeof r.attesa === 'string' && r.attesa.trim()) sotto2.append(nodo('span', 'mg-rc-attesa', r.attesa.trim(), 'Perché il server non la fa partire'));
    const ist = istanzaTesto(r.istanza);
    if (ist) {
      const i = r.istanza;
      sotto2.append(nodo('span', '', ist, [i.creatoIl ? `creata ${quando(i.creatoIl)}` : '', i.chiusoIl ? `chiusa ${quando(i.chiusoIl)}` : ''].filter(Boolean).join(', ')));
    }

    const vivo = nodo('div', 'mg-rc-vivo');
    vivo.append(leva(r));
    const rap = rapporto(r);
    if (rap) vivo.append(rap);
    vivo.append(azioni(r), esito(r));
    if (inModifica) vivo.append(modulo(r.id));
    li.append(testa, sotto);
    if (sotto2.children.length) li.append(sotto2);
    li.append(vivo);
    return li;
  }

  // ── Il modulo ────────────────────────────────────────────────────────────

  function scelta(etichetta, controllo, titolo) {
    const l = nodo('label', 'mg-cp-scelta', null, titolo);
    l.append(document.createTextNode(etichetta), controllo);
    return l;
  }

  function opzioniAmbito(sel, attuale) {
    const nomi = K.ambitiAttivi({ ambiti: stato.ambiti });
    // Un ricorrente può aspettare un ambito non ancora attivo: resta fra le scelte, se no si cambierebbe da solo.
    if (attuale && !nomi.includes(attuale)) nomi.push(attuale);
    for (const n of nomi) {
      const a = ambitoDi(n);
      const note = [a && a.riservato ? 'ambiente dei riservati' : '', a && !a.attivo ? 'non ancora attivo' : ''].filter(Boolean).join(', ');
      const o = new Option(note ? `${n} (${note})` : n, n);
      o.title = ambitoTitolo(a);
      sel.append(o);
    }
    sel.value = attuale;
  }

  function anteprima(id, box) {
    const v = valori(id);
    const c = R.validaCadenza({ giorni: v.giorni, ora: v.ora });
    box.classList.toggle('mg-rc-anteprima--no', !c.ok);
    if (!c.ok) { box.textContent = K.frase(c.dettaglio); return; }
    const prossima = R.prossimaIl(c.cadenza, Date.now());
    box.textContent = `${R.cadenzaTesto(c.cadenza)}${prossima ? ` · la prossima ${R.quandoTesto(prossima)}` : ''}`;
  }

  function modulo(id) {
    const v = valori(id);
    const form = nodo('form', 'mg-rc-form');
    form.noValidate = true;
    form.autocomplete = 'off';
    form.dataset.id = id;
    const campo = (tag, nome, attr) => {
      const c = document.createElement(tag);
      c.className = 'mg-cp-campo';
      c.dataset.campo = nome;
      Object.assign(c, attr || {});
      return c;
    };
    const nome = campo('input', 'nome', { type: 'text', placeholder: 'Nome', value: String(v.nome || '') });
    nome.setAttribute('aria-label', 'Nome del compito ricorrente');
    const testo = campo('textarea', 'testo', { rows: 8, placeholder: 'Istruzioni per l’agente', value: String(v.testo || '') });
    testo.classList.add('mg-cp-istruzioni', 'mg-rc-testo');
    testo.setAttribute('aria-label', 'Istruzioni');

    const cadenza = nodo('div', 'mg-rc-cadenza');
    const giorni = nodo('div', 'mg-rc-giorni');
    giorni.setAttribute('role', 'group');
    giorni.setAttribute('aria-label', 'Giorni');
    const prev = nodo('span', 'mg-rc-anteprima');
    prev.setAttribute('aria-live', 'polite');
    for (const g of SETTIMANA) {
      const on = (v.giorni || []).includes(g);
      const b = nodo('button', on ? 'mg-chip mg-chip--on' : 'mg-chip', R.GIORNI[g].slice(0, 3), R.GIORNI[g]);
      b.type = 'button';
      b.dataset.campo = 'giorni';
      b.dataset.giorno = String(g);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', () => {
        const ora = valori(id).giorni || [];
        const si = !ora.includes(g);
        tocca(id, 'giorni', si ? ora.concat([g]) : ora.filter((x) => x !== g));
        b.classList.toggle('mg-chip--on', si);
        b.setAttribute('aria-pressed', si ? 'true' : 'false');
        anteprima(id, prev);
      });
      giorni.append(b);
    }
    const oraIn = campo('input', 'ora', { type: 'time', value: String(v.ora || '') });
    cadenza.append(scelta('Giorni', giorni), scelta('Ora', oraIn, 'Ora italiana'), prev);

    const scelte = nodo('div', 'mg-cp-scelte');
    const ambito = campo('select', 'ambito');
    opzioniAmbito(ambito, String(v.ambito || ''));
    const urgenza = campo('input', 'urgenza', { type: 'number', min: String(K.URGENZA.min), max: String(K.URGENZA.max), step: '1', value: String(v.urgenza) });
    urgenza.className = 'mg-auto-number';
    const modello = campo('select', 'modello');
    modello.append(new Option('dell’agente', ''));
    for (const m of K.MODELLI) modello.append(new Option(RM ? ((RM.SCELTE.model.find((s) => s.id === m) || {}).nome || m) : m, m));
    modello.value = String(v.modello || '');
    const sforzo = campo('select', 'sforzo');
    sforzo.append(new Option('dell’agente', ''));
    for (const s of K.SFORZI) sforzo.append(new Option(s, s));
    sforzo.value = String(v.sforzo || '');
    scelte.append(
      scelta('Ambito', ambito, 'Cosa può fare l’agente: l’elenco degli ambiti è in fondo alla scheda'),
      scelta('Urgenza', urgenza, 'Più alta passa prima. I feedback a priorità 3 stanno da 50 in su, «Gestisci la risposta» a 47.'),
      scelta('Modello', modello), scelta('Sforzo', sforzo),
    );
    // Uno che c'è già si accende e si spegne dalla sua levetta, subito: una seconda nel modulo varrebbe solo al salvataggio.
    if (id === NUOVO) {
      const attivo = nodo('label', 'mg-switch mg-rc-form-attivo', null, 'Spento, il server non ne crea istanze');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.dataset.campo = 'attivo';
      check.checked = v.attivo !== false;
      const track = nodo('span', 'mg-switch-track');
      track.append(nodo('span', 'mg-switch-thumb'));
      attivo.append(nodo('span', 'mg-switch-state', 'acceso'), check, track);
      scelte.append(attivo);
    }
    const domanda = campo('textarea', 'domandaFineTurno', { rows: 2, placeholder: 'Domanda di fine turno (facoltativa)', value: String(v.domandaFineTurno || '') });
    domanda.setAttribute('aria-label', 'Domanda di fine turno');

    const bottoni = nodo('div', 'mg-cp-azioni');
    const occ = stato.occupato.get(id);
    const salva = nodo('button', 'sn-btn', occ && occ.azione === 'salva' ? 'Salvo…' : id === NUOVO ? 'Crea' : 'Salva');
    salva.type = 'submit';
    salva.dataset.azione = 'salva';
    salva.disabled = !!occ;
    bottoni.append(salva, bottone('chiudi', 'Annulla', 'Butta via le modifiche', () => chiudiModulo(id, true), { disabilitato: !!occ }));
    const m = stato.msgModulo.get(id);
    const msg = nodo('p', `mg-action-msg mg-rc-form-msg${m && m.errore ? ' mg-err' : ''}`, m ? m.testo : '');
    msg.setAttribute('role', 'status');

    form.append(nome, testo, cadenza, scelte, domanda, bottoni, msg);
    anteprima(id, prev);
    form.addEventListener('input', (e) => {
      const c = e.target;
      const k = c && c.dataset && c.dataset.campo;
      if (!k || k === 'giorni') return;
      tocca(id, k, k === 'attivo' ? c.checked : c.value);
      if (k === 'ora') anteprima(id, prev);
    });
    form.addEventListener('change', (e) => {
      const c = e.target;
      if (c && c.dataset && c.dataset.campo === 'attivo') tocca(id, 'attivo', c.checked);
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); salvaRicorrente(id); });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); salvaRicorrente(id); }
      // Esc chiude senza buttare: la bozza resta, «Riprendi la modifica» la riapre. Butta via solo «Annulla».
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); chiudiModulo(id, false); }
    });
    return form;
  }

  function disegnaNuovo() {
    const aperto = stato.owner && stato.modifica.has(NUOVO);
    el.nuovo.hidden = !aperto;
    if (!aperto) { el.nuovo.replaceChildren(); return; }
    // Il modulo nuovo non ha una riga da riconciliare: si rifà solo se cambia qualcosa che i suoi tasti mostrano.
    const occ = stato.occupato.get(NUOVO);
    const m = stato.msgModulo.get(NUOVO);
    const chiave = `${occ ? occ.azione : ''}|${m ? m.testo : ''}|${stato.ambiti.map((a) => a.nome).join(',')}`;
    if (el.nuovo.dataset.chiave === chiave && el.nuovo.firstChild) return;
    el.nuovo.dataset.chiave = chiave;
    el.nuovo.replaceChildren(modulo(NUOVO));
  }

  function disegnaAmbiti() {
    const usati = new Map();
    for (const r of stato.ricorrenti) usati.set(r.ambito, (usati.get(r.ambito) || []).concat([r.nome || r.id]));
    const firma = JSON.stringify([stato.ambiti, [...usati]]);
    if (firma === ambitiDisegnati) return;
    ambitiDisegnati = firma;
    el.ambiti.replaceChildren(...stato.ambiti.map((a) => {
      const li = nodo('li', 'mg-rc-ambito');
      li.dataset.nome = a.nome;
      li.dataset.attivo = a.attivo ? 'true' : 'false';
      const testa = nodo('div', 'mg-rc-ambito-testa');
      testa.append(nodo('span', 'mg-rc-ambito-nome', a.nome));
      if (!a.attivo) testa.append(nodo('span', 'mg-rc-tag', 'non ancora attivo', 'Il server non lo dà ancora a nessun compito'));
      if (a.riservato) testa.append(nodo('span', 'mg-rc-tag mg-rc-tag--riservato', 'ambiente dei riservati', 'Legge testo riservato: i suoi compiti girano solo nell’ambiente dei riservati'));
      if (a.soloPuliti) testa.append(nodo('span', 'mg-rc-tag', 'solo biglietti puliti', 'Vale solo per un biglietto che non ha letto testo non fidato'));
      if (a.approvato) testa.append(nodo('span', 'mg-rc-tag', 'approvato da te', 'Nato da una domanda a cui hai detto sì'));
      const puo = nodo('ul', 'mg-rc-puo');
      puo.setAttribute('aria-label', 'Può');
      for (const p of Array.isArray(a.puo) ? a.puo : []) {
        const o = nodo('li', p.attiva === false ? 'mg-rc-op--spenta' : '', p.descr, p.op);
        if (p.attiva === false) o.append(nodo('span', 'mg-rc-op-non', 'non ancora', 'Il server non la fa ancora'));
        puo.append(o);
      }
      const etichetta = nodo('p', 'mg-rc-nonpuo');
      etichetta.append(nodo('b', '', 'Può:'));
      const non = nodo('p', 'mg-rc-nonpuo');
      non.append(nodo('b', '', 'Non può: '), document.createTextNode(a.nonPuo || '—'));
      li.append(testa, etichetta, puo, non);
      const chi = usati.get(a.nome);
      if (chi) {
        const u = nodo('p', 'mg-rc-usato');
        u.append(nodo('b', '', 'Lo usa: '), document.createTextNode(chi.join(', ')));
        li.append(u);
      }
      return li;
    }));
  }

  /** Dov'è il fuoco dentro la scheda, con la selezione: un campo rifatto dalla bozza lo ritrova. */
  function fuoco() {
    const a = document.activeElement;
    if (!a || !root.contains(a)) return null;
    const li = a.closest('.mg-rc-riga, .mg-rc-nuovo');
    if (!li) return null;
    const sel = typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    return { id: li.dataset.id || NUOVO, campo: a.dataset.campo || '', giorno: a.dataset.giorno || '', azione: a.dataset.azione || '', sel, nodo: a };
  }
  function rimettiFuoco(f) {
    if (!f || document.contains(f.nodo)) return;
    const box = f.id === NUOVO ? el.nuovo : el.lista.querySelector(`.mg-rc-riga[data-id="${CSS.escape(f.id)}"]`);
    if (!box) return;
    let n = null;
    if (f.campo) n = box.querySelector(`[data-campo="${CSS.escape(f.campo)}"]${f.giorno ? `[data-giorno="${CSS.escape(f.giorno)}"]` : ''}`);
    else if (f.azione) n = box.querySelector(`[data-azione="${CSS.escape(f.azione)}"]`);
    if (!n) return;
    n.focus({ preventScroll: true });
    if (f.sel && typeof n.setSelectionRange === 'function') { try { n.setSelectionRange(f.sel[0], f.sel[1]); } catch (_) {} }
  }

  function testoStato(vista) {
    if (vista === 'errore') return `Non riesco a leggere i compiti ricorrenti: ${stato.errore}`;
    if (vista !== 'elenco') return '';
    if (stato.errore) return `Non riesco ad aggiornare: ${stato.errore}`;
    if (stato.avviso) return stato.avviso;
    return stato.letteIl ? `Aggiornati alle ${ora(stato.letteIl)}` : '';
  }

  function disegna() {
    el.apri.disabled = !stato.owner || !stato.lette;
    const vista = !stato.verificato ? 'carica'
      : !stato.owner ? 'negato'
        : !stato.lette ? (stato.errore ? 'errore' : 'carica')
          : 'elenco';
    el.carica.hidden = vista !== 'carica';
    el.negato.hidden = vista !== 'negato';
    el.corpo.hidden = vista !== 'elenco';
    el.stato.textContent = testoStato(vista);
    const f = fuoco();
    disegnaNuovo();
    if (vista === 'elenco') {
      const nuove = stato.ricorrenti.map(riga);
      if (RV) RV.riconcilia(el.lista, nuove, '.mg-rc-vivo');
      else el.lista.replaceChildren(...nuove);
      el.vuoto.hidden = stato.ricorrenti.length > 0;
      disegnaAmbiti();
    }
    rimettiFuoco(f);
  }

  // ── Letture ──────────────────────────────────────────────────────────────

  async function leggiOwner() {
    try {
      const r = await send({ type: MSG.AUTH_STATUS || 'auth_status' });
      return !!(r && r.isAdmin);
    } catch (_) {
      return false;
    }
  }

  async function leggi() {
    stato.owner = await leggiOwner();
    stato.verificato = true;
    if (!stato.owner) return;
    let r;
    try {
      r = await send({ type: ELENCO });
    } catch (e) {
      r = { ok: false, error: erroreDi(e) };
    }
    if (!r || r.ok === false) {
      stato.errore = K.frase((r && r.error) || 'il server non ha risposto');
      return;
    }
    stato.errore = '';
    stato.ricorrenti = (Array.isArray(r.ricorrenti) ? r.ricorrenti : []).filter((x) => x && typeof x.id === 'string' && x.id);
    stato.ambiti = Array.isArray(r.ambiti) && r.ambiti.length ? r.ambiti.filter((a) => a && typeof a.nome === 'string') : (A ? A.elenco() : []);
    // Una bozza di un ricorrente che non c'è più non ha dove stare.
    for (const id of [...stato.bozze.keys()]) {
      if (id !== NUOVO && !trova(id)) { stato.bozze.delete(id); stato.modifica.delete(id); }
    }
    for (const id of [...stato.modifica]) if (id !== NUOVO && !trova(id)) stato.modifica.delete(id);
    salvaBozze();
    stato.lette = true;
    stato.letteIl = Date.now();
  }

  function carica() {
    if (inVolo) {
      if (!dopo) dopo = inVolo.then(() => carica());
      return dopo;
    }
    inVolo = leggi().catch(() => {}).finally(() => {
      inVolo = null;
      dopo = null;
      disegna();
    });
    disegna();
    return inVolo;
  }

  // ── Azioni ───────────────────────────────────────────────────────────────

  function avvisa(testo) {
    stato.avviso = testo;
    disegna();
  }

  /** Il ricorrente pronto per il server, controllato con le sue regole. → { ok, ricorrente } | { ok:false, testo } */
  function pronto(id, v) {
    const c = R.validaCampi(v);
    if (!c.ok) return { ok: false, testo: K.frase(c.dettaglio) };
    const s = K.validaScelte(v, stato.ambiti.map((a) => a.nome));
    if (!s.ok) return s;
    const ricorrente = Object.assign({}, c.campi, s.scelte);
    if (id !== NUOVO) ricorrente.id = id;
    return { ok: true, ricorrente };
  }

  // Un esito riuscito dice che è andata e poi lascia il posto; un errore resta finché non si rifà qualcosa.
  function esitoBreve(id, e) {
    stato.esito.set(id, e);
    setTimeout(() => { if (stato.esito.get(id) === e) { stato.esito.delete(id); disegna(); } }, 8000);
  }

  async function scrivi(id, azione, msg) {
    stato.occupato.set(id, azione);
    stato.esito.delete(id);
    disegna();
    let r;
    try {
      r = await send(msg);
    } catch (e) {
      r = { ok: false, error: erroreDi(e) };
    }
    stato.occupato.delete(id);
    return r || { ok: false, error: 'il server non ha risposto' };
  }

  function apriModulo(id) {
    if (!stato.owner) return;
    stato.modifica.add(id);
    stato.conferma = '';
    stato.msgModulo.delete(id);
    if (id !== NUOVO) stato.esito.delete(id);
    disegna();
    const box = id === NUOVO ? el.nuovo : el.lista.querySelector(`.mg-rc-riga[data-id="${CSS.escape(id)}"]`);
    const nome = box && box.querySelector('[data-campo="nome"]');
    if (nome) { nome.focus(); if (id !== NUOVO) box.scrollIntoView({ block: 'nearest' }); }
  }

  function chiudiModulo(id, butta) {
    stato.modifica.delete(id);
    stato.msgModulo.delete(id);
    if (butta) stato.bozze.delete(id);
    salvaBozze();
    disegna();
    const dove = id === NUOVO ? el.apri : el.lista.querySelector(`.mg-rc-riga[data-id="${CSS.escape(id)}"] [data-azione="modifica"]`);
    if (dove) dove.focus();
  }

  async function salvaRicorrente(id) {
    if (stato.occupato.has(id)) return;
    const p = pronto(id, valori(id));
    if (!p.ok) {
      stato.msgModulo.set(id, { testo: p.testo, errore: true });
      disegna();
      return;
    }
    stato.msgModulo.delete(id);
    const r = await scrivi(id, { azione: 'salva' }, { type: SALVA, ricorrente: p.ricorrente });
    if (r.ok === false) {
      stato.msgModulo.set(id, { testo: K.frase(r.error || 'il server non ha risposto'), errore: true });
      disegna();
      return;
    }
    const nuovoId = id === NUOVO ? String(r.id || '') : id;
    stato.bozze.delete(id);
    stato.modifica.delete(id);
    salvaBozze();
    if (nuovoId) esitoBreve(nuovoId, { testo: id === NUOVO ? 'Creato.' : 'Salvato.' });
    await carica();
    const li = nuovoId && el.lista.querySelector(`.mg-rc-riga[data-id="${CSS.escape(nuovoId)}"]`);
    if (li) {
      const b = li.querySelector('[data-azione="modifica"]');
      if (b) b.focus({ preventScroll: true });
      li.scrollIntoView({ block: 'nearest' });
    } else if (id === NUOVO) {
      avvisa(`Creato ${nuovoId || 'il ricorrente'}: non lo vedo ancora nell'elenco.`);
      el.apri.focus();
    }
  }

  async function cambiaAttivo(id, acceso) {
    const cur = trova(id);
    if (!cur || stato.occupato.has(id)) return;
    // Solo l'interruttore: il resto com'è sul server, una bozza aperta resta bozza.
    const p = pronto(id, Object.assign(base(id), { attivo: acceso }));
    if (!p.ok) {
      stato.esito.set(id, { testo: p.testo, errore: true });
      disegna();
      return;
    }
    stato.occupato.set(id, { azione: 'attivo', valore: acceso });
    stato.esito.delete(id);
    disegna();
    let r;
    try {
      r = await send({ type: SALVA, ricorrente: p.ricorrente });
    } catch (e) {
      r = { ok: false, error: erroreDi(e) };
    }
    stato.occupato.delete(id);
    if (!r || r.ok === false) stato.esito.set(id, { testo: K.frase((r && r.error) || 'il server non ha risposto'), errore: true });
    else {
      // Il server ha detto sì: la riga lo mostra subito, la rilettura conferma la prossima istanza.
      cur.attivo = acceso;
      tocca(id, 'attivo', valori(id).attivo);
    }
    await carica();
  }

  async function avvia(id) {
    if (stato.occupato.has(id)) return;
    stato.conferma = '';
    const r = await scrivi(id, { azione: 'avvia' }, { type: AVVIA, id });
    if (r.ok === false) stato.esito.set(id, { testo: K.frase(r.error || 'il server non ha risposto'), errore: true });
    else stato.esito.set(id, { testo: r.compitoId ? `Avviato: ${r.compitoId} è in coda.` : 'Avviato.', compitoId: r.compitoId || '' });
    await carica();
  }

  async function chiediTogli(id, e, b) {
    if (stato.occupato.has(id)) return;
    // La coda di un doppio clic non conferma (patterns/una-conferma-sul-posto-tiene-ferma-la-sua-scatola.md).
    if (e && e.detail > 1) return;
    if (stato.conferma !== id) {
      const box = b && b.getBoundingClientRect();
      if (box) stato.misure.set(id, { w: Math.ceil(box.width), h: Math.ceil(box.height) });
      stato.conferma = id;
      stato.esito.delete(id);
      disegna();
      return;
    }
    stato.conferma = '';
    const r = await scrivi(id, { azione: 'togli' }, { type: TOGLI, id });
    if (r.ok === false) stato.esito.set(id, { testo: K.frase(r.error || 'il server non ha risposto'), errore: true });
    else {
      stato.bozze.delete(id);
      stato.modifica.delete(id);
      stato.rapporti.delete(id);
      salvaBozze();
      avvisa(`Tolto «${(trova(id) || {}).nome || id}».`);
    }
    await carica();
  }

  function apriCompito(compitoId) {
    const scheda = document.querySelector('.mg-tab[data-tab="compiti"]');
    if (!scheda || !window.__mgCompiti || !window.__mgCompiti.mostra) { avvisa('La scheda dei compiti non è in questa pagina.'); return; }
    scheda.click();
    window.__mgCompiti.mostra(compitoId);
  }

  /** Il ricorrente con questo id in vista e col fuoco: ci arriva chi lo nomina dalla scheda Compiti. */
  async function mostra(id) {
    await carica();
    const li = el.lista.querySelector(`.mg-rc-riga[data-id="${CSS.escape(String(id || ''))}"]`);
    if (!li) { avvisa(`Il ricorrente ${id} non c’è più.`); return; }
    li.scrollIntoView({ block: 'nearest' });
    li.classList.remove('mg-rc-riga--cercata');
    void li.offsetWidth;
    li.classList.add('mg-rc-riga--cercata');
    const b = li.querySelector('[data-azione="modifica"], [data-campo="nome"]');
    if (b) b.focus({ preventScroll: true });
  }

  async function copia(testo) {
    try {
      await navigator.clipboard.writeText(testo);
      avvisa(`Copiato: ${testo}`);
    } catch (_) {
      avvisa('Non riesco a copiare negli appunti.');
    }
  }

  // ── Ascoltatori ──────────────────────────────────────────────────────────

  // Un clic fuori dal «Sì, toglilo» lo disarma: la conferma vale per il clic subito dopo, non per uno di domani.
  root.addEventListener('click', (e) => {
    if (!stato.conferma) return;
    const b = e.target.closest && e.target.closest('[data-azione="togli"]');
    const li = b && b.closest('.mg-rc-riga');
    if (li && li.dataset.id === stato.conferma) return;
    stato.conferma = '';
    disegna();
  }, true);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stato.conferma) { stato.conferma = ''; disegna(); }
  });
  root.addEventListener('contextmenu', (e) => {
    const menu = window.SN_MANAGE_MENU;
    if (!menu || !stato.owner || e.target.closest('input, textarea, select')) return;
    e.preventDefault();
    const li = e.target.closest('.mg-rc-riga');
    const r = li ? trova(li.dataset.id) : null;
    const voci = [];
    if (r) {
      const libero = !stato.occupato.has(r.id);
      if (!stato.modifica.has(r.id)) voci.push({ testo: stato.bozze.has(r.id) ? 'Riprendi la modifica' : 'Modifica', azione: () => apriModulo(r.id) });
      if (libero) {
        voci.push({ testo: 'Avvia adesso', titolo: 'Crea subito un’istanza', azione: () => avvia(r.id) });
        voci.push({ testo: r.attivo === false ? 'Accendi' : 'Spegni', azione: () => cambiaAttivo(r.id, r.attivo === false) });
        voci.push({ testo: 'Togli', titolo: 'Chiede conferma', azione: () => { stato.conferma = r.id; disegna(); } });
      }
      if (r.istanza && r.istanza.id) voci.push({ testo: `Apri ${r.istanza.id} nei Compiti`, azione: () => apriCompito(r.istanza.id) });
      if (r.rapporto && r.rapporto.testo) voci.push({ testo: 'Copia il rapporto', azione: () => copia(r.rapporto.testo) });
      voci.push({ testo: 'Copia il nome', titolo: r.nome, azione: () => copia(r.nome || r.id) });
    }
    voci.push({ testo: 'Nuovo compito ricorrente', azione: () => apriModulo(NUOVO) });
    voci.push({ testo: 'Rileggi dal server', azione: () => { stato.avviso = ''; carica(); } });
    menu.apri(e.clientX, e.clientY, voci);
  });
  el.apri.addEventListener('click', () => (stato.modifica.has(NUOVO) ? chiudiModulo(NUOVO, false) : apriModulo(NUOVO)));

  const attiva = () => !!document.querySelector('.mg-tab[data-tab="ricorrenti"].mg-tab--active');
  document.addEventListener('mg-scheda', (e) => { if (e.detail && e.detail.tab === 'ricorrenti') { stato.avviso = ''; carica(); } });
  if (window.filo && window.filo.onBroadcast) {
    window.filo.onBroadcast((m) => { if (m && m.type === (MSG.AUTH_CHANGED || 'auth_changed')) carica(); });
  }
  setInterval(() => { if (attiva() && !document.hidden && stato.owner) carica(); }, OGNI_MS);

  leggiBozze();
  window.__mgRicorrenti = { carica, mostra, stato: () => stato };
  disegna();
  if (attiva()) carica();
})();

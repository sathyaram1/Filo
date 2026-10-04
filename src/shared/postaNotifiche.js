// Le notifiche del giro della posta (#535): la forma di un avviso proposto da una mail e le classi che l'utente
// lascia sempre cadere. Conta quante notifiche vengono seguite, non quante ne partono.
// Logica pura. Sentinella: tests/unit/postaNotifiche.test.mjs.

(function (global) {
  'use strict';

  const CLASSI = Object.freeze({
    scadenza: 'le scadenze', appuntamento: 'gli appuntamenti', pagamento: 'i pagamenti', consegna: 'le consegne',
    sicurezza: 'gli avvisi di sicurezza', personale: 'le mail personali', lavoro: 'le mail di lavoro',
    newsletter: 'le newsletter', ricevuta: 'le ricevute', promozione: 'le promozioni', altro: 'le altre mail',
  });
  // Un accesso sospetto ignorato dieci volte resta da dire all'undicesima.
  const MAI_ZITTE = Object.freeze(['sicurezza']);
  const SOGLIA_IGNORATE = 5;
  const QUOTA_SEGUITE = 0.2;
  const COSA_MAX = 160;
  const SERVE_MAX = 240;

  const testo = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const riga = (v, max) => {
    const t = testo(v).replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };

  function classe(v) {
    const c = testo(v).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(CLASSI, c) ? c : 'altro';
  }

  // Cosa è e cosa serve fare li scrive il compito; chi la manda e di quale mail si tratta li mette il motore.
  function proposta(mail, uscita) {
    const u = uscita && typeof uscita === 'object' ? uscita : {};
    const cosa = riga(u.cosa ?? u.titolo ?? u.text, COSA_MAX);
    if (!cosa) return null;
    const M = global.SN_POSTA_MEMORIA;
    const base = M ? M.daMail(mail) : { id: testo(mail && mail.id), da: { indirizzo: '', nome: '' }, data: '', oggetto: '' };
    if (!base.id) return null;
    return {
      id: `posta:${base.id}`,
      mail: base.id,
      classe: classe(u.classe),
      cosa,
      serve: riga(u.serve ?? u.azione, SERVE_MAX),
      da: base.da,
      oggetto: base.oggetto,
      data: base.data,
    };
  }

  // Il testo che il guardiano legge è tutto quello che l'utente vedrà, anche l'oggetto della mail.
  function testoDaControllare(p) {
    return [p.cosa, p.serve, p.oggetto].filter(Boolean).join('\n');
  }

  // Finché il guardiano delle notifiche non c'è, i soli controlli statici; senza nemmeno quelli, non passa niente.
  function controlla(p, { segreti = [], link = [] } = {}) {
    const G = global.SN_GUARDIANO_STATICO;
    if (!p) return { blocca: true, regola: 'vuota', motivo: 'non diceva niente' };
    if (!G || typeof G.controlla !== 'function') return { blocca: true, regola: 'guardiano', motivo: 'non c\'era chi la controllasse' };
    return G.controlla(testoDaControllare(p), { segreti, link });
  }

  function vuoto() {
    return { classi: {} };
  }

  function contatori(v) {
    const n = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.floor(Number(x)) : 0);
    const o = v && typeof v === 'object' ? v : {};
    return { mostrate: n(o.mostrate), seguite: n(o.seguite), ignorateDiFila: n(o.ignorateDiFila), zitta: o.zitta === true, detta: o.detta === true };
  }

  function normalizza(raw) {
    const out = vuoto();
    const c = raw && typeof raw === 'object' && raw.classi && typeof raw.classi === 'object' ? raw.classi : {};
    for (const k of Object.keys(c)) if (Object.prototype.hasOwnProperty.call(CLASSI, k)) out.classi[k] = contatori(c[k]);
    return out;
  }

  // «Sempre ignorate»: le ultime cinque lasciate cadere di fila, e in tutto seguita al massimo una su cinque.
  function daZittire(c, k) {
    return !MAI_ZITTE.includes(k) && c.ignorateDiFila >= SOGLIA_IGNORATE && c.seguite <= c.mostrate * QUOTA_SEGUITE;
  }

  // `esito`: 'mostrata' quando compare, 'seguita' quando l'utente la apre o fa quello che chiede, 'ignorata' quando
  // la chiude senza aprirla.
  function registra(stato, cl, esito) {
    const st = normalizza(stato);
    const k = classe(cl);
    const c = contatori(st.classi[k]);
    if (esito === 'mostrata') c.mostrate++;
    else if (esito === 'seguita') { c.seguite++; c.ignorateDiFila = 0; } else if (esito === 'ignorata') c.ignorateDiFila++;
    else return st;
    if (!c.zitta && daZittire(c, k)) { c.zitta = true; c.detta = false; }
    st.classi[k] = c;
    return st;
  }

  function zitta(stato, cl) {
    const c = normalizza(stato).classi[classe(cl)];
    return !!(c && c.zitta);
  }

  // Le classi appena zittite che l'utente non ha ancora saputo: lo si dice una volta sola.
  function daDire(stato) {
    const st = normalizza(stato);
    return Object.keys(st.classi).filter((k) => st.classi[k].zitta && !st.classi[k].detta);
  }

  function detta(stato, cl) {
    const st = normalizza(stato);
    const k = classe(cl);
    if (st.classi[k]) st.classi[k].detta = true;
    return st;
  }

  function riattiva(stato, cl) {
    const st = normalizza(stato);
    const k = classe(cl);
    if (st.classi[k]) Object.assign(st.classi[k], { zitta: false, detta: false, ignorateDiFila: 0 });
    return st;
  }

  function frase(cl) {
    return `Non ti segnalo più ${CLASSI[classe(cl)]}: gli ultimi avvisi di questo tipo li hai sempre lasciati lì. Se li rivuoi, dimmelo o riaccendili dalle Preferenze.`;
  }

  // Quante delle mostrate sono state seguite, per classe: è il numero che le Preferenze mostrano.
  function seguite(stato) {
    const st = normalizza(stato);
    return Object.keys(st.classi).map((k) => ({ classe: k, nome: CLASSI[k], ...st.classi[k] }));
  }

  global.SN_POSTA_NOTIFICHE = Object.freeze({
    CLASSI, MAI_ZITTE, SOGLIA_IGNORATE,
    classe, proposta, controlla, vuoto, normalizza, registra, zitta, daDire, detta, riattiva, frase, seguite,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);

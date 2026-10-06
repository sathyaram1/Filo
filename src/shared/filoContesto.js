// Il contesto della chat come tratto del filo (#868): gli ultimi eventi entro i due tetti, i pezzi vecchi ripescati in
// coda. Logica pura: chi legge il filo e chiama i modelli è src/main/services/contestoFilo.js. Regole:
// patterns/il-contesto-e-la-coda-del-filo-e-il-prefisso-non-si-muove.md, sentinella tests/unit/filoContesto.test.mjs.

(function (global) {
  'use strict';

  const ORA_MS = 60 * 60 * 1000;
  const GIORNO_MS = 24 * ORA_MS;
  const TETTI_DI_SERIE = Object.freeze({ giorni: 3, token: 100000 });
  const LIMITI = Object.freeze({ giorni: Object.freeze([0.5, 365]), token: Object.freeze([2000, 2000000]) });
  // Quanto vive nel contesto l'esito di una lettura (pagina, documento, comando): i venti messaggi di prima del
  // filo unico. Allungarlo lo decide l'owner (#553.2).
  const MESSAGGI_CON_ESITI = 20;
  // Una conversazione ripresa da prima dei tetti porta con sé i suoi ultimi messaggi, come faceva la chat da sola.
  const MESSAGGI_DELLA_CHAT = 20;
  const CARATTERI_PER_TOKEN = 3.5;
  // Oltre il tetto il taglio scende un quarto sotto: i turni dopo trovano lo stesso inizio, e la cache lo riusa.
  const RIENTRO = 0.75;

  function numeroIn(v, [min, max]) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  }

  // L'utente vince sull'owner, l'owner sul codice. Un valore vuoto vuol dire «come i predefiniti».
  function tetti(utente, owner) {
    const u = utente && typeof utente === 'object' ? utente : {};
    const o = owner && typeof owner === 'object' ? owner : {};
    const out = { da: {} };
    for (const k of ['giorni', 'token']) {
      const vu = numeroIn(u[k], LIMITI[k]);
      const vo = numeroIn(o[k], LIMITI[k]);
      out[k] = vu ?? vo ?? TETTI_DI_SERIE[k];
      out.da[k] = vu != null ? 'utente' : (vo != null ? 'predefiniti' : 'codice');
    }
    if (out.token % 1) out.token = Math.round(out.token);
    return out;
  }

  function stimaToken(testo) {
    return Math.ceil(String(testo == null ? '' : testo).length / CARATTERI_PER_TOKEN);
  }

  // Il taglio per giorni si muove a scatti (un'ora per un giorno, sei ore oltre i tre): fra uno scatto e l'altro due
  // turni vedono lo stesso inizio. Arrotondato in avanti, così la finestra non supera mai il tetto.
  function passoTaglio(giorni) {
    return Math.min(6 * ORA_MS, Math.max(ORA_MS, (giorni * GIORNO_MS) / 12));
  }
  function taglio(ora, giorni) {
    const t = Number(ora) - giorni * GIORNO_MS;
    const p = passoTaglio(giorni);
    return Math.ceil(t / p) * p;
  }

  // Un nome corto e fisso per la conversazione: non dipende dalla scheda che chiede, così il prefisso è lo stesso.
  function etichettaChat(id) {
    const s = String(id || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
    return s.slice(0, 4) || '----';
  }

  const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  // Data e ora assolute: un «2 ore fa» cambierebbe a ogni turno e romperebbe il prefisso.
  function quando(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function intestazione(ts, chat) {
    const q = quando(ts);
    const c = chat ? `chat ${etichettaChat(chat)}` : '';
    return `[${[q, c].filter(Boolean).join(' · ')}]`;
  }

  // Un messaggio da solo non riempie il contesto: oltre un quarto del tetto restano testa e coda, e si dice dove sta il resto.
  function tienilo(testo, tetto) {
    const s = String(testo == null ? '' : testo);
    const max = Math.max(4000, Math.floor((tetto * CARATTERI_PER_TOKEN) / 4));
    if (s.length <= max) return s;
    const testa = s.slice(0, Math.floor(max * 0.6));
    const coda = s.slice(-Math.floor(max * 0.4));
    const tolti = s.length - testa.length - coda.length;
    return `${testa}\n…(${tolti} caratteri di questo messaggio non sono qui: si rileggono interi con CERCA_CHAT)…\n${coda}`;
  }

  function chiave(m) {
    return `${m.chat}|${m.ts}`;
  }

  // `prima`: il messaggio che precede nel blocco. Ora e conversazione stanno sui messaggi dell'utente; su quelli di
  // Filo solo quando aprono un tratto di un'altra conversazione, così il modello non impara a scriverle nelle risposte.
  function rendi(m, prima, { tetto, esito, osserva }) {
    const cambia = !prima || prima.chat !== m.chat;
    const testo = tienilo(m.text, tetto);
    if (m.role === 'user') return { role: 'user', content: `${intestazione(m.ts, m.chat)} ${testo}`.trim() };
    const parti = [];
    if (cambia) parti.push(intestazione(m.ts, m.chat));
    if (testo.trim()) parti.push(testo);
    const tipi = Array.isArray(m.actions) ? m.actions.filter((t) => typeof t === 'string' && t) : [];
    const oss = esito && Array.isArray(esito.azioni) && esito.azioni.length && typeof osserva === 'function' ? osserva(esito.azioni) : '';
    if (oss) parti.push(oss);
    else if (tipi.length) parti.push(`(azioni di questo turno: ${tipi.join(', ')})`);
    return { role: 'assistant', content: parti.join('\n\n') || '(nessun testo)' };
  }

  // Il tratto del filo che il modello ha davanti. `messaggi` è tutto il filo in ordine di tempo, senza la domanda di
  // adesso; `ancora` è l'inizio scelto al turno prima, che si tiene finché i tetti lo permettono.
  function finestra(messaggi, { ora = Date.now(), giorni, token, ancora = null, chatCorrente = null, esiti = null, osserva = null } = {}) {
    const lista = Array.isArray(messaggi) ? messaggi : [];
    const n = lista.length;
    const t0 = taglio(ora, giorni);
    const stessaAncora = ancora && ancora.giorni === giorni && ancora.token === token && Number.isFinite(Date.parse(ancora.ts));
    const da = Math.max(t0, stessaAncora ? Date.parse(ancora.ts) : -Infinity);
    let inizio = 0;
    while (inizio < n && Date.parse(lista[inizio].ts) < da) inizio++;
    const conEsiti = Math.max(0, n - MESSAGGI_CON_ESITI);
    const esitoDi = (i) => (i >= conEsiti && esiti ? esiti(lista[i]) : null);
    const pesa = (i) => stimaToken(rendi(lista[i], lista[i - 1], { tetto: token, esito: esitoDi(i), osserva }).content);
    const pesi = new Array(n).fill(0);
    let totale = 0;
    for (let i = inizio; i < n; i++) { pesi[i] = pesa(i); totale += pesi[i]; }
    if (totale > token) {
      while (inizio < n && totale > token * RIENTRO) { totale -= pesi[inizio]; inizio++; }
    }
    // La conversazione di questa scheda, se è ripresa da prima dei tetti: i suoi ultimi messaggi restano davanti.
    const ripresi = [];
    if (chatCorrente) {
      for (let i = inizio - 1; i >= 0 && ripresi.length < MESSAGGI_DELLA_CHAT; i--) if (lista[i].chat === chatCorrente) ripresi.unshift(i);
    }
    const indici = [...ripresi, ...Array.from({ length: n - inizio }, (_, k) => inizio + k)];
    const out = [];
    const azioni = [];
    const visti = [];
    let prima = null;
    for (const i of indici) {
      const m = lista[i];
      const e = esitoDi(i);
      out.push(rendi(m, prima, { tetto: token, esito: e, osserva }));
      if (e && Array.isArray(e.azioni)) azioni.push(...e.azioni);
      visti.push(m);
      prima = m;
    }
    return {
      messaggi: out,
      visti,
      azioni,
      inizio,
      ripresi: ripresi.length,
      vecchi: lista.slice(0, inizio),
      ancora: inizio < n ? { ts: lista[inizio].ts, giorni, token } : (stessaAncora ? ancora : null),
      token: totale,
    };
  }

  // ── I pezzi vecchi ────────────────────────────────────────────────────────
  // Un tratto è uno scambio: un messaggio dell'utente e quello che Filo ha risposto, nella stessa conversazione.
  function tratti(messaggi, { titoli = null } = {}) {
    const out = [];
    const aperti = new Map();
    for (const m of Array.isArray(messaggi) ? messaggi : []) {
      if (!m || !m.chat) continue;
      let t = aperti.get(m.chat);
      if (m.role === 'user' || !t) {
        t = { chiave: chiave(m), chat: m.chat, ts: m.ts, fine: m.ts, righe: [], titolo: titoli ? titoli(m.chat) || '' : '' };
        aperti.set(m.chat, t);
        out.push(t);
      }
      const testo = String(m.text || '').replace(/\s+/g, ' ').trim();
      if (testo) t.righe.push(`${m.role === 'user' ? 'Utente' : 'Filo'}: ${testo}`);
      t.fine = m.ts;
    }
    return out.filter((t) => t.righe.length).map((t) => ({ ...t, testo: t.righe.join('\n') }));
  }

  // Quel che si manda all'indice: abbastanza per riconoscere l'argomento, mai un messaggio enorme intero.
  function testoPerIndice(t) {
    const s = `${t.titolo ? `${t.titolo}\n` : ''}${t.testo}`;
    return s.length > 6000 ? `${s.slice(0, 4000)}\n…\n${s.slice(-2000)}` : s;
  }

  const SOGLIA_RICORDO = 0.45;
  const MAX_RICORDI = 3;
  const CARATTERI_RICORDO = 3000;

  // Tiene i più vicini alla domanda sopra la soglia, al massimo tre: un ricordo sbagliato in coda costa più di uno mancato.
  function scegliRicordi(punteggi, { soglia = SOGLIA_RICORDO, max = MAX_RICORDI } = {}) {
    return (Array.isArray(punteggi) ? punteggi : [])
      .filter((p) => p && p.tratto && Number(p.score) >= soglia)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .sort((a, b) => Date.parse(a.tratto.ts) - Date.parse(b.tratto.ts));
  }

  function testoRicordo(t) {
    const s = String(t.testo || '');
    if (s.length <= CARATTERI_RICORDO) return s;
    return `${s.slice(0, Math.floor(CARATTERI_RICORDO * 0.7))}\n…(il resto si rilegge con CERCA_CHAT e l'id ${t.chat})…\n${s.slice(-Math.floor(CARATTERI_RICORDO * 0.3))}`;
  }

  // I pezzi vecchi vengono dall'archivio: dentro la busta, come i risultati di CERCA_CHAT.
  function rendiRicordi(ricordi) {
    const lista = Array.isArray(ricordi) ? ricordi : [];
    if (!lista.length) return '';
    const E = global.SN_ESTERNO;
    const blocchi = lista.map((r) => {
      const t = r.tratto || r;
      const campi = { Conversazione: `${t.chat}`, Titolo: t.titolo || '', Quando: quando(t.ts) };
      return E.imbustaCampi({ tipo: 'CONVERSAZIONE_ARCHIVIATA', campi, corpo: testoRicordo(t), conIntestazione: true });
    });
    return '═══ RICORDI DAL FILO (ripescati da Filo perché sembrano legati al messaggio qui sotto) ═══\n'
      + 'Sono tratti di conversazioni più vecchie dei giorni che hai davanti. Usali se servono, ignorali se non c\'entrano; '
      + 'una conversazione per intero si rilegge con CERCA_CHAT e il suo id.\n\n'
      + blocchi.join('\n\n');
  }

  // Il blocco subito prima della domanda: tutto ciò che cambia a ogni turno, così il filo davanti resta identico.
  function coda({ contesto = '', ricordi = '', chatCorrente = null, nuova = false } = {}) {
    const dove = chatCorrente
      ? (nuova ? `Questa scheda ha appena aperto la chat ${etichettaChat(chatCorrente)}.` : `Questa scheda è la chat ${etichettaChat(chatCorrente)}.`)
      : '';
    return [
      '═══ CONTESTO DI ADESSO (lo scrive Filo, non l\'utente: vale per il messaggio qui sotto) ═══',
      dove,
      contesto,
      ricordi,
    ].filter((x) => String(x || '').trim()).join('\n\n');
  }

  global.SN_FILO_CONTESTO = {
    TETTI_DI_SERIE, LIMITI, MESSAGGI_CON_ESITI, MESSAGGI_DELLA_CHAT, SOGLIA_RICORDO, MAX_RICORDI,
    tetti, numeroIn, stimaToken, taglio, passoTaglio, etichettaChat, quando, intestazione, chiave,
    finestra, tratti, testoPerIndice, scegliRicordi, rendiRicordi, coda,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

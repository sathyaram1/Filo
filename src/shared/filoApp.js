// Le conversazioni delle altre app (Editor, Mazzi, Aiuto) nel filo (#974): una riga ripiegata ciascuna. Logica pura:
// le scrive solo src/main/services/conversazioniApp.js, le mostra la home. Regole:
// patterns/il-filo-cresce-solo-in-coda-e-cancellare-e-un-evento.md (§ chat delle altre app), sentinella tests/unit/filoApp.test.mjs.

(function (global) {
  'use strict';

  // Una chat nuova entra nel filo con una voce qui e una chiamata a SN_CONVERSAZIONI_APP.annota (o FILO_CONVERSAZIONE_APP).
  const APP = Object.freeze({
    editor: Object.freeze({ nome: 'Editor', nel: "nell'Editor", icona: 'editor' }),
    mazzi: Object.freeze({ nome: 'Mazzi', nel: 'nei Mazzi', icona: 'decks' }),
    aiuto: Object.freeze({ nome: 'Aiuto', nel: "nell'Aiuto", icona: 'question' }),
  });
  // Oltre un'ora di silenzio quello che si scrive nella stessa chat dell'app è una conversazione nuova: una riga sua.
  const PAUSA_MS = 60 * 60 * 1000;
  const GIORNO_MS = 24 * 60 * 60 * 1000;
  const SOGGETTO_MAX = 120;

  const eApp = (a) => typeof a === 'string' && Object.hasOwn(APP, a);
  const ms = (t) => { const n = Date.parse(t); return Number.isFinite(n) ? n : NaN; };

  // Il nome di un documento, di un mazzo, di un sito: un'etichetta su una riga.
  function soggetto(s) {
    const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > SOGGETTO_MAX ? `${t.slice(0, SOGGETTO_MAX - 1)}…` : t;
  }

  function titolo(app, sogg) {
    const a = APP[app];
    if (!a) return '';
    const s = soggetto(sogg);
    return s ? `${a.nome} · ${s}` : a.nome;
  }

  function quantiMessaggi(n) {
    return `${n} ${n === 1 ? 'messaggio' : 'messaggi'}`;
  }

  // «4 messaggi nell'Editor su tesi»: quello che la riga dice, nella home e (fra parentesi) al modello.
  function testoRiga(c) {
    const a = c && APP[c.app];
    if (!a) return '';
    const n = Array.isArray(c.messages) ? c.messages.length : 0;
    const s = soggetto(c.soggetto);
    return `${quantiMessaggi(n)} ${a.nel}${s ? ` su ${s}` : ''}`;
  }

  // Al modello la riga, non lo scambio: il testo si rilegge con CERCA_CHAT e l'id. Il soggetto fra caporali e senza
  // marcature, così il nome di un mazzo importato o di un documento resta un nome e non apre una busta.
  function testoPerModello(c) {
    const a = c && APP[c.app];
    if (!a) return '';
    const n = Array.isArray(c.messages) ? c.messages.length : 0;
    const E = global.SN_ESTERNO;
    const s = E && typeof E.neutralizza === 'function' ? E.neutralizza(soggetto(c.soggetto), { unaRiga: true }).trim() : soggetto(c.soggetto);
    return `(conversazione ${a.nel}${s ? ` su «${s}»` : ''}: ${quantiMessaggi(n)} fra l'utente e Filo. `
      + `Il testo non è qui: si rilegge con CERCA_CHAT e id "${c.id}")`;
  }

  // Le parole scritte nell'Aiuto sopra un sito le vedeva il sito, e prima di #1340 poteva cambiarle (#1508): chi le
  // rilegge le conta come testo da fuori. Le conversazioni salvate prima del segno lo prendono dal riferimento, che per
  // l'Aiuto comincia col sito (src/main/services/handlers/filo.js). Il segno si aggiunge e basta, mai si toglie.
  function conProvenienza(c) {
    const msgs = Array.isArray(c && c.messages) ? c.messages : [];
    if (c.app !== 'aiuto' || String(c.rif || '').startsWith('filo|')) return msgs;
    return msgs.map((m) => (m && m.role === 'user' && m.daPagina !== true ? { ...m, daPagina: true } : m));
  }

  function inizio(c) {
    const m = Array.isArray(c && c.messages) ? c.messages[0] : null;
    const t = ms(m && m.ts);
    return Number.isFinite(t) ? t : ms(c && c.startedAt);
  }

  // La conversazione dell'app da continuare: l'ultima con la stessa app e lo stesso riferimento, se non è passata
  // un'ora dall'ultimo messaggio. Altrimenti null, e se ne apre una nuova.
  function daContinuare(chats, { app, rif, ora = Date.now() } = {}) {
    let ultima = null;
    for (const c of Array.isArray(chats) ? chats : []) {
      if (!c || c.app !== app || c.rif !== rif) continue;
      if (!ultima || (ms(c.updatedAt) || 0) > (ms(ultima.updatedAt) || 0)) ultima = c;
    }
    if (!ultima || ultima.closedAt) return null;
    const t = ms(ultima.updatedAt);
    return Number.isFinite(t) && ora - t <= PAUSA_MS ? ultima : null;
  }

  // Gli istanti in cui una conversazione della home c'era: i suoi messaggi e la chiusura.
  function istantiDiCasa(c) {
    const out = [];
    for (const m of Array.isArray(c.messages) ? c.messages : []) { const t = ms(m && m.ts); if (Number.isFinite(t)) out.push(t); }
    const ch = ms(c.closedAt);
    if (Number.isFinite(ch)) out.push(ch);
    return out;
  }

  function vista(c) {
    return {
      id: c.id,
      app: c.app,
      icona: APP[c.app].icona,
      nomeApp: APP[c.app].nome,
      soggetto: soggetto(c.soggetto),
      testo: testoRiga(c),
      n: c.messages.length,
      inizio: new Date(inizio(c)).toISOString(),
      fine: c.updatedAt || null,
      dove: typeof c.dove === 'string' ? c.dove : '',
    };
  }

  // Le righe che la home mostra. Una riga sta nella conversazione della home in cui è nata (o, se è nata fra due
  // conversazioni, in testa alla seguente); a home vuota, quelle nate dopo l'ultima conversazione della home.
  // Mai più vecchie dei giorni che la chat ha davanti.
  function perLaHome(chats, { chat = null, ora = Date.now(), giorni = 3 } = {}) {
    const lista = Array.isArray(chats) ? chats : [];
    const casa = lista.filter((c) => c && !c.app && Array.isArray(c.messages) && c.messages.length);
    const app = lista.filter((c) => c && eApp(c.app) && Array.isArray(c.messages) && c.messages.length);
    const finestra = Math.max(0, Number(giorni) || 0) * GIORNO_MS;
    const corrente = chat ? casa.find((c) => c.id === chat) : null;
    let da = -Infinity;
    let fine = Infinity;
    if (corrente) {
      const primo = inizio(corrente);
      for (const c of casa) {
        if (c === corrente) continue;
        for (const t of istantiDiCasa(c)) if (t < primo && t > da) da = t;
      }
      da = Math.max(da, primo - finestra);
      const ch = ms(corrente.closedAt);
      if (Number.isFinite(ch)) fine = ch;
    } else {
      for (const c of casa) for (const t of istantiDiCasa(c)) if (t > da) da = t;
      da = Math.max(da, ora - finestra);
    }
    return app
      .filter((c) => { const t = inizio(c); return Number.isFinite(t) && t > da && t <= fine; })
      .sort((a, b) => (inizio(a) - inizio(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(vista);
  }

  global.SN_FILO_APP = {
    APP, PAUSA_MS, eApp, soggetto, titolo, testoRiga, testoPerModello, conProvenienza, inizio, daContinuare, perLaHome, vista,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

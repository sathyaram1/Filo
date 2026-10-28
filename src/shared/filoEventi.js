// Il filo (#866): la forma degli eventi e la loro piegatura in chat e pagine visitate. Logica pura, niente disco:
// legge e scrive solo src/main/services/ilFilo.js. Regole: patterns/il-filo-cresce-solo-in-coda-e-cancellare-e-un-evento.md,
// sentinella tests/unit/filoEventi.test.mjs.

(function (global) {
  'use strict';

  const VERSIONE = 1;
  const TIPI = Object.freeze({
    CHAT_APERTA: 'chat.aperta',
    MESSAGGIO: 'messaggio',
    CHAT_CHIUSA: 'chat.chiusa',
    CHAT_TITOLO: 'chat.titolo',
    // Ciò che la chat ha letto, come classi di fonte (#530): ripresa dall'archivio non riparte pulita.
    CHAT_FONTI: 'chat.fonti',
    // Nascosta dall'utente (#1295): esce dalla home e da ciò che Filo ha davanti, resta nel filo e si rimette.
    CHAT_NASCOSTA: 'chat.nascosta',
    NAVIGAZIONE: 'navigazione',
    TITOLO_PAGINA: 'navigazione.titolo',
    CANCELLAZIONE: 'cancellazione',
    // Un cambio di stato annullabile (#867): `cambio` è il suo id per ANNULLA_CAMBIO, `ambito` impostazioni, timer,
    // proxy o zoom. Con `fonde` riscrive il cambio con quell'id (ritocchi della stessa cosa), con `cambi` vuoti lo ritira.
    CAMBIO: 'cambio',
    // Quello che succede fuori dalla chat (#1561), scritto da src/main/services/accaduti.js e dai punti che scrivono
    // quello stato. Le schede dicono solo quale: la pagina è nella visita che porta lo stesso `scheda`.
    AZIONE: 'azione',
    SCHEDA_APERTA: 'scheda.aperta',
    SCHEDA_CHIUSA: 'scheda.chiusa',
    SCHEDA_DAVANTI: 'scheda.davanti',
    RICERCA: 'ricerca',
    DOWNLOAD: 'download',
    FILE: 'file',
    TIMER_SCATTATO: 'timer.scattato',
    NOTIFICA: 'notifica',
    SISTEMA: 'sistema',
  });
  const ACCADUTI = new Set([TIPI.AZIONE, TIPI.SCHEDA_APERTA, TIPI.SCHEDA_CHIUSA, TIPI.SCHEDA_DAVANTI, TIPI.RICERCA,
    TIPI.DOWNLOAD, TIPI.FILE, TIPI.TIMER_SCATTATO, TIPI.NOTIFICA, TIPI.SISTEMA]);
  const AUTORI = Object.freeze(['utente', 'filo', 'automazione']);
  const ORA_MS = 60 * 60 * 1000;
  const PERIODI = Object.freeze(['ultima_ora', 'oggi', 'ieri', 'tutto']);

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  const isoValida = (s) => typeof s === 'string' && s.length >= 20 && !Number.isNaN(Date.parse(s));
  const stringa = (s) => typeof s === 'string' && s.length > 0;
  const oggetto = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

  // Un tipo sconosciuto è valido: lo scriverà una versione più nuova (le azioni, un altro dispositivo) e chi non lo
  // capisce lo conserva senza piegarlo, invece di buttarlo alla prima riscrittura.
  function valido(ev) {
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return false;
    if (ev.v !== VERSIONE || !stringa(ev.id) || !isoValida(ev.ts) || !stringa(ev.dispositivo)) return false;
    if (!AUTORI.includes(ev.autore) || !stringa(ev.tipo)) return false;
    switch (ev.tipo) {
      case TIPI.CHAT_APERTA:
      case TIPI.CHAT_CHIUSA:
      case TIPI.CHAT_TITOLO:
        return stringa(ev.chat);
      case TIPI.CHAT_FONTI:
        return stringa(ev.chat) && Array.isArray(ev.fonti);
      case TIPI.CHAT_NASCOSTA:
        return stringa(ev.chat) && typeof ev.nascosta === 'boolean';
      case TIPI.MESSAGGIO:
        return stringa(ev.chat) && !!ev.msg && typeof ev.msg === 'object' && typeof ev.msg.text === 'string'
          && (ev.msg.role === 'user' || ev.msg.role === 'filo');
      case TIPI.NAVIGAZIONE:
        return stringa(ev.url) && typeof ev.titolo === 'string';
      case TIPI.TITOLO_PAGINA:
        return stringa(ev.visita) && typeof ev.titolo === 'string';
      case TIPI.CANCELLAZIONE:
        if (ev.chat != null) return stringa(ev.chat);
        return !!ev.pagine && typeof ev.pagine === 'object'
          && (ev.pagine.da == null || isoValida(ev.pagine.da)) && (ev.pagine.a == null || isoValida(ev.pagine.a))
          && (ev.pagine.sito == null || stringa(ev.pagine.sito));
      case TIPI.CAMBIO:
        return stringa(ev.cambio) && stringa(ev.ambito) && Array.isArray(ev.cambi)
          && ev.cambi.every((c) => c && typeof c === 'object' && stringa(c.chiave));
      case TIPI.AZIONE:
        return stringa(ev.nome) && oggetto(ev.esito) && (ev.parametri == null || oggetto(ev.parametri))
          && (ev.chat == null || stringa(ev.chat));
      case TIPI.SCHEDA_APERTA:
      case TIPI.SCHEDA_CHIUSA:
      case TIPI.SCHEDA_DAVANTI:
        return stringa(ev.scheda);
      case TIPI.RICERCA:
        return stringa(ev.testo) && (ev.visita == null || stringa(ev.visita)) && (ev.chat == null || stringa(ev.chat));
      case TIPI.DOWNLOAD:
        return stringa(ev.scaricamento) && stringa(ev.stato) && typeof ev.file === 'string';
      case TIPI.FILE:
        return stringa(ev.file) && stringa(ev.azione);
      case TIPI.TIMER_SCATTATO:
        return stringa(ev.timer);
      case TIPI.NOTIFICA:
        return stringa(ev.testo) && (ev.url == null || stringa(ev.url));
      case TIPI.SISTEMA:
        return stringa(ev.cosa);
      default:
        return true;
    }
  }

  // Un'ora in un'altra forma (numero, data senza millisecondi) si normalizza: un evento non si perde per l'orologio.
  function normaTs(ts) {
    if (ts == null || ts === '') return new Date().toISOString();
    const t = typeof ts === 'number' ? ts : Date.parse(ts);
    return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
  }

  // L'ordine dei campi è fisso: due dispositivi che scrivono lo stesso evento producono la stessa riga.
  function crea(tipo, campi, { id, ts, dispositivo, autore } = {}) {
    const ev = {
      v: VERSIONE,
      id: id || uuid(),
      ts: isoValida(ts) ? ts : normaTs(ts),
      dispositivo: String(dispositivo || ''),
      autore: AUTORI.includes(autore) ? autore : 'utente',
      tipo,
    };
    for (const k of Object.keys(campi || {})) {
      if (campi[k] !== undefined && !(k in ev)) ev[k] = campi[k];
    }
    return ev;
  }

  // JSON.stringify scappa ogni a capo dentro le stringhe: una riga è sempre un evento intero.
  function riga(ev) {
    return JSON.stringify(ev) + '\n';
  }

  // Una riga sola: l'evento, null se rotta o fuori formato, undefined se vuota. La lettura del file la usa riga per
  // riga (un file grande non sta in una stringa); `analizza` per un testo intero, come un export.
  function analizzaRiga(r) {
    if (!r || !r.trim()) return undefined;
    try {
      const ev = JSON.parse(r);
      return valido(ev) ? ev : null;
    } catch (_) { return null; }
  }

  // Una riga rotta (scrittura interrotta da un guasto di corrente) si salta e si conta, non ferma la lettura.
  function analizza(testo) {
    const eventi = [];
    let scartate = 0;
    for (const r of String(testo || '').split('\n')) {
      const ev = analizzaRiga(r);
      if (ev) eventi.push(ev); else if (ev === null) scartate++;
    }
    return { eventi, scartate };
  }

  function nuovoStato() {
    // `messaggi`: l'id di ogni evento-messaggio porta alla sua chat (#872: le memorie ricordano da dove sono nate).
    // `cambi`: i cambi di stato nell'ordine in cui sono nati, nella forma che legge src/shared/cambi.js.
    // `accaduti`: gli eventi di ACCADUTI così come sono arrivati, in ordine (azioni, schede, ricerche…).
    return { chat: new Map(), pagine: new Map(), ids: new Set(), pos: 0, tagli: [], messaggi: new Map(), cambi: [], accaduti: [] };
  }

  function nelPeriodo(ts, pagine) {
    const t = Date.parse(ts);
    if (pagine.da != null && t < Date.parse(pagine.da)) return false;
    if (pagine.a != null && t > Date.parse(pagine.a)) return false;
    return true;
  }

  // «youtube.com», «https://www.youtube.com/watch», «YouTube»: il sito come lo dice l'utente, ridotto a un nome.
  function normaSito(s) {
    const t = String(s == null ? '' : s).trim().toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^www\./, '');
    return t;
  }

  // Senza punto («youtube») vale ogni dominio con quel nome; con il punto, il dominio e i suoi sottodomini.
  function delSito(url, sito) {
    if (!sito) return true;
    let host = '';
    try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return false; }
    return hostDelSito(host, sito);
  }
  function hostDelSito(host, sito) {
    if (!host) return false;
    if (sito.includes('.')) return host === sito || host.endsWith('.' + sito);
    return host.split('.').includes(sito);
  }

  // Una cancellazione di pagine copre quelle aperte PRIMA di lei nel suo periodo, in qualunque ordine arrivino
  // (un import, una visita ancora in caricamento, un altro dispositivo): «tutto» è tutto fino a quel momento.
  function copertura(ev) {
    const p = ev.pagine || {};
    const a = p.a != null && Date.parse(p.a) < Date.parse(ev.ts) ? p.a : ev.ts;
    return { da: p.da ?? null, a, sito: p.sito ? normaSito(p.sito) : null };
  }

  function copre(c, pagina) {
    return nelPeriodo(pagina.ts, c) && delSito(pagina.url, c.sito);
  }

  // I siti che un'azione nomina nei suoi parametri («apri clinica.it/visita»), con o senza schema.
  function hostIn(v, out = [], prof = 0) {
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^https?:\/\//i.test(s)) {
        try { out.push(new URL(s).hostname.toLowerCase().replace(/^www\./, '')); } catch (_) {}
      } else {
        const m = /^(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?::\d+)?(?:[/?#]|$)/i.exec(s);
        if (m) out.push(m[1].toLowerCase());
      }
    } else if (prof < 4 && v && typeof v === 'object') {
      for (const x of Array.isArray(v) ? v : Object.values(v)) hostIn(x, out, prof + 1);
    }
    return out;
  }

  // I siti che un testo libero nomina («Sito bloccato: casino.com · pubblicità»), parola per parola.
  function hostNelTesto(testo, out = []) {
    for (const p of String(testo || '').split(/\s+/)) hostIn(p.replace(/^[«"'(\[]+|[»"')\],;:.!?]+$/g, ''), out);
    return out;
  }

  // Una regola sola per quello che nasce dall'uso (download, ricerche di Filo, azioni, avvisi): cancellare le pagine
  // di un periodo lo porta via, e con un sito porta via quello che ne nomina un indirizzo (`url`, parametri, testo
  // dell'avviso). Le ricerche sui siti stanno con la loro visita; quelle di Filo sul web non nominano un sito.
  const DALL_USO = new Set([TIPI.DOWNLOAD, TIPI.RICERCA, TIPI.AZIONE, TIPI.NOTIFICA]);
  function copreAccaduto(c, ev) {
    if (!DALL_USO.has(ev.tipo) || !nelPeriodo(ev.ts, c)) return false;
    if (ev.tipo === TIPI.RICERCA && stringa(ev.visita)) return false;
    if (ev.tipo === TIPI.DOWNLOAD && !stringa(ev.url)) return false;
    if (!c.sito) return true;
    if (ev.tipo === TIPI.RICERCA) return false;
    const siti = hostIn(ev.parametri, hostIn(ev.url));
    if (ev.tipo === TIPI.NOTIFICA) hostNelTesto(ev.testo, siti);
    return siti.some((h) => hostDelSito(h, c.sito));
  }

  // Una visita che una cancellazione già vista copre non entra: non si scrive nemmeno. Il titolo nuovo di una visita
  // che qui non c'è (cancellata, o mai entrata) nemmeno, né la ricerca letta nel suo indirizzo: `visite` sono quelle
  // che arrivano insieme a loro.
  function coperto(stato, ev, visite) {
    if (!ev) return false;
    if (ev.tipo === TIPI.TITOLO_PAGINA || (ev.tipo === TIPI.RICERCA && stringa(ev.visita))) {
      return !stato.pagine.has(ev.visita) && !(visite && visite.has(ev.visita));
    }
    if (ev.tipo === TIPI.NAVIGAZIONE) return stato.tagli.some((c) => copre(c, ev));
    if (!ACCADUTI.has(ev.tipo)) return false;
    // Un accaduto di una chat cancellata se ne va con lei anche se arriva dopo: l'azione che la cancella ne dice il titolo.
    if (ev.chat != null && stato.chatTolte.has(ev.chat)) return true;
    return stato.tagli.some((c) => copreAccaduto(c, ev));
  }

  function chatNuova(id, ts) {
    return {
      id, startedAt: ts, updatedAt: ts, closedAt: null, title: '', kind: null, onboarding: false, messages: [], _pos: 0, _disp: [], _ids: [],
    };
  }

  // Piega un evento nello stato. Un id già visto non conta due volte: è la regola che rende ripetibili import e
  // sincronizzazione. Ritorna quante cose una cancellazione ha tolto (zero per gli altri eventi).
  function applica(stato, ev) {
    if (!valido(ev) || stato.ids.has(ev.id)) return { nuovo: false, tolti: 0 };
    stato.ids.add(ev.id);
    stato.pos += 1;
    let c = ev.chat != null ? stato.chat.get(ev.chat) : null;
    switch (ev.tipo) {
      case TIPI.CHAT_APERTA:
        if (!c) { c = chatNuova(ev.chat, ev.ts); c._pos = stato.pos; stato.chat.set(ev.chat, c); }
        if (ev.onboarding) c.onboarding = true;
        // Una conversazione di un'altra app (Editor, Mazzi, Aiuto): nel filo è una riga ripiegata (src/shared/filoApp.js).
        if (stringa(ev.app)) {
          c.app = ev.app;
          c.rif = typeof ev.rif === 'string' ? ev.rif : '';
          if (typeof ev.soggetto === 'string') c.soggetto = ev.soggetto;
          if (typeof ev.dove === 'string') c.dove = ev.dove;
        }
        break;
      case TIPI.MESSAGGIO: {
        if (!c) { c = chatNuova(ev.chat, ev.ts); stato.chat.set(ev.chat, c); }
        // Un messaggio di Filo che si fonde col suo di prima (#869; quando, lo decide chi scrive: src/shared/filoCoda.js)
        // lo riscrive con tutto quello che è successo, e su disco restano tutti e due.
        const ultimo = c.messages[c.messages.length - 1];
        if (ev.msg.fonde && ev.msg.spontaneo && ultimo && ultimo.spontaneo && ultimo.role === 'filo' && ev.msg.role === 'filo') {
          const { fonde: _f, ...fuso } = ev.msg;
          c.messages[c.messages.length - 1] = { ...fuso, ts: ultimo.ts };
          c._disp[c.messages.length - 1] = ev.dispositivo;
          (c._ids[c.messages.length - 1] = c._ids[c.messages.length - 1] || []).push(ev.id);
        } else {
          c.messages.push({ ...ev.msg, ts: ev.ts });
          c._disp.push(ev.dispositivo);
          c._ids.push([ev.id]);
        }
        if (stato.messaggi) stato.messaggi.set(ev.id, ev.chat);
        c.updatedAt = ev.ts;
        c._pos = stato.pos;
        // Riapre solo l'utente: una risposta arrivata a chat chiusa è la coda di quella di prima.
        if (ev.msg.role === 'user') { c.closedAt = null; delete c.finita; }
        if (ev.onboarding) c.onboarding = true;
        break;
      }
      case TIPI.CHAT_CHIUSA:
        if (c && !c.closedAt) c.closedAt = ev.ts;
        // `fine`: l'ha chiusa l'utente apposta (bottone, /clear), non una scheda che se ne va: una scheda nuova non la continua.
        if (c && ev.fine === true) c.finita = true;
        break;
      case TIPI.CHAT_TITOLO:
        if (!c) break;
        if (typeof ev.title === 'string') c.title = ev.title;
        if (ev.kind !== undefined) c.kind = ev.kind;
        if (ev.titleByUser) c.titleByUser = true;
        if (ev.kindByUser) c.kindByUser = true;
        if (Number.isFinite(ev.triagedCount)) c.triagedCount = ev.triagedCount;
        if (typeof ev.soggetto === 'string') c.soggetto = ev.soggetto;
        break;
      case TIPI.CHAT_NASCOSTA:
        if (!c) break;
        if (ev.nascosta) c.nascosta = true; else delete c.nascosta;
        break;
      case TIPI.CHAT_FONTI: {
        if (!c) break;
        const prima = Array.isArray(c.fonti) ? c.fonti : [];
        const nuove = ev.fonti.filter((f) => f && typeof f === 'object' && Number.isInteger(f.classe)
          && !prima.some((p) => p.chiave === f.chiave && p.classe === f.classe));
        c.fonti = prima.concat(nuove.map((f) => ({ ...f })));
        break;
      }
      case TIPI.NAVIGAZIONE:
        if (coperto(stato, ev)) return { nuovo: true, tolti: 1 };
        stato.pagine.set(ev.id, {
          id: ev.id, ts: ev.ts, url: ev.url, titolo: ev.titolo, scheda: ev.scheda ?? null, dispositivo: ev.dispositivo,
          // Una scheda chiusa prima del filo, entrata alla sua data (#872): riassunto e vettore restano nel suo archivio.
          ...(stringa(ev.archivio) ? { archivio: ev.archivio } : {}),
          // Tagliati alla misura (src/main/services/misurePagine.js): un indirizzo a metà non si riapre come intero.
          ...(ev.urlTagliato === true ? { urlTagliato: true } : {}),
          ...(ev.titoloTagliato === true ? { titoloTagliato: true } : {}),
        });
        break;
      case TIPI.TITOLO_PAGINA: {
        const p = stato.pagine.get(ev.visita);
        if (p) {
          p.titolo = ev.titolo;
          if (ev.titoloTagliato === true) p.titoloTagliato = true; else delete p.titoloTagliato;
        }
        break;
      }
      case TIPI.CANCELLAZIONE: {
        // `pagine` sono le visite tolte, il numero che si dice all'utente; `tolti` conta tutto e dice di compattare.
        let tolti = 0;
        let pagine = 0;
        const acc = Array.isArray(stato.accaduti) ? stato.accaduti : [];
        let via = () => false;
        if (ev.chat != null) {
          const c = stato.chat.get(ev.chat);
          if (c && stato.messaggi) for (const ids of c._ids || []) for (const id of ids || []) stato.messaggi.delete(id);
          if (stato.chat.delete(ev.chat)) tolti = 1;
          via = (a) => a.chat === ev.chat;
        } else {
          const c = copertura(ev);
          stato.tagli.push(c);
          const visite = new Set();
          for (const [id, p] of stato.pagine) {
            if (copre(c, p)) { stato.pagine.delete(id); visite.add(id); tolti++; pagine++; }
          }
          via = (a) => (a.tipo === TIPI.RICERCA && visite.has(a.visita)) || copreAccaduto(c, a);
        }
        const restano = acc.filter((a) => !via(a));
        tolti += acc.length - restano.length;
        stato.accaduti = restano;
        return { nuovo: true, tolti, pagine };
      }
      case TIPI.CAMBIO:
        piegaCambio(stato, ev);
        break;
      default:
        if (ACCADUTI.has(ev.tipo)) {
          if (coperto(stato, ev)) return { nuovo: true, tolti: 1 };
          if (!Array.isArray(stato.accaduti)) stato.accaduti = [];
          stato.accaduti.push(ev);
        }
        break;
    }
    return { nuovo: true, tolti: 0 };
  }

  // Gli accaduti in ordine di arrivo, copiati: `tipi` per sceglierne alcuni, `da` per quelli dopo un istante.
  function accadutiDi(stato, { tipi, da } = {}) {
    const voluti = Array.isArray(tipi) && tipi.length ? new Set(tipi) : null;
    const t0 = da != null ? Date.parse(da) : NaN;
    return (stato && Array.isArray(stato.accaduti) ? stato.accaduti : [])
      .filter((ev) => (!voluti || voluti.has(ev.tipo)) && (Number.isNaN(t0) || Date.parse(ev.ts) > t0))
      .map((ev) => JSON.parse(JSON.stringify(ev)));
  }

  function piegaCambio(stato, ev) {
    if (!Array.isArray(stato.cambi)) stato.cambi = [];
    const lista = stato.cambi;
    const cambi = ev.cambi.map((c) => ({ ...c }));
    if (ev.fonde === true) {
      let i = lista.length - 1;
      while (i >= 0 && lista[i].id !== ev.cambio) i--;
      if (i >= 0) {
        if (!cambi.length) lista.splice(i, 1);
        else lista[i] = { ...lista[i], cambi, agg: ev.ts };
        return;
      }
      if (!cambi.length) return;
    }
    lista.push({
      id: ev.cambio, ts: ev.ts, tipo: ev.ambito, via: stringa(ev.via) ? ev.via : 'filo',
      ...(stringa(ev.dove) ? { dove: ev.dove } : {}), ...(stringa(ev.annulla) ? { annulla: ev.annulla } : {}), cambi,
    });
  }

  // Le copie dei cambi per chi le legge: nessuno tocca lo stato piegato.
  function cambiDi(stato) {
    return (stato && Array.isArray(stato.cambi) ? stato.cambi : []).map((e) => ({ ...e, cambi: e.cambi.map((c) => ({ ...c })) }));
  }

  // Cosa resta su disco dopo le cancellazioni: gli eventi di una chat cancellata DOPO di loro e le pagine che una
  // cancellazione copre se ne vanno, il resto resta identico e in ordine. Le cancellazioni restano: un altro dispositivo dovrà saperle.
  function compatta(eventi) {
    const chatCancellate = new Set();
    const tagli = eventi.filter((ev) => ev.tipo === TIPI.CANCELLAZIONE && ev.chat == null).map(copertura);
    // Il titolo di una pagina cancellata è suo contenuto: se ne va con lei.
    const visiteTolte = new Set(eventi.filter((ev) => ev.tipo === TIPI.NAVIGAZIONE && tagli.some((c) => copre(c, ev))).map((ev) => ev.id));
    const tenuti = [];
    for (let i = eventi.length - 1; i >= 0; i--) {
      const ev = eventi[i];
      if (ev.tipo === TIPI.CANCELLAZIONE) {
        if (ev.chat != null) chatCancellate.add(ev.chat);
        tenuti.push(ev);
        continue;
      }
      if (ev.chat != null && chatCancellate.has(ev.chat)) continue;
      if (ev.tipo === TIPI.NAVIGAZIONE && visiteTolte.has(ev.id)) continue;
      if ((ev.tipo === TIPI.TITOLO_PAGINA || ev.tipo === TIPI.RICERCA) && visiteTolte.has(ev.visita)) continue;
      if (ACCADUTI.has(ev.tipo) && tagli.some((c) => copreAccaduto(c, ev))) continue;
      tenuti.push(ev);
    }
    return tenuti.reverse();
  }

  // Le chat sono dal più recente: per ora dell'ultimo messaggio, poi per posizione nel filo.
  function elencoChat(stato) {
    return [...stato.chat.values()].sort((a, b) => {
      const d = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      return d || (b._pos - a._pos);
    });
  }

  // `dispositivi`: per la home (#869), il dispositivo da cui è arrivato ogni messaggio, allineato a `messages`.
  function copiaChat(c, { dispositivi = false, ids = false } = {}) {
    if (!c) return null;
    const out = { ...c, messages: c.messages.map((m) => ({ ...m })) };
    if (Array.isArray(c.fonti)) out.fonti = c.fonti.map((f) => ({ ...f }));
    delete out._pos;
    delete out._disp;
    delete out._ids;
    if (dispositivi) out.dispositivi = c.messages.map((_, i) => (c._disp && c._disp[i]) || '');
    // L'ultimo evento di ogni messaggio (un messaggio di Filo fuso ne ha più d'uno): è l'id con cui una memoria lo cita.
    if (ids) out.eids = c.messages.map((_, i) => { const a = c._ids && c._ids[i]; return (a && a[a.length - 1]) || ''; });
    return out;
  }

  // Dov'è un evento nel filo: un messaggio (chat e posizione) o una pagina visitata. Null se non c'è più.
  function dove(stato, id) {
    if (!stato || !stringa(id)) return null;
    const chatId = stato.messaggi && stato.messaggi.get(id);
    const c = chatId != null ? stato.chat.get(chatId) : null;
    if (c) {
      const i = (c._ids || []).findIndex((a) => Array.isArray(a) && a.includes(id));
      if (i >= 0) return { tipo: 'messaggio', chat: c.id, i, ts: c.messages[i].ts, role: c.messages[i].role, app: c.app || null };
    }
    const p = stato.pagine.get(id);
    if (p) return { tipo: 'pagina', id: p.id, ts: p.ts, url: p.url, titolo: p.titolo, ...(p.urlTagliato ? { urlTagliato: true } : {}) };
    return null;
  }

  // Le chat salvate prima del filo diventano segmenti: per ogni chat i suoi eventi uno dopo l'altro, la meno
  // recente per prima, così l'ordine dell'elenco resta quello di prima. Ogni campo si conserva com'era.
  function daChatSalvate(chats, { dispositivo } = {}) {
    const eventi = [];
    const lista = (Array.isArray(chats) ? chats : []).filter((c) => c && stringa(c.id));
    const ora = new Date().toISOString();
    for (const c of lista.slice().reverse()) {
      const messaggi = Array.isArray(c.messages) ? c.messages.filter((m) => m && typeof m === 'object') : [];
      const inizio = isoValida(c.startedAt) ? c.startedAt
        : (messaggi[0] && isoValida(messaggi[0].ts) ? messaggi[0].ts : (isoValida(c.updatedAt) ? c.updatedAt : ora));
      eventi.push(crea(TIPI.CHAT_APERTA, { chat: c.id, onboarding: c.onboarding ? true : undefined },
        { ts: inizio, dispositivo, autore: 'utente' }));
      let ultimo = inizio;
      for (const m of messaggi) {
        const role = m.role === 'user' ? 'user' : 'filo';
        const msg = { ...m, role, text: String(m.text == null ? '' : m.text) };
        delete msg.ts;
        const ts = isoValida(m.ts) ? m.ts : ultimo;
        ultimo = ts;
        eventi.push(crea(TIPI.MESSAGGIO, { chat: c.id, msg }, { ts, dispositivo, autore: role === 'user' ? 'utente' : 'filo' }));
      }
      if (c.closedAt) {
        eventi.push(crea(TIPI.CHAT_CHIUSA, { chat: c.id }, {
          ts: isoValida(c.closedAt) ? c.closedAt : ultimo, dispositivo, autore: 'utente',
        }));
      }
      if (c.title || c.kind != null || c.titleByUser || c.kindByUser || c.triagedCount != null) {
        eventi.push(crea(TIPI.CHAT_TITOLO, {
          chat: c.id,
          title: typeof c.title === 'string' ? c.title : '',
          kind: c.kind ?? null,
          titleByUser: c.titleByUser ? true : undefined,
          kindByUser: c.kindByUser ? true : undefined,
          triagedCount: Number.isFinite(c.triagedCount) ? c.triagedCount : undefined,
        }, { ts: isoValida(c.closedAt) ? c.closedAt : ultimo, dispositivo, autore: c.titleByUser || c.kindByUser ? 'utente' : 'filo' }));
      }
    }
    return eventi;
  }

  // Chi ha fatto la cosa, da dove l'ha chiesta: dalla chat o dall'Aiuto la fa Filo, da una pagina o dall'interfaccia l'utente.
  function autoreDi(via) {
    if (via === 'chat' || via === 'assistente' || via === 'filo') return 'filo';
    if (via === 'automazione') return 'automazione';
    return 'utente';
  }

  // L'evento di un cambio, nella forma del registro (`{ id, ts, tipo, via, dove?, annulla?, cambi }`).
  function eventoCambio(e, { fonde = false, ts, dispositivo, id } = {}) {
    return crea(TIPI.CAMBIO, {
      cambio: e.id, ambito: e.tipo, via: e.via || 'filo',
      dove: stringa(e.dove) ? e.dove : undefined, annulla: stringa(e.annulla) ? e.annulla : undefined,
      cambi: (Array.isArray(e.cambi) ? e.cambi : []).map((c) => ({ ...c })), fonde: fonde ? true : undefined,
    }, { id, ts: ts || e.ts, dispositivo, autore: autoreDi(e.via) });
  }

  // Il registro dei cambi di prima (`filo_cambi` in storage.json) diventa eventi alla loro ora: un cambio ritoccato
  // porta anche la sua fusione, così ritrova l'ora dell'ultimo ritocco. Uno già nel filo non rientra.
  function daCambiSalvati(lista, { dispositivo, gia } = {}) {
    const visti = gia instanceof Set ? gia : new Set();
    const eventi = [];
    for (const e of Array.isArray(lista) ? lista : []) {
      if (!e || !stringa(e.id) || !stringa(e.tipo) || !Array.isArray(e.cambi) || visti.has(e.id)) continue;
      visti.add(e.id);
      const ts = isoValida(e.ts) ? e.ts : normaTs(e.ts);
      eventi.push(eventoCambio({ ...e, ts }, { dispositivo }));
      if (isoValida(e.agg) && e.agg !== ts && e.cambi.length) eventi.push(eventoCambio(e, { fonde: true, ts: e.agg, dispositivo }));
    }
    return eventi.filter(valido);
  }

  // Un giorno scritto senza ora («2026-10-02») vale per il giorno intero dell'utente, non dalla mezzanotte di Greenwich.
  function istante(x, { fineGiorno = false } = {}) {
    if (x == null || x === '') return null;
    const g = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x).trim());
    if (g) {
      const d = new Date(Number(g[1]), Number(g[2]) - 1, Number(g[3]));
      return fineGiorno ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1 : d.getTime();
    }
    const t = typeof x === 'number' ? x : Date.parse(x);
    return Number.isFinite(t) ? t : NaN;
  }

  // Il periodo che una cancellazione di pagine copre: un nome («ultima ora», «oggi», «ieri», «tutto»), le ultime N ore
  // o N giorni, o un intervallo qualsiasi (`da`/`a`, istanti o giorni) per «ieri sera» o «la settimana scorsa».
  function periodo(nome, { ore, giorni, da, a, ora } = {}) {
    const adesso = ora instanceof Date ? ora : new Date();
    const mezzanotte = new Date(adesso.getFullYear(), adesso.getMonth(), adesso.getDate());
    if ((da != null && da !== '') || (a != null && a !== '')) {
      const t0 = istante(da);
      const t1 = istante(a, { fineGiorno: true });
      if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
      const fine = t1 == null ? adesso.getTime() : Math.min(t1, adesso.getTime());
      if (t0 != null && t0 > fine) return null;
      return { da: t0 == null ? null : new Date(t0).toISOString(), a: new Date(fine).toISOString() };
    }
    const n = Number(ore);
    if (Number.isFinite(n) && n > 0) return { da: new Date(adesso.getTime() - n * ORA_MS).toISOString(), a: adesso.toISOString() };
    const gg = Number(giorni);
    if (Number.isFinite(gg) && gg > 0) return { da: new Date(adesso.getTime() - gg * 24 * ORA_MS).toISOString(), a: adesso.toISOString() };
    const p = String(nome || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (p === 'tutto' || p === 'tutte' || p === 'sempre') return { da: null, a: null };
    if (p === 'oggi') return { da: mezzanotte.toISOString(), a: adesso.toISOString() };
    if (p === 'ieri') {
      const ieri = new Date(mezzanotte.getFullYear(), mezzanotte.getMonth(), mezzanotte.getDate() - 1);
      return { da: ieri.toISOString(), a: new Date(mezzanotte.getTime() - 1).toISOString() };
    }
    if (p === 'ultima_ora' || p === 'ora') return { da: new Date(adesso.getTime() - ORA_MS).toISOString(), a: adesso.toISOString() };
    return null;
  }

  function pagineNelPeriodo(stato, pagine) {
    if (!pagine) return [];
    const sito = pagine.sito ? normaSito(pagine.sito) : null;
    return [...stato.pagine.values()].filter((p) => nelPeriodo(p.ts, pagine) && delSito(p.url, sito));
  }

  global.SN_FILO_EVENTI = {
    VERSIONE, TIPI, AUTORI, PERIODI,
    uuid, valido, crea, riga, analizza, analizzaRiga, nuovoStato, applica, compatta, elencoChat, copiaChat, dove,
    daChatSalvate, periodo, pagineNelPeriodo, nelPeriodo, normaSito, delSito, coperto,
    autoreDi, eventoCambio, daCambiSalvati, cambiDi, ACCADUTI, accadutiDi,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

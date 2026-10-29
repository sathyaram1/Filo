// Il contesto della chat come tratto del filo (#868): gli ultimi eventi entro i due tetti, i pezzi vecchi ripescati in
// coda. Logica pura: chi legge il filo e chiama i modelli è src/main/services/contestoFilo.js. Regole:
// patterns/il-contesto-e-la-coda-del-filo-e-il-prefisso-non-si-muove.md, sentinella tests/unit/filoContesto.test.mjs.

(function (global) {
  'use strict';

  const ORA_MS = 60 * 60 * 1000;
  const GIORNO_MS = 24 * ORA_MS;
  const TETTI_DI_SERIE = Object.freeze({ giorni: 3, token: 100000, cache: '1h' });
  const LIMITI = Object.freeze({ giorni: Object.freeze([0.5, 365]), token: Object.freeze([2000, 2000000]) });
  // Quanto vive la cache della parte fissa della chat (SPEC-CONTESTO § Le costanti): le sole due durate di Anthropic.
  const DURATE_CACHE = Object.freeze(['5m', '1h']);
  function durataIn(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return DURATE_CACHE.includes(s) ? s : null;
  }
  // Gli esiti delle letture e il ragionamento restano nel tratto vivo finché il tratto non si chiude (SPEC-CONTESTO § Gli
  // esiti degli strumenti): un messaggio passato non si riscrive. Qui resta la misura con cui la scheda confronta i suoi.
  const MESSAGGI_CON_ESITI = 20;
  // Una conversazione ripresa da prima dei tetti porta con sé i suoi ultimi messaggi, come faceva la chat da sola,
  // ma dentro il tetto in token: al più un quarto, e la finestra si stringe di quanto prendono.
  const MESSAGGI_DELLA_CHAT = 20;
  const QUOTA_RIPRESI = 0.25;
  const CARATTERI_PER_TOKEN = 3.5;
  // Oltre il tetto il taglio scende un quarto sotto: i turni dopo trovano lo stesso inizio, e la cache lo riusa.
  const RIENTRO = 0.75;
  // Le immagini mandate in chat tornano col loro messaggio finché vive come una lettura (#1166). Una foto pesa per i
  // tetti quanto una media fra i fornitori; i due tetti tengono la richiesta sotto i limiti dei fornitori.
  const TOKEN_PER_IMMAGINE = 1500;
  const MAX_IMMAGINI_RIMANDATE = 16;
  const MAX_CARATTERI_IMMAGINI = 24 * 1024 * 1024;
  // La domanda di questo turno fra i messaggi che partono (pianoDellaCache): il punto del tratto le sta subito prima.
  // Per identità: al modello non va. Se un segreto oscurato la ricopia, la si ritrova dall'intestazione.
  const DOMANDE = new WeakSet();

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
    const cu = durataIn(u.cache);
    const co = durataIn(o.cache);
    out.cache = cu ?? co ?? TETTI_DI_SERIE.cache;
    out.da.cache = cu != null ? 'utente' : (co != null ? 'predefiniti' : 'codice');
    return out;
  }

  function stimaToken(testo) {
    return Math.ceil(String(testo == null ? '' : testo).length / CARATTERI_PER_TOKEN);
  }

  // Un contenuto a parti (testo e immagini): le immagini contano per quello che costano, non per i caratteri del data URL.
  const parti = (c) => (Array.isArray(c) ? c.filter((p) => p && typeof p === 'object') : null);
  const soloImmagini = (p) => p.type === 'image_url';
  function tokenDi(content) {
    const ps = parti(content);
    if (!ps) return stimaToken(content);
    return ps.reduce((n, p) => n + (soloImmagini(p) ? TOKEN_PER_IMMAGINE : stimaToken(p.text)), 0);
  }
  function caratteriDi(messaggi) {
    return (Array.isArray(messaggi) ? messaggi : []).reduce((n, m) => {
      const c = m && m.content;
      const ps = parti(c);
      if (ps) return n + ps.reduce((k, p) => k + (soloImmagini(p) ? TOKEN_PER_IMMAGINE * CARATTERI_PER_TOKEN : String(p.text || '').length), 0);
      return n + (typeof c === 'string' ? c.length : JSON.stringify(c || '').length);
    }, 0);
  }

  function numeroImmagini(m) {
    const n = Math.floor(Number(m && m.images) || 0);
    return n > 0 ? Math.min(n, 999) : 0;
  }
  // Al posto delle immagini che non tornano: senza, il modello rinnegava quello che ne aveva letto (#1166).
  function notaImmagini(n, { altre = false } = {}) {
    if (altre) {
      return n === 1
        ? "(qui l'utente aveva mandato anche un'altra immagine che non hai più davanti: quello che ne hai scritto dopo l'avevi letto da lì. Se ti serve rivederla, chiedi di rimandarla.)"
        : `(qui l'utente aveva mandato anche altre ${n} immagini che non hai più davanti: quello che ne hai scritto dopo l'avevi letto da lì. Se ti serve rivederle, chiedi di rimandarle.)`;
    }
    return n === 1
      ? "(qui l'utente aveva mandato un'immagine che non hai più davanti: quello che ne hai scritto dopo l'avevi letto da lì. Se ti serve rivederla, chiedi di rimandarla.)"
      : `(qui l'utente aveva mandato ${n} immagini che non hai più davanti: quello che ne hai scritto dopo l'avevi letto da lì. Se ti serve rivederle, chiedi di rimandarle.)`;
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

  // Un messaggio da solo non riempie il contesto: oltre un quarto del tetto restano testa e coda, e si dice come
  // rileggere il resto (l'id intero: l'etichetta corta non basta a CERCA_CHAT).
  function tienilo(testo, tetto, chat) {
    const s = String(testo == null ? '' : testo);
    const max = Math.max(4000, Math.floor((tetto * CARATTERI_PER_TOKEN) / 4));
    if (s.length <= max) return s;
    const testa = s.slice(0, Math.floor(max * 0.6));
    const coda = s.slice(-Math.floor(max * 0.4));
    const tolti = s.length - testa.length - coda.length;
    const id = /^[\w.:-]{1,80}$/.test(String(chat || '')) ? String(chat) : '';
    const come = id ? `CERCA_CHAT con id "${id}", a pezzi con \`da\`` : 'CERCA_CHAT';
    return `${testa}\n…(${tolti} caratteri di questo messaggio non sono qui: si rileggono interi con ${come})…\n${coda}`;
  }

  function chiave(m) {
    return `${m.chat}|${m.ts}`;
  }

  // Il testo che la chat scrive nella conversazione venendo da fuori (l'esito di un comando dato in chat, il nome di un
  // file scaricato) è una lettura come le altre: imbustato, contato per le uscite (#587), con la vita delle letture.
  const ESTERNO_COMANDO = "dall'output di un comando";
  const daFuoriIl = (m) => !!m && m.role !== 'user' && typeof m.esterno === 'string' && !!m.esterno;
  function letturaDaFuori(m, comando = '') {
    if (!daFuoriIl(m)) return null;
    const text = String(m.text == null ? '' : m.text);
    if (m.esterno === ESTERNO_COMANDO) {
      const cmd = String(comando || '').replace(/^\//, '').trim();
      return { type: 'ESEGUI_COMANDO', command: cmd, _dallaChat: true, _executed: true, _output: { command: cmd, stdout: text, stderr: '' } };
    }
    return { type: 'TESTO_DI_FUORI', _executed: true, _output: { text, fonte: m.esterno, daFuori: [{ testo: text, fonte: m.esterno }] } };
  }
  // Lo stesso testo quando torna dall'archivio (un ricordo, una ricerca, una rilettura): l'azione che lo riporta lo
  // dichiara in `_output.daFuori`, e uscite e conferme lo contano come la lettura che era (urlExfil, actionLevels).
  // Così le parole scritte nell'Aiuto sopra un sito (`daPagina`, src/shared/filoApp.js → conProvenienza, #1508).
  const ESTERNO_AIUTO = "dall'Aiuto, in un messaggio scritto sopra un sito";
  const daPaginaIl = (m) => !!m && m.role === 'user' && m.daPagina === true;
  function daFuoriDi(messaggi) {
    return (Array.isArray(messaggi) ? messaggi : []).filter((m) => daFuoriIl(m) || daPaginaIl(m))
      .map((m) => ({ testo: String(m.text == null ? '' : m.text), fonte: daPaginaIl(m) ? ESTERNO_AIUTO : m.esterno }))
      .filter((x) => x.testo.trim());
  }

  // La risposta di Filo che l'utente cita col suo messaggio (#1620), già ritrovata nel filo (SN_RISPOSTA_A.risolvi). Un
  // testo arrivato da fuori resta fuori anche qui, come nel resto del filo: l'ora e l'id bastano a rileggerlo.
  function notaRisposta(r) {
    if (!r || typeof r !== 'object') return '';
    if (r.manca) return "(l'utente risponde a un tuo messaggio che nel filo non c'è più)";
    const dove = r.ts || r.chat ? ` ${intestazione(r.ts, r.chat)}` : '';
    const di = r.role === 'user' ? 'a un suo messaggio' : 'al tuo messaggio';
    if (r.esterno) {
      const come = r.chat ? `: si rilegge con CERCA_CHAT e l'id "${r.chat}"` : '';
      return `(l'utente risponde al testo arrivato ${r.esterno}${dove}${come})`;
    }
    const t = String(r.testo == null ? '' : r.testo).trim();
    return t ? `(l'utente risponde ${di}${dove}: «${t}»)` : `(l'utente risponde ${di}${dove})`;
  }

  // Una risposta di Filo riletta altrove vale la classe peggiore che la sua chat aveva letto (#1508); una salvata prima
  // del campo, la peggiore fra le fonti della chat. Testi da fuori e parole dell'utente li conta daFuoriDi.
  function classeDelMessaggio(m, fontiDellaChat = null) {
    if (!m || m.role === 'user' || daFuoriIl(m)) return 1;
    const c = Number(m.classeLetta);
    if (Number.isInteger(c) && c >= 1 && c <= 5) return c;
    let peggiore = 1;
    for (const f of Array.isArray(fontiDellaChat) ? fontiDellaChat : []) {
      const k = Number(f && f.classe);
      if (Number.isInteger(k) && k > peggiore && k <= 5) peggiore = k;
    }
    return peggiore;
  }
  function classeDelleRisposte(messaggi, fontiDellaChat = null) {
    let peggiore = 1;
    for (const m of Array.isArray(messaggi) ? messaggi : []) peggiore = Math.max(peggiore, classeDelMessaggio(m, fontiDellaChat));
    return peggiore;
  }

  // Le risposte di altre chat nel tratto (#1508) hanno la forma di una ricerca fra le chat, come i ricordi: stato, uscite e
  // accoglienza le contano uguali. `classeLetta` è già risolta da src/main/services/contestoFilo.js (messaggiDi).
  function trattoComeAzione(visti, { chatCorrente = null } = {}) {
    const altre = (Array.isArray(visti) ? visti : []).filter((m) => m && !m.riga && m.chat !== chatCorrente);
    const classe = classeDelleRisposte(altre);
    if (classe <= 1) return null;
    return { type: 'CERCA_CHAT', _tratto: true, _executed: true, _output: { tratto: true, classeLetta: classe } };
  }

  // Cosa porta nel compito una conversazione dell'archivio riletta per intero (#1508): i testi da fuori, le parole
  // dell'utente (per la regola dell'indirizzo scritto, #553) e la classe peggiore delle risposte di Filo.
  function provenienzaDellaChat(chat) {
    const A = global.SN_FILO_APP;
    const msgs = A ? A.conProvenienza(chat) : (Array.isArray(chat && chat.messages) ? chat.messages : []);
    return {
      daFuori: daFuoriDi(msgs),
      parole: msgs.filter((m) => m && m.role === 'user' && !m.daModello && !daPaginaIl(m)).map((m) => String(m.text || '')).join('\n'),
      classeLetta: classeDelleRisposte(msgs, chat && chat.fonti),
    };
  }

  // Di una conversazione trovata dalla ricerca torna solo il frammento: porta la lettura dei messaggi da cui viene. Se
  // non si riconosce da dove, vale la chat intera.
  function provenienzaDelFrammento(chat, frammento) {
    const A = global.SN_FILO_APP;
    const msgs = A ? A.conProvenienza(chat) : (Array.isArray(chat && chat.messages) ? chat.messages : []);
    const pezzo = String(frammento || '').replace(/^…|…$/g, '').trim();
    const da = pezzo ? msgs.filter((m) => m && String(m.text == null ? '' : m.text).replace(/\s+/g, ' ').includes(pezzo)) : [];
    const fuori = daFuoriDi(da);
    return {
      daFuori: fuori.length ? [{ testo: pezzo, fonte: fuori[0].fonte }] : [],
      classeLetta: classeDelleRisposte(da.length ? da : msgs, chat && chat.fonti),
    };
  }

  // `prima`: il messaggio che precede nel blocco. Ora e conversazione stanno sui messaggi dell'utente; su quelli di
  // Filo solo quando aprono un tratto di un'altra conversazione, così il modello non impara a scriverle nelle risposte.
  // `foto`: le immagini del messaggio che tornano davanti al modello in questo turno (la finestra decide quali).
  // `preambolo`: quello che Filo scrive in testa al messaggio dell'utente (src/shared/filoTrattoVivo.js); `dopo`: le note
  // del suo turno (l'origine delle immagini) che tornano con lui; `intero`: la domanda di adesso non si accorcia.
  function rendi(m, prima, { tetto, esito, osserva, foto = null, preambolo = '', dopo = null, intero = false }) {
    const cambia = !prima || prima.chat !== m.chat;
    const daFuori = daFuoriIl(m);
    const testo = daFuori ? '' : (intero ? String(m.text == null ? '' : m.text) : tienilo(m.text, tetto, m.chat));
    if (m.role === 'user') {
      const nota = notaRisposta(m.rispostaA);
      const pre = String(preambolo || '').trim();
      const detto = pre
        ? `${intestazione(m.ts, m.chat)}\n${pre}\n${nota ? `${nota}\n` : ''}${testo}`.trim()
        : `${intestazione(m.ts, m.chat)} ${nota ? `${nota}\n` : ''}${testo}`.trim();
      const note = (Array.isArray(dopo) ? dopo : []).map((x) => String(x || '').trim()).filter(Boolean);
      const quante = numeroImmagini(m);
      if (!quante) return { role: 'user', content: note.length ? `${detto}\n\n${note.join('\n\n')}` : detto };
      if (Array.isArray(foto) && foto.length) {
        const mancano = quante - foto.length;
        return {
          role: 'user',
          content: [
            { type: 'text', text: detto },
            ...foto.map((url) => ({ type: 'image_url', image_url: { url } })),
            ...(mancano > 0 ? [{ type: 'text', text: notaImmagini(mancano, { altre: true }) }] : []),
            ...note.map((text) => ({ type: 'text', text })),
          ],
        };
      }
      return { role: 'user', content: [`${detto}\n${notaImmagini(quante)}`, ...note].join('\n\n') };
    }
    const parti = [];
    if (cambia) parti.push(intestazione(m.ts, m.chat));
    if (testo.trim()) parti.push(testo);
    const tipi = Array.isArray(m.actions) ? m.actions.filter((t) => typeof t === 'string' && t) : [];
    // I ricordi ripescati da soli stanno nel messaggio dell'utente del loro turno, non qui.
    const azioni = esito && Array.isArray(esito.azioni) ? esito.azioni.filter((a) => !(a && a._auto)) : [];
    const oss = azioni.length && typeof osserva === 'function' ? osserva(azioni) : '';
    if (oss) parti.push(oss);
    else if (daFuori) parti.push(`(qui c'era un testo arrivato ${m.esterno}: non è più davanti, si rilegge con CERCA_CHAT e l'id ${m.chat})`);
    else if (tipi.length) parti.push(`(azioni di questo turno: ${tipi.join(', ')})`);
    // #778 — una finestra guardata resta un nome: quello che c'era non è conservato, e si riguarda se serve.
    if (!oss && Array.isArray(m.guardate) && m.guardate.length) {
      const E = global.SN_ESTERNO;
      const nomi = m.guardate.map((n) => `«${E ? E.perCanaleSistema(n) : String(n)}»`).join(', ');
      parti.push(`(qui avevo guardato ${nomi}: quello che c'era non è conservato)`);
    }
    const out = { role: 'assistant', content: parti.join('\n\n') || '(nessun testo)' };
    // Il ragionamento vive quanto gli esiti, su ogni risposta e in ogni scheda. Verso Claude parte solo col prefisso con
    // cui è nato (src/main/services/providers/ragionamentoRimandato.js).
    const rd = esito && Array.isArray(esito.reasoningDetails) && esito.reasoningDetails.length ? esito.reasoningDetails : null;
    if (rd) out.reasoning_details = rd;
    return out;
  }

  // Il turno di una risposta come è andato (strumenti, esiti, seguiti), quando la memoria lo ha ancora: torna così,
  // perché un turno passato riscritto rompe la cache da lì e il ragionamento nato dentro i suoi giri. Solo se nel tratto
  // la risposta segue la sua domanda: con un'altra conversazione in mezzo il giro non è più quello che il modello ha visto.
  function conGiro(m, prima, giro) {
    if (!giro || !Array.isArray(giro.messaggi) || !prima || prima.chat !== m.chat || prima.role !== 'user') return null;
    const finale = { role: 'assistant', content: String(giro.testo == null ? '' : giro.testo) || '(nessun testo)' };
    if (Array.isArray(giro.reasoningDetails) && giro.reasoningDetails.length) finale.reasoning_details = giro.reasoningDetails;
    return [...giro.messaggi, finale];
  }

  // Il tratto del filo che il modello ha davanti. `messaggi` è tutto il filo in ordine di tempo, senza la domanda di
  // adesso; `ancora` è l'inizio scelto al turno prima, che si tiene finché i tetti lo permettono.
  // `immagini(m)`: i data URL ancora in memoria del messaggio, o null. `preambolo(m)`: quello che Filo scrive in testa a
  // un messaggio dell'utente; `note(m)`: le note del suo turno. `giro(m)`: il turno di una risposta come è andato, e
  // `salta(m)`: i seguiti che quel turno porta già dentro.
  function finestra(messaggi, {
    ora = Date.now(), giorni, token, ancora = null, chatCorrente = null, esiti = null, osserva = null, immagini = null,
    preambolo = null, note = null, giro = null, salta = null,
  } = {}) {
    const lista0 = Array.isArray(messaggi) ? messaggi : [];
    const lista = typeof salta === 'function' ? lista0.filter((m) => !salta(m)) : lista0;
    const n = lista.length;
    const t0 = taglio(ora, giorni);
    const stessaAncora = ancora && ancora.giorni === giorni && ancora.token === token && Number.isFinite(Date.parse(ancora.ts));
    const da = Math.max(t0, stessaAncora ? Date.parse(ancora.ts) : -Infinity);
    let inizio = 0;
    while (inizio < n && Date.parse(lista[inizio].ts) < da) inizio++;
    // Il comando di un esito scritto in chat è l'ultima riga «/…» dell'utente nella sua conversazione.
    const comandi = new Array(n).fill('');
    const ultimoComando = new Map();
    for (let i = 0; i < n; i++) {
      const m = lista[i];
      if (m.role === 'user' && /^\//.test(String(m.text || ''))) ultimoComando.set(m.chat, String(m.text));
      else if (m.role !== 'user') comandi[i] = ultimoComando.get(m.chat) || '';
    }
    const esitoDi = (i) => {
      const e = esiti ? esiti(lista[i]) : null;
      const fuori = letturaDaFuori(lista[i], comandi[i]);
      return fuori ? { ...(e || {}), azioni: [...((e && e.azioni) || []), fuori] } : e;
    };
    // Le immagini tornano col loro messaggio, dalle più nuove, da `ancora.foto` in poi: oltre i tetti quelle prima
    // lasciano la nota, e il taglio scende di un quarto come per i token, così non riscrive il tratto a ogni foto nuova.
    const fotoDi = new Map();
    let fotoDa = stessaAncora && Number.isFinite(Date.parse(ancora.foto)) ? ancora.foto : null;
    if (typeof immagini === 'function') {
      const urlsDi = (m) => {
        if (m.role !== 'user' || !numeroImmagini(m)) return [];
        const date = immagini(m);
        return (Array.isArray(date) ? date : []).filter((u) => typeof u === 'string' && u);
      };
      // `scala`: la parte dei tetti da riempire. Un messaggio che non ci sta intero tiene le prime foto che ci stanno
      // nei tetti pieni solo se è il più nuovo con foto; altrimenti il taglio cade dopo di lui.
      const scegli = (da, scala) => {
        const out = new Map();
        let quante = 0;
        let caratteri = 0;
        let primo = null;
        for (let i = n - 1; i >= 0; i--) {
          const m = lista[i];
          if (da != null && Date.parse(m.ts) < Date.parse(da)) break;
          const urls = urlsDi(m);
          if (!urls.length) continue;
          const peso = urls.reduce((k, u) => k + u.length, 0);
          if (quante + urls.length <= MAX_IMMAGINI_RIMANDATE * scala && caratteri + peso <= MAX_CARATTERI_IMMAGINI * scala) {
            quante += urls.length;
            caratteri += peso;
            out.set(i, urls);
            primo = m.ts;
            continue;
          }
          if (scala === 1 || out.size) return { out, primo, oltre: true };
          const tenute = [];
          for (const u of urls) {
            if (tenute.length + 1 > MAX_IMMAGINI_RIMANDATE || caratteri + u.length > MAX_CARATTERI_IMMAGINI) break;
            caratteri += u.length;
            tenute.push(u);
          }
          if (tenute.length) out.set(i, tenute);
          return { out, primo: tenute.length ? m.ts : primo, oltre: true };
        }
        return { out, primo, oltre: false };
      };
      let scelta = scegli(fotoDa, 1);
      if (scelta.oltre) {
        scelta = scegli(null, RIENTRO);
        fotoDa = scelta.primo;
      }
      for (const [i, urls] of scelta.out) fotoDi.set(i, urls);
    }
    const opzioni = (i) => {
      const m = lista[i];
      if (m.role === 'user') {
        return {
          tetto: token, foto: fotoDi.get(i) || null, intero: typeof intero === 'function' && !!intero(m),
          preambolo: typeof preambolo === 'function' ? preambolo(m) : '', dopo: typeof note === 'function' ? note(m) : null,
        };
      }
      return { tetto: token, esito: esitoDi(i), osserva };
    };
    // Un messaggio diventa uno o più messaggi per il modello (una risposta col suo giro).
    const rendiIl = (i, prima) => {
      const m = lista[i];
      const g = m.role !== 'user' && typeof giro === 'function' ? conGiro(m, prima, giro(m)) : null;
      return g || [rendi(m, prima, opzioni(i))];
    };
    const memo = new Map();
    const pesa = (i) => {
      if (!memo.has(i)) memo.set(i, rendiIl(i, lista[i - 1]).reduce((k, x) => k + tokenDi(x.content), 0));
      return memo.get(i);
    };
    // La conversazione di questa scheda, se è ripresa da prima dei tetti: i suoi ultimi messaggi restano davanti,
    // dentro la loro quota. Il tetto in token vale per loro e per la finestra insieme.
    const mie = [];
    if (chatCorrente) for (let i = 0; i < n; i++) if (lista[i].chat === chatCorrente) mie.push(i);
    let mieDavanti = 0;
    while (mieDavanti < mie.length && mie[mieDavanti] < inizio) mieDavanti++;
    const riprendi = () => {
      const indici = [];
      let peso = 0;
      for (let k = mieDavanti - 1; k >= 0 && indici.length < MESSAGGI_DELLA_CHAT; k--) {
        const p = pesa(mie[k]);
        if (peso + p > token * QUOTA_RIPRESI) break;
        peso += p;
        indici.unshift(mie[k]);
      }
      return { indici, peso };
    };
    let ripresi = riprendi();
    let totale = 0;
    for (let i = inizio; i < n; i++) totale += pesa(i);
    if (totale + ripresi.peso > token) {
      while (inizio < n && totale + ripresi.peso > token * RIENTRO) {
        totale -= pesa(inizio);
        if (lista[inizio].chat === chatCorrente) { mieDavanti++; ripresi = riprendi(); }
        inizio++;
      }
    }
    const indici = [...ripresi.indici, ...Array.from({ length: n - inizio }, (_, k) => inizio + k)];
    const out = [];
    const azioni = [];
    // Gli esiti che avrebbe davanti anche una conversazione nuova: quelli fra gli ultimi messaggi di tutto il filo.
    const perUnaNuova = [];
    const visti = [];
    let prima = null;
    for (const i of indici) {
      const m = lista[i];
      const e = m.role !== 'user' ? esitoDi(i) : null;
      out.push(...rendiIl(i, prima));
      if (e && Array.isArray(e.azioni)) azioni.push(...e.azioni);
      if (e && Array.isArray(e.azioni) && n - i <= MESSAGGI_CON_ESITI) perUnaNuova.push(...e.azioni);
      visti.push(m);
      prima = m;
    }
    return {
      messaggi: out,
      visti,
      azioni,
      perUnaNuova,
      inizio,
      ripresi: ripresi.indici.length,
      vecchi: lista.slice(0, inizio),
      ultimo: visti.length ? visti[visti.length - 1] : null,
      ancora: inizio < n ? { ts: lista[inizio].ts, giorni, token } : (stessaAncora ? ancora : null),
      token: totale + ripresi.peso,
    };
  }

  // ── I pezzi vecchi ────────────────────────────────────────────────────────
  // Un tratto è uno scambio: un messaggio dell'utente e quello che Filo ha risposto, nella stessa conversazione.
  function tratti(messaggi, { titoli = null } = {}) {
    const out = [];
    const aperti = new Map();
    for (const m of Array.isArray(messaggi) ? messaggi : []) {
      // La riga di una conversazione di un'altra app (#974) non è uno scambio: lo scambio si cerca, non si ripesca.
      if (!m || !m.chat || m.riga) continue;
      let t = aperti.get(m.chat);
      if (m.role === 'user' || !t) {
        t = { chiave: chiave(m), chat: m.chat, ts: m.ts, fine: m.ts, righe: [], daFuori: [], classeLetta: 1, titolo: (titoli ? titoli(m.chat) : m.titolo) || '' };
        aperti.set(m.chat, t);
        out.push(t);
      }
      const testo = String(m.text || '').replace(/\s+/g, ' ').trim();
      if (testo) t.righe.push(`${m.role === 'user' ? 'Utente' : 'Filo'}: ${testo}`);
      t.daFuori.push(...daFuoriDi([m]));
      t.classeLetta = Math.max(t.classeLetta, classeDelMessaggio(m));
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

  // Senza vettori il ricordo va per parole, che è una prova debole: servono almeno due parole rare nelle conversazioni
  // vecchie nello stesso scambio, e vincono gli scambi che ne hanno di più. Una parola che compare in molte
  // conversazioni («grazie», «perfetto») non distingue niente; una che torna in tutta una conversazione sola (il suo
  // argomento) sì. Pretenderle tutte no (#868.8): «chiamava», detta una volta in un'altra chat, bloccava il ricordo.
  // Le parole di cortesia non sono mai l'argomento: rare finché sono state dette una volta sola, ripescherebbero quello
  // scambio a ogni «grazie mille». Fuori le parole che possono esserlo («chiaro» del tema, «accordo», «fine»).
  const MIN_PAROLE_RICORDO = 2;
  const QUOTA_PAROLA_COMUNE = 0.05;
  const PAROLE_DI_CORTESIA = new Set([
    'grazie', 'mille', 'tante', 'tantissimo', 'tantissime', 'infinite', 'ringrazio', 'ringraziamo', 'perfetto', 'perfetta',
    'perfetti', 'ottimo', 'ottima', 'benissimo', 'bene', 'okay', 'ciao', 'ciaociao', 'salve', 'prego', 'figurati',
    'figurarsi', 'certo', 'certamente', 'esatto', 'esattamente', 'giusto', 'capito', 'vabbe', 'vabene',
    "d'accordo", 'daccordo', 'buongiorno', 'buonasera', 'buonanotte', 'grandioso', 'fantastico',
    'splendido', 'gentilissimo', 'gentilissima', 'bravo', 'brava', 'bravissimo', 'bravissima', 'ahah',
    'ahahah', 'haha', 'hahaha', 'thanks', 'thank', 'great', 'cool', 'sure',
  ]);
  const diCortesia = (p) => PAROLE_DI_CORTESIA.has(String(p).replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''));
  function ricordiPerParole(domanda, tratti) {
    const CA = global.SN_CHAT_ARCHIVE;
    const lista = Array.isArray(tratti) ? tratti : [];
    if (!CA || !lista.length) return [];
    const pagliai = lista.map((t) => CA.normalizeForSearch(`${t.titolo || ''} ${t.testo || ''}`));
    const chat = new Set(lista.map((t) => t.chat)).size;
    const comune = Math.max(1, Math.floor(chat * QUOTA_PAROLA_COMUNE));
    const inQuante = (p) => new Set(lista.filter((_t, i) => CA.contieneTermine(pagliai[i], p)).map((t) => t.chat)).size;
    const parole = [...new Set(CA.terminiCheDistinguono(CA.paroleDi(domanda), domanda))]
      .filter((p) => !diCortesia(p))
      .filter((p) => { const n = inQuante(p); return n >= 1 && n <= comune; });
    if (parole.length < MIN_PAROLE_RICORDO) return [];
    const quante = pagliai.map((s) => parole.filter((p) => CA.contieneTermine(s, p)).length);
    const migliore = quante.reduce((m, n) => Math.max(m, n), 0);
    if (migliore < MIN_PAROLE_RICORDO) return [];
    const presi = lista.filter((_t, i) => quante[i] === migliore);
    return scegliRicordi(presi.slice(-MAX_RICORDI).map((t) => ({ tratto: t, score: 1 })));
  }

  // ── La finestra del modello ───────────────────────────────────────────────
  // Il rifiuto di un fornitore perché la richiesta supera la finestra del modello: null se è un altro errore.
  // Le misure, quando il messaggio le dice, servono a stringere il tratto quanto basta e non di più.
  const NUMERO = '(\\d[\\d,.\']*)';
  const numeroDa = (s, re) => {
    const m = s.match(re);
    const n = m ? Number(String(m[1]).replace(/[,.']/g, '')) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  function troppoLungo(err) {
    const st = Number(err && err.status);
    if (Number.isFinite(st) && st > 0 && ![400, 413, 422].includes(st)) return null;
    const s = String((err && (err.message || err.error)) || err || '');
    if (!/maximum context|context[ _-]?(length|window)|too many tokens|prompt is too long|input is too long|reduce the length of the (messages|prompt)/i.test(s)) return null;
    return {
      max: numeroDa(s, new RegExp(`maximum context (?:length|window) (?:is|of) ${NUMERO}`, 'i'))
        || numeroDa(s, new RegExp(`context (?:length|window|limit)[^0-9]{0,24}${NUMERO}`, 'i')),
      chiesti: numeroDa(s, new RegExp(`requested (?:about )?${NUMERO}`, 'i'))
        || numeroDa(s, new RegExp(`(?:prompt|input) (?:is|has|contains) ${NUMERO}`, 'i')),
    };
  }

  // Il rifiuto di una richiesta per le immagini che porta: modello di solo testo, troppe immagini, richiesta troppo grossa.
  function rifiutaImmagini(err) {
    const st = Number(err && err.status);
    if (st === 413) return true;
    if (Number.isFinite(st) && st > 0 && ![400, 404, 415, 422].includes(st)) return false;
    const s = String((err && (err.message || err.error)) || err || '');
    return /imag|vision|multi-?modal|content must be a string|payload too large|entity too large/i.test(s);
  }

  // Il tetto in token con cui riprovare dopo quel rifiuto. `caratteri`: tutta la richiesta; `caratteriTratto`: la
  // parte che si può stringere. Con le misure si va un po' sotto la finestra; senza, il tratto si dimezza.
  const MARGINE_FINESTRA = 0.85;
  function tettoDopoRifiuto({ max = null, chiesti = null, caratteri = 0, caratteriTratto = 0 } = {}) {
    const ct = Math.max(0, Number(caratteriTratto) || 0);
    if (!ct) return null;
    let restano = ct / 2;
    if (max && chiesti && chiesti > max && caratteri > 0) {
      restano = Math.min(ct * 0.9, (caratteri * (max / chiesti) * MARGINE_FINESTRA) - (caratteri - ct));
    }
    return Math.max(0, Math.floor(Math.max(0, restano) / CARATTERI_PER_TOKEN));
  }

  // Una rilettura (CERCA_CHAT con l'id) sta nella finestra fin dal primo tentativo (#868.7), con la richiesta già fatta
  // (`occupati`) e il tetto della risposta, che il fornitore conta dentro. Mai sotto il minimo: il resto si legge a pezzi.
  const RILETTURA_MIN = 8000;
  function capRilettura({ tetto = TETTI_DI_SERIE.token, finestra = null, occupati = 0, risposta = 0 } = {}) {
    let token = Number(tetto) > 0 ? Number(tetto) : TETTI_DI_SERIE.token;
    const f = Number(finestra);
    if (Number.isFinite(f) && f > 0) {
      const riserva = Math.min(Math.max(0, Number(risposta) || 0), f / 2);
      token = Math.min(token, f * MARGINE_FINESTRA - Math.max(0, Number(occupati) || 0) - riserva);
    }
    return Math.max(RILETTURA_MIN, Math.floor(token * CARATTERI_PER_TOKEN));
  }

  // Dopo un rifiuto per finestra, i caratteri che restano alle riletture del turno (null se già al minimo). Con la finestra
  // detta dal rifiuto vale la misura del primo tentativo: il turno dopo, che se le ritrova davanti, ci sta ancora.
  function rilettureDopoRifiuto({ max = null, chiesti = null, caratteri = 0, caratteriRiletture = 0, n = 1, risposta = 0, fuori = 0 } = {}) {
    const minimo = RILETTURA_MIN * Math.max(1, n);
    const cr = Math.max(0, Number(caratteriRiletture) || 0);
    if (cr <= minimo) return null;
    let resta = Math.floor((tettoDopoRifiuto({ max, chiesti, caratteri, caratteriTratto: cr }) || 0) * CARATTERI_PER_TOKEN);
    if (max) {
      const occupati = Math.ceil((Math.max(0, caratteri - cr) + Math.max(0, Number(fuori) || 0)) / CARATTERI_PER_TOKEN);
      resta = Math.min(resta, capRilettura({ tetto: Infinity, finestra: max, occupati, risposta }));
    }
    return Math.max(minimo, resta);
  }

  // Quello che il modello ha già davanti dall'archivio: i pezzi ripescati nei turni prima e le conversazioni rilette
  // per intero. Non si ripescano di nuovo (#868.1): le copie si accumulavano a ogni messaggio sullo stesso argomento.
  function giaDavanti(azioni) {
    const chiavi = new Set();
    const intere = new Set();
    for (const a of Array.isArray(azioni) ? azioni : []) {
      const o = a && String(a.type || '').toUpperCase() === 'CERCA_CHAT' ? a._output : null;
      if (!o || typeof o !== 'object') continue;
      if (o.automatica) {
        for (const r of Array.isArray(o.results) ? o.results : []) if (r && r.id && r.date) chiavi.add(`${r.id}|${r.date}`);
      }
      if (o.chatRead && o.found && o.intera) intere.add(String(o.chatRead));
    }
    return { chiavi, chat: intere };
  }

  // Ciò che l'utente ha cancellato non torna al modello dalle copie che ricerche e ricordi avevano messo nelle risposte
  // di altre conversazioni (#868.1): `chat(id)` e `pagina(p)` dicono se esiste ancora. Il resto dell'azione resta.
  function senzaCancellati(azioni, { chat = null, pagina = null } = {}) {
    if (!Array.isArray(azioni)) return azioni;
    let cambiate = 0;
    const out = azioni.map((a) => {
      const o = a && String(a.type || '').toUpperCase() === 'CERCA_CHAT' ? a._output : null;
      if (!o || typeof o !== 'object') return a;
      if ('chatRead' in o) {
        if (!o.found || typeof chat !== 'function' || chat(String(o.chatRead))) return a;
        cambiate++;
        return { ...a, _output: { chatRead: o.chatRead, found: false, cancellata: true } };
      }
      const results = Array.isArray(o.results) ? o.results : [];
      const pagine = Array.isArray(o.pagine) ? o.pagine : [];
      const restano = typeof chat === 'function' ? results.filter((r) => !r || !r.id || chat(String(r.id))) : results;
      const pagineRestano = typeof pagina === 'function' ? pagine.filter((p) => !p || pagina(p)) : pagine;
      const tolti = (results.length - restano.length) + (pagine.length - pagineRestano.length);
      if (!tolti) return a;
      cambiate++;
      return {
        ...a,
        _output: { ...o, results: restano, ...('pagine' in o ? { pagine: pagineRestano } : {}), cancellati: (Number(o.cancellati) || 0) + tolti },
      };
    });
    return cambiate ? out : azioni;
  }

  function testoRicordo(t) {
    const s = String(t.testo || '');
    if (s.length <= CARATTERI_RICORDO) return s;
    return `${s.slice(0, Math.floor(CARATTERI_RICORDO * 0.7))}\n…(il resto si rilegge con CERCA_CHAT e l'id ${t.chat})…\n${s.slice(-Math.floor(CARATTERI_RICORDO * 0.3))}`;
  }

  // I pezzi vecchi ripescati da soli hanno la forma di una ricerca fra le chat: il blocco di attività li racconta, le
  // uscite li contano fra le cose lette (#587), la chat riaperta li ritrova, e `giaDavanti` li riconosce al turno dopo.
  function ricordoComeAzione(ricordi, ora = Date.now()) {
    const lista = Array.isArray(ricordi) ? ricordi : [];
    // Lo stesso testo che il modello ha davanti (testa e coda), così le uscite contano tutto quello che ha letto.
    const results = lista.map((r) => ({ id: r.tratto.chat, title: r.tratto.titolo || '', date: r.tratto.ts, snippet: testoRicordo(r.tratto) }));
    const daFuori = lista.flatMap((r) => (Array.isArray(r.tratto.daFuori) ? r.tratto.daFuori : []));
    const classeLetta = lista.reduce((c, r) => Math.max(c, Number(r.tratto.classeLetta) || 1), 1);
    return {
      type: 'CERCA_CHAT', _auto: true, _callId: `ricordo_${Number(ora).toString(36)}`, _executed: true,
      _output: { automatica: true, results, ...(daFuori.length ? { daFuori } : {}), ...(classeLetta > 1 ? { classeLetta } : {}) },
    };
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

  // La richiesta della chat nei quattro blocchi di SPEC-CONTESTO § La richiesta: strumenti (a parte), system con la
  // parte fissa e il CONTESTO dell'utente, il tratto vivo che finisce con la domanda, il giro di strumenti di adesso.
  function richiesta({ sistema = '', tratto = [], scheda = [], domanda = null, giro = [] } = {}) {
    const out = [{ role: 'system', content: String(sistema || '') }, ...tratto, ...scheda];
    if (domanda) {
      DOMANDE.add(domanda);
      out.push(domanda);
    }
    return out.concat(Array.isArray(giro) ? giro : []);
  }

  // Anthropic rifiuta un punto di cache su un testo vuoto o di soli spazi.
  function haTesto(m) {
    if (!m) return false;
    if (typeof m.content === 'string') return m.content.trim() !== '';
    return Array.isArray(m.content) && m.content.some((p) => p && p.type === 'text' && String(p.text || '').trim());
  }

  const INTESTAZIONE_RE = new RegExp(`^\\[(${GIORNI.join('|')}) \\d`);
  const testoIniziale = (m) => {
    if (!m) return '';
    if (typeof m.content === 'string') return m.content;
    const p = Array.isArray(m.content) ? m.content.find((x) => x && x.type === 'text') : null;
    return p ? String(p.text || '') : '';
  };
  // La domanda fra i messaggi che partono: per identità, o l'ultimo messaggio dell'utente con l'ora e la chat in testa.
  function indiceDellaDomanda(messages) {
    const i = messages.findIndex((m) => m && DOMANDE.has(m));
    if (i > 0) return i;
    for (let k = messages.length - 1; k > 0; k--) {
      const m = messages[k];
      if (m && m.role === 'user' && INTESTAZIONE_RE.test(testoIniziale(m))) return k;
    }
    return -1;
  }

  // Dove la richiesta della chat smette di ripetersi (SPEC-CONTESTO § La richiesta): fine della parte fissa e fine del
  // CONTESTO dell'utente (tutte e due della durata scelta), fine del tratto prima della domanda, ultimo messaggio. Anthropic
  // ne prende al più quattro. Solo la chat e il correttore: un prompt che cambia a ogni chiamata pagherebbe scritture mai
  // rilette. `caratteri` divide il testo del messaggio e il punto va sulla parte prima. Sentinella:
  // tests/unit/puntiDiCache.test.mjs. `durata`: '5m' o '1h' (da tetti().cache); assente o non valida vale quella di serie.
  function pianoDellaCache(action, messages, { durata } = {}) {
    const C = global.SN_CONST;
    if (!C || !C.ACTIONS || !Array.isArray(messages) || !messages.length) return null;
    // Il correttore (#1580): le regole nel system, uguali a ogni chiamata; il testo che cambia sta dopo. Cinque minuti
    // bastano a chi scrive, e la durata della chat è una scelta sulla chat.
    if (action === C.ACTIONS.SPELLCHECK_SEMANTIC || action === C.ACTIONS.SPELLCHECK_CONTEXT) {
      const sys = messages[0];
      return sys && sys.role === 'system' && haTesto(sys) && messages.length > 1 ? { punti: [{ indice: 0 }] } : null;
    }
    if (action !== C.ACTIONS.FILO_CHAT) return null;
    const punti = [];
    const sys = messages[0];
    const lunga = (durataIn(durata) || TETTI_DI_SERIE.cache) === '1h' ? { durata: '1h' } : {};
    if (sys && sys.role === 'system' && typeof sys.content === 'string') {
      const testo = sys.content;
      const utente = C.INIZIO_PARTE_UTENTE ? testo.indexOf(C.INIZIO_PARTE_UTENTE) : -1;
      // Quello che nel ripiego senza filo cambia a ogni turno (l'ora, l'intervista) sta in fondo, fuori dai punti.
      const variabili = [C.INIZIO_ACCOGLIENZA, C.INIZIO_CONTESTO_CHAT].filter(Boolean).map((x) => testo.indexOf(x)).filter((i) => i > 0 && i > utente);
      const fine = variabili.length ? Math.min(...variabili) : testo.length;
      const punto = (n) => (n < testo.length ? { indice: 0, caratteri: n, ...lunga } : { indice: 0, ...lunga });
      if (utente > 0 && testo.slice(0, utente).trim()) punti.push(punto(utente));
      if (testo.slice(Math.max(0, utente), fine).trim()) punti.push(punto(fine));
    }
    const iDomanda = indiceDellaDomanda(messages);
    let fineTratto = iDomanda > 0 ? iDomanda - 1 : -1;
    while (fineTratto > 0 && !haTesto(messages[fineTratto])) fineTratto--;
    if (fineTratto > 0) punti.push({ indice: fineTratto });
    let ultimo = messages.length - 1;
    while (ultimo > 0 && !haTesto(messages[ultimo])) ultimo--;
    if (ultimo > 0 && !punti.some((p) => p.indice === ultimo)) punti.push({ indice: ultimo });
    return punti.length ? { punti } : null;
  }

  global.SN_FILO_CONTESTO = {
    TETTI_DI_SERIE, LIMITI, DURATE_CACHE, durataIn, CARATTERI_PER_TOKEN, MESSAGGI_CON_ESITI, MESSAGGI_DELLA_CHAT, QUOTA_RIPRESI, SOGLIA_RICORDO, MAX_RICORDI,
    TOKEN_PER_IMMAGINE, MAX_IMMAGINI_RIMANDATE, MAX_CARATTERI_IMMAGINI, tokenDi, caratteriDi, numeroImmagini, notaImmagini, notaRisposta,
    tetti, numeroIn, stimaToken, taglio, passoTaglio, etichettaChat, quando, intestazione, chiave,
    ESTERNO_COMANDO, ESTERNO_AIUTO, letturaDaFuori, daFuoriDi, classeDelMessaggio, classeDelleRisposte, trattoComeAzione,
    provenienzaDellaChat, provenienzaDelFrammento, finestra, tratti, testoPerIndice, scegliRicordi, ricordiPerParole, testoRicordo, rendiRicordi,
    troppoLungo, tettoDopoRifiuto, rifiutaImmagini, pianoDellaCache, richiesta, indiceDellaDomanda, rendiMessaggio: rendi, conGiro,
    RILETTURA_MIN, capRilettura, rilettureDopoRifiuto, giaDavanti, senzaCancellati, ricordoComeAzione,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

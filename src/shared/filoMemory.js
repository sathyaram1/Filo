// Persistenza del sistema di memoria di Filo.
//
// Due livelli (vedi filo-architettura.md sezione 4; lo storico delle interazioni è il filo, #866):
//   - lessons buffer: lezioni estratte dall'agente Creatore Lezioni, in attesa
//     di compattazione (svuotato dal Compattatore quando supera 3000 char).
//   - moduli: PROFILO, PREFERENZE, e N espansioni dinamiche. Sempre persistenti.
//
// In aggiunta gestiamo qui anche due store legati alla dashboard:
//   - timers: countdown attivi (azione TIMER).
//   - notifications: avvisi, carte della colonna sinistra della home.
//
// Gli appunti NON stanno più qui: l'azione SALVA_APPUNTO li scrive nei file
// dell'editor (src/main/services/editorFiles.js), che è anche l'unico posto che
// conosce ancora il vecchio archivio, per svuotarlo una volta sola alla prima
// partenza dopo l'aggiornamento.
//
// Caricato nel service worker via importScripts e nelle pagine via <script>.

(function (global) {
  'use strict';

  const KEYS = global.SN_CONST.STORAGE_KEYS;

  // Quando il buffer di lezioni supera questa soglia in caratteri, il
  // Compattatore va eseguito (vedi spec sezione 4.2).
  const LESSONS_BUFFER_TRIGGER_CHARS = 3000;
  // Cap difensivo per le notifiche.
  const NOTIFICATIONS_CAP = 100;

  function uuid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Tronca senza spezzare un carattere: `slice` conta unità UTF-16 e taglierebbe un'emoji
  // a metà, cioè un glifo rotto nell'etichetta di un timer. Ripiego a code point.
  function truncateSafe(str, max) {
    const s = String(str == null ? '' : str);
    let units;
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        units = Array.from(seg.segment(s), (g) => g.segment);
      } else {
        units = Array.from(s);
      }
    } catch {
      units = Array.from(s);
    }
    if (units.length <= max) return s;
    return units.slice(0, max).join('');
  }

  async function getRaw(key, fallback) {
    const res = await chrome.storage.local.get(key);
    return res[key] === undefined ? fallback : res[key];
  }
  async function setRaw(key, value) {
    await chrome.storage.local.set({ [key]: value });
    if ((key === KEYS.FILO_MEMORY || key === KEYS.FILO_LESSONS_BUFFER || key === KEYS.FILO_KEEP_OPEN || key === KEYS.FILO_MEMORY_FONTI) && onMemoriaCambiata) {
      try { onMemoriaCambiata(); } catch (_) {}
    }
  }

  // Il main avvisa da qui le pagine che mostrano la memoria (Preferenze, #592).
  let onMemoriaCambiata = null;
  function setOnMemoryChange(fn) { onMemoriaCambiata = typeof fn === 'function' ? fn : null; }

  // ===== Lessons buffer =====

  async function getLessonsBuffer() {
    return getRaw(KEYS.FILO_LESSONS_BUFFER, []);
  }

  const Q = () => global.SN_QUADERNO;

  // Lezioni, righe e fonti si rileggono e riscrivono intere: le scritture vanno in fila, o la lezione arrivata mentre
  // l'utente toglie una riga se la mangia (patterns/chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md).
  let codaMemoria = Promise.resolve();
  function inCodaMemoria(fn) {
    const r = codaMemoria.then(fn, fn);
    codaMemoria = r.then(() => {}, () => {});
    return r;
  }
  const inFila = (fn) => (...a) => inCodaMemoria(() => fn(...a));

  // `fonti`: gli eventi del filo da cui la lezione è nata (#872). Una lezione che ridice una riga tolta dall'utente,
  // dallo stesso tratto del filo, non entra.
  async function appendLesson(lesson, { fonti = [] } = {}) {
    const buf = await getLessonsBuffer();
    const text = String(lesson || '').trim();
    const f = Q() ? Q().unisci(fonti) : [];
    if (f.length && Q() && Q().tornaDaTolta(text, f, (await getFonti()).nascoste)) return buf;
    buf.push({ ts: new Date().toISOString(), text, ...(f.length ? { fonti: f } : {}) });
    await setRaw(KEYS.FILO_LESSONS_BUFFER, buf);
    return buf;
  }

  // ===== Quaderno delle memorie (#872) =====

  async function getFonti() {
    const m = await getRaw(KEYS.FILO_MEMORY_FONTI, null);
    return Q() ? Q().normaMeta(m) : { righe: {}, nascoste: [] };
  }

  async function setFonti(meta) {
    await setRaw(KEYS.FILO_MEMORY_FONTI, meta);
  }

  // Ogni cambio dell'utente (correggere, togliere, rimettere, svuotare) sale di versione: un compattatore partito prima
  // non scrive sopra quello che l'utente ha fatto mentre il modello lavorava (applicaCompattazione).
  function toccata(meta) {
    meta.versione = (Number.isFinite(meta.versione) ? meta.versione : 0) + 1;
    return meta;
  }

  // Le lezioni ancora da riordinare che ridicono una riga appena tolta o corretta, dallo stesso tratto, se ne vanno con
  // lei: il compattatore la riscriverebbe com'era.
  async function togliLezioniSimili(testo, fonti) {
    if (!Q() || !Array.isArray(fonti) || !fonti.length) return;
    const buf = await getLessonsBuffer();
    const resta = buf.filter((l) => !(l && Q().tornaDaTolta(l.text, Q().unisci(l.fonti), [{ testo, fonti }])));
    if (resta.length !== buf.length) await setRaw(KEYS.FILO_LESSONS_BUFFER, resta);
  }

  // Toglie una riga dalla memoria senza buttarla: finisce fra le nascoste del quaderno, con le sue fonti, e da lì si
  // rimette o si cancella per sempre. Il prompt non la vede più dal messaggio dopo. Torna l'id della nascosta, o null.
  // `fonti`: come per editLine, per ritrovare la riga sotto un campo rimasto aperto mentre il compattatore la riordinava.
  async function hideLine(via, { fonti = [] } = {}) {
    const ora = new Date().toISOString();
    if (via && via.lezione && typeof via.lezione === 'object') {
      const buf = await getLessonsBuffer();
      const i = buf.findIndex((l) => l && l.ts === via.lezione.ts && l.text === via.lezione.text);
      if (i < 0) {
        const e = await erede(via.lezione.text, fonti);
        return e ? hideLine(e) : null;
      }
      const [l] = buf.splice(i, 1);
      await setRaw(KEYS.FILO_LESSONS_BUFFER, buf);
      const meta = await getFonti();
      const n = { id: uuid(), testo: l.text, lezione: true, fonti: Q() ? Q().unisci(l.fonti) : [], nata: l.ts || null, tolta: ora };
      meta.nascoste.push(n);
      await setFonti(toccata(meta));
      await togliLezioniSimili(n.testo, n.fonti);
      return n.id;
    }
    if (via && typeof via.modulo === 'string' && typeof via.riga === 'string') {
      const mem = await getMemory();
      const testo = typeof mem[via.modulo] === 'string' ? mem[via.modulo] : null;
      if (!via.riga.trim()) return null;
      const righe = testo == null ? [] : testo.split(/\r?\n/);
      const i = righe.findIndex((r) => r.trim() === via.riga.trim());
      if (i < 0) {
        const e = await erede(via.riga, fonti);
        return e ? hideLine(e) : null;
      }
      const [tolta] = righe.splice(i, 1);
      await setMemory({ ...mem, [via.modulo]: righe.join('\n').trim() });
      const meta = await getFonti();
      const m = Q() ? Q().metaDi(meta, via.modulo, tolta) : null;
      if (m) meta.righe[via.modulo] = meta.righe[via.modulo].filter((x) => x !== m);
      const n = { id: uuid(), testo: tolta.trim(), modulo: via.modulo, fonti: m ? m.fonti : [], nata: m ? m.nata : null, tolta: ora };
      meta.nascoste.push(n);
      await setFonti(toccata(meta));
      await togliLezioniSimili(n.testo, n.fonti);
      return n.id;
    }
    return null;
  }

  // Che riga è e quando è nata, per i contatori (#1467): il modulo e la data, mai il testo.
  async function descriviRiga(via) {
    if (via && via.lezione && typeof via.lezione === 'object') return { modulo: '', lezione: true, nata: via.lezione.ts || null };
    if (!via || typeof via.modulo !== 'string' || typeof via.riga !== 'string') return null;
    const m = Q() ? Q().metaDi(await getFonti(), via.modulo, via.riga) : null;
    return { modulo: via.modulo, lezione: false, nata: (m && m.nata) || null };
  }
  async function descriviNascosta(id) {
    const n = (await getFonti()).nascoste.find((x) => x.id === id);
    return n ? { modulo: n.modulo || 'PREFERENZE', lezione: !!n.lezione, nata: n.nata || null } : null;
  }

  // Una nascosta torna dov'era: nel suo modulo, o fra le lezioni da riordinare.
  async function restoreHidden(id) {
    const meta = await getFonti();
    const n = meta.nascoste.find((x) => x.id === id);
    if (!n || !n.testo) return false;
    meta.nascoste = meta.nascoste.filter((x) => x !== n);
    if (n.lezione) {
      const buf = await getLessonsBuffer();
      buf.push({ ts: n.nata || new Date().toISOString(), text: n.testo, ...(n.fonti.length ? { fonti: n.fonti } : {}) });
      await setRaw(KEYS.FILO_LESSONS_BUFFER, buf);
    } else {
      const nome = n.modulo || 'PREFERENZE';
      const mem = await getMemory();
      const prima = typeof mem[nome] === 'string' ? mem[nome].trim() : '';
      await setMemory({ ...mem, [nome]: prima ? `${prima}\n${n.testo}` : n.testo });
      meta.righe[nome] = [...(meta.righe[nome] || []), { testo: n.testo, fonti: n.fonti, nata: n.nata || null }];
    }
    await setFonti(toccata(meta));
    return true;
  }

  // Per sempre: il testo se ne va dal disco. Restano solo gli id del tratto da cui era nata, perché da lì non ritorni.
  async function forgetHiddenForever(id) {
    const meta = await getFonti();
    const n = meta.nascoste.find((x) => x.id === id);
    if (!n) return false;
    meta.nascoste = n.fonti.length
      ? meta.nascoste.map((x) => (x === n ? { id: n.id, fonti: n.fonti, tolta: n.tolta, perSempre: true } : x))
      : meta.nascoste.filter((x) => x !== n);
    await setFonti(meta);
    return true;
  }

  // La riga che il compattatore ha appena fatto da una lezione o da una riga sotto un campo ancora aperto: stesse fonti
  // e stesso senso, e una sola. Senza fonti non si indovina.
  async function erede(vecchio, fonti) {
    const f = Q() ? Q().unisci(fonti) : [];
    if (!f.length || !vecchio) return null;
    const mem = await getMemory();
    const meta = await getFonti();
    const trovate = [];
    for (const [nome, v] of Object.entries(mem || {})) {
      if (typeof v !== 'string') continue;
      for (const riga of Q().righeDi(v)) {
        const m = Q().metaDi(meta, nome, riga);
        if (m && Q().contenute(f, m.fonti) && Q().stessoSenso(riga, vecchio)) trovate.push({ modulo: nome, riga });
      }
    }
    return trovate.length === 1 ? trovate[0] : null;
  }

  // La correzione dell'utente prende il posto della riga e tiene le sue fonti: vale dal messaggio dopo, e il
  // compattatore la riporta com'è. `testo` arriva già controllato (tetto e caratteri, SN_PREF.lezioneDaAzione).
  // `fonti`: gli eventi che il quaderno mostrava per la riga, per ritrovarla se nel frattempo è stata riordinata.
  async function editLine(via, testo, { fonti = [] } = {}) {
    const nuovo = String(testo || '').trim();
    if (!nuovo || /[\r\n]/.test(nuovo)) return false;
    const ora = new Date().toISOString();
    if (via && via.lezione && typeof via.lezione === 'object') {
      const buf = await getLessonsBuffer();
      const i = buf.findIndex((l) => l && l.ts === via.lezione.ts && l.text === via.lezione.text);
      if (i < 0) {
        const e = await erede(via.lezione.text, fonti);
        return e ? editLine(e, nuovo) : false;
      }
      const vecchia = buf[i];
      buf[i] = { ...vecchia, text: nuovo, corretta: ora };
      await setRaw(KEYS.FILO_LESSONS_BUFFER, buf);
      await setFonti(toccata(await getFonti()));
      return true;
    }
    if (via && typeof via.modulo === 'string' && typeof via.riga === 'string') {
      const mem = await getMemory();
      const testoMod = typeof mem[via.modulo] === 'string' ? mem[via.modulo] : null;
      if (testoMod == null) return false;
      const righe = testoMod.split(/\r?\n/);
      const i = righe.findIndex((r) => r.trim() === via.riga.trim());
      if (i < 0) {
        const e = await erede(via.riga, fonti);
        return e ? editLine(e, nuovo) : false;
      }
      const meta = await getFonti();
      const m = Q() ? Q().metaDi(meta, via.modulo, via.riga) : null;
      const lista = (meta.righe[via.modulo] || []).filter((x) => x !== m);
      // Corretta in una riga che c'è già: ne resta una, con le fonti di tutte e due (due righe uguali il quaderno non
      // le sa distinguere).
      const doppia = righe.findIndex((r, j) => j !== i && Q().norma(r) && Q().norma(r) === Q().norma(nuovo));
      let riga;
      if (doppia >= 0) {
        const altra = Q().metaDi(meta, via.modulo, righe[doppia]);
        const nate = [altra && altra.nata, m && m.nata].filter(Boolean).sort();
        riga = { testo: righe[doppia].trim(), fonti: Q().unisci(altra ? altra.fonti : [], m ? m.fonti : []), nata: nate[0] || null, corretta: ora };
        righe.splice(i, 1);
        meta.righe[via.modulo] = [...lista.filter((x) => x !== altra), riga];
      } else {
        righe[i] = nuovo;
        riga = { testo: nuovo, fonti: m ? m.fonti : [], nata: m ? m.nata : null, corretta: ora };
        meta.righe[via.modulo] = [...lista, riga];
      }
      await setMemory({ ...mem, [via.modulo]: righe.join('\n').trim() });
      await setFonti(toccata(meta));
      await togliLezioniSimili(via.riga, riga.fonti);
      return true;
    }
    return false;
  }

  // Il quaderno come lo legge l'utente: ogni riga col suo `via`, la data in cui è nata e gli eventi del filo da cui
  // viene; le nascoste a parte (quelle cancellate per sempre non hanno più niente da mostrare).
  async function quaderno() {
    const mem = await getMemory();
    const meta = await getFonti();
    const moduli = Object.entries(mem || {}).filter(([, v]) => typeof v === 'string').map(([nome, v]) => ({
      nome,
      righe: v.split(/\r?\n/).map((r) => r.trim()).filter(Boolean).map((riga) => {
        const m = Q() ? Q().metaDi(meta, nome, riga) : null;
        return { testo: riga, via: { modulo: nome, riga }, nata: m ? m.nata : null, fonti: m ? m.fonti : [], corretta: (m && m.corretta) || null };
      }),
    }));
    const lezioni = (await getLessonsBuffer()).filter((l) => l && typeof l.text === 'string' && l.text.trim())
      .map((l) => ({ testo: l.text, via: { lezione: { ts: l.ts, text: l.text } }, nata: l.ts || null, fonti: Q() ? Q().unisci(l.fonti) : [], corretta: l.corretta || null }));
    const keep = await listKeepOpen();
    const sempreAperte = Object.keys(keep).sort().map((host) => ({ host, ts: keep[host] && keep[host].ts ? keep[host].ts : null }));
    const nascoste = meta.nascoste.filter((n) => n.testo).map((n) => ({
      id: n.id, testo: n.testo, modulo: n.modulo || null, lezione: !!n.lezione, nata: n.nata || null, tolta: n.tolta || null, fonti: n.fonti,
    }));
    return { moduli, lezioni, sempreAperte, nascoste };
  }

  async function svuotaQuaderno() {
    const { versione } = await getFonti();
    await setFonti(toccata({ righe: {}, nascoste: [], versione }));
  }

  // Quello che il compattatore deve sapere delle righe tolte: testo (se c'è ancora) e fonti.
  async function righeTolte() {
    return (await getFonti()).nascoste.map((n) => ({ testo: n.testo || '', fonti: n.fonti }));
  }

  // Dopo il compattatore: i moduli toccati prendono testo e righe del quaderno insieme, e dal buffer escono solo le
  // lezioni che ha letto (quelle arrivate mentre lavorava aspettano il giro dopo). Se mentre il modello scriveva
  // l'utente ha corretto, tolto o rimesso una riga (`versione` letta all'inizio), l'uscita non si applica: memoria e
  // lezioni restano come le ha lasciate lui, e il giro dopo riparte da lì. Torna se l'ha applicata.
  async function applicaCompattazione({ patch, righe, usate = [], versione }) {
    const meta = await getFonti();
    if (Number.isFinite(versione) && (meta.versione || 0) !== versione) return false;
    if (patch && Object.keys(patch).length) {
      const testi = {};
      for (const [nome, testo] of Object.entries(patch)) {
        const l = (righe && righe[nome]) || Q().righeDi(testo).map((t) => ({ testo: t, fonti: [], nata: null }));
        testi[nome] = l.map((r) => r.testo).join('\n');
        meta.righe[nome] = l;
      }
      await patchMemory(testi);
      await setFonti(meta);
    }
    const via = new Set((Array.isArray(usate) ? usate : []).map((l) => `${l && l.ts}|${l && l.text}`));
    const buf = await getLessonsBuffer();
    const resta = buf.filter((l) => !via.has(`${l && l.ts}|${l && l.text}`));
    if (resta.length !== buf.length) await setRaw(KEYS.FILO_LESSONS_BUFFER, resta);
    return true;
  }

  async function lessonsBufferShouldCompact() {
    const buf = await getLessonsBuffer();
    const totalChars = buf.reduce((acc, l) => acc + (l.text?.length || 0), 0);
    return totalChars >= LESSONS_BUFFER_TRIGGER_CHARS;
  }

  async function clearLessonsBuffer() {
    await setRaw(KEYS.FILO_LESSONS_BUFFER, []);
  }

  // Toglie UNA lezione, riconosciuta da data e testo: una pagina rimasta indietro
  // non deve poter togliere la riga sbagliata. Torna se l'ha trovata (#592).
  async function forgetLesson({ ts, text } = {}) {
    const buf = await getLessonsBuffer();
    const i = buf.findIndex((l) => l && l.ts === ts && l.text === text);
    if (i < 0) return false;
    buf.splice(i, 1);
    await setRaw(KEYS.FILO_LESSONS_BUFFER, buf);
    return true;
  }

  // ===== Moduli =====

  // Forma in storage: { PROFILO: "...", PREFERENZE: "...", <ESPANSIONE>: "..." }
  async function getMemory() {
    const mem = await getRaw(KEYS.FILO_MEMORY, null);
    if (mem && typeof mem === 'object') return mem;
    return { PROFILO: '', PREFERENZE: '' };
  }

  // Una riga detta due volte nello stesso modulo è una riga sola: il quaderno riconosce le righe dal testo.
  function senzaDoppie(testo) {
    const viste = new Set();
    return testo.split(/\r?\n/).filter((r) => {
      const k = Q() ? Q().norma(r) : r.trim();
      if (!k) return true;
      if (viste.has(k)) return false;
      viste.add(k);
      return true;
    }).join('\n');
  }

  async function setMemory(memory) {
    const pulita = memory && typeof memory === 'object'
      ? Object.fromEntries(Object.entries(memory).map(([k, v]) => [k, typeof v === 'string' ? senzaDoppie(v) : v]))
      : memory;
    await setRaw(KEYS.FILO_MEMORY, pulita);
  }

  // Toglie UNA riga da un modulo, riconosciuta dal testo esatto. Torna se c'era.
  async function forgetModuleLine(nome, riga) {
    const mem = await getMemory();
    const testo = mem && typeof mem[nome] === 'string' ? mem[nome] : null;
    if (testo == null || typeof riga !== 'string' || !riga.trim()) return false;
    const righe = testo.split(/\r?\n/);
    const i = righe.findIndex((r) => r.trim() === riga.trim());
    if (i < 0) return false;
    righe.splice(i, 1);
    await setMemory({ ...mem, [nome]: righe.join('\n').trim() });
    return true;
  }

  // La memoria come la rilegge l'utente nelle Preferenze (#592): i moduli in
  // righe, le lezioni ancora da riordinare e i siti da tenere aperti (#823).
  async function viewForUser() {
    const mem = await getMemory();
    const moduli = Object.entries(mem || {})
      .filter(([, v]) => typeof v === 'string')
      .map(([nome, v]) => ({ nome, righe: v.split(/\r?\n/).map((r) => r.trim()).filter(Boolean) }));
    const lezioni = (await getLessonsBuffer())
      .filter((l) => l && typeof l.text === 'string' && l.text.trim())
      .map((l) => ({ ts: l.ts, text: l.text }));
    const sempreAperte = Object.keys(await listKeepOpen()).sort();
    return { moduli, lezioni, sempreAperte };
  }

  const fraseSempreAperta = (host) => `Tieni sempre aperto ${host}`;

  // Le righe che una frase detta a voce indica (#592): quelle uguali, se ce ne
  // sono, altrimenti quelle che la contengono. Ognuna porta il `via` di
  // FILO_MEMORY_FORGET, così la voce toglie esattamente quello che toglie la ×.
  async function tutteLeRighe() {
    const { moduli, lezioni, sempreAperte } = await viewForUser();
    return [
      ...moduli.flatMap((m) => m.righe.map((riga) => ({ testo: riga, via: { modulo: m.nome, riga } }))),
      ...lezioni.map((l) => ({ testo: l.text, via: { lezione: { ts: l.ts, text: l.text } } })),
      ...sempreAperte.map((host) => ({ testo: fraseSempreAperta(host), via: { sempreAperta: host } })),
    ];
  }

  async function findLines(frase) {
    const norma = (s) => String(s == null ? '' : s).replace(/^\s*[-•*]\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const cerca = norma(frase);
    if (!cerca) return [];
    const tutte = await tutteLeRighe();
    const uguali = tutte.filter((r) => norma(r.testo) === cerca);
    return uguali.length ? uguali : tutte.filter((r) => norma(r.testo).includes(cerca));
  }

  // Le righe che ci sono ancora fra quelle che un popup ha mostrato, per testo.
  async function linesWithText(testi) {
    const visti = new Set((Array.isArray(testi) ? testi : []).filter((t) => typeof t === 'string'));
    if (!visti.size) return [];
    return (await tutteLeRighe()).filter((r) => visti.has(r.testo));
  }

  // Dimenticare una riga la nasconde (decisione dell'owner, #872): esce dal prompt e resta nel quaderno, da dove si
  // rimette o si cancella per sempre. Un sito tenuto aperto è una regola, non un ricordo: si toglie e basta.
  async function forgetLine(via) {
    if (via && typeof via.sempreAperta === 'string') return (await removeKeepOpen(via.sempreAperta)).length > 0;
    return !!(await hideLine(via));
  }

  // Semantica patch: aggiorna alcuni moduli senza toccare gli altri.
  async function patchMemory(patch) {
    const cur = await getMemory();
    const next = { ...cur, ...patch };
    await setMemory(next);
    return next;
  }

  // Output del Compattatore: blocchi «NOME:\ncontenuto» separati da una riga vuota.
  // Tollerante: quello che precede il primo header si scarta.
  function parseCompactorOutput(text) {
    if (!text) return {};
    const trimmed = String(text).trim();
    if (trimmed === 'NESSUNA MODIFICA') return {};
    const lines = trimmed.split(/\r?\n/);
    const out = {};
    let currentName = null;
    let buffer = [];
    const flush = () => {
      if (currentName) {
        out[currentName] = buffer.join('\n').trim();
      }
      buffer = [];
    };
    const headerRe = /^([A-Z][A-Z0-9_]{1,40}):\s*$/;
    for (const line of lines) {
      const m = line.match(headerRe);
      if (m) {
        flush();
        currentName = m[1];
        continue;
      }
      if (currentName) buffer.push(line);
    }
    flush();
    return out;
  }

  function renderMemoryForPrompt(memory) {
    if (!memory || typeof memory !== 'object') return { profilo: '', preferenze: '', espansioni: '' };
    const profilo = memory.PROFILO || '';
    const preferenze = memory.PREFERENZE || '';
    const others = Object.entries(memory)
      .filter(([k]) => k !== 'PROFILO' && k !== 'PREFERENZE')
      .filter(([_, v]) => v && String(v).trim().length);
    let espansioni = '';
    if (others.length) {
      espansioni = 'ESPANSIONI:\n' + others.map(([k, v]) => `${k}:\n${v}`).join('\n\n');
    }
    return { profilo, preferenze, espansioni };
  }

  // Onboarding (#524): lo stato sta in UNA chiave e passa sempre da `SN_ONBOARDING.normalize`,
  // perché queste letture stanno sul cammino di apertura della home.

  function Onb() {
    return global.SN_ONBOARDING;
  }

  // Il segno «già accolto» è UNO: `done`, scritto quando l'intervista FINISCE.
  // FILO_WELCOMED resta solo come segnale di migrazione: chi era accolto non la rivede.
  async function getOnboarding() {
    const raw = await getRaw(KEYS.FILO_ONBOARDING, null);
    const O = Onb();
    if (raw == null) {
      const legacy = await getRaw(KEYS.FILO_WELCOMED, false);
      if (legacy) return O ? O.normalize({ done: true }) : { done: true, ticked: [], thread: [] };
    }
    return O ? O.normalize(raw) : (raw || { done: false, ticked: [], thread: [] });
  }

  async function setOnboarding(state) {
    const O = Onb();
    const next = O ? O.normalize(state) : state;
    await setRaw(KEYS.FILO_ONBOARDING, next);
    return next;
  }

  async function listTimers() {
    return getRaw(KEYS.FILO_TIMERS, []);
  }

  // `chat`: la conversazione che l'ha chiesto, se c'è; la carta nella home ci riporta lì (#870).
  const chatValida = (c) => (typeof c === 'string' && c.length > 0 && c.length <= 200 ? c : null);

  async function addTimer({ label, seconds, chat }) {
    // Una durata non interpretabile o non positiva (0, negativa, NaN) NON crea un
    // timer: torniamo null e i chiamanti non lo trasmettono né lo segnano eseguito
    // (`if (t) broadcastLiveUpdate()`, `executed: !!entry`). Stessa filosofia di
    // addAlarm: meglio "non ho capito la durata" che programmare un timer fasullo.
    // (Prima un `Math.max(1, …)` forzava il minimo a 1s e rendeva questa guardia
    // irraggiungibile: un input malformato creava un timer di 1s che suonava subito.)
    const sec = Math.round(Number(seconds) || 0);
    if (sec <= 0) return null;
    const list = await listTimers();
    const entry = {
      id: uuid(),
      label: truncateSafe(String(label || 'Timer').trim(), 60),
      startedAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + sec * 1000).toISOString(),
      paused: false,
    };
    if (chatValida(chat)) entry.chat = chat;
    list.unshift(entry);
    await setRaw(KEYS.FILO_TIMERS, list);
    return entry;
  }

  async function deleteTimer(id) {
    const list = await listTimers();
    const filtered = list.filter((t) => t.id !== id);
    await setRaw(KEYS.FILO_TIMERS, filtered);
    return filtered;
  }

  // In pausa il tempo si congela in `remainingMs` e `endsAt` non è più affidabile:
  // chi mostra un timer in pausa DEVE usare `remainingMs`. Le sveglie non si mettono in pausa.
  async function pauseTimer(id) {
    const list = await listTimers();
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return list;
    const t = list[idx];
    if (t.paused || t.ringing || t.kind === 'alarm') return list;
    const remainingMs = Math.max(0, new Date(t.endsAt).getTime() - Date.now());
    list[idx] = { ...t, paused: true, remainingMs };
    await setRaw(KEYS.FILO_TIMERS, list);
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    return list;
  }

  // Riprende da `adesso + remainingMs`: il conto riparte da dov'era. No-op se non in pausa.
  async function resumeTimer(id) {
    const list = await listTimers();
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return list;
    const t = list[idx];
    if (!t.paused) return list;
    const remainingMs = Number.isFinite(t.remainingMs)
      ? t.remainingMs
      : Math.max(0, new Date(t.endsAt).getTime() - Date.now());
    const next = { ...t, paused: false, endsAt: new Date(Date.now() + remainingMs).toISOString() };
    delete next.remainingMs;
    list[idx] = next;
    await setRaw(KEYS.FILO_TIMERS, list);
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    return list;
  }

  // Una sveglia (#322) è un timer con scadenza ASSOLUTA e vive nella STESSA lista,
  // così eredita gratis il flusso già rodato: gcTimers → ringing → suoneria.

  // «HH:MM» o «H»: la PROSSIMA occorrenza, oggi se futura, altrimenti domani.
  // Null se non interpretabile: meglio «non ho capito» che fingere di aver programmato.
  function resolveAlarmTime(raw, nowMs = Date.now()) {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(s);
    if (m) {
      const h = Number(m[1]);
      const min = Number(m[2] || 0);
      if (h > 23 || min > 59) return null;
      const d = new Date(nowMs);
      d.setHours(h, min, 0, 0);
      let t = d.getTime();
      if (t <= nowMs) t += 24 * 60 * 60 * 1000;
      return t;
    }
    const t = Date.parse(s);
    if (Number.isFinite(t) && t > nowMs) return t;
    return null;
  }

  // Il dato canonico è `repeat` più `atTime`; `endsAt` resta la PROSSIMA occorrenza,
  // così il flusso esistente funziona senza saperne nulla. Al suono non si consuma.

  const DOW_TOKENS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']; // indice = Date#getDay()
  const DOW_ORDER = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];  // ordine di lettura
  const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven'];
  const WEEKEND = ['sab', 'dom'];

  // Chiave di confronto: minuscolo, senza accenti, spazi e punteggiatura.
  function normKey(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  const DOW_ALIASES = {
    lun: 'lun', lu: 'lun', lunedi: 'lun', mon: 'lun', monday: 'lun',
    mar: 'mar', ma: 'mar', martedi: 'mar', tue: 'mar', tuesday: 'mar',
    mer: 'mer', me: 'mer', mercoledi: 'mer', wed: 'mer', wednesday: 'mer',
    gio: 'gio', gi: 'gio', giovedi: 'gio', thu: 'gio', thursday: 'gio',
    ven: 'ven', ve: 'ven', venerdi: 'ven', fri: 'ven', friday: 'ven',
    sab: 'sab', sa: 'sab', sabato: 'sab', sat: 'sab', saturday: 'sab',
    dom: 'dom', do: 'dom', domenica: 'dom', sun: 'dom', sunday: 'dom',
  };

  const DOW_GROUPS = {
    feriali: WEEKDAYS, giorniferiali: WEEKDAYS, lavorativi: WEEKDAYS,
    giornilavorativi: WEEKDAYS, infrasettimanale: WEEKDAYS, weekdays: WEEKDAYS,
    weekend: WEEKEND, finesettimana: WEEKEND, ilweekend: WEEKEND, festivi: WEEKEND,
    ognigiorno: DOW_ORDER, tuttiigiorni: DOW_ORDER, tuttiigiorno: DOW_ORDER,
    quotidiano: DOW_ORDER, quotidiana: DOW_ORDER, giornaliero: DOW_ORDER,
    giornaliera: DOW_ORDER, sempre: DOW_ORDER, daily: DOW_ORDER, everyday: DOW_ORDER,
    tuttiigg: DOW_ORDER,
  };

  // Accetta array, stringa con separatori o scorciatoie («feriali», «weekend»).
  // Quello che non si riconosce si ignora: [] = occorrenza singola, come sempre.
  function normalizeRepeat(raw) {
    const found = new Set();
    const eat = (value) => {
      if (value == null) return;
      if (Array.isArray(value)) { value.forEach(eat); return; }
      const whole = normKey(value);
      if (!whole) return;
      if (DOW_GROUPS[whole]) { DOW_GROUPS[whole].forEach((d) => found.add(d)); return; }
      if (DOW_ALIASES[whole]) { found.add(DOW_ALIASES[whole]); return; }
      const pieces = String(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      if (pieces.length > 1) {
        for (const p of pieces) {
          const k = normKey(p);
          if (DOW_GROUPS[k]) DOW_GROUPS[k].forEach((d) => found.add(d));
          else if (DOW_ALIASES[k]) found.add(DOW_ALIASES[k]);
        }
      }
    };
    eat(raw);
    return DOW_ORDER.filter((d) => found.has(d));
  }

  // Per una sveglia ricorrente il giorno lo decide la ricorrenza: dell'input serve solo l'ora.
  function parseClock(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(s);
    if (m) {
      const h = Number(m[1]);
      const min = Number(m[2] || 0);
      if (h > 23 || min > 59) return null;
      return { h, m: min };
    }
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return null;
    const d = new Date(t);
    return { h: d.getHours(), m: d.getMinutes() };
  }

  function fmtClock(clock) {
    if (!clock) return '';
    return `${String(clock.h).padStart(2, '0')}:${String(clock.m).padStart(2, '0')}`;
  }

  // Occorrenza STRETTAMENTE futura, da oggi a fra sette giorni compresi:
  // la sveglia del solo lunedì, chiesta lunedì dopo l'orario, va al lunedì dopo.
  function nextRecurrence(clock, days, nowMs = Date.now()) {
    const wanted = normalizeRepeat(days);
    if (!clock || !wanted.length) return null;
    const set = new Set(wanted);
    for (let i = 0; i <= 7; i++) {
      const d = new Date(nowMs);
      d.setDate(d.getDate() + i);
      d.setHours(clock.h, clock.m, 0, 0);
      const t = d.getTime();
      if (t <= nowMs) continue;
      if (set.has(DOW_TOKENS[d.getDay()])) return t;
    }
    return null;
  }

  function isRecurring(t) {
    return !!(t && t.kind === 'alarm' && Array.isArray(t.repeat) && t.repeat.length);
  }

  // Prossima occorrenza di una sveglia ricorrente già salvata.
  function nextAlarmOccurrence(t, nowMs = Date.now()) {
    if (!isRecurring(t)) return null;
    const clock = parseClock(t.atTime) || parseClock(t.endsAt);
    return nextRecurrence(clock, t.repeat, nowMs);
  }

  // Dicitura leggibile della ricorrenza: "ogni giorno", "feriali", "weekend"
  // oppure l'elenco dei giorni ("lun+mer"). Unica per stato dell'agente e
  // carte della home: se cambia, cambia in un posto solo.
  function formatRepeat(days) {
    const d = normalizeRepeat(days);
    if (!d.length) return '';
    if (d.length === 7) return 'ogni giorno';
    if (d.length === 5 && WEEKDAYS.every((x) => d.includes(x))) return 'feriali';
    if (d.length === 2 && WEEKEND.every((x) => d.includes(x))) return 'weekend';
    return d.join('+');
  }

  async function addAlarm({ label, time, repeat, nowMs, chat }) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const days = normalizeRepeat(repeat);
    const clock = days.length ? parseClock(time) : null;
    const at = days.length ? nextRecurrence(clock, days, now) : resolveAlarmTime(time, now);
    if (!at) return null;
    const list = await listTimers();
    const entry = {
      id: uuid(),
      kind: 'alarm',
      label: truncateSafe(String(label || '').trim(), 60),
      startedAt: new Date(now).toISOString(),
      endsAt: new Date(at).toISOString(),
      paused: false,
    };
    if (days.length) {
      entry.repeat = days;
      entry.atTime = fmtClock(clock);
    }
    if (chatValida(chat)) entry.chat = chat;
    list.unshift(entry);
    await setRaw(KEYS.FILO_TIMERS, list);
    return entry;
  }

  // L'utente non dice mai un id: dice «la sveglia della palestra», «quella delle 7», «tutte».
  // Array vuoto = «non ho capito»: chi chiama non cancella niente invece di indovinare.

  function normText(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function alarmClockText(t) {
    const clock = parseClock(t.atTime) || parseClock(t.endsAt);
    return clock ? fmtClock(clock) : '';
  }

  // `kind` filtra 'alarm' o 'timer'; assente = entrambi.
  function resolveTimerRefs(list, ref = {}) {
    const all = Array.isArray(list) ? list : [];
    // Riferimento già risolto altrove: il main lo risolve prima del popup di conferma.
    if (Array.isArray(ref.ids)) {
      const set = new Set(ref.ids);
      return all.filter((t) => set.has(t.id));
    }
    if (ref.id) return all.filter((t) => t.id === ref.id);
    const kind = ref.kind === 'alarm' || ref.kind === 'timer' ? ref.kind : null;
    const pool = kind
      ? all.filter((t) => (t.kind === 'alarm' ? 'alarm' : 'timer') === kind)
      : all.slice();
    const q = normText(ref.label);
    if (ref.all && !q) return pool;
    if (!q) return [];

    // 1) etichetta identica.
    const exact = pool.filter((t) => normText(t.label) === q);
    if (exact.length) return exact;
    // 2) una contiene l'altra ("sveglia palestra" ↔ "palestra").
    const partial = pool.filter((t) => {
      const l = normText(t.label);
      return !!l && (l.includes(q) || q.includes(l));
    });
    if (partial.length) return partial;
    // 3) parole in comune (da 3 lettere in su: "le" e "la" non sono indizi).
    const words = q.split(' ').filter((w) => w.length >= 3);
    if (words.length) {
      const byWord = pool.filter((t) => {
        const l = normText(t.label);
        return !!l && words.some((w) => l.split(' ').includes(w));
      });
      if (byWord.length) return byWord;
    }
    // Sul testo GREZZO: normalizzando, «06:30» diventerebbe «06 30», cioè le 6 in punto.
    const hm = /(\d{1,2})(?:[:.](\d{2}))?/.exec(String(ref.label || ''));
    if (hm) {
      const want = fmtClock({ h: Number(hm[1]), m: Number(hm[2] || 0) });
      const byTime = pool.filter((t) => t.kind === 'alarm' && alarmClockText(t) === want);
      if (byTime.length) return byTime;
    }
    // 5) "tutte le sveglie di X" con X che non combacia: meglio niente che a caso.
    return ref.all ? pool : [];
  }

  // Cancella le entry indicate dal riferimento. Ritorna { removed, list }.
  async function removeTimersByRef(ref = {}) {
    const list = await listTimers();
    const targets = resolveTimerRefs(list, ref);
    if (!targets.length) return { removed: [], list };
    const ids = new Set(targets.map((t) => t.id));
    const kept = list.filter((t) => !ids.has(t.id));
    await setRaw(KEYS.FILO_TIMERS, kept);
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    return { removed: targets, list: kept };
  }

  // `updated` vuoto = non ho capito quale, o l'orario non è interpretabile:
  // in quel caso non si tocca niente.
  async function updateTimersByRef(ref = {}, { time, repeat, seconds, nowMs } = {}) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const list = await listTimers();
    const targets = resolveTimerRefs(list, ref);
    if (!targets.length) return { updated: [], list };
    const ids = new Set(targets.map((t) => t.id));
    const updated = [];
    const next = list.map((t) => {
      if (!ids.has(t.id)) return t;
      if (t.kind === 'alarm') {
        // Spostare l'orario non deve far perdere «il lunedì e il mercoledì».
        const asked = normalizeRepeat(repeat);
        const days = asked.length ? asked : normalizeRepeat(t.repeat);
        const clock = parseClock(time) || parseClock(t.atTime) || parseClock(t.endsAt);
        const at = days.length ? nextRecurrence(clock, days, now) : resolveAlarmTime(time, now);
        if (!at) return t;
        const e = { ...t, endsAt: new Date(at).toISOString(), paused: false };
        delete e.ringing;
        delete e.remainingMs;
        if (days.length) { e.repeat = days; e.atTime = fmtClock(clock); }
        else { delete e.repeat; delete e.atTime; }
        updated.push(e);
        return e;
      }
      const sec = Math.round(Number(seconds ?? time) || 0);
      if (sec <= 0) return t;
      const e = { ...t, endsAt: new Date(now + sec * 1000).toISOString(), paused: false };
      delete e.ringing;
      delete e.remainingMs;
      updated.push(e);
      return e;
    });
    if (!updated.length) return { updated: [], list };
    await setRaw(KEYS.FILO_TIMERS, next);
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    return { updated, list: next };
  }

  // I timer scaduti si marcano `ringing` invece di sparire, così la UI suona e mostra «Ferma».
  // Alla prossima apertura si tolgono in silenzio: senza UI la suoneria non avrebbe senso.
  async function gcTimers() {
    const list = await listTimers();
    const now = Date.now();
    let changed = false;
    const result = [];
    for (const t of list) {
      if (t.paused) { result.push(t); continue; }
      const expired = new Date(t.endsAt).getTime() <= now;
      if (!expired) { result.push(t); continue; }
      if (t.ringing) {
        // Già ringing: resta in lista, e la cache non si invalida ogni secondo.
        result.push(t);
      } else if (isRecurring(t)) {
        // Sveglia RICORRENTE: suona e non si consuma, `endsAt` va già all'occorrenza dopo.
        // Se non è calcolabile si comporta come una sveglia normale.
        const next = nextAlarmOccurrence(t, now);
        result.push(next ? { ...t, ringing: true, endsAt: new Date(next).toISOString() } : { ...t, ringing: true });
        changed = true;
      } else {
        // Prima volta che scade: passa a ringing e invalida la cache.
        result.push({ ...t, ringing: true });
        changed = true;
      }
    }
    if (changed) {
      await setRaw(KEYS.FILO_TIMERS, result);
      // I suggerimenti «il timer sta per suonare» vanno rigenerati.
      await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    }
    return result;
  }

  // ECCEZIONE: una sveglia RICORRENTE non si cancella con «Ferma» — fermare quella di
  // stamattina non disdice quella di mercoledì. Per toglierla davvero c'è la ×.
  async function stopTimerAlarm(id) {
    const list = await listTimers();
    const idx = list.findIndex((t) => t.id === id);
    if (idx >= 0 && isRecurring(list[idx])) {
      const t = list[idx];
      const now = Date.now();
      const next = new Date(t.endsAt).getTime() > now ? new Date(t.endsAt).getTime() : nextAlarmOccurrence(t, now);
      if (next) {
        const kept = list.slice();
        kept[idx] = { ...t, ringing: false, endsAt: new Date(next).toISOString() };
        await setRaw(KEYS.FILO_TIMERS, kept);
        await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
        return kept;
      }
    }
    const filtered = list.filter((t) => t.id !== id);
    await setRaw(KEYS.FILO_TIMERS, filtered);
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    return filtered;
  }

  async function listNotifications({ includeDismissed = false } = {}) {
    const list = await getRaw(KEYS.FILO_NOTIFICATIONS, []);
    return includeDismissed ? list : list.filter((n) => !n.dismissed);
  }

  async function addNotification({ kind, text, action, color }) {
    const list = await getRaw(KEYS.FILO_NOTIFICATIONS, []);
    const entry = {
      id: uuid(),
      ts: new Date().toISOString(),
      kind: kind || 'info', // 'alert' | 'process' | 'background' | 'info'
      text: String(text || ''),
      action: action || null,
      color: color || null, // override del colore della barra laterale
      dismissed: false,
    };
    list.unshift(entry);
    if (list.length > NOTIFICATIONS_CAP) list.length = NOTIFICATIONS_CAP;
    await setRaw(KEYS.FILO_NOTIFICATIONS, list);
    // Nel main un avviso nuovo è una cosa successa: Filo lo scrive nel filo (#869).
    try { global.SN_FILO_PARLA?.segnala({ tipo: 'avviso', testo: entry.text }); } catch (_) {}
    return entry;
  }

  // Un avviso che descrive uno stato si riscrive quando lo stato cambia, invece di restare con una frase non più vera.
  async function setNotificationText(id, text) {
    const list = await getRaw(KEYS.FILO_NOTIFICATIONS, []);
    const n = list.find((x) => x.id === id);
    if (!n || n.dismissed || n.text === String(text || '')) return false;
    n.text = String(text || '');
    await setRaw(KEYS.FILO_NOTIFICATIONS, list);
    return true;
  }

  async function dismissNotification(id, { acted = false } = {}) {
    const list = await getRaw(KEYS.FILO_NOTIFICATIONS, []);
    const idx = list.findIndex((n) => n.id === id);
    if (idx >= 0) {
      list[idx].dismissed = true;
      list[idx].dismissedAt = new Date().toISOString();
      list[idx].acted = !!acted;
      await setRaw(KEYS.FILO_NOTIFICATIONS, list);
    }
    return list;
  }

  async function getDashboardCache() {
    return getRaw(KEYS.FILO_DASHBOARD_CACHE, null);
  }

  async function setDashboardCache(payload) {
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, {
      ts: new Date().toISOString(),
      message: payload?.message || '',
      suggestions: Array.isArray(payload?.suggestions) ? payload.suggestions : [],
      // Firma degli input del messaggio: dice se la home va ricalcolata (#155).
      signature: payload?.signature || '',
      // Scritto senza chiave: manda a riscattare l'invito, e con la chiave non va più servito.
      senzaChiave: payload?.senzaChiave === true,
    });
  }

  // Le regole proxy per dominio (#152) vivono nella memoria a lungo termine, così la tab
  // nasce già instradata. La chiave è l'eTLD+1 calcolato dal chiamante, che ha la PSL.
  function normProxyDomain(domain) {
    return String(domain || '').trim().toLowerCase().replace(/^www\./, '');
  }

  async function listProxyRules() {
    const r = await getRaw(KEYS.FILO_PROXY_RULES, {});
    return r && typeof r === 'object' ? r : {};
  }

  async function setProxyRule(domain, { country, tier } = {}) {
    const dom = normProxyDomain(domain);
    const code = String(country || '').trim().toLowerCase();
    if (!dom || !/^[a-z]{2}$/.test(code)) return null;
    const rules = await listProxyRules();
    rules[dom] = { country: code, tier: tier || null, ts: new Date().toISOString() };
    await setRaw(KEYS.FILO_PROXY_RULES, rules);
    return rules[dom];
  }

  async function removeProxyRule(domain) {
    const dom = normProxyDomain(domain);
    const rules = await listProxyRules();
    if (dom in rules) {
      delete rules[dom];
      await setRaw(KEYS.FILO_PROXY_RULES, rules);
    }
    return rules;
  }

  async function getProxyRule(domain) {
    const rules = await listProxyRules();
    return rules[normProxyDomain(domain)] || null;
  }

  // ===== Siti sempre aperti (#823) =====
  // La pulizia delle schede li legge senza passare dal modello. La voce (host) la calcola il main.

  async function listKeepOpen() {
    const r = await getRaw(KEYS.FILO_KEEP_OPEN, {});
    return r && typeof r === 'object' && !Array.isArray(r) ? r : {};
  }

  // Rilegge e riscrive la chiave intera: le scritture in fila, o due insieme si mangiano a vicenda
  // (patterns/chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md).
  let codaKeepOpen = Promise.resolve();
  function inCodaKeepOpen(fn) {
    const r = codaKeepOpen.then(fn, fn);
    codaKeepOpen = r.then(() => {}, () => {});
    return r;
  }

  function addKeepOpen(host) {
    const h = normProxyDomain(host);
    if (!h) return Promise.resolve(null);
    return inCodaKeepOpen(async () => {
      const voci = await listKeepOpen();
      voci[h] = { ts: (voci[h] && voci[h].ts) || new Date().toISOString() };
      await setRaw(KEYS.FILO_KEEP_OPEN, voci);
      return h;
    });
  }

  // Torna le voci tolte davvero.
  function removeKeepOpen(hosts) {
    return inCodaKeepOpen(async () => {
      const voci = await listKeepOpen();
      const tolte = (Array.isArray(hosts) ? hosts : [hosts]).map(normProxyDomain).filter((h) => h && h in voci);
      if (!tolte.length) return [];
      for (const h of tolte) delete voci[h];
      await setRaw(KEYS.FILO_KEEP_OPEN, voci);
      return tolte;
    });
  }

  // ===== Session =====

  async function getSession() {
    const s = await getRaw(KEYS.FILO_SESSION, null);
    if (s && typeof s === 'object') return s;
    return { lastInteractionAt: null, sessionStartedAt: null, sessionCount: 0 };
  }

  async function setSession(session) {
    await setRaw(KEYS.FILO_SESSION, session);
  }

  // Reset dopo 30 minuti di inattività (spec §5.1).
  async function touchSession() {
    const s = await getSession();
    const now = new Date();
    const last = s.lastInteractionAt ? new Date(s.lastInteractionAt).getTime() : 0;
    const idleMin = (now.getTime() - last) / 60000;
    if (!s.sessionStartedAt || idleMin > 30) {
      s.sessionStartedAt = now.toISOString();
      s.sessionCount = 0;
    }
    s.lastInteractionAt = now.toISOString();
    s.sessionCount = (s.sessionCount || 0) + 1;
    await setSession(s);
    return s;
  }

  global.SN_FILO_MEMORY = {
    // raw log
    // lessons
    getLessonsBuffer, appendLesson: inFila(appendLesson), lessonsBufferShouldCompact, clearLessonsBuffer, forgetLesson,
    LESSONS_BUFFER_TRIGGER_CHARS,
    // moduli
    getMemory, setMemory, patchMemory, parseCompactorOutput, renderMemoryForPrompt, forgetModuleLine,
    setOnMemoryChange, viewForUser, findLines, linesWithText, forgetLine: inFila(forgetLine),
    // quaderno delle memorie (#872)
    getFonti, quaderno, righeTolte, svuotaQuaderno: inFila(svuotaQuaderno), hideLine: inFila(hideLine), restoreHidden: inFila(restoreHidden),
    forgetHiddenForever: inFila(forgetHiddenForever), editLine: inFila(editLine), applicaCompattazione: inFila(applicaCompattazione),
    // onboarding (#524)
    getOnboarding, setOnboarding,
    listTimers, addTimer, addAlarm, resolveAlarmTime, deleteTimer, pauseTimer, resumeTimer, gcTimers, stopTimerAlarm,
    normalizeRepeat, parseClock, nextRecurrence, nextAlarmOccurrence, formatRepeat, isRecurring,
    resolveTimerRefs, removeTimersByRef, updateTimersByRef,
    // notifications
    listNotifications, addNotification, dismissNotification, setNotificationText,
    // dashboard cache
    getDashboardCache, setDashboardCache,
    listProxyRules, setProxyRule, removeProxyRule, getProxyRule,
    // siti sempre aperti (#823)
    listKeepOpen, addKeepOpen, removeKeepOpen, fraseSempreAperta,
    // session
    getSession, setSession, touchSession,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

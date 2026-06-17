// Logica pura: trasforma un feedback (segnalazione + note) nella sua
// CONVERSAZIONE a turni, così la dashboard può mostrarla a "bolle di chat"
// invece di un unico blocco di testo dove segnalazione, risposte di Filo e
// risposte dell'utente si mescolano (feedback #108: "un feedback ha testo
// originale, risposta del modello, mia risposta, altre domande… ogni turno in
// un box diverso").
//
// Il dato resta UNO solo (il campo `notes` su Firestore): qui non si cambia lo
// schema, si PARSA ciò che già c'è. La struttura delle note è quella prodotta
// dai due cammini che le scrivono:
//   - le routine/Filo scrivono il loro report/le domande come testo libero;
//   - la dashboard, quando l'utente riapre o risponde, APPENDE un blocco
//     `--- Riaperto il <ts> ---\n<testo>` (o `--- La tua risposta del <ts> ---`).
// Quindi: il segmento iniziale delle note è il turno di Filo; ogni marcatore
// di riapertura/risposta apre un turno dell'utente.
//
// Convenzione IIFE su globalThis come gli altri moduli shared/*.

(function (global) {
  'use strict';

  // Marcatori che, dentro `notes`, aprono un turno dell'UTENTE. Il primo
  // ("Riaperto il") è quello storico già presente su Firestore: va riconosciuto
  // per retro-compatibilità. Il secondo è quello che usa la risposta dal tab
  // Chiarimenti. Cattura (group 1) il timestamp scritto nel marcatore.
  const USER_TURN_RE = /^---\s*(?:Riaperto il|La tua risposta del)\s*(.*?)\s*---\s*$/;

  // Marcatore che, dentro `notes`, apre un nuovo turno dell'AGENTE/MODELLO. Serve
  // quando una routine RI-risolve un feedback già lavorato (riaperto): il nuovo
  // report va APPESO come turno separato, non sovrascrive lo storico (report
  // precedente + annotazione di riapertura dell'utente). Senza questo marcatore
  // il parser attribuirebbe il nuovo report al turno utente precedente. Cattura
  // (group 1) il timestamp.
  const MODEL_TURN_RE = /^---\s*(?:Aggiornamento dell'agente del|Filo ha risposto il)\s*(.*?)\s*---\s*$/;

  // Allegati PER-TURNO (#190.3). Il modello dati dei feedback ha `images`/`files`
  // PIATTI sul documento (la segnalazione originale). Per legare un allegato a un
  // singolo COMMENTO/turno — senza aggiungere campi a Firestore né cambiare le
  // regole (il campo `notes` è già scrivibile dagli admin) — codifichiamo gli
  // allegati di un turno come RIGHE-MARCATORE dentro `notes`, una per allegato:
  //
  //   @@filo-attachment {"kind":"img","url":"https://…"}
  //   @@filo-attachment {"kind":"file","url":"https://…","name":"x.pdf","type":"application/pdf"}
  //
  // Il parser le riconosce e le toglie dal corpo del turno, raccogliendole in
  // `turn.attachments`. Così l'allegato resta ANCORATO al turno in cui è stato
  // incollato (a differenza degli array piatti, che li mescolerebbero tutti con
  // la segnalazione originale). JSON su singola riga = nomi con spazi/caratteri
  // speciali gestiti dall'escaping, prefisso improbabile nella prosa.
  const ATTACH_PREFIX = '@@filo-attachment ';

  // Serializza un allegato { kind, url, name?, type? } nella sua riga-marcatore.
  function serializeAttachment(att) {
    const a = att || {};
    const kind = a.kind === 'file' ? 'file' : 'img';
    const obj = { kind, url: String(a.url || '') };
    if (kind === 'file') {
      obj.name = String(a.name || 'allegato');
      if (a.type) obj.type = String(a.type);
    }
    return ATTACH_PREFIX + JSON.stringify(obj);
  }

  // Riconosce una riga-marcatore di allegato e la decodifica, oppure null se la
  // riga è prosa normale. Difensivo: scarta URL non http(s) (no javascript:/data:
  // → niente vettore XSS quando l'URL finisce in un href/src in dashboard).
  function parseAttachmentLine(line) {
    const s = String(line || '');
    if (s.indexOf(ATTACH_PREFIX) !== 0) return null;
    try {
      const obj = JSON.parse(s.slice(ATTACH_PREFIX.length));
      const url = String(obj.url || '');
      if (!/^https?:\/\//i.test(url)) return null;
      const kind = obj.kind === 'file' ? 'file' : 'img';
      const att = { kind, url };
      if (kind === 'file') {
        att.name = String(obj.name || 'allegato');
        att.type = String(obj.type || '');
      }
      return att;
    } catch (_) {
      return null;
    }
  }

  // Serializza una lista di allegati nelle loro righe-marcatore (una per riga).
  function attachmentsBlock(attachments) {
    const list = Array.isArray(attachments) ? attachments : [];
    return list.map(serializeAttachment).filter(Boolean).join('\n');
  }

  // true se il feedback è stato inviato da un modello (issue d'agente o
  // sub-feedback creato da una routine): in quel caso anche la segnalazione
  // originale è "lato Filo", non "lato utente".
  function isFromModel(clientId) {
    const c = String(clientId || '');
    return c.startsWith('agent:') || c.startsWith('routine:');
  }

  // true se il feedback è un invio MANUALE dell'owner (admin loggato). L'identità
  // owner viene applicata nel main process al momento dell'invio (vedi
  // ownerize): il content script non sa di esserlo.
  function isFromOwner(clientId) {
    return String(clientId || '').startsWith('owner:');
  }

  // Classifica l'ORIGINE di un feedback dal prefisso del clientId. Serve alla
  // dashboard per colorare card e bolle a colpo d'occhio:
  //   owner:<id>     → 'owner'    invio manuale dell'admin loggato (verde)
  //   agent:<model>  → 'agent'    agente esploratore LLM (accento)
  //   routine:<slug> → 'routine'  audit automatico delle routine cloud (blu)
  //   <altro>        → 'user'     alpha tester esterno (arancione)
  function originOf(clientId) {
    const c = String(clientId || '');
    if (c.startsWith('owner:')) return 'owner';
    if (c.startsWith('agent:')) return 'agent';
    if (c.startsWith('routine:')) return 'routine';
    return 'user';
  }

  // Marca un clientId come invio dell'owner. Idempotente: non raddoppia il
  // prefisso e NON marca i feedback già di origine modello (agent:/routine:),
  // che owner non sono. Cap a 100 char = limite `clientId` delle Firestore rules.
  function ownerize(clientId) {
    const c = String(clientId || '');
    if (!c || isFromModel(c) || c.startsWith('owner:')) return c;
    return ('owner:' + c).slice(0, 100);
  }

  // Spezza il blob `notes` nei suoi turni. Ritorna una lista di
  // { role: 'model'|'user', ts: string|null, body: string } senza i segmenti
  // vuoti (es. note che iniziano direttamente con un marcatore di riapertura).
  function splitNotes(notes) {
    const lines = String(notes || '').split('\n');
    const segments = [];
    // Il testo prima di qualsiasi marcatore è il turno di Filo (il report/le
    // domande scritte dalla routine).
    let current = { role: 'model', ts: null, lines: [], atts: [] };
    for (const line of lines) {
      const mu = USER_TURN_RE.exec(line);
      const mm = mu ? null : MODEL_TURN_RE.exec(line);
      if (mu) {
        segments.push(current);
        current = { role: 'user', ts: (mu[1] || '').trim() || null, lines: [], atts: [] };
      } else if (mm) {
        segments.push(current);
        current = { role: 'model', ts: (mm[1] || '').trim() || null, lines: [], atts: [] };
      } else {
        // Riga-allegato del turno corrente o prosa normale.
        const att = parseAttachmentLine(line);
        if (att) current.atts.push(att);
        else current.lines.push(line);
      }
    }
    segments.push(current);
    return segments
      .map((s) => ({ role: s.role, ts: s.ts, body: s.lines.join('\n').trim(), attachments: s.atts }))
      // Tiene i segmenti con testo OPPURE con soli allegati (es. una risposta
      // fatta solo di un'immagine, senza parole).
      .filter((s) => s.body.length > 0 || s.attachments.length > 0);
  }

  // Costruisce la conversazione completa di un feedback.
  // turni: { role, kind, body, ts }
  //   role  'model' (Filo) | 'user' (utente) — decide il lato/colore della bolla
  //   kind  'report' (la segnalazione iniziale) | 'note' (turno di Filo) |
  //         'reply' (risposta/riapertura dell'utente) — decide l'etichetta
  //   body  testo del turno (da escapare a valle, qui resta grezzo)
  //   ts    timestamp del turno se noto (ISO per la segnalazione, stringa già
  //         localizzata per i marcatori di riapertura), altrimenti null
  function parse(feedback) {
    const f = feedback || {};
    const turns = [];
    const text = String(f.text || '').trim();
    if (text) {
      turns.push({
        role: isFromModel(f.clientId) ? 'model' : 'user',
        kind: 'report',
        body: text,
        ts: f.createdAt || f._createTime || null,
      });
    }
    for (const seg of splitNotes(f.notes)) {
      turns.push({
        role: seg.role,
        kind: seg.role === 'model' ? 'note' : 'reply',
        body: seg.body,
        ts: seg.ts,
      });
    }
    return turns;
  }

  // Marcatore da APPENDERE alle note quando l'utente risponde dal tab
  // Chiarimenti (o riapre). Centralizzato qui così il parser e chi scrive
  // restano allineati su una sola forma.
  function userTurnMarker(ts, label) {
    const when = ts || new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    return `--- ${label || 'La tua risposta del'} ${when} ---`;
  }

  // Appende un turno dell'utente al blob note esistente, conservando lo storico.
  function appendUserTurn(oldNotes, replyText, opts) {
    const o = opts || {};
    const reply = String(replyText || '').trim();
    if (!reply) return String(oldNotes || '');
    const block = `${userTurnMarker(o.ts, o.label)}\n${reply}`;
    const prev = String(oldNotes || '');
    return prev ? `${prev}\n\n${block}` : block;
  }

  // Marcatore da APPENDERE quando l'AGENTE (una routine) ri-risolve un feedback
  // già lavorato. Simmetrico a userTurnMarker.
  function modelTurnMarker(ts, label) {
    const when = ts || new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    return `--- ${label || "Aggiornamento dell'agente del"} ${when} ---`;
  }

  // Appende un turno dell'agente al blob note esistente, conservando lo storico.
  function appendModelTurn(oldNotes, reportText, opts) {
    const o = opts || {};
    const report = String(reportText || '').trim();
    if (!report) return String(oldNotes || '');
    const block = `${modelTurnMarker(o.ts, o.label)}\n${report}`;
    const prev = String(oldNotes || '');
    return prev ? `${prev}\n\n${block}` : block;
  }

  // Fonde il nuovo report di una routine con le note ESISTENTI, senza perderle.
  // È il fix di "riaprendo un feedback perdo la risposta dell'agente e la mia
  // nota": quando una routine ri-risolve un feedback già lavorato, il suo report
  // arriva da solo (la routine non conosce lo storico). Questa funzione decide:
  //   - note esistenti vuote → il report diventa il primo turno (nessun marcatore);
  //   - report già contenuto nelle note (re-applicazione/retry) → niente, evita
  //     duplicati;
  //   - altrimenti → APPENDI il report come nuovo turno dell'agente, conservando
  //     report precedente + annotazione di riapertura dell'utente.
  function mergeModelReport(existingNotes, incomingReport, opts) {
    const incoming = String(incomingReport || '').trim();
    const existing = String(existingNotes || '');
    if (!incoming) return existing;
    if (!existing.trim()) return incoming;
    if (existing.includes(incoming)) return existing;
    return appendModelTurn(existing, incoming, opts);
  }

  global.SN_FEEDBACK_THREAD = {
    parse,
    splitNotes,
    isFromModel,
    isFromOwner,
    originOf,
    ownerize,
    userTurnMarker,
    appendUserTurn,
    modelTurnMarker,
    appendModelTurn,
    mergeModelReport,
    USER_TURN_RE,
    MODEL_TURN_RE,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

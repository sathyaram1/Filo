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

  // I prefissi di `clientId` che dicono "questo testo l'ha scritto un'istanza di
  // Claude, non una persona". Tre, e restano TRE cose diverse (vedi authorKind):
  //   agent:   l'agente esploratore che gira sull'app in cerca di problemi;
  //   routine: le automazioni in cloud, col loro ruolo dopo i due punti;
  //   local:   la sessione locale — Claude che lavora sulla macchina dell'owner,
  //            in chat con lui. È la provenienza di chi apre un feedback da lì.
  const MODEL_PREFIXES = ['agent:', 'routine:', 'local:'];

  // true se il feedback è stato inviato da un modello (issue d'agente,
  // sub-feedback creato da una routine, ritrovamento di una sessione locale):
  // in quel caso anche la segnalazione originale è "lato Filo", non
  // "lato utente".
  function isFromModel(clientId) {
    const c = String(clientId || '');
    return MODEL_PREFIXES.some(function (p) { return c.indexOf(p) === 0; });
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
  //   local:<slug>   → 'local'    sessione locale di Claude (viola)
  //   <altro>        → 'user'     alpha tester esterno (arancione)
  function originOf(clientId) {
    const c = String(clientId || '');
    if (c.startsWith('owner:')) return 'owner';
    if (c.startsWith('agent:')) return 'agent';
    if (c.startsWith('routine:')) return 'routine';
    if (c.startsWith('local:')) return 'local';
    return 'user';
  }

  // Categoria d'AUTORE, user-facing, per l'icona "chi l'ha scritto" della
  // dashboard di gestione:
  //   auto:<…> / filo:<…>   → 'filo'     Filo per conto di un utente (una
  //                                      capacità che manca, un errore incontrato,
  //                                      o una segnalazione che l'utente ha
  //                                      approvato dalla chat)
  //   owner:<id>            → 'owner'    l'owner (invio manuale dell'admin loggato)
  //   …:prober              → 'prober'   un'istanza che ESPLORA l'app in cerca di
  //                                      problemi che nessuno ha segnalato
  //   …:new-work / :fixer   → 'worker'   un'istanza che IMPLEMENTA: il ritrovamento
  //                                      è nato mentre scriveva il codice
  //   …:verifier / :secaudit→ 'verifier' un'istanza che VERIFICA il lavoro di
  //                                      un'altra: parla del lavoro appena fatto
  //   local:<qualsiasi>     → 'local'    la SESSIONE LOCALE: Claude che lavora
  //                                      sulla macchina dell'owner, in chat con
  //                                      lui. Categoria PROPRIA, non 'prober' e
  //                                      non 'claude': quello che nasce lì nasce
  //                                      da un lavoro fatto insieme all'owner —
  //                                      contesto diverso sia dall'esploratore
  //                                      (che gira da solo sull'app) sia dalle
  //                                      automazioni in cloud (che girano senza
  //                                      nessuno davanti). Se collassasse su una
  //                                      delle due, leggendo la coda non si
  //                                      saprebbe più da dove viene un
  //                                      ritrovamento — ed è l'unica cosa che il
  //                                      mittente serve a dire
  //   routine:residuo       → 'residuo'  i rilievi RESIDUI di una verifica: un
  //                                      lavoro promosso dopo N giri «migliorabile»
  //                                      (SPEC-RIDISEGNO-MAX.md §13) lascia i
  //                                      rilievi non risolti in un feedback nuovo,
  //                                      aperto dal SERVER. Categoria propria, NON
  //                                      prober e NON verifier: spacciarlo per uno
  //                                      dei due falserebbe la lettura di dove
  //                                      nascono i ritrovamenti
  //   agent:/routine:<altro>→ 'claude'   automazione di ruolo ignoto (storico: fino
  //                                      al 2026-08-08 nessuno si firmava)
  //   <altro>               → 'user'     un utente / alpha tester esterno
  //
  // Perché il ruolo conta (feedback #443): il MITTENTE dice quanto fidarsi e in
  // che contesto leggere. Un ritrovamento del verificatore riguarda la modifica
  // appena consegnata; uno dell'esploratore riguarda l'app in generale; uno di
  // Filo è la voce di un utente vero, filtrata.
  //
  // `auto:`/`filo:` vanno controllati PRIMA di `owner:`: gli auto-feedback
  // bypassano ownerize(), ma l'ordine tiene anche se un domani venissero marcati.
  var ROLE_KIND = {
    prober: 'prober',
    'new-work': 'worker',
    fixer: 'worker',
    verifier: 'verifier',
    secaudit: 'verifier',
    residuo: 'residuo',
  };
  function authorKind(clientId) {
    var c = String(clientId || '');
    if (c.indexOf('auto:') === 0 || c.indexOf('filo:') === 0) return 'filo';
    if (c.indexOf('owner:') === 0) return 'owner';
    // La sessione locale prima del ramo agent/routine: non ha ruoli dopo i due
    // punti da mappare, è una categoria sola.
    if (c.indexOf('local:') === 0) return 'local';
    if (c.indexOf('agent:') === 0 || c.indexOf('routine:') === 0) {
      var role = c.slice(c.indexOf(':') + 1).trim().toLowerCase();
      return ROLE_KIND[role] || 'claude';
    }
    return 'user';
  }

  // ── Chi può entrare in coda da solo ────────────────────────────────────────
  // La modalità automatica non è più un sì/no per tutti: l'owner sceglie QUALI
  // mittenti si fida di far entrare in coda senza passare da lui.
  //
  // UN INTERRUTTORE PER OGNI AUTORE CHE LA DASHBOARD MOSTRA. Fino a oggi le
  // cinque istanze di Claude (esplorazione, sviluppo, verifica, rilievi
  // residui, sessione locale) stavano dietro un interruttore solo: la coda le
  // distingueva con cinque icone diverse ma la fiducia era una sola, quindi
  // per non far entrare da solo l'esploratore bisognava fermare anche la
  // sessione locale. I due assi ora coincidono: chi si vede separato si regola
  // separato.
  //
  // `filo` resta SEPARATO dalle automazioni: un feedback che nasce da Filo è
  // la voce di un utente vero filtrata da un modello, non un processo
  // dell'owner. Metterli insieme farebbe entrare in coda del contenuto scritto
  // da un utente sotto l'etichetta "automazioni".
  //
  // L'ordine è quello della dashboard (AUTHOR_RANK in manage.js): prima le
  // persone, poi le istanze di Claude dalla più vicina all'owner, in fondo Filo.
  var AUTO_APPROVE_GROUPS = [
    'owner', 'user', 'local', 'worker', 'verifier', 'residuo', 'prober', 'claude', 'filo',
  ];

  // Le istanze di Claude. Servono al ripiego sul vecchio interruttore unico
  // (vedi resolveAutoApprove): un documento salvato prima di oggi ha solo
  // `claude`, e quel "no" deve continuare a valere per tutte e cinque finché
  // l'owner non sceglie diversamente. Senza questo, spezzare l'interruttore
  // riaprirebbe da solo cinque porte che l'owner aveva chiuso.
  var CLAUDE_GROUPS = ['local', 'worker', 'verifier', 'residuo', 'prober', 'claude'];

  // Il gruppo di fiducia di un mittente = la sua categoria d'autore, quella che
  // la dashboard mostra come icona. Una funzione sola per i due assi.
  function autoApproveGroup(clientId) {
    return authorKind(clientId);
  }

  /**
   * La mappa salvata → la mappa completa, un valore per ogni gruppo. PURA.
   *
   * Due ripieghi, in quest'ordine:
   *   · gruppo assente e mappa con il vecchio `claude` → eredita quel valore
   *     (solo per le istanze di Claude: è l'interruttore che le teneva tutte);
   *   · tutto il resto assente → ammesso, che è la semantica che l'automatica
   *     aveva prima che i sottointerruttori esistessero.
   *
   * Mappa assente del tutto ⇒ `null`: il chiamante sa che non c'è scelta
   * registrata e ammette tutti.
   */
  function resolveAutoApprove(map) {
    if (!map || typeof map !== 'object') return null;
    var legacy = map.claude;
    var out = {};
    for (var i = 0; i < AUTO_APPROVE_GROUPS.length; i++) {
      var g = AUTO_APPROVE_GROUPS[i];
      if (typeof map[g] === 'boolean') out[g] = map[g];
      else if (legacy === false && CLAUDE_GROUPS.indexOf(g) >= 0) out[g] = false;
      else out[g] = true;
    }
    return out;
  }

  // Decide se un feedback SICURO (giudicato allineato) può entrare in coda da
  // solo. PURA: la config arriva già letta.
  //   cfg = { enabled: bool, autoApprove?: { <gruppo>: bool, … } }
  // Interruttore master spento ⇒ mai, qualunque cosa dicano i sottointerruttori
  // (è lo stato sicuro: uno solo da spegnere per fermare tutto).
  // Mappa assente ⇒ tutti ammessi: è la semantica che l'automatica aveva prima
  // che i sottointerruttori esistessero, e non deve cambiare da sola.
  function autoApproveAllowed(clientId, cfg) {
    if (!cfg || cfg.enabled !== true) return false;
    var map = resolveAutoApprove(cfg.autoApprove);
    if (!map) return true;
    return map[autoApproveGroup(clientId)] !== false;
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
        // Gli allegati della segnalazione originale vivono nei campi PIATTI
        // `images`/`files`, non nelle note: la dashboard li mostra a parte.
        attachments: [],
      });
    }
    for (const seg of splitNotes(f.notes)) {
      turns.push({
        role: seg.role,
        kind: seg.role === 'model' ? 'note' : 'reply',
        body: seg.body,
        ts: seg.ts,
        attachments: seg.attachments || [],
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
  // opts.attachments: lista di allegati { kind, url, name?, type? } ANCORATI a
  // questo turno (serializzati come righe-marcatore subito sotto al testo).
  function appendUserTurn(oldNotes, replyText, opts) {
    const o = opts || {};
    const reply = String(replyText || '').trim();
    const attBlock = attachmentsBlock(o.attachments);
    // Una risposta fatta di soli allegati (senza parole) è valida.
    if (!reply && !attBlock) return String(oldNotes || '');
    const parts = [userTurnMarker(o.ts, o.label)];
    if (reply) parts.push(reply);
    if (attBlock) parts.push(attBlock);
    const block = parts.join('\n');
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
  // opts.attachments come in appendUserTurn (simmetria tra i due cammini).
  function appendModelTurn(oldNotes, reportText, opts) {
    const o = opts || {};
    const report = String(reportText || '').trim();
    const attBlock = attachmentsBlock(o.attachments);
    if (!report && !attBlock) return String(oldNotes || '');
    const parts = [modelTurnMarker(o.ts, o.label)];
    if (report) parts.push(report);
    if (attBlock) parts.push(attBlock);
    const block = parts.join('\n');
    const prev = String(oldNotes || '');
    return prev ? `${prev}\n\n${block}` : block;
  }

  // ── Compositore note editabile (tab Ricevuti/Da risolvere/Bozze/Agente) ──
  // Lì l'admin modifica l'INTERO blob `notes` come testo libero in una textarea.
  // Per gestire gli allegati senza mostrargli le righe-marcatore grezze:
  //   stripAttachments(notes) → { text, attachments } toglie le righe-marcatore
  //     dal testo (lasciando intatti i marcatori di turno `--- … ---`) e ritorna
  //     gli allegati raccolti, da mostrare come thumbnail sotto la textarea.
  //   composeNotes(text, attachments) → ri-incorpora gli allegati come righe in
  //     coda al testo al momento del salvataggio (inverso di stripAttachments).
  function stripAttachments(notes) {
    const lines = String(notes || '').split('\n');
    const kept = [];
    const attachments = [];
    for (const line of lines) {
      const att = parseAttachmentLine(line);
      if (att) attachments.push(att);
      else kept.push(line);
    }
    return { text: kept.join('\n'), attachments };
  }

  function composeNotes(text, attachments) {
    const base = String(text == null ? '' : text);
    const attBlock = attachmentsBlock(attachments);
    if (!attBlock) return base;
    const trimmed = base.replace(/\s+$/, '');
    return trimmed ? `${trimmed}\n${attBlock}` : attBlock;
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

  // ── Tetto alla lunghezza della conversazione ────────────────────────────────
  // Le Firestore rules limitano la dimensione del campo `notes`. Il limite non è
  // cosmetico: se le note SUPERANO il tetto, ogni successiva scrittura sul
  // feedback viene respinta dal server — anche una che non tocca le note (le
  // regole validano il documento RISULTANTE, non solo i campi cambiati). Il
  // feedback diventa quindi immobile: non lo si può più spostare di stato, né
  // commentare, né archiviare.
  //
  // Ci si arriva perché la conversazione CRESCE (report delle routine + risposte
  // dell'owner + righe-allegato) e perché uno dei cammini di scrittura (la
  // GitHub Action, che usa un service account) BYPASSA le regole: può gonfiare
  // le note oltre il tetto senza accorgersene, e a quel punto la dashboard —
  // che passa dalle regole — resta fuori.
  //
  // Difesa: TUTTI i cammini di scrittura passano da qui e tagliano i turni PIÙ
  // VECCHI finché il blob rientra, lasciando una riga che dichiara il taglio
  // (meglio perdere i turni antichi che perdere il feedback). Se cambi NOTES_MAX
  // qui, riallinea la copia del server (filo-security, routine/notes.js) e
  // rideploya.
  //
  // ⚠️ IL TETTO È IN BYTE, E STA SOTTO QUELLO DELLE REGOLE. Il taglio si fa sul
  // testo in chiaro, ma su Firestore ci va il CIFRATO (spec ROUTINE-AUTH-SPEC.md
  // §8), che è più lungo di un terzo: 6 + ceil(4*(94+byte)/3). Con il tetto
  // uguale a quello delle regole la conversazione passava il taglio e veniva
  // respinta dalle regole subito dopo: il feedback diventava immobile (nessun
  // cambio di stato, nessun commento) mentre il server, che le regole le
  // bypassa, continuava a gonfiarlo — cioè il guaio che questo tetto esiste per
  // impedire. 44.000 byte diventano 58.798 cifrati: ci stanno.
  const NOTES_MAX = 44000;
  const TRIM_MARK = '--- (i turni più vecchi sono stati rimossi: conversazione troppo lunga) ---';

  // Spezza il blob in blocchi grezzi: il primo è il testo prima di qualsiasi
  // marcatore, poi un blocco per ogni marcatore di turno (marcatore incluso).
  // Diverso da splitNotes(): qui NON si perde nulla (marcatori, righe vuote,
  // allegati restano dove sono) perché il risultato torna su Firestore.
  function rawBlocks(notes) {
    const lines = String(notes || '').split('\n');
    const blocks = [];
    let current = [];
    for (const line of lines) {
      if (USER_TURN_RE.test(line) || MODEL_TURN_RE.test(line)) {
        blocks.push(current.join('\n'));
        current = [line];
      } else {
        current.push(line);
      }
    }
    blocks.push(current.join('\n'));
    return blocks.filter((b, i) => i === 0 || b.length > 0);
  }

  /**
   * Quanto OCCUPA questo testo. In BYTE UTF-8, non in caratteri.
   *
   * È la differenza che ha fatto saltare il tetto: le regole Firestore contano
   * i byte del testo cifrato, che è ASCII e cresce in proporzione ai byte del
   * chiaro. Una conversazione di 40.000 CARATTERI accentati, o in cirillico o
   * in giapponese, sono 60.000-120.000 byte: passava il taglio e veniva
   * respinta dalle regole subito dopo. Con l'italiano quasi non si vede — ed è
   * il motivo per cui un tetto contato in caratteri sembra funzionare finché
   * qualcuno non scrive un feedback in un'altra lingua.
   */
  function byteLen(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    return Buffer.byteLength(s, 'utf8');
  }

  function capNotes(notes, max) {
    const limit = Number(max) > 0 ? Number(max) : NOTES_MAX;
    const s = String(notes == null ? '' : notes);
    if (byteLen(s) <= limit) return s;
    const blocks = rawBlocks(s);
    // Toglie i blocchi più vecchi finché il resto (+ la riga che dichiara il
    // taglio) rientra nel tetto. Tiene sempre almeno l'ultimo turno.
    while (blocks.length > 1) {
      blocks.shift();
      const candidate = `${TRIM_MARK}\n\n${blocks.join('\n').replace(/^\n+/, '')}`;
      if (byteLen(candidate) <= limit) return candidate;
    }
    // Un turno solo, più lungo del tetto: tiene l'inizio (marcatore compreso) e
    // taglia la coda. Si taglia a byte e si arretra finché non si è spezzato un
    // carattere a metà: un troncamento in mezzo a una lettera accentata
    // lascerebbe un carattere rotto in coda alla conversazione.
    const head = `${TRIM_MARK}\n\n`;
    const body = blocks.join('\n').replace(/^\n+/, '');
    const spazio = Math.max(0, limit - byteLen(head) - byteLen('…'));
    let tagliato = body;
    while (byteLen(tagliato) > spazio) {
      const troppi = byteLen(tagliato) - spazio;
      tagliato = tagliato.slice(0, Math.max(0, tagliato.length - Math.max(1, Math.ceil(troppi / 4))));
    }
    // Un carattere fuori dal piano base (un'emoji) in JS sono DUE unità: se il
    // taglio cade in mezzo resta mezza emoji, che non è più un carattere.
    const ultimo = tagliato.charCodeAt(tagliato.length - 1);
    if (ultimo >= 0xD800 && ultimo <= 0xDBFF) tagliato = tagliato.slice(0, -1);
    return head + tagliato + '…';
  }

  /**
   * Cosa legge CHI HA MANDATO il feedback, quando gli viene detto che è risolto.
   *
   * I DUE TESTI (spec ROUTINE-AUTH-SPEC.md §8). `userNote` è la frase scritta
   * per lui: breve, in chiaro, leggibile sulla SUA macchina, che non ha — giusta-
   * mente — nessuna chiave. `notes` è un'altra cosa: è il report per l'owner,
   * con le scelte della lavorazione, e da qui in avanti viaggia cifrato.
   * Mostrargli quello era il motivo per cui il report non poteva essere protetto.
   *
   * RETROCOMPATIBILITÀ: i feedback già chiusi hanno un testo solo, in chiaro,
   * dentro `notes`. Per quelli si continuano a estrarre i turni del modello, come
   * prima — altrimenti chi torna su un feedback vecchio non leggerebbe più
   * niente. Se invece `notes` è cifrato e la frase non c'è, non si mostra il
   * ciphertext: si tace, che è meglio di un blob.
   */
  /**
   * Il report NON è leggibile da chi sta guardando? Due forme, e vanno
   * riconosciute entrambe: il testo cifrato così com'è (nessuna chiave in
   * giro), e il SEGNAPOSTO che l'app mette al suo posto quando ha provato a
   * decifrare e non ci è riuscita. Riconoscerne una sola è come non averne
   * nessuna: nel caso scoperto la casella di modifica resta aperta su un
   * segnaposto, e il primo salvataggio cancella il report vero.
   */
  function reportUnreadable(notes) {
    const s = String(notes || '').trim();
    return s.startsWith('FENC') || s.startsWith('[cifrato');
  }

  function explanationForReporter(f) {
    const frase = String((f && f.userNote) || '').trim();
    if (frase) return frase;

    const raw = String((f && f.notes) || '').trim();
    if (!raw || reportUnreadable(raw)) return '';
    return splitNotes(raw)
      .filter((s) => s.role === 'model' && s.body)
      .map((s) => s.body)
      .join('\n\n')
      .trim();
  }

  global.SN_FEEDBACK_THREAD = {
    parse,
    splitNotes,
    explanationForReporter,
    reportUnreadable,
    isFromModel,
    isFromOwner,
    originOf,
    authorKind,
    // Il clientId con cui si firma una sessione locale. Sta qui perché chi lo
    // SCRIVE (scripts/claude-feedback.mjs) e chi lo LEGGE (authorKind) non
    // possano divergere su una stringa copiata a mano.
    LOCAL_CLIENT_ID: 'local:claude',
    MODEL_PREFIXES,
    // Auto-approvazione per mittente (#446). La LOGICA è specchiata nel backend
    // di sicurezza (filo-security: functions/src/autoApprove.js), che è l'unico
    // a deciderla davvero: se cambi i gruppi qui, riallinea quel file e rideploya.
    autoApproveGroup,
    autoApproveAllowed,
    AUTO_APPROVE_GROUPS,
    ownerize,
    userTurnMarker,
    appendUserTurn,
    modelTurnMarker,
    appendModelTurn,
    mergeModelReport,
    // Tetto alla conversazione (deve restare allineato a firestore.rules)
    capNotes,
    NOTES_MAX,
    TRIM_MARK,
    // Allegati per-turno (#190.3)
    serializeAttachment,
    parseAttachmentLine,
    attachmentsBlock,
    stripAttachments,
    composeNotes,
    ATTACH_PREFIX,
    USER_TURN_RE,
    MODEL_TURN_RE,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

// Logica pura: trasforma un feedback (segnalazione + note) nella sua CONVERSAZIONE a turni, così la dashboard la mostra a bolle invece che come un blocco dove segnalazione, risposte di Filo e risposte dell'utente si mescolano (#108).
// Il dato resta UNO (il campo `notes`): qui non si cambia lo schema, si parsa ciò che c'è. Le routine scrivono il loro report come testo libero; la dashboard, quando l'utente riapre o risponde, appende un blocco `--- Riaperto il <ts> ---`.
// Quindi il segmento iniziale delle note è il turno di Filo, e ogni marcatore apre un turno dell'utente.

(function (global) {
  'use strict';

  // Marcatori che aprono un turno dell'UTENTE. «Riaperto il» è quello storico già su Firestore e va riconosciuto per retrocompatibilità; l'altro lo usa la risposta dal tab Chiarimenti. Il gruppo 1 cattura il timestamp.
  const USER_TURN_RE = /^---\s*(?:Riaperto il|La tua risposta del)\s*(.*?)\s*---\s*$/;

  // Marcatore che apre un nuovo turno dell'AGENTE: serve quando una routine ri-risolve un feedback riaperto, perché il nuovo report va APPESO come turno separato e non deve sovrascrivere lo storico. Senza, il parser lo attribuirebbe al turno utente precedente.
  const MODEL_TURN_RE = /^---\s*(?:Aggiornamento dell'agente del|Filo ha risposto il)\s*(.*?)\s*---\s*$/;

  // Allegati PER-TURNO (#190.3). Il documento ha `images`/`files` PIATTI, buoni per la segnalazione originale: per legare un allegato a un singolo turno senza aggiungere campi a Firestore né toccare le regole, lo si codifica come riga-marcatore dentro `notes` — `@@filo-attachment {"kind":"img","url":"…"}`, un JSON per riga.
  // Il parser le toglie dal corpo e le raccoglie in `turn.attachments`, così l'allegato resta ANCORATO al turno in cui è stato incollato invece di finire nel mucchio insieme alla segnalazione.
  // JSON su riga singola: l'escaping gestisce nomi con spazi e caratteri speciali, e il prefisso è improbabile nella prosa.
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

  // Ritorna null se la riga è prosa normale. Difensivo: scarta gli URL non http(s), così un javascript:/data: non diventa un vettore XSS quando finisce in un href o un src.
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

  // Una riga per allegato.
  function attachmentsBlock(attachments) {
    const list = Array.isArray(attachments) ? attachments : [];
    return list.map(serializeAttachment).filter(Boolean).join('\n');
  }

  // I prefissi di `clientId` che dicono «questo testo l'ha scritto un'istanza di Claude, non una persona», e restano TRE cose diverse (vedi authorKind):
  // agent: l'esploratore che gira sull'app in cerca di problemi; routine: le automazioni in cloud, col ruolo dopo i due punti; local: la sessione locale, Claude che lavora sulla macchina dell'owner, in chat con lui.
  const MODEL_PREFIXES = ['agent:', 'routine:', 'local:'];

  // Inviato da un modello (issue d'agente, sub-feedback di una routine, ritrovamento di una sessione locale): allora anche la segnalazione originale è «lato Filo», non «lato utente».
  function isFromModel(clientId) {
    const c = String(clientId || '');
    return MODEL_PREFIXES.some(function (p) { return c.indexOf(p) === 0; });
  }

  // Invio MANUALE dell'owner. L'identità owner la applica il main al momento dell'invio (ownerize): il content script non sa di esserlo.
  function isFromOwner(clientId) {
    return String(clientId || '').startsWith('owner:');
  }

  // Classifica l'ORIGINE dal prefisso del clientId, per colorare card e bolle a colpo d'occhio: owner → 'owner' (verde), agent → 'agent' (accento), routine → 'routine' (blu), local → 'local' (viola), tutto il resto → 'user' (arancione).
  function originOf(clientId) {
    const c = String(clientId || '');
    if (c.startsWith('owner:')) return 'owner';
    if (c.startsWith('agent:')) return 'agent';
    if (c.startsWith('routine:')) return 'routine';
    if (c.startsWith('local:')) return 'local';
    return 'user';
  }

  // Categoria d'AUTORE, user-facing, per l'icona «chi l'ha scritto»: auto:/filo: → 'filo' (Filo per conto di un utente), owner: → 'owner', :prober → 'prober' (esplora l'app), :new-work/:fixer → 'worker' (implementa), :verifier/:secaudit → 'verifier' (parla del lavoro appena fatto), local: → 'local', routine:residuo → 'residuo', altre automazioni → 'claude', tutto il resto → 'user'.
  // Il MITTENTE dice quanto fidarsi e in che contesto leggere (#443): un rilievo del verificatore riguarda la modifica appena consegnata, uno dell'esploratore riguarda l'app in generale, uno di Filo è la voce di un utente vero filtrata. Per questo 'local' e 'residuo' sono categorie proprie e non collassano su 'prober' o 'verifier': leggendo la coda non si saprebbe più da dove nasce un ritrovamento, che è l'unica cosa che il mittente serve a dire.
  // `auto:`/`filo:` si controllano PRIMA di `owner:`: gli auto-feedback bypassano ownerize(), e l'ordine regge anche se un domani venissero marcati.
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
    // La sessione locale prima del ramo agent/routine: non ha ruoli da mappare dopo i due punti, è una categoria sola.
    if (c.indexOf('local:') === 0) return 'local';
    if (c.indexOf('agent:') === 0 || c.indexOf('routine:') === 0) {
      var role = c.slice(c.indexOf(':') + 1).trim().toLowerCase();
      return ROLE_KIND[role] || 'claude';
    }
    return 'user';
  }

  // Chi può entrare in coda da solo: la modalità automatica non è un sì/no per tutti, l'owner sceglie DI QUALI MITTENTI si fida.
  // Un interruttore per ogni autore che la dashboard mostra. Con le cinque istanze di Claude dietro un interruttore solo, la coda le distingueva con cinque icone ma la fiducia era una: per non far entrare l'esploratore bisognava fermare anche la sessione locale. Chi si vede separato si regola separato.
  // `filo` resta SEPARATO dalle automazioni: è la voce di un utente vero filtrata da un modello, non un processo dell'owner, e metterli insieme farebbe entrare in coda contenuto scritto da un utente sotto l'etichetta «automazioni». L'ordine è quello della dashboard (AUTHOR_RANK in manage.js).
  var AUTO_APPROVE_GROUPS = [
    'owner', 'user', 'local', 'worker', 'verifier', 'residuo', 'prober', 'claude', 'filo',
  ];

  // Le istanze di Claude, per il ripiego sul vecchio interruttore unico: un documento salvato prima ha solo `claude`, e quel «no» deve valere per tutte e cinque finché l'owner non sceglie diversamente — altrimenti spezzare l'interruttore riaprirebbe da solo cinque porte che aveva chiuso.
  var CLAUDE_GROUPS = ['local', 'worker', 'verifier', 'residuo', 'prober', 'claude'];

  // Il gruppo di fiducia di un mittente è la sua categoria d'autore, quella che la dashboard mostra come icona: una funzione sola per i due assi.
  function autoApproveGroup(clientId) {
    return authorKind(clientId);
  }

  /**
  * La mappa salvata → la mappa completa, un valore per ogni gruppo. PURA.
  * Due ripieghi: gruppo assente con il vecchio `claude` in mappa → eredita quel valore (solo per le istanze di Claude); tutto il resto assente → ammesso, la semantica che l'automatica aveva prima dei sottointerruttori.
  * Mappa assente del tutto ⇒ `null`: il chiamante sa che non c'è scelta registrata e ammette tutti.
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

  // Decide se un feedback giudicato allineato può entrare in coda da solo. PURA, la config arriva già letta: cfg = { enabled, autoApprove?: { <gruppo>: bool } }.
  // Master spento ⇒ mai, qualunque cosa dicano i sottointerruttori: è lo stato sicuro, uno solo da spegnere per fermare tutto. Mappa assente ⇒ tutti ammessi, la semantica di prima, che non deve cambiare da sola.
  function autoApproveAllowed(clientId, cfg) {
    if (!cfg || cfg.enabled !== true) return false;
    var map = resolveAutoApprove(cfg.autoApprove);
    if (!map) return true;
    return map[autoApproveGroup(clientId)] !== false;
  }

  // Idempotente: non raddoppia il prefisso e NON marca i feedback di origine modello, che owner non sono. Cap a 100 caratteri, il limite di `clientId` nelle firestore rules.
  function ownerize(clientId) {
    const c = String(clientId || '');
    if (!c || isFromModel(c) || c.startsWith('owner:')) return c;
    return ('owner:' + c).slice(0, 100);
  }

  // Spezza il blob `notes` nei suoi turni: { role: 'model'|'user', ts, body }, senza i segmenti vuoti (note che iniziano subito con un marcatore di riapertura).
  function splitNotes(notes) {
    const lines = String(notes || '').split('\n');
    const segments = [];
    // Il testo prima di qualsiasi marcatore è il turno di Filo.
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
      // Si tengono i segmenti con testo OPPURE con soli allegati: una risposta può essere fatta di una sola immagine.
      .filter((s) => s.body.length > 0 || s.attachments.length > 0);
  }

  // La conversazione completa. role 'model'|'user' decide lato e colore della bolla; kind 'report' (segnalazione iniziale) | 'note' (turno di Filo) | 'reply' (risposta o riapertura) decide l'etichetta; body resta grezzo, da escapare a valle; ts è ISO per la segnalazione e stringa già localizzata per i marcatori.
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
        // Gli allegati della segnalazione originale vivono nei campi PIATTI, non nelle note: la dashboard li mostra a parte.
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

  // Centralizzato qui così il parser e chi scrive restano allineati su una sola forma.
  function userTurnMarker(ts, label) {
    const when = ts || new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    return `--- ${label || 'La tua risposta del'} ${when} ---`;
  }

  // Appende un turno dell'utente conservando lo storico. `opts.attachments` sono gli allegati ANCORATI a questo turno, serializzati come righe subito sotto al testo.
  function appendUserTurn(oldNotes, replyText, opts) {
    const o = opts || {};
    const reply = String(replyText || '').trim();
    const attBlock = attachmentsBlock(o.attachments);
    // Una risposta fatta di soli allegati è valida.
    if (!reply && !attBlock) return String(oldNotes || '');
    const parts = [userTurnMarker(o.ts, o.label)];
    if (reply) parts.push(reply);
    if (attBlock) parts.push(attBlock);
    const block = parts.join('\n');
    const prev = String(oldNotes || '');
    return prev ? `${prev}\n\n${block}` : block;
  }

  // Simmetrico a userTurnMarker, per quando una routine ri-risolve un feedback già lavorato.
  function modelTurnMarker(ts, label) {
    const when = ts || new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    return `--- ${label || "Aggiornamento dell'agente del"} ${when} ---`;
  }

  // Come appendUserTurn: i due cammini restano simmetrici.
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

  // Compositore note editabile: nei tab dove l'admin modifica l'INTERO blob in una textarea non deve vedere le righe-marcatore grezze.
  // stripAttachments(notes) toglie le righe di allegato dal testo — lasciando intatti i marcatori di turno — e ritorna gli allegati da mostrare come thumbnail; composeNotes(text, attachments) li ri-incorpora al salvataggio.
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

  // Fonde il nuovo report di una routine con le note ESISTENTI senza perderle: la routine non conosce lo storico e il suo report arriva da solo, e senza questo riaprire un feedback faceva sparire la risposta dell'agente e la nota dell'owner.
  // Note vuote → il report è il primo turno, senza marcatore; report già contenuto (retry) → niente, per non duplicare; altrimenti si appende come nuovo turno dell'agente.
  function mergeModelReport(existingNotes, incomingReport, opts) {
    const incoming = String(incomingReport || '').trim();
    const existing = String(existingNotes || '');
    if (!incoming) return existing;
    if (!existing.trim()) return incoming;
    if (existing.includes(incoming)) return existing;
    return appendModelTurn(existing, incoming, opts);
  }

  // Tetto alla lunghezza della conversazione. Le firestore rules limitano `notes`, e il limite non è cosmetico: oltre il tetto ogni scrittura successiva viene respinta, anche una che le note non le tocca (le regole validano il documento RISULTANTE). Il feedback diventa immobile — non si sposta di stato, non si commenta, non si archivia.
  // Ci si arriva perché la conversazione cresce, e perché uno dei cammini di scrittura (la GitHub Action, con un service account) BYPASSA le regole: può gonfiare le note senza accorgersene, e la dashboard, che dalle regole ci passa, resta fuori. Difesa: TUTTI i cammini passano da qui e tagliano i turni PIÙ VECCHI finché il blob rientra, lasciando una riga che dichiara il taglio.
  // IL TETTO È IN BYTE E STA SOTTO QUELLO DELLE REGOLE: il taglio si fa sul chiaro, ma su Firestore va il CIFRATO, più lungo di un terzo — 6 + ceil(4*(94+byte)/3). Con il tetto uguale a quello delle regole la conversazione passava il taglio e veniva respinta subito dopo, cioè proprio il guaio che questo tetto esiste per impedire. 44.000 byte diventano 58.798 cifrati: ci stanno.
  // Se cambi NOTES_MAX, riallinea la copia del server (filo-security, routine/notes.js) e rideploya.
  const NOTES_MAX = 44000;
  const TRIM_MARK = '--- (i turni più vecchi sono stati rimossi: conversazione troppo lunga) ---';

  // Blocchi grezzi: il testo prima di ogni marcatore, poi un blocco per marcatore (incluso). Diverso da splitNotes(): qui non si perde nulla — marcatori, righe vuote, allegati restano dove sono — perché il risultato torna su Firestore.
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
  * Quanto OCCUPA questo testo, in BYTE UTF-8 e non in caratteri.
  * È la differenza che ha fatto saltare il tetto: le regole contano i byte del cifrato, che cresce in proporzione ai byte del chiaro. Quarantamila caratteri accentati, cirillici o giapponesi sono 60.000-120.000 byte: passavano il taglio e venivano respinti subito dopo.
  * Con l'italiano quasi non si vede, ed è per questo che un tetto contato in caratteri sembra funzionare finché qualcuno non scrive in un'altra lingua.
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
    // Toglie i blocchi più vecchi finché il resto, più la riga che dichiara il taglio, rientra. Tiene sempre almeno l'ultimo turno.
    while (blocks.length > 1) {
      blocks.shift();
      const candidate = `${TRIM_MARK}\n\n${blocks.join('\n').replace(/^\n+/, '')}`;
      if (byteLen(candidate) <= limit) return candidate;
    }
    // Un turno solo più lungo del tetto: si tiene l'inizio, marcatore compreso, e si taglia la coda a byte arretrando finché non si è spezzato un carattere a metà — un troncamento dentro una lettera accentata lascerebbe un carattere rotto.
    const head = `${TRIM_MARK}\n\n`;
    const body = blocks.join('\n').replace(/^\n+/, '');
    const spazio = Math.max(0, limit - byteLen(head) - byteLen('…'));
    let tagliato = body;
    while (byteLen(tagliato) > spazio) {
      const troppi = byteLen(tagliato) - spazio;
      tagliato = tagliato.slice(0, Math.max(0, tagliato.length - Math.max(1, Math.ceil(troppi / 4))));
    }
    // Un carattere fuori dal piano base (un'emoji) in JS sono DUE unità: tagliare in mezzo lascia mezza emoji, che non è più un carattere.
    const ultimo = tagliato.charCodeAt(tagliato.length - 1);
    if (ultimo >= 0xD800 && ultimo <= 0xDBFF) tagliato = tagliato.slice(0, -1);
    return head + tagliato + '…';
  }

  /**
  * Cosa legge CHI HA MANDATO il feedback quando gli viene detto che è risolto (ROUTINE-AUTH-SPEC.md §8).
  * I due testi sono cose diverse: `userNote` è la frase scritta per lui, breve e in chiaro, leggibile sulla SUA macchina, che non ha nessuna chiave; `notes` è il report per l'owner, con le scelte della lavorazione, e viaggia cifrato. Mostrargli quello era il motivo per cui il report non poteva essere protetto.
  * Retrocompatibilità: i feedback già chiusi hanno un testo solo in chiaro dentro `notes`, e per quelli si continuano a estrarre i turni del modello. Se invece `notes` è cifrato e la frase non c'è, si tace: meglio del blob.
  */
  /**
  * Il report NON è leggibile da chi sta guardando? Due forme, da riconoscere entrambe: il testo cifrato così com'è, e il SEGNAPOSTO che l'app mette al suo posto quando ha provato a decifrare senza riuscirci.
  * Riconoscerne una sola è come non averne nessuna: la casella di modifica resta aperta su un segnaposto, e il primo salvataggio cancella il report vero.
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
    // Il clientId con cui si firma una sessione locale. Sta qui perché chi lo SCRIVE (scripts/claude-feedback.mjs) e chi lo LEGGE non divergano su una stringa copiata a mano.
    LOCAL_CLIENT_ID: 'local:claude',
    MODEL_PREFIXES,
    // Auto-approvazione per mittente (#446). La logica è specchiata nel backend di sicurezza, che è l'unico a deciderla davvero: se cambi i gruppi qui, riallinea functions/src/autoApprove.js e rideploya.
    autoApproveGroup,
    autoApproveAllowed,
    resolveAutoApprove,
    AUTO_APPROVE_GROUPS,
    CLAUDE_GROUPS,
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

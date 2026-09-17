// Trasforma un feedback (segnalazione + note) nella sua CONVERSAZIONE a turni (#108).
// Il dato resta UNO, il campo `notes`: qui non si cambia lo schema, si parsa ciò che c'è.
// Il segmento iniziale è il turno di Filo, e ogni marcatore apre un turno nuovo.

(function (global) {
  'use strict';

  // «Riaperto il» è già su Firestore e va riconosciuto; l'altro lo usa il tab Chiarimenti.
  // Il gruppo 1 cattura il timestamp.
  const USER_TURN_RE = /^---\s*(?:Riaperto il|La tua risposta del)\s*(.*?)\s*---\s*$/;

  // Quando una routine ri-risolve un feedback riaperto il report va APPESO come turno nuovo:
  // senza questo marcatore il parser lo attribuirebbe al turno utente precedente.
  const MODEL_TURN_RE = /^---\s*(?:Aggiornamento dell'agente del|Filo ha risposto il)\s*(.*?)\s*---\s*$/;

  // Un allegato si lega al TURNO codificandolo come riga dentro `notes`, un JSON per riga:
  // Firestore non ha campi per-turno e `images`/`files` sono piatti (#190.3).
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

  // Null se la riga è prosa normale.
  // Scarta gli URL non http(s): un javascript:/data: finirebbe in un href come XSS.
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

  function attachmentsBlock(attachments) {
    const list = Array.isArray(attachments) ? attachments : [];
    return list.map(serializeAttachment).filter(Boolean).join('\n');
  }

  // I prefissi di `clientId` che dicono «questo l'ha scritto un'istanza di Claude»,
  // e restano TRE cose diverse: l'esploratore, le routine in cloud, la sessione locale.
  const MODEL_PREFIXES = ['agent:', 'routine:', 'local:'];

  // Se l'invio è di un modello, anche la segnalazione originale è «lato Filo».
  function isFromModel(clientId) {
    const c = String(clientId || '');
    return MODEL_PREFIXES.some(function (p) { return c.indexOf(p) === 0; });
  }

  // L'identità owner la applica il main all'invio: il content script non sa di esserlo.
  function isFromOwner(clientId) {
    return String(clientId || '').startsWith('owner:');
  }

  // Classifica l'ORIGINE dal prefisso del clientId: serve a colorare card e bolle.
  function originOf(clientId) {
    const c = String(clientId || '');
    if (c.startsWith('owner:')) return 'owner';
    if (c.startsWith('agent:')) return 'agent';
    if (c.startsWith('routine:')) return 'routine';
    if (c.startsWith('local:')) return 'local';
    return 'user';
  }

  // Categoria d'AUTORE: il mittente dice quanto fidarsi e in che contesto leggere (#443).
  // `auto:`/`filo:` si controllano PRIMA di `owner:`: gli auto-feedback bypassano ownerize().
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
    // La sessione locale non ha ruoli dopo i due punti: è una categoria sola.
    if (c.indexOf('local:') === 0) return 'local';
    if (c.indexOf('agent:') === 0 || c.indexOf('routine:') === 0) {
      var role = c.slice(c.indexOf(':') + 1).trim().toLowerCase();
      return ROLE_KIND[role] || 'claude';
    }
    return 'user';
  }

  // L'automatica non è un sì/no per tutti: l'owner sceglie di quali mittenti si fida.
  // `filo` resta SEPARATO: è la voce di un utente filtrata, non un'automazione.
  var AUTO_APPROVE_GROUPS = [
    'owner', 'user', 'local', 'worker', 'verifier', 'residuo', 'prober', 'claude', 'filo',
  ];

  // Ripiego sull'interruttore unico: un documento vecchio ha solo `claude`, e quel «no»
  // deve valere per tutte, o spezzare l'interruttore riaprirebbe porte già chiuse.
  var CLAUDE_GROUPS = ['local', 'worker', 'verifier', 'residuo', 'prober', 'claude'];

  // Il gruppo di fiducia è la categoria d'autore: una funzione sola per i due assi.
  function autoApproveGroup(clientId) {
    return authorKind(clientId);
  }

  // Gruppo assente col vecchio `claude` in mappa → eredita quel valore (solo per Claude);
  // tutto il resto assente → ammesso. Mappa assente del tutto ⇒ null, cioè nessuna scelta.
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

  // Master spento ⇒ mai, qualunque cosa dicano i sottointerruttori: è lo stato sicuro.
  // Mappa assente ⇒ tutti ammessi, la semantica di prima, che non deve cambiare da sola.
  function autoApproveAllowed(clientId, cfg) {
    if (!cfg || cfg.enabled !== true) return false;
    var map = resolveAutoApprove(cfg.autoApprove);
    if (!map) return true;
    return map[autoApproveGroup(clientId)] !== false;
  }

  // Idempotente, e NON marca i feedback di origine modello, che owner non sono.
  // Cap a 100 caratteri, il limite di `clientId` nelle firestore rules.
  function ownerize(clientId) {
    const c = String(clientId || '');
    if (!c || isFromModel(c) || c.startsWith('owner:')) return c;
    return ('owner:' + c).slice(0, 100);
  }

  // Turni { role, ts, body }, senza i segmenti vuoti di chi inizia con un marcatore.
  function splitNotes(notes) {
    const lines = String(notes || '').split('\n');
    const segments = [];
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
        const att = parseAttachmentLine(line);
        if (att) current.atts.push(att);
        else current.lines.push(line);
      }
    }
    segments.push(current);
    return segments
      .map((s) => ({ role: s.role, ts: s.ts, body: s.lines.join('\n').trim(), attachments: s.atts }))
      // Si tiene anche il segmento di soli allegati: una risposta può essere una sola immagine.
      .filter((s) => s.body.length > 0 || s.attachments.length > 0);
  }

  // role decide lato e colore della bolla; kind ('report'|'note'|'reply') decide l'etichetta.
  // `body` resta grezzo, da escapare a valle.
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
        // Gli allegati della segnalazione stanno nei campi PIATTI: la dashboard li mostra a parte.
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

  // `opts.attachments` sono ANCORATI a questo turno: righe subito sotto al testo.
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

  // Dove l'admin modifica l'INTERO blob in una textarea non deve vedere le righe-marcatore:
  // stripAttachments le toglie, composeNotes le ri-incorpora al salvataggio.
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

  // La routine non conosce lo storico e il suo report arriva da solo: senza questa fusione
  // riaprire un feedback faceva sparire la risposta dell'agente e la nota dell'owner.
  function mergeModelReport(existingNotes, incomingReport, opts) {
    const incoming = String(incomingReport || '').trim();
    const existing = String(existingNotes || '');
    if (!incoming) return existing;
    if (!existing.trim()) return incoming;
    if (existing.includes(incoming)) return existing;
    return appendModelTurn(existing, incoming, opts);
  }

  // Oltre il tetto le regole respingono OGNI scrittura sul feedback, che resta immobile:
  // TUTTI i cammini tagliano qui i turni più vecchi. È in BYTE, sotto il tetto delle regole.
  const NOTES_MAX = 44000;
  const TRIM_MARK = '--- (i turni più vecchi sono stati rimossi: conversazione troppo lunga) ---';

  // Diverso da splitNotes(): qui non si perde nulla, marcatori e righe vuote comprese,
  // perché il risultato torna su Firestore.
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

  // In BYTE UTF-8, non in caratteri: le regole contano i byte del cifrato.
  // Quarantamila caratteri accentati o giapponesi sono 60.000-120.000 byte.
  function byteLen(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    return Buffer.byteLength(s, 'utf8');
  }

  function capNotes(notes, max) {
    const limit = Number(max) > 0 ? Number(max) : NOTES_MAX;
    const s = String(notes == null ? '' : notes);
    if (byteLen(s) <= limit) return s;
    const blocks = rawBlocks(s);
    // Tiene sempre almeno l'ultimo turno, e la riga che dichiara il taglio conta nel tetto.
    while (blocks.length > 1) {
      blocks.shift();
      const candidate = `${TRIM_MARK}\n\n${blocks.join('\n').replace(/^\n+/, '')}`;
      if (byteLen(candidate) <= limit) return candidate;
    }
    // Un turno più lungo del tetto: si tiene l'inizio, marcatore compreso, e si taglia la coda
    // arretrando finché non si è spezzato un carattere a metà.
    const head = `${TRIM_MARK}\n\n`;
    const body = blocks.join('\n').replace(/^\n+/, '');
    const spazio = Math.max(0, limit - byteLen(head) - byteLen('…'));
    let tagliato = body;
    while (byteLen(tagliato) > spazio) {
      const troppi = byteLen(tagliato) - spazio;
      tagliato = tagliato.slice(0, Math.max(0, tagliato.length - Math.max(1, Math.ceil(troppi / 4))));
    }
    // Un'emoji in JS sono DUE unità: tagliare in mezzo lascia mezzo carattere.
    const ultimo = tagliato.charCodeAt(tagliato.length - 1);
    if (ultimo >= 0xD800 && ultimo <= 0xDBFF) tagliato = tagliato.slice(0, -1);
    return head + tagliato + '…';
  }

  // Cosa legge CHI HA MANDATO il feedback: `userNote` è la frase in chiaro per lui,
  // `notes` è il report per l'owner e viaggia cifrato. Se non c'è la frase, si tace.
  // Due forme da riconoscere entrambe: il testo cifrato e il SEGNAPOSTO messo al suo posto.
  // Riconoscerne una sola lascia la casella aperta, e il primo salvataggio cancella il report.
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
    // Sta qui perché chi lo scrive e chi lo legge non divergano su una stringa a mano.
    LOCAL_CLIENT_ID: 'local:claude',
    MODEL_PREFIXES,
    // A decidere davvero è il backend di sicurezza: se cambi i gruppi qui,
    // riallinea functions/src/autoApprove.js e rideploya.
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

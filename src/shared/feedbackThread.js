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

  // Un nome riservato vale solo con la prova che scrivono l'admin o il server (#595, #912): senza, è un utente nello
  // spazio `non-provato:`. Gemelli: effectiveClientId in manageReview.js e in filo-security (data/identities.js);
  // la sentinella tests/unit/mittentiProvati.test.mjs li tiene uguali.
  const RESERVED_SENDER_RE = /^(owner|routine|agent|local):/i;
  const SENDER_PROOFS = ['admin', 'server'];
  // Le funzioni di classificazione qui sotto prendono il FEEDBACK (si legge la prova) o una stringa che è già un
  // mittente efficace o una firma scritta dall'admin; il `clientId` grezzo di un feedback non va passato.
  function senderOf(x) {
    if (!x || typeof x !== 'object') return String(x || '');
    const c = String(x.clientId || '');
    return RESERVED_SENDER_RE.test(c) && SENDER_PROOFS.indexOf(x.senderProof) === -1 ? 'non-provato:' + c : c;
  }

  // true se il feedback è stato inviato da un modello (issue d'agente,
  // sub-feedback creato da una routine, ritrovamento di una sessione locale):
  // in quel caso anche la segnalazione originale è "lato Filo", non
  // "lato utente".
  function isFromModel(fb) {
    const c = senderOf(fb);
    return MODEL_PREFIXES.some(function (p) { return c.indexOf(p) === 0; });
  }

  // true se il feedback è un invio MANUALE dell'owner (admin loggato). L'identità
  // owner viene applicata nel main process al momento dell'invio (vedi
  // ownerize): il content script non sa di esserlo.
  function isFromOwner(fb) {
    return senderOf(fb).startsWith('owner:');
  }

  // Classifica l'ORIGINE di un feedback dal prefisso del clientId. Serve alla
  // dashboard per colorare card e bolle a colpo d'occhio:
  //   owner:<id>     → 'owner'    invio manuale dell'admin loggato (verde)
  //   agent:<model>  → 'agent'    agente esploratore LLM (accento)
  //   routine:<slug> → 'routine'  audit automatico delle routine cloud (blu)
  //   local:<slug>   → 'local'    sessione locale di Claude (viola)
  //   <altro>        → 'user'     alpha tester esterno (arancione)
  function originOf(fb) {
    const c = senderOf(fb);
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
  //   routine:residuo       → 'residuo'  i rilievi DERIVATI da una verifica: quelli
  //                                      che quel lavoro non corregge (esterni, o
  //                                      interni messi da parte dal bilancio),
  //                                      aperti dal SERVER uno per rilievo come
  //                                      feedback figli del lavoro (#N.k), con la
  //                                      priorità del livello. Categoria propria, NON
  //                                      prober e NON verifier: spacciarlo per uno
  //                                      dei due falserebbe la lettura di dove
  //                                      nascono i ritrovamenti
  //   agent:costruzione     → 'costruzione' l'allarme della pubblicazione (#1002): lo
  //                                      apre il SERVER quando costruzione o suite di
  //                                      una versione sono rosse; non è un'istanza di
  //                                      Claude e il testo è una coda di registro
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
    costruzione: 'costruzione',
  };
  function authorKind(fb) {
    var c = senderOf(fb);
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

  // Scritto da Filo (chat o segnalazione automatica), per conto di chi: 'owner' se porta la prova dell'admin, 'user'
  // se lo dichiara soltanto, '' se non è di Filo. Solo per l'etichetta: categoria e fiducia restano di authorKind (#953).
  function filoPerConto(fb) {
    const c = senderOf(fb);
    const resto = c.indexOf('owner:') === 0 ? c.slice('owner:'.length) : c;
    if (resto.indexOf('filo:') !== 0 && resto.indexOf('auto:') !== 0) return '';
    return fb && typeof fb === 'object' && fb.senderProof === 'admin' ? 'owner' : 'user';
  }

  // ── Chi può entrare in coda da solo ────────────────────────────────────────
  // L'automatica ha un sottointerruttore per livello di fiducia, mai per mittente (SPEC-DOMANDE.md §10: il mittente
  // non dà permessi). SPECCHIO di filo-security functions/src/autoApprove.js, che decide davvero: stessi casi in
  // tests/unit/autoApprove.test.mjs e nel gemello del server.
  var AUTO_APPROVE_GROUPS = ['fidato', 'non_fidato'];

  // Le mappe salvate prima del §10 avevano un interruttore per mittente: non riaprono da sole ciò che l'owner aveva
  // chiuso. All'automatica arrivano fidati solo i ritrovamenti delle routine e gli allarmi; non fidato chiunque.
  var LEGACY_GROUPS = {
    fidato: ['worker', 'verifier', 'residuo', 'prober', 'claude'],
    non_fidato: ['owner', 'user', 'local', 'worker', 'verifier', 'residuo', 'prober', 'claude', 'filo'],
  };

  // Il gruppo è la fiducia del feedback: assente o ignota vale non fidato.
  function autoApproveGroup(fiducia) {
    return fiducia === 'fidato' ? 'fidato' : 'non_fidato';
  }

  /**
   * La mappa salvata → un valore per ogni gruppo. Un gruppo assente eredita dai vecchi interruttori per mittente (uno
   * spento lo chiude); senza nemmeno quelli è ammesso. Mappa assente ⇒ `null`: il chiamante ammette tutti. PURA.
   */
  function resolveAutoApprove(map) {
    if (!map || typeof map !== 'object') return null;
    var out = {};
    for (var i = 0; i < AUTO_APPROVE_GROUPS.length; i++) {
      var g = AUTO_APPROVE_GROUPS[i];
      out[g] = typeof map[g] === 'boolean'
        ? map[g]
        : !LEGACY_GROUPS[g].some(function (k) { return map[k] === false; });
    }
    return out;
  }

  // Un feedback giudicato sicuro può entrare in coda da solo? Master spento ⇒ mai (uno solo da spegnere per fermare
  // tutto); mappa assente ⇒ tutti ammessi. PURA.
  function autoApproveAllowed(fiducia, cfg) {
    if (!cfg || cfg.enabled !== true) return false;
    var map = resolveAutoApprove(cfg.autoApprove);
    if (!map) return true;
    return map[autoApproveGroup(fiducia)] !== false;
  }

  // Idempotente, e NON marca i feedback di origine modello, che owner non sono.
  // Cap a 100 caratteri, il limite di `clientId` nelle firestore rules.
  function ownerize(clientId) {
    const c = String(clientId || '');
    if (!c || isFromModel(c) || c.startsWith('owner:')) return c;
    return ('owner:' + c).slice(0, 100);
  }

  // Una riga finisce a OGNI a capo, di qualunque tipo: chi ripulisce e chi legge spezzano solo così, o un «\r» in
  // mezzo a un marcatore sfugge a chi ripulisce e apre un turno per chi legge. Copia sul server: routine/notes.js.
  const A_CAPO_RE = /\r\n|[\n\r\u2028\u2029]/;
  function righe(s) {
    return String(s == null ? '' : s).split(A_CAPO_RE);
  }

  // Spezza il blob `notes` nei suoi turni. Ritorna una lista di
  // { role: 'model'|'user', ts: string|null, body: string } senza i segmenti
  // vuoti (es. note che iniziano direttamente con un marcatore di riapertura).
  function splitNotes(notes) {
    const lines = righe(notes || '');
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
        role: isFromModel(f) ? 'model' : 'user',
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

  // L'istante scritto in un marcatore, in ISO, o null. I marcatori sono scritti in italiano (giorno/mese, anno a due
  // o quattro cifre, ora locale di chi scrive): `new Date()` li legge mese/giorno e sbaglia o li scarta (#764).
  const DATA_MARCATORE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:,?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/;
  function istanteDelMarcatore(ts) {
    const s = String(ts == null ? '' : ts).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const t = Date.parse(s);
      return Number.isNaN(t) ? null : new Date(t).toISOString();
    }
    const m = DATA_MARCATORE_RE.exec(s);
    if (!m) return null;
    const [g, me, a, h, mi, se] = [m[1], m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0].map(Number);
    const anno = m[3].length === 2 ? 2000 + a : a;
    const d = new Date(anno, me - 1, g, h, mi, se);
    // Un 31/02 o un 25:00 non è una data: Date li farebbe scivolare in avanti in silenzio.
    if (d.getFullYear() !== anno || d.getMonth() !== me - 1 || d.getDate() !== g
      || d.getHours() !== h || d.getMinutes() !== mi) return null;
    return d.toISOString();
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

  // Fonde il nuovo report di una routine con le note ESISTENTI, senza perderle.
  // È il fix di "riaprendo un feedback perdo la risposta dell'agente e la mia
  // nota": quando una routine ri-risolve un feedback già lavorato, il suo report
  // arriva da solo (la routine non conosce lo storico). Questa funzione decide:
  //   - note esistenti vuote → il report diventa il primo turno (nessun marcatore);
  //   - report già contenuto nelle note (re-applicazione/retry) → niente, evita
  //     duplicati;
  //   - altrimenti → APPENDI il report come nuovo turno dell'agente, conservando
  //     report precedente + annotazione di riapertura dell'utente.
  // Un report di un agente non può aprire un turno: una riga che imita un
  // confine («--- La tua risposta del … ---») diventerebbe una decisione
  // dell'owner. Resta leggibile, citata con «> » davanti (come fa il server).
  // Lo stesso per l'intestazione di un blocco di domande: le scrive solo il server.
  const CONFINE_GENERICO_RE = /^---\s.*\sdel\s.*---\s*$/;
  const CONFINE_PROPRIETARIO_RE = /^---\s*(?:Risposta|Aggiornamento) (?:dell'utente|dell’utente|del proprietario) del .*---\s*$/;
  const DOMANDA_SERVER_RE = /^(?:Segnalazione|Domande) per l'owner \(chi [^)\n]+\):/;
  function neutralizzaConfini(report) {
    return righe(report || '').map((l) => {
      const confine = USER_TURN_RE.test(l) || MODEL_TURN_RE.test(l) || CONFINE_GENERICO_RE.test(l)
        || CONFINE_PROPRIETARIO_RE.test(l) || DOMANDA_SERVER_RE.test(l.trim());
      return confine ? `> ${l}` : l;
    }).join('\n');
  }

  function mergeModelReport(existingNotes, incomingReport, opts) {
    const incoming = neutralizzaConfini(String(incomingReport || '').trim());
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
  // impedire. 400.000 byte diventano 533.465 cifrati: le regole ne ammettono
  // 540.000, e il documento intero resta sotto il MiB di Firestore.
  //
  // Dimensionato sul caso peggiore realistico (#1333): dieci giri di bocciatura
  // con critica al suo tetto (anch'esso in byte, scripts/lib/tetto-critica.mjs)
  // e report lunghi, più segnalazioni e domande, in qualunque lingua, devono
  // lasciare leggibile il primo turno. La sentinella è
  // tests/unit/tettiConversazione.test.mjs.
  const NOTES_MAX = 400000;
  const TRIM_MARK = '--- (i turni più vecchi sono stati rimossi: conversazione troppo lunga) ---';

  // Diverso da splitNotes(): qui non si perde nulla, marcatori e righe vuote comprese,
  // perché il risultato torna su Firestore.
  function rawBlocks(notes) {
    const lines = righe(notes || '');
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
    // Toglie i blocchi più vecchi finché il resto (+ la riga che dichiara il
    // taglio) rientra nel tetto. Tiene sempre almeno l'ultimo turno. Le misure
    // si sommano una volta sola: col tetto a centinaia di KB, ricomporre il
    // testo a ogni turno tolto costava secondi a ogni scrittura.
    const misure = blocks.map(byteLen);
    const testa = byteLen(`${TRIM_MARK}\n\n`);
    let resto = misure.reduce((a, b) => a + b, 0) + blocks.length - 1;
    for (let i = 1; i < blocks.length; i++) {
      resto -= misure[i - 1] + 1;
      if (testa + resto > limit) continue;
      const candidate = `${TRIM_MARK}\n\n${blocks.slice(i).join('\n').replace(/^\n+/, '')}`;
      if (byteLen(candidate) <= limit) return candidate;
    }
    blocks.splice(0, blocks.length - 1);
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
    // Un'emoji in JS sono DUE unità: tagliare in mezzo lascia mezzo carattere.
    const ultimo = tagliato.charCodeAt(tagliato.length - 1);
    if (ultimo >= 0xD800 && ultimo <= 0xDBFF) tagliato = tagliato.slice(0, -1);
    return head + tagliato + '…';
  }

  // `userNote` è la frase in chiaro per chi ha mandato, `notes` il report cifrato per l'owner.
  // Si riconoscono sia il cifrato sia il SEGNAPOSTO, o il primo salvataggio cancella il report.
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
    senderOf,
    filoPerConto,
    // Il clientId con cui si firma una sessione locale. Sta qui perché chi lo
    // SCRIVE (scripts/claude-feedback.mjs) e chi lo LEGGE (authorKind) non
    // possano divergere su una stringa copiata a mano.
    LOCAL_CLIENT_ID: 'local:claude',
    MODEL_PREFIXES,
    // L'automatica per fiducia (§10): specchio di filo-security functions/src/autoApprove.js.
    autoApproveGroup,
    autoApproveAllowed,
    resolveAutoApprove,
    AUTO_APPROVE_GROUPS,
    LEGACY_GROUPS,
    ownerize,
    userTurnMarker,
    istanteDelMarcatore,
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
    A_CAPO_RE,
    righe,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

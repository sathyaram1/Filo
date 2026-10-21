// Dashboard interna: triage dei feedback alpha; stato e note su Firestore.
// Sezione, ordinamento e conteggio passano dalle STESSE funzioni pure della dashboard di
// gestione (SN_MANAGE_REVIEW): due liste calcolate dallo stesso codice non divergono (#509).

(function () {
  'use strict';

  // Senza il vocabolario della macchina a stati e la logica di sezione condivisa, fermarsi
  // con un errore leggibile è meglio di sezioni vuote che non dicono perché.
  const FS = window.SN_FB_STATUS;
  const MR = window.SN_MANAGE_REVIEW;
  if (!FS || !MR) {
    throw new Error('feedback.js: carica shared/feedbackTransitions.js, feedbackStatus.js e manageReview.js prima di questa pagina');
  }
  // Il giro dal vivo, lo stesso della Gestione (feedbackLive.js + feedbackLivePagina.js).
  const LIVE = window.SN_FEEDBACK_LIVE;
  const PAG = window.SN_FEEDBACK_LIVE_PAGINA;
  // Note e frase partono dopo una pausa e a ogni uscita (Ctrl, cambio o chiusura della scheda): la regola delle caselle.
  const caselleTesti = window.SN_CASELLE.crea();
  const PAUSA_TESTI_MS = 1500;
  let live = null;

  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  const countEl = document.getElementById('count');
  const searchEl = document.getElementById('search');
  const refreshBtn = document.getElementById('refresh');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const tabsEl = document.getElementById('tabs');
  const noSectionsEl = document.getElementById('noSections');
  const agentOnlyEl = document.getElementById('agentOnly');
  const adminBanner = document.getElementById('adminBanner');
  const adminBannerText = document.getElementById('adminBannerText');
  const adminSignInBtn = document.getElementById('adminSignIn');
  // Interruttore master «gestione automatica» (owner-only, filo-security DESIGN §2). Default
  // OFF: finché è OFF anche i feedback sicuri richiedono verifica umana (config/automation).
  const automationRow = document.getElementById('automationRow');
  const automationToggle = document.getElementById('automationToggle');
  const automationDesc = document.getElementById('automationDesc');

  // Gestione E lettura dei feedback sono riservate agli admin (#583). La garanzia forte è
  // server-side (Firestore rules): qui è solo il gate UX, ogni scrittura passa dal main.
  let isAdmin = false;

  // Gli allegati si chiedono una volta per indirizzo e la risposta resta in memoria, ma un
  // «no» dipende da CHI guarda: al cambio di identità va svuotata, nei due sensi (#582).
  function setIsAdmin(v) {
    const nuovo = Boolean(v);
    if (nuovo === isAdmin) return;
    isAdmin = nuovo;
    fbImgCache.clear();
    fbFileWhyCache.clear();
  }

  // Su pagine filo:// il ponte col main è sempre presente.
  function sendToMain(msg) {
    if (window.filo?.message) return window.filo.message(msg);
    if (window.chrome?.runtime?.sendMessage) return window.chrome.runtime.sendMessage(msg);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  // Le sezioni della macchina a stati, le stesse della dashboard di
  // gestione: 'inbox' Ricevuti (aspettano una decisione dell'owner), 'queue'
  // In coda (l'iter di lavorazione), 'local' Lavori locali (la stessa coda, che
  // le routine non prendono: #908), 'waiting' Aspettano (in coda dopo altri feedback: #903), 'resolved' Risolti (fix usciti davvero in
  // una versione rilasciata), 'archived' Archiviati.
  const TABS = ['inbox', 'queue', 'local', 'waiting', 'resolved', 'archived'];
  const TAB_LABELS = {
    inbox: 'Ricevuti', queue: 'In coda', local: 'Lavori server', waiting: 'Aspettano', resolved: 'Risolti', archived: 'Archiviati',
  };
  const TAB_EMPTY = {
    inbox: 'Nessun feedback in attesa di una tua decisione.',
    queue: 'Nessun feedback in lavorazione.',
    local: 'Nessun lavoro server.',
    waiting: 'Nessun feedback aspetta un altro.',
    resolved: 'Nessun fix uscito in una versione rilasciata.',
    archived: 'Nessun feedback archiviato.',
  };

  let all = [];
  let currentTab = 'inbox';
  // Ritrovamenti automatici: filtro trasversale alle quattro sezioni, non una sezione a sé.
  let agentOnly = false;
  // DB3: la versione in esecuzione è, per definizione, l'ultima rilasciata. Senza, un `done`
  // non ancora spedito starebbe in «Risolti» qui e in «In coda» nella gemella.
  let releasedVersion = '';
  // Finché i feedback non sono arrivati davvero la pagina non conosce nessun numero: le
  // sezioni restano col solo nome (#495).
  let dataLoaded = false;
  // Ultimo caricamento fallito: la frase e «Riprova» da rimettere se un re-render svuota il
  // riquadro.
  let loadError = null;
  // Generazione dei caricamenti: ogni load() butta il proprio risultato se nel frattempo ne
  // è partito un altro, o quello lento aperto all'avvio sovrascriverebbe il più recente.
  let loadGen = 0;
  // Le richieste di fusione del server (solo l'owner le legge): una che aspetta il suo sì porta la pratica nei
  // Ricevuti anche con lo stato rimasto indietro. Stessa regola delle sezioni della Gestione (MR.manageTabFor).
  let fusioni = { pending: [], failed: [], recent: [], preapproved: [] };
  // Il più vecchio caricato, quando il caricamento si è fermato al tetto: il giro non porta dentro i più vecchi.
  let sogliaFinestra = null;
  function opzSezioni() {
    return { releasedVersion, fusioni, trovaAtteso: (id) => all.find((f) => f._id === id) };
  }

  // Stato CANONICO (FEEDBACK-STATES.md §2): unica porta d'ingresso, normalizeStatus scioglie
  // anche gli stati dello storico.
  function statusOf(f) {
    return MR.normalizeStatus(f).status;
  }
  function statusReasonOf(f) {
    return MR.normalizeStatus(f).statusReason;
  }

  // Sezione di un feedback: la STESSA funzione della dashboard di gestione.
  function tabOf(f) {
    return MR.manageTabFor(f, opzSezioni());
  }

  // La regola su cosa è illeggibile e su cosa si scrive al suo posto vive nel modulo
  // condiviso: tenerne una copia qui è il modo in cui le due pagine hanno divergito (#509).
  function statoCifrato(f) {
    return MR.statusUnreadable(f);
  }
  function sezioniAttendibili() {
    return MR.sectionsReliable(all);
  }

  // Ritrovamenti automatici (filtro "Solo automatici"). Due fonti:
  //   - agente esploratore LLM: clientId "agent:<model>" (vedi tests/agent/feedback.mjs);
  //   - audit proattivo di una routine cloud: clientId "routine:<slug>" ancora
  //     da triagiare (status canonico `unlabeled`, o il legacy `new` che ci si
  //     normalizza). I sub-feedback di una routine portano lo stesso prefisso ma
  //     nascono `todo`/`design`: NON sono ritrovamenti d'agente, quindi qui si
  //     escludono col vincolo sullo stato.
  // #595: un prefisso riservato senza prova del mittente vale come un utente, anche nei colori e nei filtri.
  function mittenteDi(f) {
    return MR.effectiveClientId(f);
  }
  function isAgent(f) {
    const c = mittenteDi(f);
    if (c.startsWith('agent:')) return true;
    if (c.startsWith('routine:') && statusOf(f) === 'unlabeled') return true;
    return false;
  }
  // Origine del feedback: delega alla logica condivisa, così dashboard e main classificano uguale.
  function originOf(f) {
    const c = mittenteDi(f);
    if (window.SN_FEEDBACK_THREAD && SN_FEEDBACK_THREAD.originOf) return SN_FEEDBACK_THREAD.originOf(c);
    if (c.startsWith('owner:')) return 'owner';
    if (c.startsWith('agent:')) return 'agent';
    if (c.startsWith('routine:')) return 'routine';
    if (c.startsWith('local:')) return 'local';
    return 'user';
  }
  // L'agente esploratore codifica «severità|area|titolo» nel campo `title`; l'audit di una
  // routine no (il titolo breve sta in `name`), quindi va trattato a parte.
  function agentMeta(f) {
    const c = String(f.clientId || '');
    // L'allarme della pubblicazione (#1002) non è un modello: il suo titolo sta in `name`.
    if (window.SN_FEEDBACK_THREAD && SN_FEEDBACK_THREAD.authorKind(f) === 'costruzione') {
      return { source: 'costruzione', model: '', severity: '', area: '', title: String(f.name || '').trim() };
    }
    if (c.startsWith('routine:')) {
      const slug = c.slice('routine:'.length) || 'routine';
      return { source: 'routine', model: slug, severity: '', area: '', title: String(f.name || '').trim() };
    }
    const model = c.slice('agent:'.length) || '?';
    const parts = String(f.title || '').split('|');
    const severity = parts.length >= 3 ? parts[0].trim() : '';
    const area = parts.length >= 3 ? parts[1].trim() : '';
    const title = parts.length >= 3 ? parts.slice(2).join('|').trim() : (f.title || '');
    return { source: 'agent', model, severity, area, title };
  }

  // Più pallini pieni = le routine affrontano prima quel feedback.
  function priorityOf(f) {
    const p = Math.round(Number(f.priority) || 0);
    return p >= 1 && p <= 3 ? p : 0;
  }

  function priorityDotsHtml(f) {
    const p = priorityOf(f);
    // Non-admin: pallini decorativi (sola lettura), nessun click.
    const dots = [1, 2, 3].map((n) => {
      const on = n <= p ? ' fb-dot--on' : '';
      if (!isAdmin) {
        return `<span class="fb-dot fb-dot--readonly${on}" aria-label="Priorità ${n}"></span>`;
      }
      return `<button type="button" class="fb-dot${on}" data-id="${escapeHtml(f._id)}" data-n="${n}" title="Priorità ${n}${p === n ? ' (clic per azzerare)' : ''}" aria-label="Priorità ${n}"></button>`;
    }).join('');
    return `<div class="fb-priority" title="Priorità: ${p || '—'}">${dots}</div>`;
  }

  // Badge «in lavorazione»: il semaforo lo tiene il server e lo specchia su Firestore.
  // Mostrato solo finché il claim non è scaduto; vuoto o scaduto = libero.
  function claimBadgeHtml(f) {
    const exp = Date.parse(f.claimExpiresAt || '');
    if (!Number.isFinite(exp) || exp <= Date.now()) return '';
    const who = String(f.claimedBy || '').slice(0, 40);
    const title = `Una routine ci sta lavorando${who ? ` (${who})` : ''} — scade ${fmtTs(f.claimExpiresAt)}`;
    return `<span class="fb-claim" title="${escapeHtml(title)}">🔧 in lavorazione</span>`;
  }

  // Branch git del fix in attesa di verifica (stati `review`/`blocked` del cancello di merge).
  function branchBadgeHtml(f) {
    const b = String(f.branch || '').trim();
    if (!b) return '';
    return `<span class="fb-branch" title="Branch del fix: ${escapeHtml(b)}">⎇ ${escapeHtml(b)}</span>`;
  }

  // Dentro «Ricevuti» e «In coda» vivono stati diversi: senza questa riga la card non direbbe
  // più a che punto è. Colore, testo e motivo vengono dal vocabolario unico.
  function stateBadgeHtml(f) {
    // Stato cifrato: la macchina lo ridurrebbe a «Non filtrato» anche su un feedback già chiuso.
    // L'unica cosa vera è l'enum in chiaro `statusPublic`; le PAROLE dal modulo condiviso.
    const b = MR.stateBadge(f);
    if (!b) return '';
    const dot = b.color
      ? `<span class="fb-state-dot" style="color:${escapeHtml(b.color)}"></span>`
      : '';
    return `<span class="fb-state" title="${escapeHtml(b.hint)}">${dot}${escapeHtml(b.label)}`
      + `${b.showReason ? ` <span class="fb-state-reason">— ${escapeHtml(b.reasonText)}</span>` : ''}</span>`;
  }

  // Una fusione ferma è il motivo per cui una pratica con uno stato di lavoro sta nei Ricevuti: la scheda lo dice.
  // Il sì si dà in Gestione, dove c'è la richiesta con quello che ha fermato i controlli.
  function fusioneChipHtml(f) {
    const l5 = MR.livelloL5(f, { fusioni });
    if (!l5 || (l5.esito !== 'bloccato' && l5.esito !== 'conflitto')) return '';
    const testo = l5.esito === 'conflitto' ? 'fusione non avvenuta' : 'fusione ferma';
    const titolo = `${(l5.pannello && l5.pannello.testo) || ''} Si decide in Gestione.`.trim();
    return `<span class="fb-fusione" title="${escapeHtml(titolo)}">${escapeHtml(testo)}</span>`;
  }

  // «Aspetta #N» (#903): cosa aspetta e lo stato di ciascuno, come in Gestione (dove si mette e si toglie).
  function attesaChipHtml(f) {
    const ATT = window.SN_FB_ATTESE;
    const stati = ATT ? ATT.statiDelleAttese(f, opzSezioni().trovaAtteso) : [];
    if (!stati.length) return '';
    const testo = stati.map((w) => `${ATT.etichetta(w)} ${ATT.ETICHETTA[w.stato] || w.stato}`).join(', ');
    return `<span class="fb-attesa" title="Nessuna routine lo prende finché non sono tutti fusi. Si cambia in Gestione.">⏳ aspetta ${escapeHtml(testo)}</span>`;
  }

  // «Aspetta D-12», gemello del segno in Gestione (SPEC-DOMANDE §3.8): si risponde in un posto solo, e il clic ci porta.
  function domandaChipHtml(f) {
    const id = MR.aspettaDomanda(f);
    if (!id) return '';
    const titolo = `Aspetta la tua risposta alla domanda ${id}: aprila in Gestione`;
    return `<button type="button" class="fb-attesa fb-domanda" data-domanda="${escapeHtml(id)}" title="${escapeHtml(titolo)}" aria-label="${escapeHtml(titolo)}">aspetta ${escapeHtml(id)}</button>`;
  }

  function apriDomandaInGestione(id) {
    return sendToMain({ type: 'open_url', url: `filo://manage/manage.html#domanda=${encodeURIComponent(id)}` });
  }

  // Il segno dei Ricevuti, gemello di quello della gestione (D93): stessa forma, stesso motivo sotto il puntatore.
  function segnoFermataHtml(f) {
    const s = MR.segnoFermata(f, { fusioni });
    if (!s || !MR.FORME_SVG[s.forma]) return '';
    const cls = 'fb-segno' + (s.classe ? ` fb-segno--${s.classe}` : ' fb-segno--vuoto');
    return `<span class="${escapeHtml(cls)}" data-forma="${escapeHtml(s.forma)}" title="${escapeHtml(s.testo)}" aria-label="${escapeHtml(s.testo)}" role="img">`
      + `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${MR.FORME_SVG[s.forma]}"/></svg></span> `;
  }

  function fmtTs(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) { return String(ts); }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // Filtra URL non sicuri (javascript:, data:) prima dell'href: i feedback arrivano da utenti
  // reali, e un URL malevolo finito in DB non deve diventare un vettore XSS al click.
  function safeHref(rawUrl) {
    if (!rawUrl) return '';
    try {
      const u = new URL(rawUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch (_) {}
    return '';
  }

  // Allegati ANCORATI al turno (#190.3): righe-marcatore dentro `notes`, così non cambiano
  // schema né regole. Allowlist dei tipi UNA, condivisa col riquadro dentro i siti (#582).
  const AttachTypes = window.SN_FEEDBACK_ATTACH;
  const ATTACH_REJECT_MSG =
    'Tipo di file non supportato. Ammessi: immagini, PDF, testo, markdown, CSV e JSON.';

  // Se l'allowlist condivisa non si carica il ripiego deve CHIUDERE (solo immagini raster),
  // non aprire: un gate che sparisce in silenzio quando manca un pezzo è un gate che non c'è.
  function classificaAllegato(file) {
    if (AttachTypes && typeof AttachTypes.classify === 'function') {
      return AttachTypes.classify(file);
    }
    const t = String(file?.type || '').toLowerCase();
    return /^image\/(png|jpe?g|gif|webp|bmp)$/.test(t) ? 'image' : null;
  }

  const ATTACH_MAX_IMAGES = 5;
  const ATTACH_MAX_FILES = 5;
  const ATTACH_MAX_BYTES = 4 * 1024 * 1024;
  const ATTACH_ACCEPT = 'image/*,application/pdf,application/json,text/*,.pdf,.txt,.md,.markdown,.json,.csv,.log,.yml,.yaml';

  const FILE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

  function cssEsc(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s);
  }

  // Nessun src iniziale: gli allegati sono CIFRATI su Storage e un <img src=URL> diretto
  // mostrerebbe un allegato rotto. Il main li decifra, resolveFbImages riempie src.
  function imagesGridHtml(urls) {
    const imgs = (urls || []).filter((u) => typeof u === 'string' && u);
    if (!imgs.length) return '';
    return `<div class="fb-imgs">${imgs.map((u) => `<img class="fb-img-loading" data-url="${escapeHtml(u)}" loading="lazy" alt="">`).join('')}</div>`;
  }

  // Decifratura lazy, cache url → { dataUrl, error }: `error` porta il MOTIVO preciso, così
  // il segnaposto lo spiega. `soloDestinatario` non è un guasto: apre solo chi riceve.
  const fbImgCache = new Map();
  async function resolveImageSrc(url) {
    if (!url) return { dataUrl: null, error: '', soloDestinatario: false };
    if (fbImgCache.has(url)) return fbImgCache.get(url);
    let dataUrl = null;
    let error = '';
    let soloDestinatario = false;
    try {
      const r = await sendToMain({ type: 'feedback_decrypt_image', url });
      if (r && r.ok && r.dataUrl) dataUrl = r.dataUrl;
      else if (r && r.error) { error = String(r.error); soloDestinatario = !!r.soloDestinatario; }
      else error = 'immagine non disponibile';
    } catch (_) { error = 'immagine non raggiungibile'; }
    const res = { dataUrl, error, soloDestinatario };
    fbImgCache.set(url, res);
    return res;
  }

  // L'indirizzo di un allegato NON diventa mai un href: lo scrive chi manda la segnalazione,
  // e chiunque può mandarne una. Il clic passa dal main, che confronta col deposito e decifra.
  function filesListHtml(files) {
    const fs = (files || []).filter((x) => x && typeof x.url === 'string' && x.url);
    if (!fs.length) return '';
    return `<div class="fb-files">${fs.map((x) => `<a class="fb-file" href="#" data-url="${escapeHtml(x.url)}" data-name="${escapeHtml(x.name || 'allegato')}" data-type="${escapeHtml(x.type || '')}">${FILE_SVG}<span class="fb-file-name">${escapeHtml(x.name || 'allegato')}</span></a>`).join('')}</div>`;
  }

  // Perché un allegato non si apre, con le parole del main (una sola fonte per quella frase).
  // Lo si chiede solo a chi NON riceve le segnalazioni: lì il main risponde senza toccare la rete.
  const fbFileWhyCache = new Map();
  async function fileClosedReason(url) {
    if (!url) return null;
    if (fbFileWhyCache.has(url)) return fbFileWhyCache.get(url);
    let res = null;
    try {
      const r = await sendToMain({ type: 'feedback_decrypt_image', url });
      if (!r || !r.ok) {
        res = { error: String((r && r.error) || 'allegato non disponibile'), soloDestinatario: !!(r && r.soloDestinatario) };
      }
    } catch (_) {
      res = { error: 'allegato non raggiungibile', soloDestinatario: false };
    }
    fbFileWhyCache.set(url, res);
    return res;
  }

  // Sulla pillola, non solo nell'hover: chi ha mandato la segnalazione deve capire a colpo
  // d'occhio che quell'allegato lui non lo apre.
  function markFileClosed(a, motivo, soloDestinatario) {
    a.title = motivo || '';
    a.classList.add('fb-file--closed');
    let nota = a.querySelector('.fb-file-note');
    if (!nota) {
      nota = document.createElement('span');
      nota.className = 'fb-file-note';
      a.appendChild(nota);
    }
    // Non «inviato»: l'elenco mostra a ogni tester le segnalazioni di tutti. Non «consegnato»
    // (#582): se sia arrivato Filo non l'ha guardato. Dice chi lo apre, che è vero in ogni caso.
    nota.textContent = soloDestinatario ? '(riservato)' : '(non disponibile)';
  }

  // Il clic scarica e decifra dal main, poi salva col nome vero: un collegamento diretto
  // darebbe i byte cifrati, un .pdf col nome giusto che non si apre.
  function resolveFileLinks(root) {
    root.querySelectorAll('a.fb-file').forEach((a) => {
      const url = a.dataset.url || '';
      const name = a.dataset.name || 'allegato';
      const mime = a.dataset.type || 'application/octet-stream';
      if (!isAdmin) {
        fileClosedReason(url).then((r) => { if (r) markFileClosed(a, r.error, r.soloDestinatario); });
      }
      a.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (a.classList.contains('fb-file--loading')) return;
        a.classList.add('fb-file--loading');
        try {
          const r = await sendToMain({ type: 'feedback_decrypt_image', url, mime });
          if (r && r.ok && r.dataUrl) {
            const dl = document.createElement('a');
            dl.href = r.dataUrl;
            dl.download = name;
            document.body.appendChild(dl);
            dl.click();
            dl.remove();
          } else {
            markFileClosed(a, (r && r.error) || 'allegato non disponibile', !!(r && r.soloDestinatario));
          }
        } catch (_) {
          markFileClosed(a, 'allegato non raggiungibile', false);
        } finally {
          a.classList.remove('fb-file--loading');
        }
      });
    });
  }

  function humanSize(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Crea un compositore di allegati legato a una textarea. Inserisce in `mount`
  // un pulsante "Allega" + le thumbnail; intercetta incolla/trascina sulla
  // textarea. Ogni file viene caricato SUBITO su Storage (così le note salvano
  // solo l'URL). onChange() è chiamato dopo ogni aggiunta/rimozione — chi vuole
  // persistenza immediata (note editabili) lo usa per fare patch.
  // #602 — L'ANTEPRIMA DI UN ALLEGATO NEL COMPOSITORE.
  //
  // Da quando gli allegati dei commenti salgono cifrati, il loro indirizzo nel
  // deposito dentro un <img> è un riquadro rotto: quei byte non sono più
  // un'immagine. L'anteprima però è l'unico modo che ha chi scrive di
  // controllare di aver allegato il file giusto PRIMA di mandarlo, e nella
  // conversazione lo stesso allegato si vede benissimo — perché lì Filo lo
  // decifra. Erano due strade per la stessa immagine e una sola la apriva.
  //
  // Le due strade adesso sono una:
  //  · l'allegato appena scelto la copia in chiaro ce l'ha già qui (è il file
  //    che l'utente ha aperto): la si tiene da parte e l'anteprima compare
  //    subito, senza toccare la rete e senza chiave privata — vale quindi anche
  //    per chi le segnalazioni non le riceve;
  //  · quello già salvato in una nota una copia locale non ce l'ha, e allora si
  //    fa la stessa strada del resto della pagina: il main lo scarica e lo
  //    decifra (`resolveImageSrc`, con la sua cache: una sola richiesta per
  //    indirizzo, anche se la lista si ridisegna).
  const anteprimeLocali = new Map(); // indirizzo nel deposito → blob: locale

  function ricordaAnteprimaLocale(url, file) {
    if (!url || !file) return;
    try {
      if (anteprimeLocali.has(url)) return;
      anteprimeLocali.set(url, URL.createObjectURL(file));
    } catch (_) { /* senza anteprima locale si ripiega sulla decifratura */ }
  }

  function dimenticaAnteprimaLocale(url) {
    const blobUrl = anteprimeLocali.get(url);
    if (!blobUrl) return;
    anteprimeLocali.delete(url);
    try { URL.revokeObjectURL(blobUrl); } catch (_) {}
  }

  // Riempie la miniatura: copia locale se c'è, altrimenti contenuto decifrato.
  // Se non si può mostrare niente lo dice con le stesse parole del resto della
  // pagina, e il motivo per esteso resta nell'hover.
  async function mostraAnteprimaAllegato(im, url) {
    const locale = anteprimeLocali.get(url);
    if (locale) { im.src = locale; im.dataset.full = locale; return; }
    im.classList.add('fb-img-loading');
    const { dataUrl, error, soloDestinatario } = await resolveImageSrc(url);
    im.classList.remove('fb-img-loading');
    if (dataUrl) { im.src = dataUrl; im.dataset.full = dataUrl; return; }
    const ph = document.createElement('div');
    ph.className = 'fb-img-broken';
    ph.textContent = soloDestinatario ? '(riservato)' : '(non visibile)';
    ph.title = error || '';
    im.replaceWith(ph);
  }

  // Ritorna { getAttachments } che torna la lista corrente { kind, url, name, type }.
  function makeAttachComposer({ textarea, mount, initial, onChange }) {
    if (!textarea || !mount) return { getAttachments: () => [] };
    const attachments = Array.isArray(initial) ? initial.slice() : [];

    const thumbs = document.createElement('div');
    thumbs.className = 'fb-attach-thumbs';
    const bar = document.createElement('div');
    bar.className = 'fb-attach-bar';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-btn sn-btn-secondary fb-attach-btn';
    btn.textContent = '+ Allega';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = ATTACH_ACCEPT;
    fileInput.hidden = true;
    const status = document.createElement('div');
    status.className = 'fb-attach-status';
    status.setAttribute('aria-live', 'polite');
    bar.appendChild(btn);
    bar.appendChild(fileInput);
    bar.appendChild(status);
    mount.appendChild(thumbs);
    mount.appendChild(bar);

    let uploading = 0;
    const setStatus = (m) => { status.textContent = m || ''; };
    function counts() {
      let imgs = 0, files = 0;
      for (const a of attachments) (a.kind === 'img' ? imgs++ : files++);
      return { imgs, files };
    }

    function renderThumbs() {
      thumbs.innerHTML = '';
      attachments.forEach((a, i) => {
        if (a.kind === 'img') {
          const wrap = document.createElement('div');
          wrap.className = 'fb-attach-thumb';
          const im = document.createElement('img');
          im.alt = '';
          im.title = 'Clic per ingrandire';
          // Mai `a.url` come sorgente: nel deposito ci sono byte cifrati (#602).
          mostraAnteprimaAllegato(im, a.url);
          // E l'ingrandimento apre quello che si sta guardando, non l'indirizzo
          // del deposito: altrimenti il riquadro grande resta vuoto.
          im.addEventListener('click', () => {
            const piena = im.dataset.full;
            if (!piena) return;
            lightboxImg.src = piena;
            lightbox.classList.add('open');
          });
          const x = document.createElement('button');
          x.type = 'button'; x.className = 'fb-attach-x'; x.textContent = '×';
          x.setAttribute('aria-label', 'Rimuovi');
          x.addEventListener('click', () => {
            const via = attachments.splice(i, 1)[0];
            if (via && via.url) dimenticaAnteprimaLocale(via.url);
            renderThumbs();
            if (typeof onChange === 'function') onChange();
          });
          wrap.appendChild(im); wrap.appendChild(x);
          thumbs.appendChild(wrap);
        } else {
          const chip = document.createElement('div');
          chip.className = 'fb-attach-chip';
          chip.title = a.name || 'allegato';
          const ic = document.createElement('span');
          ic.className = 'fb-attach-ic';
          ic.innerHTML = FILE_SVG;
          const nm = document.createElement('span');
          nm.className = 'fb-attach-name';
          nm.textContent = a.name || 'allegato';
          const x = document.createElement('button');
          x.type = 'button'; x.className = 'fb-attach-x'; x.textContent = '×';
          x.setAttribute('aria-label', 'Rimuovi');
          x.addEventListener('click', () => { attachments.splice(i, 1); renderThumbs(); if (typeof onChange === 'function') onChange(); });
          chip.appendChild(ic); chip.appendChild(nm); chip.appendChild(x);
          thumbs.appendChild(chip);
        }
      });
    }

    async function addFile(file) {
      if (!file) return;
      // Il TIPO si guarda PRIMA di caricare: il selettore offre anche image/* e text/*, che il
      // deposito rifiuta — e se ne leggeva il numero d'errore invece della frase giusta.
      const kind = classificaAllegato(file);
      if (!kind) { setStatus(ATTACH_REJECT_MSG); return; }
      const isImg = kind === 'image';
      const c = counts();
      if (isImg && c.imgs >= ATTACH_MAX_IMAGES) { setStatus(`Massimo ${ATTACH_MAX_IMAGES} immagini.`); return; }
      if (!isImg && c.files >= ATTACH_MAX_FILES) { setStatus(`Massimo ${ATTACH_MAX_FILES} file.`); return; }
      if (file.size > ATTACH_MAX_BYTES) { setStatus(`«${file.name || 'file'}» troppo grande (max 4 MB).`); return; }
      if (!window.SN_FEEDBACK?.uploadAttachment) { setStatus('Upload non disponibile.'); return; }
      uploading++; btn.disabled = true; setStatus('Caricamento…');
      try {
        const att = await SN_FEEDBACK.uploadAttachment(file, file.name);
        // La copia in chiaro è qui, ed è l'anteprima: quella che sta nel
        // deposito è cifrata e in un <img> non compare (#602).
        if (att && att.kind === 'img') ricordaAnteprimaLocale(att.url, file);
        attachments.push(att);
        renderThumbs();
        setStatus('');
        if (typeof onChange === 'function') onChange();
      } catch (e) {
        // #602 — se a fermarsi è stata la cifratura, la frase è già quella
        // giusta per chi legge (dice che non è partito niente e perché).
        const gia = !!(window.SN_FEEDBACK?.isEncryptionError?.(e));
        setStatus(gia ? String(e.message) : ('Caricamento non riuscito: ' + (e?.message || e)));
      } finally {
        uploading = Math.max(0, uploading - 1);
        if (uploading === 0) btn.disabled = false;
      }
    }

    btn.addEventListener('click', () => { try { fileInput.click(); } catch (_) {} });
    fileInput.addEventListener('change', async () => {
      const picked = Array.from(fileInput.files || []);
      for (const f of picked) await addFile(f);
      fileInput.value = '';
    });
    // Incolla: cattura SOLO i file dagli appunti, lascia passare il testo normale.
    textarea.addEventListener('paste', async (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const blobs = [];
      for (const it of items) {
        if (it.kind === 'file') { const b = it.getAsFile(); if (b) blobs.push(b); }
      }
      if (blobs.length) { e.preventDefault(); for (const b of blobs) await addFile(b); }
    });
    ['dragenter', 'dragover'].forEach((ev) => textarea.addEventListener(ev, (e) => { e.preventDefault(); textarea.classList.add('fb-drop-hover'); }));
    ['dragleave', 'drop'].forEach((ev) => textarea.addEventListener(ev, (e) => { textarea.classList.remove('fb-drop-hover'); }));
    textarea.addEventListener('drop', async (e) => {
      const dropped = e.dataTransfer && e.dataTransfer.files;
      if (!dropped || !dropped.length) return;
      e.preventDefault();
      for (const f of dropped) await addFile(f);
    });

    renderThumbs();
    return { getAttachments: () => attachments.slice() };
  }

  // La textarea modifica SOLO il «capo» delle note (la nota dell'agente): la «coda»
  // (riaperture e turni successivi) vive in bolle a sé e va CONSERVATA intatta.
  function notesValueOf(ta) {
    if (!ta) return '';
    const atts = ta._attachComposer ? ta._attachComposer.getAttachments() : [];
    const headText = ta.value;
    const head = window.SN_FEEDBACK_THREAD && SN_FEEDBACK_THREAD.composeNotes
      ? SN_FEEDBACK_THREAD.composeNotes(headText, atts)
      : headText;
    const tail = ta.dataset && ta.dataset.tail ? ta.dataset.tail : '';
    if (!tail) return head;
    return head ? `${head}\n\n${tail}` : tail;
  }

  // Spezza `notes` in { head, tail }: head fino al primo marcatore di turno (la parte
  // editabile), tail verbatim — mostrato come bolle e conservato intatto al salvataggio.
  function splitNotesHeadTail(notes) {
    const s = String(notes || '');
    if (!s) return { head: '', tail: '' };
    const T = window.SN_FEEDBACK_THREAD;
    if (!T || !T.USER_TURN_RE) return { head: s, tail: '' };
    const lines = T.righe ? T.righe(s) : s.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (T.USER_TURN_RE.test(lines[i]) || (T.MODEL_TURN_RE && T.MODEL_TURN_RE.test(lines[i]))) {
        const head = lines.slice(0, i).join('\n').replace(/\n+$/, '');
        const tail = lines.slice(i).join('\n');
        return { head, tail };
      }
    }
    return { head: s, tail: '' };
  }

  // `silenzioso`: salva senza ridisegnare, per le caselle che si salvano mentre ci si scrive
  // dentro. `inPlace`: non ridisegnare MAI (vedi «Un clic, una scheda»).
  async function patch(id, payload, optimistic, { silenzioso = false, inPlace = false } = {}) {
    if (!isAdmin) {
      alert('Operazione riservata agli amministratori: accedi con un account autorizzato.');
      return false;
    }
    const item = all.find((f) => f._id === id);
    if (!item) return false;
    // Non si riscrive una conversazione che non si è potuta leggere. Il guardiano sta qui
    // perché i cammini che scrivono le note sono più d'uno: uno scoperto basta.
    if (item.reportIllegibile && payload && typeof payload.notes === 'string') {
      alert('Il report di questo feedback non è leggibile su questo computer: manca la chiave privata. '
        + 'Salvare adesso lo sostituirebbe con quello che vedi a schermo. Configura la chiave e riprova.');
      return false;
    }
    // Stessa regola, altro motivo: la conversazione non è mai arrivata, quindi
    // la casella è vuota perché non sappiamo, non perché non c'è niente.
    if (item._dettaglioMancato && payload && typeof payload.notes === 'string') {
      alert('Il resto di questa segnalazione non è arrivato: salvare adesso sostituirebbe la conversazione '
        + 'con quello che vedi a schermo. Premi «Aggiorna» e riprova.');
      return false;
    }
    // Un cambio di stato passa SOLO se è una delle azioni che la segnalazione
    // offre in questo momento (la stessa tabella che disegna i pulsanti). Il
    // guardiano sta qui e non sui pulsanti: uno stato può essere cambiato
    // mentre il pannello era aperto, e senza questo il clic scriverebbe una
    // decisione che la pagina non offre più — è così che un attacco confermato
    // si ritrovava riscritto ad "archiviato".
    if (payload && payload.status !== undefined
        && !MR.ownerActionAllowsStatus(item, payload.status, { releasedVersion })) {
      alert('Lo stato di questa segnalazione è cambiato: questa azione non è più disponibile. Aggiorna la lista e riprova.');
      return false;
    }
    // Va salvato tutto ciò che l'aggiornamento ottimistico tocca: ripristinarne una parte sola
    // lascia la card che dice una cosa e il database un'altra.
    const prev = {
      status: item.status, notes: item.notes, userNote: item.userNote,
      priority: item.priority, reviewDecision: item.reviewDecision,
      archiveOverride: item.archiveOverride, starred: item.starred,
      localOnly: item.localOnly, localApproval: item.localApproval,
    };
    Object.assign(item, optimistic);
    if (!silenzioso && !inPlace) applyFilter();
    try {
      // Instradata dal main, che allega l'ID token come Bearer e rifiuta i non-admin: i token non
      // sono mai esposti alle pagine (SECURITY.md §3).
      const r = await sendToMain({ type: 'feedback_update', id, ...payload });
      if (!r || r.ok === false) throw new Error(r?.error || 'aggiornamento rifiutato');
      // Il sì come lavoro locale, dato leggendo il testo, è anche fiducia (#1148, come nella gemella): la scrive il server.
      if (payload.localApproval === true && item.fiducia !== 'fidato') {
        const f = await sendToMain({ type: (window.SN_MSG?.MSG?.FIDUCIA_SEGNA) || 'fiducia_segna', feedbackId: id }).catch((err) => ({ ok: false, error: err?.message }));
        if (f && f.ok) item.fiducia = 'fidato';
        else alert(`Nei Lavori server, ma non segnato fidato: ${(f && f.error) || 'il server non ha risposto'}. Alla fusione ti chiederà il via libera.`);
      }
      return true;
    } catch (e) {
      Object.assign(item, prev);
      if (!inPlace) applyFilter();
      alert('Errore: ' + (e?.message || e));
      return false;
    }
  }

  // I pulsanti scrivono STATI CANONICI, gli stessi che scrive la dashboard di
  // gestione. Prima scrivevano il vocabolario vecchio (new/draft/verified/
  // ignored/blocked): ogni clic spingeva il feedback FUORI dalla macchina a
  // stati, e la gemella doveva poi ridurlo a forza. Due cammini equivalenti
  // devono fare la stessa cosa, non due cose che si somigliano.
  // QUALI azioni esistono lo decide il modulo condiviso (MR.ownerActions): la
  // dashboard di gestione legge la stessa tabella, quindi sulla stessa
  // segnalazione le due pagine offrono le stesse azioni per costruzione. Qui
  // resta solo il MODO di disegnarle (pulsanti dentro la scheda).
  const TITOLO_LAVORO_LOCALE = 'Diventa un lavoro server. Lo lavorano le routine se in Automazioni i lavori server sono accesi, altrimenti una sessione. La fusione non aspetta il tuo sì.';
  function actionsFor(f) {
    // Non-admin: niente pulsanti d'azione (sola lettura).
    if (!isAdmin) return '';
    // Stato illeggibile: i pulsanti nascono dalla sezione, e qui la sezione non si sa. Offrire
    // «→ In coda» a un feedback che potrebbe essere già chiuso è peggio che non offrire niente.
    if (!sezioniAttendibili()) return '';
    const id = escapeHtml(f._id);
    const EXTRA = { accept: ' data-accept="1"', reject: ' data-reject="1"',
      archive: ' data-archive="1"', restore: ' data-restore="1"' };
    return MR.ownerActions(f, { releasedVersion }).map((a) => {
      // "Riapri" non scrive subito: apre il modulo che chiede COSA manca ancora.
      if (a.kind === 'reopen') {
        return `<button class="sn-btn sn-btn-secondary fb-reopen-start" data-id="${id}">${escapeHtml(a.label)}</button>`;
      }
      // #913: «Lavoro locale» scrive anche il segno e il sì dell'owner, come nella gemella.
      const locale = a.locale ? ` data-local="1" title="${escapeHtml(TITOLO_LAVORO_LOCALE)}"` : '';
      return `<button class="sn-btn${a.primary ? '' : ' sn-btn-secondary'} fb-act"`
        + ` data-id="${id}" data-to="${escapeHtml(a.to)}"${EXTRA[a.kind] || ''}${locale}>${escapeHtml(a.label)}</button>`;
    }).join('\n');
  }

  // ── La frase per chi ha segnalato parte chiusa, come in Gestione (#497, #857) ──
  // Si scrive una volta sola, e aperta su tutte le schede occupava la lista. Il tasto sta fuori da
  // `.fb-actions`: quella scatola sono le azioni di stato, che esito e riapertura riscrivono.
  const fraseAperte = new Set(); // id delle schede con la frase aperta: un ridisegno non la richiude

  function tastoFraseHtml(f) {
    const id = escapeHtml(f._id);
    const t = MR.tastoFrase(f.userNote);
    return `<button type="button" class="sn-btn sn-btn-secondary fb-usernote-toggle${t.piena ? ' fb-usernote-piena' : ''}"`
      + ` data-id="${id}" aria-controls="fb-frase-${id}" aria-expanded="${fraseAperte.has(f._id)}"`
      + ` title="${escapeHtml(t.titolo)}">Frase</button>`;
  }

  // Aperta riceve il cursore (chi preme vuole scrivere); chiusa rende il fuoco al tasto. Il blur salva.
  function mostraFrase(card, id, aperta) {
    const box = card && card.querySelector('.fb-usernote-box');
    if (!box) return;
    const tasto = card.querySelector('.fb-usernote-toggle');
    box.hidden = !aperta;
    if (aperta) fraseAperte.add(id); else fraseAperte.delete(id);
    if (tasto) tasto.setAttribute('aria-expanded', aperta ? 'true' : 'false');
    const input = box.querySelector('.fb-usernote');
    if (aperta && input) input.focus();
    else if (!aperta && tasto) tasto.focus();
  }

  // Da chiusa, solo il tasto dice che una frase c'è: porta il segno di quello che è stato salvato.
  function riflettiFrase(id) {
    const item = all.find((f) => f._id === id);
    const tasto = listEl.querySelector(`.fb-usernote-toggle[data-id="${cssEsc(id)}"]`);
    if (!item || !tasto) return;
    const t = MR.tastoFrase(item.userNote);
    tasto.classList.toggle('fb-usernote-piena', t.piena);
    tasto.title = t.titolo;
  }

  // ── UN CLIC, UNA SCHEDA ───────────────────────────────────────────────────
  // Qui i pulsanti vivono DENTRO la scheda, in una lista che si riordina da sé.
  // Finché ogni azione ridisegnava la lista, appena la scheda usciva dalla
  // sezione le altre risalivano e sotto il puntatore FERMO arrivava il pulsante
  // della scheda successiva: il secondo clic — anche mezzo secondo dopo, anche
  // voluto, perché al primo non si vedeva succedere niente — cadeva su un ALTRO
  // feedback. Due volte «→ In coda» nei Ricevuti mettevano in coda il primo e
  // marcavano il secondo come ATTACCO CONFERMATO; due volte «Risolto» ne
  // chiudevano due; due volte «Ripristina» ne ripristinavano due. Nella gemella
  // non succede perché l'azione sta in un pannello fermo e riguarda la scheda
  // selezionata.
  //
  // La regola che chiude tutte le porte insieme (non una per giro) è una sola:
  // NESSUNA AZIONE PRESA DENTRO UNA SCHEDA RICOMPONE LA LISTA. La scheda si
  // aggiorna al proprio posto — si spegne mentre scrive, poi dice cosa è
  // successo — e la lista si ricompone solo quando lo chiedi tu (cambio
  // sezione, ricerca, filtro, Aggiorna). Vale per tutte le vie che scrivono da
  // una scheda: i pulsanti di stato, «Conferma riapertura», «Invia risposta» e
  // i pallini della priorità (che in «In coda» sono un criterio di ordinamento,
  // quindi anche loro rimescolavano la lista sotto il dito).

  // Schede con una scrittura in volo: il loro secondo clic non deve partire.
  const inScrittura = new Set();
  // Schede su cui l'azione è già andata: restano a schermo, spente, con l'esito.
  const decise = new Map(); // id -> esito (testo)
  // Quante schede ha disegnato l'ultimo render: serve alla riga del totale, che non si
  // riscrive più a ogni azione.
  let disegnate = 0;

  // Spegne TUTTI i pulsanti della scheda: la scrittura riguarda la scheda intera, e «Archivia»
  // premuto mentre «→ In coda» è in volo scriverebbe due decisioni sullo stesso feedback.
  function spegniScheda(card) {
    if (!card) return;
    card.classList.add('fb-card--busy');
    card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  }

  function riaccendiScheda(card) {
    if (!card) return;
    card.classList.remove('fb-card--busy');
    card.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }

  // Dove è finita la scheda, col nome della sezione che si legge nella barra: calcolato con la
  // stessa funzione che riempie le sezioni, o l'esito direbbe una cosa diversa dal vero.
  function esitoDi(item, optimistic) {
    const dopo = Object.assign({}, item, optimistic);
    const dest = MR.manageTabFor(dopo, opzSezioni());
    const nome = TAB_LABELS[dest];
    if (!nome || dest === currentTab) return 'Fatto';
    return `Spostata in «${nome}»`;
  }

  // Azione andata: la scheda resta dov'è (nessuno la vede sparire da sotto il cursore) ma
  // smette di essere premibile e DICE cosa è successo. Sparisce alla prima ricomposizione.
  function marcaDecisa(card, esito, item) {
    if (!card) return;
    card.classList.remove('fb-card--busy');
    card.classList.add('fb-card--decisa');
    // L'etichetta dello stato si riscrive: la scheda resta a schermo e senza questo direbbe
    // ancora lo stato di prima («Attacco» invece di «Attacco confermato»).
    const badge = card.querySelector('.fb-state');
    if (badge && item) {
      const html = stateBadgeHtml(item);
      if (html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        if (tmp.firstElementChild) badge.replaceWith(tmp.firstElementChild);
      }
    }
    const box = card.querySelector('.fb-actions');
    if (box) {
      box.textContent = '';
      const riga = document.createElement('div');
      riga.className = 'fb-esito';
      riga.textContent = `✓ ${esito}`;
      box.appendChild(riga);
    }
    // Anche le caselle: la scheda non è più di questa sezione, e una scrivibile direbbe il
    // contrario.
    card.querySelectorAll('button, textarea, input').forEach((b) => { b.disabled = true; });
  }

  // Il totale dice anche quante schede sono già decise, altrimenti il numero della sezione —
  // che scende subito, ed è vero — sembrerebbe non tornare con quel che resta a schermo.
  function aggiornaTotale() {
    if (!disegnate) return;
    const n = decise.size;
    countEl.textContent = n
      ? `${disegnate} feedback · ${n} ${n === 1 ? 'decisa' : 'decise'}`
      : `${disegnate} feedback`;
  }

  // Il cammino unico di ogni azione presa dentro una scheda.
  async function azioneScheda(btn, { id, payload, optimistic }) {
    if (!id || inScrittura.has(id) || decise.has(id)) return;
    const item = all.find((f) => f._id === id);
    if (!item) return;
    const card = btn.closest('.fb-card');
    const esito = esitoDi(item, optimistic);
    inScrittura.add(id);
    btn.classList.add('fb-act--busy');
    spegniScheda(card);
    const ok = await patch(id, payload, optimistic, { inPlace: true });
    inScrittura.delete(id);
    // Nel frattempo la lista può essere stata ricomposta: la scheda non è più a schermo e non
    // c'è niente da riaccendere. Il dato è salvato lo stesso.
    const viva = card && card.isConnected ? card : null;
    if (ok) {
      decise.set(id, esito);
      marcaDecisa(viva, esito, item);
    } else if (viva) {
      btn.classList.remove('fb-act--busy');
      riaccendiScheda(viva);
    }
    updateTabCounts();
    aggiornaTotale();
    provaRidisegno();
  }

  // Cattura il campo a fuoco (se ha data-id) per riselezionarlo dopo il re-render: senza,
  // salvare le note faceva perdere fuoco e cursore mentre l'utente stava scrivendo.
  function captureFocus() {
    const el = document.activeElement;
    if (!el || !listEl.contains(el)) return null;
    const id = el.dataset && el.dataset.id;
    if (!id) return null;
    // Distingue le textarea con stesso data-id (es. note) dalla classe.
    // Anche il tasto della frase: Esc gli rende il fuoco, e un ridisegno dal vivo non deve toglierglielo.
    const cls = ['fb-notes', 'fb-usernote', 'fb-usernote-toggle'].find((c) => el.classList && el.classList.contains(c)) || null;
    if (!cls) return null;
    return {
      cls,
      id,
      start: typeof el.selectionStart === 'number' ? el.selectionStart : null,
      end: typeof el.selectionEnd === 'number' ? el.selectionEnd : null,
      scrollTop: el.scrollTop || 0,
    };
  }

  function restoreFocus(snap) {
    if (!snap) return;
    const sel = `.${snap.cls}[data-id="${(window.CSS && CSS.escape) ? CSS.escape(snap.id) : snap.id}"]`;
    const el = listEl.querySelector(sel);
    if (!el) return;
    el.focus();
    if (snap.start != null && typeof el.setSelectionRange === 'function') {
      try { el.setSelectionRange(snap.start, snap.end ?? snap.start); } catch (_) {}
    }
    el.scrollTop = snap.scrollTop;
  }

  function render(items) {
    const focusSnap = captureFocus();
    // Ricomporre la lista è SEMPRE una richiesta esplicita: è il momento in cui le schede già
    // decise lasciano il posto, e l'unico in cui la lista si rimescola.
    decise.clear();
    disegnate = items.length;
    // A zero il contatore resta: è proprio lì che dice «la ricerca non ha trovato
    // niente» (#511). Muto solo finché i dati non sono arrivati.
    countEl.textContent = dataLoaded ? `${items.length} feedback` : '';
    if (!items.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      // Caricamento fallito: non è una sezione vuota, è una sezione che non sappiamo. «Nessun
      // feedback» sarebbe una bugia, per giunta al posto dell'unico tasto per riprovare.
      if (loadError && !dataLoaded) {
        showLoadError(loadError);
        return;
      }
      // Se il vuoto dipende dalla ricerca, dillo: «Nessun feedback…» sembrerebbe un tab svuotato.
      const q = (searchEl.value || '').trim();
      if (q && sectionItems().length) {
        emptyEl.textContent = `Nessun risultato per "${q}".`;
        return;
      }
      // Idem per «Solo automatici»: la sezione non è vuota, è vuota DI RITROVAMENTI AUTOMATICI.
      if (agentOnly && sectionBase(currentTab).length) {
        emptyEl.textContent = 'Nessun ritrovamento automatico in questa sezione.';
        return;
      }
      emptyEl.textContent = sezioniAttendibili()
        ? (TAB_EMPTY[currentTab] || 'Nessun feedback.')
        : 'Nessun feedback ricevuto.';
      // Col caricamento al tetto una sezione «vuota» può non esserlo: i più vecchi non sono qui.
      if (dataLoaded && SN_FEEDBACK.listHitCap(all, SN_FEEDBACK.LIST_PAGE_SIZE)) {
        emptyEl.textContent = `${emptyEl.textContent} ${SN_FEEDBACK.COUNT_CAP_HINT}`;
      }
      return;
    }
    emptyEl.hidden = true;
    listEl.innerHTML = items.map((f) => {
      const when = fmtTs(f.createdAt || f._createTime);
      const url = f.url || '';
      // L'indirizzo si apre, ma la scritta la compone SN_FEEDBACK.linkLabel, che mostra il sito
      // vero e dichiara il taglio: lo scrive chi manda, e sceglieva cosa si leggeva (#582).
      const safeUrl = safeHref(url);
      const ua = (f.userAgent || '').slice(0, 80);
      // #912: un utente che si era dato un nome riservato si legge senza quella firma, come in Gestione.
      const cidGrezzo = String(f.clientId || '');
      const cid = (originOf(f) === 'user' ? cidGrezzo.replace(/^(non-provato:)?(owner|routine|agent|local):/i, '') : cidGrezzo).slice(0, 12);
      const text = escapeHtml(f.text || '(senza testo)');
      // Allegati della SEGNALAZIONE originale: vivono nei campi piatti images/files.
      const imgsHtml = imagesGridHtml(Array.isArray(f.images) ? f.images : []);
      const filesHtml = filesListHtml(Array.isArray(f.files) ? f.files : []);
      const origin = originOf(f);
      // Numero progressivo (#22, #22.1 per i sub creati dalle routine).
      const num = SN_FEEDBACK.formatNum(f.seq, f.subSeq);
      const numHtml = num ? `<span class="fb-num">#${escapeHtml(num)}</span>` : '';
      // Badge che distingue la fonte: 🤖 <modello> per l'agente esploratore LLM, 🔧 audit · <slug>
      // per le routine cloud, più severità e area per il solo agente.
      const agent = isAgent(f);
      const am = agent ? agentMeta(f) : null;
      const isRoutineFind = am && am.source === 'routine';
      const isAllarme = am && am.source === 'costruzione';
      const agentIcon = isAllarme ? '🏗️' : isRoutineFind ? '🔧' : '🤖';
      const agentLabel = !am ? '' : isAllarme ? 'Allarme della pubblicazione' : isRoutineFind ? `audit · ${am.model}` : am.model;
      const agentBadgeTitle = isAllarme ? 'Aperto dal server quando una versione non si costruisce'
        : isRoutineFind ? 'Audit automatico di una routine cloud' : "Modello che ha trovato l'errore";
      const agentTitleHtml = am && (am.title || num)
        ? `<div class="fb-title">${numHtml}${numHtml ? ' ' : ''}${segnoFermataHtml(f)}${escapeHtml(am.title)}</div>` : '';
      const agentHtml = agent ? `
        <div class="fb-badges">
          <span class="fb-badge fb-badge--model" title="${escapeHtml(agentBadgeTitle)}">${agentIcon} ${escapeHtml(agentLabel)}</span>
          ${am.severity ? `<span class="fb-badge fb-badge--${escapeHtml(am.severity)}">${escapeHtml(am.severity)}</span>` : ''}
          ${am.area ? `<span class="fb-badge">${escapeHtml(am.area)}</span>` : ''}
        </div>
        ${agentTitleHtml}` : '';
      // Le issue d'agente hanno già il loro titolo in agentHtml.
      const titleHtml = !agent && (num || f.name)
        ? `<div class="fb-title">${numHtml}${numHtml ? ' ' : ''}${segnoFermataHtml(f)}${escapeHtml(f.name || '')}</div>`
        : '';
      // Conversazione a turni (#108): segnalazione, risposte di Filo e dell'utente in BOLLE
      // distinte in ordine cronologico. Gli allegati vivono nella bolla della segnalazione.
      const turns = window.SN_FEEDBACK_THREAD ? SN_FEEDBACK_THREAD.parse(f) : [];
      const convoTurns = turns.filter((t) => t.kind !== 'report');
      const reportRole = window.SN_FEEDBACK_THREAD && SN_FEEDBACK_THREAD.isFromModel(mittenteDi(f)) ? 'model' : 'user';
      const reportWho = reportRole === 'model' ? 'Agente' : 'Segnalazione';
      // Note editabili (textarea) dove l'admin sta lavorando: Ricevuti e In
      // coda. "Ricevuti" è incluso così si può COMMENTARE un feedback appena
      // arrivato e poi metterlo in coda (il commento viaggia col cambio di
      // stato — vedi il gestore .fb-act).
      // La routine ha domande: `design` con motivo `clarify`. Vive nei Ricevuti
      // (è una decisione che aspetta l'owner), non più in una sezione sua.
      const clarifyReply = isAdmin && MR.aspettaRisposta(f);
      // Con la conversazione non arrivata la casella non si offre: quello che
      // ci si scrive dentro non si può salvare (sostituirebbe il report), e
      // offrirla vorrebbe dire far scrivere l'owner per niente.
      const notesEditable = isAdmin && !f.reportIllegibile && !clarifyReply && !f._dettaglioMancato
        && (currentTab === 'inbox' || currentTab === 'queue' || currentTab === 'local' || currentTab === 'waiting');
      // Render di un turno come bolla di sola lettura (segnalazione esclusa).
      const convoBubble = (t) => {
        const who = (t.kind === 'note' || t.role === 'model') ? 'Filo' : 'Tu';
        const tsLabel = t.ts ? `<span>${escapeHtml(String(t.ts))}</span>` : '';
        // Allegati ANCORATI a questo turno (#190.3): immagini + file separati.
        const atts = Array.isArray(t.attachments) ? t.attachments : [];
        const tImgs = atts.filter((a) => a && a.kind === 'img').map((a) => a.url);
        const tFiles = atts.filter((a) => a && a.kind === 'file');
        // Il turno di Filo è il markdown di un modello: lo stesso formattatore della chat, come in Gestione.
        const corpo = who === 'Filo' && window.SN_MARKDOWN
          ? `<div class="filo-md">${window.SN_MARKDOWN.render(t.body)}</div>`
          : escapeHtml(t.body);
        const bodyHtml = t.body ? `<div class="fb-bubble-body">${corpo}</div>` : '';
        return `
          <div class="fb-bubble fb-bubble--${t.role}">
            <div class="fb-bubble-head"><span class="fb-bubble-who">${who}</span>${tsLabel}</div>
            ${bodyHtml}
            ${imagesGridHtml(tImgs)}
            ${filesListHtml(tFiles)}
          </div>`;
      };
      const reportBubble = `
        <div class="fb-bubble fb-bubble--report fb-bubble--${reportRole} fb-bubble--origin-${origin}">
          <div class="fb-bubble-head"><span class="fb-bubble-who">${reportWho}</span></div>
          <div class="fb-bubble-body">${text}</div>
          ${imgsHtml}
          ${filesHtml}
        </div>`;
      // La textarea modifica SOLO la nota dell'agente: riaperture e risposte restano bolle a sé.
      let headText = '';
      let headAtts = [];
      let tailStr = '';
      let tailBubblesHtml = '';
      let convoHtml = '';
      if (notesEditable) {
        const { head, tail } = splitNotesHeadTail(f.notes);
        const stripped = window.SN_FEEDBACK_THREAD && SN_FEEDBACK_THREAD.stripAttachments
          ? SN_FEEDBACK_THREAD.stripAttachments(head)
          : { text: head, attachments: [] };
        headText = stripped.text;
        headAtts = stripped.attachments;
        tailStr = tail;
        const tailTurns = tail && window.SN_FEEDBACK_THREAD ? SN_FEEDBACK_THREAD.splitNotes(tail) : [];
        tailBubblesHtml = tailTurns
          .map((s) => convoBubble({ role: s.role, kind: s.role === 'model' ? 'note' : 'reply', ts: s.ts, body: s.body, attachments: s.attachments }))
          .join('');
      } else {
        convoHtml = convoTurns.map(convoBubble).join('');
      }
      // Il resto non è arrivato: si dice, con le stesse parole della gemella in
      // Gestione e con lo stesso tasto. Senza, la scheda si disegnava come se
      // la conversazione fosse vuota e l'owner decideva su metà segnalazione.
      const mancatoHtml = f._dettaglioMancato
        ? `<div class="fb-bubble fb-bubble--model fb-dettaglio-mancato">
             <div class="fb-bubble-body"><em>${f._dettaglioMancato === 'sparito'
               ? 'Il resto di questa segnalazione non è arrivato: sul server non c&#39;è più.'
               : 'Il resto di questa segnalazione non è arrivato: controlla la connessione.'}</em></div>
             <button type="button" class="fb-load-retry fb-riprova-dettaglio" data-id="${escapeHtml(f._id)}">↻ Riprova</button>
           </div>`
        : '';
      const threadHtml = `<div class="fb-thread">${reportBubble}${convoHtml}${mancatoHtml}</div>`;
      const tailThreadHtml = tailBubblesHtml ? `<div class="fb-thread fb-thread--tail">${tailBubblesHtml}</div>` : '';
      // Su «Ricevuti» la casella è un commento al volo; altrove è la nota di triage e di design.
      const notesLabelText = currentTab === 'inbox' ? 'Commento:' : 'Note / decisioni di design:';
      const notesPlaceholder = currentTab === 'inbox'
        ? 'Aggiungi un commento… (verrà conservato quando metti il feedback in coda)'
        : 'Dettagli aggiuntivi, vincoli, scelte di design…';
      // La textarea mostra il capo pulito (le righe-marcatore vivono come miniature nel
      // compositore) e porta la coda in `data-tail`, che il salvataggio riallega intatta.
      const notesBlock = notesEditable
        ? `<label class="fb-notes-label">${notesLabelText}
             <textarea class="fb-notes" data-id="${escapeHtml(f._id)}" data-tail="${escapeHtml(tailStr)}" rows="3" placeholder="${escapeHtml(notesPlaceholder)}">${escapeHtml(headText || '')}</textarea>
           </label>
           <div class="fb-attach-mount" data-id="${escapeHtml(f._id)}" data-kind="notes"></div>`
        : '';
      // Sotto la riga dei tasti: aprendosi non sposta il tasto, e il secondo clic lo ritrova.
      const fraseBlock = notesEditable
        ? `<div class="fb-usernote-box" id="fb-frase-${escapeHtml(f._id)}"${fraseAperte.has(f._id) ? '' : ' hidden'}>
             <label class="fb-usernote-label">Frase per chi ha segnalato: è quello che legge quando il feedback si chiude
               <input type="text" class="fb-usernote" data-id="${escapeHtml(f._id)}" maxlength="500"
                      placeholder="Una riga in chiaro: cosa può fare adesso."
                      value="${escapeHtml(String(f.userNote || ''))}">
             </label>
           </div>`
        : '';
      // Chiarimenti: la risposta si APPENDE allo storico (conserva la domanda) e il feedback
      // torna «Da risolvere» perché una routine lo riprenda.
      const replyBlock = clarifyReply
        ? `<div class="fb-reply">
             <label class="fb-notes-label">La tua risposta:
               <textarea class="fb-reply-text" data-id="${escapeHtml(f._id)}" rows="3" placeholder="Rispondi alle domande di Filo qui sopra… (puoi incollare/trascinare immagini e file)"></textarea>
             </label>
             <div class="fb-attach-mount" data-id="${escapeHtml(f._id)}" data-kind="reply"></div>
             <div class="fb-reply-buttons">
               <button type="button" class="sn-btn fb-reply-send" data-id="${escapeHtml(f._id)}">Invia risposta</button>
             </div>
           </div>`
        : '';
      return `
        <article class="fb-card fb-card--${escapeHtml(statusOf(f))} fb-card--tab-${escapeHtml(tabOf(f) || 'inbox')} fb-card--origin-${origin}${agent ? ' fb-card--agent' : ''}${arrivata(f) ? ' fb-card--arrivata' : ''}" data-id="${escapeHtml(f._id)}">
          <div class="fb-meta">
            <span>${escapeHtml(when)}</span>
            ${stateBadgeHtml(f)}
            ${fusioneChipHtml(f)}
            ${attesaChipHtml(f)}
            ${domandaChipHtml(f)}
            ${safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener" title="${escapeHtml(safeUrl)}">${escapeHtml(SN_FEEDBACK.linkLabel(safeUrl) || url.slice(0, 80))}</a>` : (url ? `<span title="${escapeHtml(url)}">${escapeHtml(url.slice(0, 80))}</span>` : '')}
            ${!agent && cid ? `<span>client: ${escapeHtml(cid)}</span>` : ''}
            ${!agent && ua ? `<span title="${escapeHtml(ua)}">UA</span>` : ''}
            ${claimBadgeHtml(f)}
            ${branchBadgeHtml(f)}
            ${priorityDotsHtml(f)}
          </div>
          ${agentHtml}${titleHtml}
          ${threadHtml}
          ${notesBlock}
          ${tailThreadHtml}
          ${replyBlock}
          <div class="fb-tasti">${notesEditable ? tastoFraseHtml(f) : ''}<div class="fb-actions">${actionsFor(f)}</div></div>
          ${fraseBlock}
        </article>
      `;
    }).join('');

    listEl.querySelectorAll('.fb-riprova-dettaglio').forEach((btn) => {
      btn.addEventListener('click', () => riprovaDettaglio(btn.dataset.id));
    });

    listEl.querySelectorAll('.fb-imgs img').forEach((img) => {
      img.addEventListener('click', () => {
        if (img.dataset.full) {
          lightboxImg.src = img.dataset.full;
          lightbox.classList.add('open');
        }
      });
      resolveImageSrc(img.dataset.url || '').then(({ dataUrl, error, soloDestinatario }) => {
        img.classList.remove('fb-img-loading');
        if (dataUrl) {
          img.src = dataUrl;
          img.dataset.full = dataUrl;
        } else {
          const ph = document.createElement('div');
          ph.className = 'fb-img-broken';
          // L'allegato lo apre solo chi riceve: non è un guasto. Il motivo lo dà il main.
          ph.textContent = soloDestinatario ? '(allegato riservato)' : '(immagine non disponibile)';
          // Hover col MOTIVO preciso del fallimento (ripiega sull'URL cifrato).
          ph.title = error || img.dataset.url || '';
          img.replaceWith(ph);
        }
      });
    });

    resolveFileLinks(listEl);

    bindCardActions(listEl);

    // Salvare le note non deve far perdere fuoco e cursore a chi sta scrivendo.
    restoreFocus(focusSnap);
  }

  // Serve in due momenti: dopo un render completo e quando una sola scheda si riscrive AL
  // PROPRIO POSTO — l'unico modo di aggiornarla senza rimescolare la lista sotto il puntatore.
  function bindCardActions(root) {
    root.querySelectorAll('.fb-act').forEach((b) => {
      b.addEventListener('click', () => {
        const to = b.dataset.to; // stato CANONICO (todo | done | archived | *_confirmed)
        const id = b.dataset.id;
        const payload = { status: to };
        const ottimistico = { status: to };
        // Gli stessi campi che scrive la dashboard di gestione, o le due pagine
        // lascerebbero due tracce diverse della stessa decisione.
        if (b.dataset.accept) {
          // Override dell'owner: toglie il blocco dei giudici e rimette in coda.
          payload.reviewDecision = 'accepted';
          payload.reviewedAt = new Date().toISOString();
          ottimistico.reviewDecision = 'accepted';
        }
        if (b.dataset.local) {
          payload.localOnly = true;
          payload.localApproval = true;
          ottimistico.localOnly = { by: 'te', at: Date.now() };
          ottimistico.localApproval = { by: 'te', at: Date.now() };
        }
        if (b.dataset.reject) {
          payload.reviewDecision = 'rejected';
          payload.reviewedAt = new Date().toISOString();
          ottimistico.reviewDecision = 'rejected';
        }
        // Archiviazione a mano = scelta esplicita: vince per sempre
        // sull'auto-archiviazione a punteggio (DC3), in un verso e nell'altro.
        if (b.dataset.archive) { payload.archiveOverride = 'archived'; ottimistico.archiveOverride = 'archived'; }
        if (b.dataset.restore) { payload.archiveOverride = 'keep_open'; ottimistico.archiveOverride = 'keep_open'; }
        // Mettendo in coda un feedback appena arrivato porto con me note e allegati già scritti.
        const ta = listEl.querySelector(`.fb-notes[data-id="${cssEsc(id)}"]`);
        if (ta) { payload.notes = notesValueOf(ta); ottimistico.notes = payload.notes; }
        const frase = listEl.querySelector(`.fb-usernote[data-id="${cssEsc(id)}"]`);
        if (frase) { payload.userNote = frase.value.slice(0, 500); ottimistico.userNote = payload.userNote; }
        azioneScheda(b, { id, payload, optimistic: ottimistico });
      });
    });

    // «Riapri» apre un form inline: la spiegazione si appende alle note esistenti (separatore e
    // timestamp), così il commento del primo agente resta visibile anche dopo la riapertura.
    root.querySelectorAll('.fb-reopen-start').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.id;
        const card = b.closest('.fb-card');
        const actionsDiv = card && card.querySelector('.fb-actions');
        if (!actionsDiv) return;
        actionsDiv.innerHTML = `
          <div class="fb-reopen-form">
            <label class="fb-notes-label">Cosa non va / cosa manca:
              <textarea class="fb-reopen-text" rows="3" placeholder="Spiega meglio il problema, allega contesto, indica passi per riprodurre… (puoi incollare/trascinare immagini e file)"></textarea>
            </label>
            <div class="fb-attach-mount" data-kind="reopen"></div>
            <div class="fb-reopen-buttons">
              <button type="button" class="sn-btn sn-btn-secondary fb-reopen-cancel">Annulla</button>
              <button type="button" class="sn-btn fb-reopen-confirm">Conferma riapertura</button>
            </div>
          </div>
        `;
        const ta = actionsDiv.querySelector('.fb-reopen-text');
        // Compositore allegati per la riapertura (parità con gli altri composer).
        const reopenComposer = makeAttachComposer({
          textarea: ta,
          mount: actionsDiv.querySelector('.fb-attach-mount[data-kind="reopen"]'),
          initial: [],
        });
        ta.focus();
        // Esc annulla, Ctrl/Cmd+Enter conferma. Annullare rimette i pulsanti NELLA SCHEDA, senza
        // ridisegnare la lista (vedi «Un clic, una scheda»).
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            ripristinaAzioni(card, id);
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            actionsDiv.querySelector('.fb-reopen-confirm').click();
          }
        });
        actionsDiv.querySelector('.fb-reopen-cancel').addEventListener('click', () => {
          ripristinaAzioni(card, id);
        });
        actionsDiv.querySelector('.fb-reopen-confirm').addEventListener('click', (ev) => {
          const item = all.find((f) => f._id === id);
          const oldNotes = (item && item.notes) || '';
          const reason = ta.value.trim();
          const atts = reopenComposer.getAttachments();
          const ts = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
          // Senza testo né allegati, le note restano com'erano.
          const newNotes = window.SN_FEEDBACK_THREAD
            ? SN_FEEDBACK_THREAD.appendUserTurn(oldNotes, reason, { ts, label: 'Riaperto il', attachments: atts })
            : (reason ? (oldNotes ? `${oldNotes}\n\n--- Riaperto il ${ts} ---\n${reason}` : `--- Riaperto il ${ts} ---\n${reason}`) : oldNotes);
          // Riaprire = rimettere in coda (`todo`), la transizione prevista per «manca qualcosa».
          azioneScheda(ev.currentTarget, {
            id,
            payload: { status: 'todo', notes: newNotes },
            optimistic: { status: 'todo', notes: newNotes },
          });
        });
      });
    });

    // Composer "Invia risposta" del tab Chiarimenti: appende la risposta
    // dell'utente come turno (conservando la domanda di Filo nello storico) e
    // rimette il feedback in "Da risolvere" perché una routine lo riprenda.
    root.querySelectorAll('.fb-domanda[data-domanda]').forEach((b) => {
      b.addEventListener('click', (e) => { e.stopPropagation(); apriDomandaInGestione(b.dataset.domanda); });
    });

    root.querySelectorAll('.fb-reply-send').forEach((btn) => {
      const id = btn.dataset.id;
      const card = btn.closest('.fb-card');
      const ta = card && card.querySelector('.fb-reply-text');
      // Gli allegati si ancorano al turno della risposta dell'utente.
      const mount = card && card.querySelector('.fb-attach-mount[data-kind="reply"]');
      const composer = ta && mount ? makeAttachComposer({ textarea: ta, mount, initial: [] }) : null;
      const send = () => {
        const reply = ta ? ta.value.trim() : '';
        const atts = composer ? composer.getAttachments() : [];
        if (!reply && !atts.length) { if (ta) ta.focus(); return; }
        const item = all.find((f) => f._id === id);
        const oldNotes = (item && item.notes) || '';
        const newNotes = window.SN_FEEDBACK_THREAD
          ? SN_FEEDBACK_THREAD.appendUserTurn(oldNotes, reply, { attachments: atts })
          : (oldNotes ? `${oldNotes}\n\n${reply}` : reply);
        azioneScheda(btn, {
          id,
          payload: { status: 'todo', notes: newNotes },
          optimistic: { status: 'todo', notes: newNotes },
        });
      };
      btn.addEventListener('click', send);
      // Ctrl/Cmd+Enter invia (come negli altri composer di Filo).
      if (ta) ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
      });
    });

    // Clic sul pallino N imposta priorità N, ri-clic su quello attivo la azzera. In «In coda» la
    // priorità ordina: i pallini si ridipingono nella scheda, la lista resta ferma.
    root.querySelectorAll('.fb-dot').forEach((dot) => {
      dot.addEventListener('click', async () => {
        const id = dot.dataset.id;
        const n = Number(dot.dataset.n);
        const item = all.find((f) => f._id === id);
        if (!item || inScrittura.has(id) || decise.has(id)) return;
        const cur = priorityOf(item);
        const next = cur === n ? 0 : n;
        const card = dot.closest('.fb-card');
        inScrittura.add(id);
        spegniScheda(card);
        // priorityManual:true = scelta dell'owner: il giudice automatico non la sovrascrive.
        const ok = await patch(id, { priority: next, priorityManual: true }, { priority: next }, { inPlace: true });
        inScrittura.delete(id);
        if (card && card.isConnected) {
          riaccendiScheda(card);
          if (ok) ridipingiPriorita(card, item);
        }
      });
    });

    // Compositore del «capo»: persiste subito (onChange → patch), e notesValueOf ricompone
    // capo (testo e allegati) più coda intatta.
    root.querySelectorAll('.fb-attach-mount[data-kind="notes"]').forEach((mount) => {
      const id = mount.dataset.id;
      const ta = listEl.querySelector(`.fb-notes[data-id="${cssEsc(id)}"]`);
      if (!ta || ta._attachComposer) return;
      const item = all.find((f) => f._id === id);
      const init = item && window.SN_FEEDBACK_THREAD && SN_FEEDBACK_THREAD.stripAttachments
        ? SN_FEEDBACK_THREAD.stripAttachments(splitNotesHeadTail(item.notes).head).attachments
        : [];
      ta._attachComposer = makeAttachComposer({
        textarea: ta,
        mount,
        initial: init,
        onChange: () => {
          const v = notesValueOf(ta);
          const it = all.find((f) => f._id === id);
          if (it && it.notes === v) return;
          // Silenzioso come il salvataggio della casella: un ridisegno rigenererebbe le miniature
          // sotto il cursore, e la × appena premuta lascerebbe il posto a quella dell'allegato dopo.
          patch(id, { notes: v }, { notes: v }, { silenzioso: true });
        },
      });
    });

    // Debounce su input più blur; si salva il capo ricomposto con la coda (notesValueOf).
    root.querySelectorAll('.fb-notes').forEach((ta) => {
      const nome = `note:${ta.dataset.id}`;
      const flush = () => {
        caselleTesti.spedita(nome);
        const id = ta.dataset.id;
        const item = all.find((f) => f._id === id);
        if (!item) return;
        const v = notesValueOf(ta);
        if (item.notes === v) return;
        patch(id, { notes: v }, { notes: v }, { silenzioso: true });
      };
      caselleTesti.registra(nome, flush);
      ta.addEventListener('blur', flush);
      ta.addEventListener('input', (e) => caselleTesti.cambiato(nome, e, { pausa: PAUSA_TESTI_MS }));
    });

    // La frase per chi ha segnalato: è l'altra metà dei due testi, e senza questa casella
    // chiudendo un feedback col pulsante a chi l'aveva mandato restava la sola riga generica.
    root.querySelectorAll('.fb-usernote').forEach((input) => {
      const nome = `frase:${input.dataset.id}`;
      const flush = () => {
        caselleTesti.spedita(nome);
        const id = input.dataset.id;
        const item = all.find((f) => f._id === id);
        if (!item) return;
        const v = input.value.slice(0, 500);
        if (String(item.userNote || '') === v) return;
        patch(id, { userNote: v }, { userNote: v }, { silenzioso: true }).then((ok) => {
          if (ok) { riflettiFrase(id); return; }
          // Come in Gestione: se il salvataggio fallisce a casella chiusa, si riapre su quello che c'è davvero.
          mostraFrase(listEl.querySelector(`.fb-card[data-id="${cssEsc(id)}"]`), id, true);
        });
      };
      caselleTesti.registra(nome, flush);
      input.addEventListener('blur', flush);
      input.addEventListener('input', (e) => caselleTesti.cambiato(nome, e, { pausa: PAUSA_TESTI_MS }));
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || e.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        mostraFrase(input.closest('.fb-card'), input.dataset.id, false);
      });
    });

    root.querySelectorAll('.fb-usernote-toggle').forEach((b) => {
      b.addEventListener('click', () => {
        const card = b.closest('.fb-card');
        const box = card && card.querySelector('.fb-usernote-box');
        if (box) mostraFrase(card, b.dataset.id, box.hidden);
      });
    });
  }

  // Rimette i pulsanti originali di una scheda AL SUO POSTO, senza toccare il
  // resto della lista.
  function ripristinaAzioni(card, id) {
    const item = all.find((f) => f._id === id);
    const box = card && card.querySelector('.fb-actions');
    if (!box || !item) return;
    box.innerHTML = actionsFor(item);
    bindCardActions(box);
  }

  // Ridipinge i pallini della priorità nella scheda (stessa idea: la scheda si
  // aggiorna da sé, la lista non si muove).
  function ridipingiPriorita(card, item) {
    const vecchio = card && card.querySelector('.fb-priority');
    if (!vecchio || !item) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = priorityDotsHtml(item);
    const nuovo = tmp.firstElementChild;
    if (!nuovo) return;
    vecchio.replaceWith(nuovo);
    bindCardActions(nuovo);
  }

  // La lista la costruisce la stessa funzione pura della dashboard di gestione, ordinamento
  // compreso. Sopra passa solo il filtro «Solo automatici», che è di questa pagina.
  function sectionBase(tab) {
    // Stati illeggibili: niente sezioni, un elenco solo (i più recenti in cima).
    if (!sezioniAttendibili()) {
      return all.slice().sort((a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    }
    const t = tab || currentTab;
    // "Archiviati" ha regole sue (i confermati, i preferiti): la sua lista la
    // costruisce listArchiveTab, esattamente come nella gemella.
    if (t === 'archived') return MR.listArchiveTab(all, opzSezioni());
    // Le fusioni ferme davanti, con qualsiasi ordine: sono decisioni che aspettano l'owner, come in Gestione.
    return MR.fusioniFermeInCima(MR.listForManageTab(all, t, opzSezioni()), opzSezioni());
  }

  function sectionItems(tab) {
    const items = sectionBase(tab);
    return agentOnly ? items.filter(isAgent) : items;
  }

  // ── Qui la scheda È il dettaglio ─────────────────────────────────────────
  //
  // Ogni scheda mostra la conversazione intera, gli allegati, il testo: il
  // caricamento non può chiederli per tutti, o si torna ai dieci MB per
  // apertura. Li chiede per la SEZIONE che si sta guardando, una volta sola
  // (chi è già completo non si ridomanda), e lo dice mentre lo fa.
  const DETTAGLI_PER_VOLTA = 200;

  // Le richieste già partite, per id. Ogni gesto fatto durante l'attesa (una
  // lettera nella ricerca, un cambio di sezione, la casella «Solo automatici»)
  // ridisegna, e senza questo registro ogni ridisegno ricomprava la sezione
  // intera: dodici lettere, tredici volte gli stessi documenti.
  const dettagliInCorso = new Map();

  async function completaDettagli(ids) {
    const attese = [];
    const nuovi = [];
    for (const id of ids) {
      const inCorso = dettagliInCorso.get(id);
      if (inCorso) attese.push(inCorso);
      else nuovi.push(id);
    }
    if (nuovi.length) {
      const giro = chiediDettagli(nuovi);
      for (const id of nuovi) dettagliInCorso.set(id, giro);
      attese.push(giro.finally(() => {
        // Solo i propri: un giro più recente può già aver preso in carico un id
        // che questo non è riuscito a completare.
        for (const id of nuovi) if (dettagliInCorso.get(id) === giro) dettagliInCorso.delete(id);
      }));
    }
    await Promise.all(attese);
  }

  // Il marchio «questa lettura non è tornata» sulle righe di un blocco: la
  // scheda lo dice e offre di riprovare, e nessun ridisegno la ricompra.
  function segnaMancate(chiesti, motivo) {
    all = all.map((f) => {
      if (!chiesti.has(f._id)) return f;
      const { _proiezione, ...resto } = f;
      return { ...resto, _dettaglioMancato: motivo };
    });
  }

  // Riprova la lettura di UNA segnalazione, su richiesta di chi guarda.
  function riprovaDettaglio(id) {
    all = all.map((f) => {
      if (f._id !== id) return f;
      const { _dettaglioMancato, ...resto } = f;
      return { ...resto, _proiezione: true };
    });
    applyFilter();
  }

  // Che cosa serve davvero del documento intero. Quando NESSUNO stato si
  // legge, su questo computer manca la chiave privata: la conversazione non
  // comparirà in nessun caso, quindi chiederla vorrebbe dire pagare cento KB a
  // segnalazione per buttarli. Restano gli allegati, che si vedono lo stesso.
  // `null` = il documento intero, il caso normale.
  function campiDettaglio() {
    return sezioniAttendibili() ? null : ['images', 'files', 'userNote'];
  }

  async function chiediDettagli(ids) {
    for (let i = 0; i < ids.length; i += DETTAGLI_PER_VOLTA) {
      const pezzo = ids.slice(i, i + DETTAGLI_PER_VOLTA);
      // Il gruppo di QUESTO blocco, non tutti: togliere il marchio a chi non è
      // ancora stato chiesto lo lascerebbe per sempre senza conversazione.
      const chiesti = new Set(pezzo);
      let rows;
      try {
        // eslint-disable-next-line no-await-in-loop
        rows = await SN_FEEDBACK.getMany(pezzo, { timeoutMs: 20000, fields: campiDettaglio() });
      } catch (e) {
        // La lettura non è tornata. Va SCRITTO sulle righe, o al ridisegno
        // dopo il primo gesto (una lettera nella ricerca, un cambio di
        // sezione) sembrerebbero ancora da chiedere e ripartirebbero: la
        // stessa spesa, moltiplicata per i gesti fatti nell'attesa.
        segnaMancate(chiesti, 'rete');
        throw e;
      }
      if (isAdmin && rows.length > 0) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = await sendToMain({ type: 'feedback_decrypt_fields', list: rows });
          if (r && r.ok && Array.isArray(r.list)) rows = r.list;
        } catch (_) { /* come al caricamento: valori cifrati piuttosto che niente */ }
      }
      const perId = new Map(rows.map((r) => [String(r && r._id), r]));
      all = all.map((f) => {
        if (!chiesti.has(f._id)) return f;
        const pieno = perId.get(f._id);
        // Il marchio si toglie ANCHE a chi non è tornato (cancellato nel
        // frattempo): lasciarcelo rimanderebbe la pagina a richiederlo in
        // eterno, un giro di caricamento dopo l'altro. Ma la scheda lo disegna
        // senza conversazione, e su una conversazione mai letta un salvataggio
        // scrive al posto del report: chi scrive deve saperlo.
        if (!pieno) { const { _proiezione, _dettaglioVecchio, ...resto } = f; return { ...resto, _dettaglioMancato: 'sparito' }; }
        const { _proiezione, _dettaglioVecchio, ...resto } = f;
        // Della riga vale quello che sa un elenco; i campi del dettaglio sono la copia di prima del giro, e sopra il
        // documento appena letto cancellerebbero proprio il turno nuovo. Stessa regola della Gestione.
        for (const campo of (SN_FEEDBACK.CAMPI_DETTAGLIO || [])) delete resto[campo];
        // `pieno` porta con sé il marchio della proiezione quando abbiamo
        // chiesto i soli allegati: toglierlo qui, o la riga resterebbe per
        // sempre «da completare» e la pagina la richiederebbe a ogni disegno.
        const fuso = { ...pieno, ...resto };
        delete fuso._proiezione;
        if (campiDettaglio()) {
          // Senza la chiave il report non si legge comunque: al suo posto va
          // la frase in chiaro, e la casella resta spenta.
          fuso.notes = String(fuso.userNote || '').trim();
          fuso.reportIllegibile = true;
          return fuso;
        }
        return sanitizeReportForReader(fuso);
      });
    }
  }

  // Torna true se la sezione non è ancora completa: allora disegna l'attesa e
  // ridisegnerà da sé. `applyFilter` si ferma qui.
  function inAttesaDiDettagli(items) {
    const mancanti = items.filter((f) => SN_FEEDBACK.soloLista(f)).map((f) => f._id).filter(Boolean);
    if (!mancanti.length) return false;
    listEl.innerHTML = '<div class="fb-empty">Caricamento…</div>';
    emptyEl.hidden = true;
    countEl.textContent = '';
    const gen = loadGen;
    completaDettagli(mancanti)
      .then(() => { if (gen === loadGen) applyFilter(); })
      .catch((e) => {
        if (gen !== loadGen) return;
        console.error('[feedback] dettagli non caricati:', e);
        showLoadError((window.SN_CHAT_ERRORS && SN_CHAT_ERRORS.sentence)
          ? SN_CHAT_ERRORS.sentence(e)
          : 'Non è stato possibile caricare questi feedback: controlla la connessione e riprova.');
      });
    return true;
  }

  // Mostra o nasconde la barra delle sezioni. Non è una decorazione: se gli
  // stati non si leggono, quella barra scriverebbe numeri inventati.
  function mostraSezioni() {
    const ok = sezioniAttendibili();
    if (tabsEl) tabsEl.hidden = !ok;
    if (noSectionsEl) {
      noSectionsEl.hidden = ok;
      if (!ok) {
        noSectionsEl.textContent = 'Questo computer non può leggere lo stato delle segnalazioni. '
          + 'Le trovi tutte qui sotto, in un elenco solo.';
      }
    }
    return ok;
  }

  function applyFilter() {
    const q = (searchEl.value || '').trim().toLowerCase();
    const sezioni = mostraSezioni();
    const base = sectionItems();
    // I numeri delle sezioni si sanno già dalla proiezione: si scrivono subito,
    // anche mentre le schede di questa sezione stanno arrivando.
    if (sezioni) updateTabCounts();
    if (inAttesaDiDettagli(base)) return;
    const filtered = q
      ? base.filter((f) => {
          const num = SN_FEEDBACK.formatNum(f.seq, f.subSeq);
          return [f.text, f.url, f.clientId, f.userAgent, f.notes, f.name, num ? `#${num}` : '']
            .join(' ').toLowerCase().includes(q);
        })
      : base;
    if (sezioni && currentTab === 'resolved') {
      // Ordine per numero: seq e poi subSeq confrontati come numeri, così #22.2 viene prima di
      // #22.10. I feedback senza seq finiscono in coda.
      const numKey = (f) => {
        const seq = Number(f.seq);
        const sub = Number(f.subSeq);
        return {
          seq: Number.isFinite(seq) ? seq : Infinity,
          sub: Number.isFinite(sub) ? sub : 0,
        };
      };
      filtered.sort((a, b) => {
        const ka = numKey(a);
        const kb = numKey(b);
        return ka.seq - kb.seq || ka.sub - kb.sub;
      });
    }
    render(filtered);
    // Una scheda che il giro ha toccato si disegna con la conversazione che c'era, e si rilegge in sottofondo.
    if (base.some((f) => f._dettaglioVecchio && !f._dettaglioMancato)) ridisegnaDalVivo();
  }

  function updateTabCounts() {
    if (!sezioniAttendibili()) return;
    // Il numero è la LUNGHEZZA della lista che la sezione mostrerebbe, calcolata dalla stessa
    // funzione che la costruisce: manageTabCounts conta anche nella gemella (#495, #509).
    const counts = agentOnly
      ? TABS.reduce((acc, t) => { acc[t] = sectionItems(t).length; return acc; }, {})
      : MR.manageTabCounts(all, opzSezioni());
    // Il caricamento si ferma ai più recenti: quando li ha presi tutti fino al
    // tetto, questi numeri sono minimi e lo dicono con un "+" (#495). Restare
    // su "(312)" quando ce ne sono 400 sembra una risposta, e non lo è.
    // E finché i feedback non sono arrivati (caricamento in corso, o fallito)
    // non si scrive nessun numero: "(0)" direbbe "qui non c'è niente" mentre la
    // verità è che non lo sappiamo ancora.
    const capped = dataLoaded && SN_FEEDBACK.listHitCap(all, SN_FEEDBACK.LIST_PAGE_SIZE);
    // Una sezione dove è arrivato qualcosa a pagina aperta lo dice sulla linguetta, finché non lo si tocca.
    const conArrivi = new Set();
    if (live && live.arrivate.size) for (const f of all) if (arrivata(f)) conArrivi.add(tabOf(f));
    for (const tab of TABS) {
      const btn = tabsEl.querySelector(`[data-tab="${tab}"]`);
      if (!btn) continue;
      btn.classList.toggle('fb-tab--arrivi', conArrivi.has(tab));
      const label = TAB_LABELS[tab];
      btn.textContent = dataLoaded
        ? `${label} ${SN_FEEDBACK.countLabel(counts[tab] || 0, capped)}`
        : label;
      if (capped) btn.title = SN_FEEDBACK.COUNT_CAP_HINT;
      else btn.removeAttribute('title');
    }
  }

  /** Il feedback come lo può leggere CHI STA GUARDANDO: se il report è ancora cifrato, al
  * suo posto va la frase in chiaro per chi ha segnalato; se è leggibile, non tocca niente. */
  function sanitizeReportForReader(f) {
    const raw = String((f && f.notes) || '');
    const T = window.SN_FEEDBACK_THREAD;
    const illeggibile = T && T.reportUnreadable
      ? T.reportUnreadable(raw)
      : (raw.startsWith('FENC') || raw.startsWith('[cifrato'));
    if (!illeggibile) return f;
    // `reportIllegibile` spegne la casella di modifica: riscrivere una nota che non si è potuta
    // leggere cancellerebbe il report vero con quello rimasto sullo schermo.
    return { ...f, notes: String((f && f.userNote) || '').trim(), reportIllegibile: true };
  }

  // La frase comprensibile (mai il «Failed to fetch» grezzo) e il tasto per riprovare. Serve
  // in due momenti: quando il caricamento fallisce e a ogni re-render che svuoterebbe il riquadro.
  function showLoadError(msg) {
    listEl.innerHTML = '';
    countEl.textContent = '';
    emptyEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'fb-load-error-msg';
    p.textContent = msg;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fb-load-retry';
    btn.textContent = '↻ Riprova';
    btn.addEventListener('click', () => load());
    emptyEl.appendChild(p);
    emptyEl.appendChild(btn);
    emptyEl.hidden = false;
  }

  async function load() {
    const gen = ++loadGen;
    listEl.innerHTML = '<div class="fb-empty">Caricamento…</div>';
    emptyEl.hidden = true;
    // Le richieste di fusione viaggiano insieme alla lista: la prima sezione disegnata è già quella giusta.
    const letturaFusioni = isAdmin ? leggiFusioni() : Promise.resolve(null);
    // DB3: la versione dell'app in esecuzione è l'ultima rilasciata. Serve al
    // gate di "Risolti" — la stessa domanda che si fa la gemella, con la stessa
    // risposta, o un `done` non ancora uscito starebbe in due sezioni diverse.
    if (!releasedVersion) {
      try {
        const r = await sendToMain({ type: 'get_update_recap' });
        if (r && r.current) releasedVersion = r.current;
      } catch (_) { /* il gate non si attiva: senza versione niente confronto */ }
    }
    try {
      // timeoutMs: offline la fetch resta muta ~13 s prima che il sistema la
      // lasci cadere. Ci arrendiamo prima e mostriamo l'errore (con Riprova).
      // La PROIEZIONE della lista: titoli, stati, numeri e tutto ciò su cui
      // le sezioni contano e la ricerca filtra. Conversazione e allegati — la
      // parte che pesa — arrivano per la sezione che si guarda davvero.
      let list = await SN_FEEDBACK.list({
        pageSize: SN_FEEDBACK.LIST_PAGE_SIZE, timeoutMs: 8000, fields: SN_FEEDBACK.CAMPI_LISTA,
      });
      // S1.3: decifratura batch dei campi FENC1: — una sola IPC per tutta la lista.
      // Graceful fallback: se l'utente non è admin o l'IPC fallisce, i valori
      // restano invariati (la dashboard non si rompe, mostra il ciphertext).
      if (isAdmin && list.length > 0) {
        try {
          const r = await sendToMain({ type: 'feedback_decrypt_fields', list });
          if (r && r.ok && Array.isArray(r.list)) list = r.list;
        } catch (_) { /* fallback: render con valori cifrati */ }
      }
      const rf = await letturaFusioni;
      // Se nel frattempo è partito un caricamento più recente (o un test ha
      // iniettato dati), questo risultato è vecchio: si butta.
      if (gen !== loadGen) return;
      if (rf) fusioni = LIVE ? LIVE.fusioniDa(rf, fusioni) : fusioni;
      sogliaFinestra = sogliaDi(list);
      // I DUE TESTI. Il report della lavorazione da qui in avanti è cifrato: chi
      // non è l'owner non ha la chiave, e non deve averla. Al posto del blob
      // illeggibile mostriamo la frase scritta per chi ha segnalato — e se non
      // c'è, niente: una bolla vuota è meglio di una bolla di ciphertext.
      all = list.map(sanitizeReportForReader);
      // Da qui in poi i numeri delle sezioni sono veri e si possono scrivere.
      dataLoaded = true;
      loadError = null;
      applyFilter();
      if (live) live.segnaRiuscito();
      avviaVivo();
    } catch (e) {
      if (gen !== loadGen) return;
      // Anche a caricamento fallito: il giro lo ritenta da solo mentre la pagina è in vista.
      avviaVivo();
      // Errore di caricamento: frase per l'utente (mai il "Failed to fetch"
      // grezzo) + un tasto per riprovare, invece di lasciare l'utente bloccato a
      // chiudere e riaprire la pagina. Stesso pattern della bacheca (SN_CHAT_ERRORS).
      console.error('[feedback] errore caricamento:', e);
      loadError = (window.SN_CHAT_ERRORS && SN_CHAT_ERRORS.sentence)
        ? SN_CHAT_ERRORS.sentence(e)
        : 'Non è stato possibile caricare i feedback: controlla la connessione e riprova.';
      showLoadError(loadError);
    }
  }

  function selectTab(tab) {
    if (!TABS.includes(tab)) return;
    // Cambiare sezione è lasciare le schede: tornando, la frase riparte chiusa, come in Gestione cambiando feedback.
    if (tab !== currentTab) fraseAperte.clear();
    currentTab = tab;
    tabsEl.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('fb-tab--active', b.dataset.tab === tab);
    });
    applyFilter();
  }

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    selectTab(btn.dataset.tab);
    // Come in Gestione: aprire Ricevuti rilegge le fusioni, o una richiesta nata in cloud a stato fermo non si vede.
    if (btn.dataset.tab === 'inbox') caricaFusioni();
  });

  function closeLightbox() {
    if (!lightbox.classList.contains('open')) return;
    lightbox.classList.remove('open');
    // Sgancia la src così alla prossima apertura non si vede per un istante
    // l'immagine precedente mentre quella nuova carica.
    lightboxImg.removeAttribute('src');
  }
  lightbox.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.classList.contains('open')) {
      e.stopPropagation();
      closeLightbox();
    }
  });
  refreshBtn.addEventListener('click', load);
  searchEl.addEventListener('input', applyFilter);
  if (agentOnlyEl) {
    agentOnlyEl.addEventListener('change', () => {
      agentOnly = agentOnlyEl.checked;
      applyFilter();
    });
  }

  function renderAuthState(profile) {
    if (adminBanner) adminBanner.hidden = isAdmin;
    // Lo switch automazione è un controllo da owner: visibile solo agli admin.
    if (automationRow) automationRow.hidden = !isAdmin;
    if (isAdmin) loadAutomation();
    if (!isAdmin && adminBannerText) {
      adminBannerText.classList.remove('fb-admin-ko');
      // Distingui "non loggato" da "loggato ma non admin": il secondo non può
      // diventare admin cliccando Accedi, quindi nascondiamo il pulsante.
      if (profile?.email) {
        // #583: senza essere admin i feedback non si leggono affatto — dirlo com'è vale più di un
        // invito che non porta da nessuna parte.
        adminBannerText.textContent = `L'account ${profile.email} non è un amministratore: i feedback li vede chi li gestisce.`;
        if (adminSignInBtn) adminSignInBtn.hidden = true;
      } else {
        adminBannerText.textContent = 'I feedback li vede chi li gestisce: accedi con un account amministratore.';
        if (adminSignInBtn) adminSignInBtn.hidden = false;
      }
    }
  }

  async function refreshAuth() {
    try {
      const r = await sendToMain({ type: 'auth_status' });
      setIsAdmin(r?.isAdmin);
      renderAuthState(r?.profile);
    } catch (_) {
      setIsAdmin(false);
      renderAuthState(null);
    }
  }

  // Il perché di un accesso non riuscito sta nel riquadro dove si è premuto Accedi.
  function mostraAccessoFallito(frase) {
    if (!adminBannerText) return;
    adminBannerText.textContent = (typeof frase === 'string' && frase.trim()) || 'Accesso non riuscito: riprova.';
    adminBannerText.classList.add('fb-admin-ko');
  }

  if (adminSignInBtn) {
    adminSignInBtn.addEventListener('click', async () => {
      adminSignInBtn.disabled = true;
      try {
        const r = await sendToMain({ type: 'auth_signin' });
        setIsAdmin(r?.isAdmin);
        renderAuthState(r?.profile);
        applyFilter(); // ridisegna con/senza controlli admin
        if (r?.ok === false) mostraAccessoFallito(r.error);
      } catch (_) {
        mostraAccessoFallito();
      } finally {
        adminSignInBtn.disabled = false;
      }
    });
  }

  // Default OFF = ogni feedback, anche sicuro, passa dall'owner (vedi sopra).
  function renderAutomation(enabled) {
    if (automationToggle) automationToggle.checked = Boolean(enabled);
    if (automationDesc) {
      automationDesc.textContent = enabled
        ? 'Attiva: i feedback classificati sicuri vengono gestiti in autonomia; i casi a rischio passano comunque da te.'
        : 'Disattivata: ogni feedback, anche sicuro, richiede la tua verifica manuale.';
    }
  }

  async function loadAutomation() {
    try {
      const r = await sendToMain({ type: 'automation_get' });
      if (r?.ok) renderAutomation(Boolean(r.enabled));
    } catch (_) { /* lo switch resta com'è; si riprova al prossimo refresh auth */ }
  }

  if (automationToggle) {
    automationToggle.addEventListener('change', async () => {
      const want = automationToggle.checked;
      automationToggle.disabled = true;
      renderAutomation(want); // ottimistico
      try {
        const r = await sendToMain({ type: 'automation_set', enabled: want });
        if (!r || r.ok === false) throw new Error(r?.error || 'errore sconosciuto');
        renderAutomation(Boolean(r.enabled));
      } catch (e) {
        renderAutomation(!want);
        alert('Non sono riuscito a salvare l\'impostazione: ' + (e?.message || e));
      } finally {
        automationToggle.disabled = false;
      }
    });
  }

  // Reagisci al login/logout fatto altrove (es. dal pulsante account della shell).
  if (window.filo?.onBroadcast) {
    window.filo.onBroadcast((m) => {
      if (m?.type === 'auth_changed') {
        setIsAdmin(m.isAdmin);
        renderAuthState(m.profile);
        applyFilter();
        avviaVivo();
        caricaFusioni();
      }
      // Una richiesta di fusione nuova o decisa altrove sposta la pratica: l'elenco arriva col messaggio.
      if (m?.type === 'merge_approvals_changed') caricaFusioni(m);
    });
  }

  // ── Aggiornamento continuo ─────────────────────────────────────────────────
  // Il giro della Gestione (SN_FEEDBACK_LIVE_PAGINA): solo per l'owner e solo in vista. Qui la scheda È il
  // dettaglio, quindi il ridisegno aspetta anche bozze e scritture in volo (patterns/un-clic-una-scheda-…).
  const liveSources = {
    getMany: (ids) => SN_FEEDBACK.getMany(ids, { fields: SN_FEEDBACK.CAMPI_LISTA, timeoutMs: 20000 }),
  };
  let avvisoGiro = '';
  let ridisegnoInAttesa = false;
  let completandoDalVivo = false;

  function arrivata(f) {
    return !!(live && f && live.arrivate.has(String(f._id)));
  }

  // Il più vecchio caricato, se il caricamento si è fermato al tetto: il giro non porta dentro quelli prima.
  function sogliaDi(list) {
    if (!LIVE || !SN_FEEDBACK.listHitCap(list, SN_FEEDBACK.LIST_PAGE_SIZE)) return null;
    const date = list.map((f) => LIVE.createdMs(f)).filter((t) => t > 0);
    return date.length ? Math.min(...date) : null;
  }

  // Mai un rifiuto né un'attesa senza fine: senza le richieste le sezioni restano quelle dello stato.
  async function leggiFusioni() {
    let t = null;
    try {
      const r = await Promise.race([
        sendToMain({ type: 'merge_approvals_get' }),
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error('nessuna risposta')), 15000); }),
      ]);
      return r && r.ok !== false ? r : null;
    } catch (e) {
      console.warn('[feedback] fusioni in attesa:', e?.message || e);
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  // `gia`: l'elenco già pronto, quando avvisa il main (merge_approvals_changed).
  async function caricaFusioni(gia) {
    if (!isAdmin || !LIVE) return;
    const r = gia || await leggiFusioni();
    if (!r) return;
    const prima = dataLoaded && live ? live.fotoSezioni() : null;
    fusioni = LIVE.fusioniDa(r, fusioni);
    if (!dataLoaded) return;
    if (prima) live.segnaArrivi(prima, all);
    updateTabCounts();
    ridisegnaDalVivo();
  }

  // «Ferma» e gli avvisi del giro stanno accanto al numero delle schede, l'hover dice cosa.
  function aggiornaSegnoFerma() {
    if (!countEl || !live) return;
    const ferma = live.ferma();
    countEl.classList.toggle('fb-count--ferma', ferma);
    countEl.classList.toggle('fb-count--avviso', !!avvisoGiro && !ferma);
    const parti = [
      ferma ? `Lista ferma alle ${fmtTs(live.okAt())}: il server non risponde, riprovo da solo.` : '',
      avvisoGiro ? `Aggiornamento: ${avvisoGiro}` : '',
    ].filter(Boolean);
    if (parti.length) countEl.title = parti.join('\n');
    else countEl.removeAttribute('title');
  }

  // Una bozza nella lista: ridisegnare la butterebbe via, e la scrittura dopo leggerebbe la casella vuota.
  // Una casella già salvata non lo è più (note e frase si salvano da sole).
  function bozzaInCorso() {
    const el = document.activeElement;
    if (el && listEl.contains(el) && (/^(textarea|input|select)$/i.test(el.tagName) || el.isContentEditable)) return true;
    const di = (box) => all.find((f) => f._id === box.dataset.id);
    for (const ta of listEl.querySelectorAll('.fb-notes')) {
      const it = di(ta);
      if (ta.value !== ta.defaultValue && (!it || notesValueOf(ta) !== it.notes)) return true;
    }
    for (const inp of listEl.querySelectorAll('.fb-usernote')) {
      const it = di(inp);
      if (inp.value !== inp.defaultValue && (!it || inp.value.slice(0, 500) !== String(it.userNote || ''))) return true;
    }
    for (const ta of listEl.querySelectorAll('.fb-reply-text')) if (ta.value.trim()) return true;
    return !!listEl.querySelector('.fb-reopen-form, .fb-reply .fb-attach-thumb, .fb-reply .fb-attach-chip');
  }

  function listaCheScorre() {
    for (let el = listEl; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    }
    return document.scrollingElement || document.documentElement;
  }

  const puntatore = PAG ? PAG.seguiPuntatore(listEl, {
    quandoLibera: () => provaRidisegno(),
    // Col puntatore fermo su un pulsante la lista non si ricompone: sotto arriverebbe quello di un'altra scheda.
    azioni: 'button, a, input, textarea, select, label',
  }) : null;

  function ridisegnaDalVivo() {
    ridisegnoInAttesa = true;
    provaRidisegno();
  }

  function provaRidisegno() {
    if (!ridisegnoInAttesa || !dataLoaded || !live || !PAG) return;
    if (!live.inVista()) return;
    if (puntatore && puntatore.occupata()) { puntatore.rimanda(); return; }
    if (inScrittura.size || bozzaInCorso()) return;
    // Le schede della sezione toccate dal giro si completano prima: una conversazione vecchia sotto uno stato
    // nuovo direbbe due cose diverse. Chi non è tornato porta già il suo «riprova» e non si richiede.
    const daCompletare = sectionItems()
      .filter((f) => f && f._id && !f._dettaglioMancato && (SN_FEEDBACK.soloLista(f) || f._dettaglioVecchio))
      .map((f) => f._id);
    if (daCompletare.length) {
      if (completandoDalVivo) return;
      completandoDalVivo = true;
      completaDettagli(daCompletare)
        .catch((e) => console.warn('[feedback] dettagli del giro:', e?.message || e))
        .finally(() => { completandoDalVivo = false; provaRidisegno(); });
      return;
    }
    ridisegnoInAttesa = false;
    if (puntatore) puntatore.annulla();
    PAG.alSuoPosto({ lista: listEl, voci: '.fb-card', scorre: listaCheScorre }, applyFilter);
  }

  if (listEl) {
    // Una bozza sparita (inviata, svuotata, annullata) lascia passare il ridisegno che aspettava.
    const piuTardi = () => setTimeout(provaRidisegno, 0);
    listEl.addEventListener('input', piuTardi);
    listEl.addEventListener('focusout', piuTardi);
    listEl.addEventListener('click', piuTardi);
    // Toccata, una scheda arrivata è vista: il segno se ne va.
    listEl.addEventListener('pointerdown', (e) => {
      const card = e.target && e.target.closest && e.target.closest('.fb-card');
      if (!card || !live || !live.arrivate.delete(String(card.dataset.id))) return;
      card.classList.remove('fb-card--arrivata');
      updateTabCounts();
    });
  }

  live = PAG ? PAG.crea({
    nome: 'feedback',
    invia: sendToMain,
    sorgenti: liveSources,
    pronta: () => dataLoaded,
    carica: () => load(),
    righe: () => all,
    sostituisci: (lista) => { all = lista; },
    decifra: () => isAdmin,
    sezioneDi: (f) => (sezioniAttendibili() && !statoCifrato(f) ? tabOf(f) : null),
    finestra: () => sogliaFinestra,
    // I numeri dicono subito la verità; la lista si ricompone quando nessuno la sta usando.
    ridisegna: () => { if (sezioniAttendibili()) updateTabCounts(); ridisegnaDalVivo(); },
    rileggiFusioni: () => caricaFusioni(),
    avvisi: (testo) => { avvisoGiro = testo || ''; aggiornaSegnoFerma(); },
    segno: () => aggiornaSegnoFerma(),
    quandoInVista: () => provaRidisegno(),
  }) : null;

  // Il giro legge per conto dell'owner: chi non lo è non ha niente da seguire.
  function avviaVivo() {
    if (!live) return;
    if (isAdmin) live.start();
    else live.stop();
  }

  // ── Aggancio di test (stesso pattern di manage: window.__mgTest) ──────────
  // Gli spec iniettano dati DOPO l'apertura della pagina, senza gareggiare col
  // caricamento reale: setData invalida (via loadGen) qualsiasi load in volo,
  // così il risultato vero — che arriva secondi dopo — viene buttato invece di
  // sovrascrivere i dati finti. È lo stesso rimedio che tiene stabile manage.
  window.__fbTest = {
    setAdmin(v, profile) {
      setIsAdmin(v);
      renderAuthState(profile || null);
      applyFilter();
    },
    // Dati finti = giro fermo, o il primo giro li rimpiazzerebbe con Firestore. `{ dalVivo: true }` (dopo
    // setLiveSources) tiene acceso l'orologio vero sulle sorgenti finte, come in Gestione.
    setData(fbs, opts) {
      loadGen++; // il caricamento reale in volo, se c'è, viene scartato
      if (live) { live.stop(); live.blocca(!(opts && opts.dalVivo)); live.arrivate.clear(); }
      all = (Array.isArray(fbs) ? fbs : []).map(sanitizeReportForReader);
      sogliaFinestra = (opts && opts.finestra) || null;
      // Dati iniettati = dati arrivati: da qui i numeri delle sezioni si scrivono.
      dataLoaded = true;
      loadError = null;
      applyFilter();
      if (live && opts && opts.dalVivo) { live.segnaRiuscito(); live.start(); }
    },
    setLiveSources(src) {
      Object.assign(liveSources, src || {});
      if (src && typeof src.listVersions === 'function' && typeof src.giro !== 'function') {
        liveSources.giro = async () => ({
          ok: true,
          giro: { kind: 'reconcile', versions: await src.listVersions({ timeoutMs: 20000 }) },
        });
      }
    },
    setLiveTiming(t) { if (live) live.tempi(t); },
    pollNow() { return live ? live.giro({ force: true }) : Promise.resolve({ changed: 0 }); },
    liveMessage(m) { return live ? live.applicaEsito(m) : Promise.resolve({ changed: 0 }); },
    isLiveOn() { return !!(live && live.acceso()); },
    // Quello che la pagina sa dal main: gli spec aspettano questo invece di un tempo fisso (#1212).
    inVista() { return !!(live && live.inVista()); },
    liveArrivate() { return live ? Array.from(live.arrivate) : []; },
    caricaFusioni: (gia) => caricaFusioni(gia),
    fusioni: () => fusioni,
    setTab(tab) { selectTab(tab); },
    // DB3: negli spec non c'è un aggiornamento da interrogare, e il gate di
    // "Risolti" dipende dalla versione rilasciata: iniettabile, come in manage.
    setReleasedVersion(v) { releasedVersion = v || ''; applyFilter(); },
    setAgentOnly(v) {
      agentOnly = !!v;
      if (agentOnlyEl) agentOnlyEl.checked = agentOnly;
      applyFilter();
    },
  };

  // Carica prima lo stato admin, poi i feedback: così il primo render già
  // mostra (o nasconde) i controlli di gestione in modo coerente.
  const bootDone = refreshAuth().finally(load);
  // Gli spec aspettano la fine del caricamento vero prima di iniettare dati finti.
  window.__fbTest.whenReady = () => bootDone;
})();

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

  const TABS = ['inbox', 'queue', 'resolved', 'archived'];
  const TAB_LABELS = {
    inbox: 'Ricevuti', queue: 'In coda', resolved: 'Risolti', archived: 'Archiviati',
  };
  const TAB_EMPTY = {
    inbox: 'Nessun feedback in attesa di una tua decisione.',
    queue: 'Nessun feedback in lavorazione.',
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
    return MR.manageTabFor(f, { releasedVersion });
  }

  // La regola su cosa è illeggibile e su cosa si scrive al suo posto vive nel modulo
  // condiviso: tenerne una copia qui è il modo in cui le due pagine hanno divergito (#509).
  function statoCifrato(f) {
    return MR.statusUnreadable(f);
  }
  function sezioniAttendibili() {
    return MR.sectionsReliable(all);
  }

  // Ritrovamenti automatici: agente esploratore LLM («agent:<model>») e audit di routine
  // («routine:<slug>») da triagiare; i sub-feedback nascono todo/design e vanno esclusi.
  function isAgent(f) {
    const c = String(f.clientId || '');
    if (c.startsWith('agent:')) return true;
    if (c.startsWith('routine:') && statusOf(f) === 'unlabeled') return true;
    return false;
  }
  // Origine del feedback: delega alla logica condivisa, così dashboard e main classificano uguale.
  function originOf(f) {
    const c = String(f.clientId || '');
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

  // Compositore legato a una textarea (incolla e trascina). Ogni file va SUBITO su Storage,
  // così le note salvano solo l'URL; onChange() per chi vuole persistenza immediata.
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
          im.src = a.url; im.alt = '';
          im.title = 'Clic per ingrandire';
          im.addEventListener('click', () => { lightboxImg.src = a.url; lightbox.classList.add('open'); });
          const x = document.createElement('button');
          x.type = 'button'; x.className = 'fb-attach-x'; x.textContent = '×';
          x.setAttribute('aria-label', 'Rimuovi');
          x.addEventListener('click', () => { attachments.splice(i, 1); renderThumbs(); if (typeof onChange === 'function') onChange(); });
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
        attachments.push(att);
        renderThumbs();
        setStatus('');
        if (typeof onChange === 'function') onChange();
      } catch (e) {
        setStatus('Caricamento non riuscito: ' + (e?.message || e));
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
    const lines = s.split('\n');
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
    // Un cambio di stato passa SOLO se è fra le azioni che la segnalazione offre ORA: lo stato
    // può cambiare a pannello aperto, e un attacco confermato finiva riscritto ad archiviato.
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
    };
    Object.assign(item, optimistic);
    if (!silenzioso && !inPlace) applyFilter();
    try {
      // Instradata dal main, che allega l'ID token come Bearer e rifiuta i non-admin: i token non
      // sono mai esposti alle pagine (SECURITY.md §3).
      const r = await sendToMain({ type: 'feedback_update', id, ...payload });
      if (!r || r.ok === false) throw new Error(r?.error || 'aggiornamento rifiutato');
      return true;
    } catch (e) {
      Object.assign(item, prev);
      if (!inPlace) applyFilter();
      alert('Errore: ' + (e?.message || e));
      return false;
    }
  }

  // I pulsanti scrivono STATI CANONICI, o il feedback esce dalla macchina a stati. QUALI
  // azioni esistono lo decide MR.ownerActions, la stessa tabella della gemella.
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
      return `<button class="sn-btn${a.primary ? '' : ' sn-btn-secondary'} fb-act"`
        + ` data-id="${id}" data-to="${escapeHtml(a.to)}"${EXTRA[a.kind] || ''}>${escapeHtml(a.label)}</button>`;
    }).join('\n');
  }

  // UN CLIC, UNA SCHEDA: nessuna azione presa dentro una scheda ricompone la lista — si
  // aggiorna al proprio posto, o il secondo clic cade su un ALTRO feedback.

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
    const dest = MR.manageTabFor(dopo, { releasedVersion });
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
  }

  // Cattura il campo a fuoco (se ha data-id) per riselezionarlo dopo il re-render: senza,
  // salvare le note faceva perdere fuoco e cursore mentre l'utente stava scrivendo.
  function captureFocus() {
    const el = document.activeElement;
    if (!el || !listEl.contains(el)) return null;
    const id = el.dataset && el.dataset.id;
    if (!id) return null;
    // Distingue le textarea con stesso data-id (es. note) dalla classe.
    const cls = el.classList && el.classList.contains('fb-notes') ? 'fb-notes'
      : (el.classList && el.classList.contains('fb-usernote') ? 'fb-usernote' : null);
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
    countEl.textContent = items.length ? `${items.length} feedback` : '';
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
      const cid = (f.clientId || '').slice(0, 12);
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
      const agentIcon = isRoutineFind ? '🔧' : '🤖';
      const agentLabel = am ? (isRoutineFind ? `audit · ${am.model}` : am.model) : '';
      const agentBadgeTitle = isRoutineFind ? 'Audit automatico di una routine cloud' : "Modello che ha trovato l'errore";
      const agentTitleHtml = am && (am.title || num)
        ? `<div class="fb-title">${numHtml}${numHtml && am.title ? ' ' : ''}${escapeHtml(am.title)}</div>` : '';
      const agentHtml = agent ? `
        <div class="fb-badges">
          <span class="fb-badge fb-badge--model" title="${escapeHtml(agentBadgeTitle)}">${agentIcon} ${escapeHtml(agentLabel)}</span>
          ${am.severity ? `<span class="fb-badge fb-badge--${escapeHtml(am.severity)}">${escapeHtml(am.severity)}</span>` : ''}
          ${am.area ? `<span class="fb-badge">${escapeHtml(am.area)}</span>` : ''}
        </div>
        ${agentTitleHtml}` : '';
      // Le issue d'agente hanno già il loro titolo in agentHtml.
      const titleHtml = !agent && (num || f.name)
        ? `<div class="fb-title">${numHtml}${numHtml && f.name ? ' ' : ''}${escapeHtml(f.name || '')}</div>`
        : '';
      // Conversazione a turni (#108): segnalazione, risposte di Filo e dell'utente in BOLLE
      // distinte in ordine cronologico. Gli allegati vivono nella bolla della segnalazione.
      const turns = window.SN_FEEDBACK_THREAD ? SN_FEEDBACK_THREAD.parse(f) : [];
      const convoTurns = turns.filter((t) => t.kind !== 'report');
      const reportRole = window.SN_FEEDBACK_THREAD && SN_FEEDBACK_THREAD.isFromModel(f.clientId) ? 'model' : 'user';
      const reportWho = reportRole === 'model' ? 'Agente' : 'Segnalazione';
      // «Ricevuti» è incluso così si può COMMENTARE un feedback appena arrivato e poi metterlo in
      // coda: il commento viaggia col cambio di stato. Le domande della routine stanno qui.
      const clarifyReply = isAdmin && statusOf(f) === 'design' && statusReasonOf(f) === 'clarify';
      const notesEditable = isAdmin && !f.reportIllegibile && !clarifyReply
        && (currentTab === 'inbox' || currentTab === 'queue');
      const convoBubble = (t) => {
        const who = (t.kind === 'note' || t.role === 'model') ? 'Filo' : 'Tu';
        const tsLabel = t.ts ? `<span>${escapeHtml(String(t.ts))}</span>` : '';
        // Allegati ANCORATI a questo turno (#190.3): immagini + file separati.
        const atts = Array.isArray(t.attachments) ? t.attachments : [];
        const tImgs = atts.filter((a) => a && a.kind === 'img').map((a) => a.url);
        const tFiles = atts.filter((a) => a && a.kind === 'file');
        const bodyHtml = t.body ? `<div class="fb-bubble-body">${escapeHtml(t.body)}</div>` : '';
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
      const threadHtml = `<div class="fb-thread">${reportBubble}${convoHtml}</div>`;
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
           <div class="fb-attach-mount" data-id="${escapeHtml(f._id)}" data-kind="notes"></div>
           <label class="fb-usernote-label">Frase per chi ha segnalato:
             <input type="text" class="fb-usernote" data-id="${escapeHtml(f._id)}" maxlength="500"
                    placeholder="Una riga in chiaro: cosa può fare adesso. La casella qui sopra la legge solo tu."
                    value="${escapeHtml(String(f.userNote || ''))}">
           </label>`
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
        <article class="fb-card fb-card--${escapeHtml(statusOf(f))} fb-card--tab-${escapeHtml(tabOf(f) || 'inbox')} fb-card--origin-${origin}${agent ? ' fb-card--agent' : ''}" data-id="${escapeHtml(f._id)}">
          <div class="fb-meta">
            <span>${escapeHtml(when)}</span>
            ${stateBadgeHtml(f)}
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
          <div class="fb-actions">${actionsFor(f)}</div>
        </article>
      `;
    }).join('');

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

    // «Invia risposta» dei Chiarimenti: appende la risposta come turno, conservando la domanda
    // di Filo, e rimette il feedback in «Da risolvere».
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
      let timer;
      const flush = () => {
        const id = ta.dataset.id;
        const item = all.find((f) => f._id === id);
        if (!item) return;
        const v = notesValueOf(ta);
        if (item.notes === v) return;
        patch(id, { notes: v }, { notes: v }, { silenzioso: true });
      };
      ta.addEventListener('blur', flush);
      ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(flush, 1500);
      });
    });

    // La frase per chi ha segnalato: è l'altra metà dei due testi, e senza questa casella
    // chiudendo un feedback col pulsante a chi l'aveva mandato restava la sola riga generica.
    root.querySelectorAll('.fb-usernote').forEach((input) => {
      let timer;
      const flush = () => {
        const id = input.dataset.id;
        const item = all.find((f) => f._id === id);
        if (!item) return;
        const v = input.value.slice(0, 500);
        if (String(item.userNote || '') === v) return;
        patch(id, { userNote: v }, { userNote: v }, { silenzioso: true });
      };
      input.addEventListener('blur', flush);
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(flush, 1500);
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
    return t === 'archived'
      ? MR.listArchiveTab(all, { releasedVersion })
      : MR.listForManageTab(all, t, { releasedVersion });
  }

  function sectionItems(tab) {
    const items = sectionBase(tab);
    return agentOnly ? items.filter(isAgent) : items;
  }

  // Non è una decorazione: se gli stati non si leggono, quella barra scriverebbe numeri inventati.
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
    if (sezioni) updateTabCounts();
    render(filtered);
  }

  function updateTabCounts() {
    if (!sezioniAttendibili()) return;
    // Il numero è la LUNGHEZZA della lista che la sezione mostrerebbe, calcolata dalla stessa
    // funzione che la costruisce: manageTabCounts conta anche nella gemella (#495, #509).
    const counts = agentOnly
      ? TABS.reduce((acc, t) => { acc[t] = sectionItems(t).length; return acc; }, {})
      : MR.manageTabCounts(all, { releasedVersion });
    // Presi tutti i feedback fino al tetto, questi numeri sono minimi e lo dicono con un «+»:
    // «(312)» su 400 sembra una risposta e non lo è. Prima dell'arrivo, nessun numero.
    const capped = dataLoaded && SN_FEEDBACK.listHitCap(all, SN_FEEDBACK.LIST_PAGE_SIZE);
    for (const tab of TABS) {
      const btn = tabsEl.querySelector(`[data-tab="${tab}"]`);
      if (!btn) continue;
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
    // DB3 (releasedVersion): stessa domanda e stessa risposta di src/pages/manage/manage.js.
    if (!releasedVersion) {
      try {
        const r = await sendToMain({ type: 'get_update_recap' });
        if (r && r.current) releasedVersion = r.current;
      } catch (_) { /* il gate non si attiva: senza versione niente confronto */ }
    }
    try {
      // timeoutMs: offline la fetch resta muta ~13 s prima che il sistema la
      // lasci cadere. Ci arrendiamo prima e mostriamo l'errore (con Riprova).
      let list = await SN_FEEDBACK.list({ pageSize: SN_FEEDBACK.LIST_PAGE_SIZE, timeoutMs: 8000 });
      // S1.3: decifratura batch dei campi FENC1:, una sola IPC per tutta la lista. Se l'utente non
      // è admin o l'IPC fallisce i valori restano invariati: la dashboard non si rompe.
      if (isAdmin && list.length > 0) {
        try {
          const r = await sendToMain({ type: 'feedback_decrypt_fields', list });
          if (r && r.ok && Array.isArray(r.list)) list = r.list;
        } catch (_) { /* fallback: render con valori cifrati */ }
      }
      // Se nel frattempo è partito un caricamento più recente (o un test ha
      // iniettato dati), questo risultato è vecchio: si butta.
      if (gen !== loadGen) return;
      // I DUE TESTI: il report della lavorazione è cifrato e chi non è l'owner non ha la chiave.
      // Al suo posto la frase per chi ha segnalato; se non c'è, niente.
      all = list.map(sanitizeReportForReader);
      // Da qui in poi i numeri delle sezioni sono veri e si possono scrivere.
      dataLoaded = true;
      loadError = null;
      applyFilter();
    } catch (e) {
      if (gen !== loadGen) return;
      console.error('[feedback] errore caricamento:', e);
      loadError = (window.SN_CHAT_ERRORS && SN_CHAT_ERRORS.sentence)
        ? SN_CHAT_ERRORS.sentence(e)
        : 'Non è stato possibile caricare i feedback: controlla la connessione e riprova.';
      showLoadError(loadError);
    }
  }

  function selectTab(tab) {
    if (!TABS.includes(tab)) return;
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
      // «Loggato ma non admin» non diventa admin cliccando Accedi: il pulsante si nasconde.
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

  if (adminSignInBtn) {
    adminSignInBtn.addEventListener('click', async () => {
      adminSignInBtn.disabled = true;
      try {
        const r = await sendToMain({ type: 'auth_signin' });
        setIsAdmin(r?.isAdmin);
        renderAuthState(r?.profile);
        applyFilter(); // ridisegna con/senza controlli admin
        if (r?.ok === false) alert('Accesso non riuscito: ' + (r.error || 'errore sconosciuto'));
      } catch (e) {
        alert('Accesso non riuscito: ' + (e?.message || e));
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
      }
    });
  }

  // Aggancio di test (come window.__mgTest): setData invalida via loadGen qualsiasi load in
  // volo, così il risultato vero — che arriva secondi dopo — non sovrascrive i dati finti.
  window.__fbTest = {
    setAdmin(v, profile) {
      setIsAdmin(v);
      renderAuthState(profile || null);
      applyFilter();
    },
    setData(fbs) {
      loadGen++; // il caricamento reale in volo, se c'è, viene scartato
      all = (Array.isArray(fbs) ? fbs : []).map(sanitizeReportForReader);
      // Dati iniettati = dati arrivati: da qui i numeri delle sezioni si scrivono.
      dataLoaded = true;
      loadError = null;
      applyFilter();
    },
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

  // Prima lo stato admin, poi i feedback: il primo render mostra già i controlli in modo coerente.
  refreshAuth().finally(load);
})();

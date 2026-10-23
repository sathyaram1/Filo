// Pagina Crediti: saldo, torta del consumo per tipo d'uso e movimenti recenti.
// Il costo in € non si mostra MAI: la vista pubblica del motore crediti lo toglie a monte.
// Col portafoglio sul server (#598) il saldo grande è quello del server, non il locale.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;
  const ICONS = window.SN_ICONS;

  function $(id) { return document.getElementById(id); }

  // Palette scelta a mano per restare distinguibile su chiaro e scuro; le fette seguono
  // l'ordine della legenda, così colore ed etichetta combaciano.
  const PALETTE = ['#c45a3b', '#3b82c4', '#3bbf7a', '#c9a13b',
    '#8a4fc4', '#c43b87', '#3bbdc4', '#7d8a3b'];

  async function load() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);

    if (ICONS && ICONS.credits) $('coin').innerHTML = ICONS.credits(48);

    // La ricarica giornaliera è un importo unico (CREDIT.DAILY_REFILL): la frase
    // lo legge dal valore in vigore invece di scriverlo a mano, così se l'importo
    // cambia (o l'owner lo configura) il testo resta veritiero. Stessa simmetria
    // già applicata al costo di riapertura in bacheca.
    if (window.SN_CONST?.CREDIT?.DAILY_REFILL != null) $('refillHint').textContent = rigaSottoIlSaldo(ultimoStato);

    // Le due letture non dipendono l'una dall'altra: partono insieme. L'avviso viene dopo, dal saldo appena letto.
    const [r, w] = await Promise.all([
      chrome.runtime.sendMessage({ type: MSG.GET_CREDITS }),
      chrome.runtime.sendMessage({ type: MSG.WALLET_STATE }).catch(() => null),
    ]);
    render(r || {}, w || null);
    renderAvviso(await chrome.runtime.sendMessage({ type: MSG.CREDITS_WARNING_STATE }).catch(() => null));
    seguiAncora();
  }

  // La riga sotto il conteggio locale. Con la chiave propria quel numero non paga niente, e lo dice prima (#1353).
  function rigaRicarica(chiavePropria = false) {
    const refill = window.SN_CONST?.CREDIT?.DAILY_REFILL;
    const ricarica = `Ricevi ${refill != null ? `+${formatInt(refill)}` : 'altri'} crediti ogni giorno a mezzanotte.`;
    return chiavePropria
      ? `Le richieste le paga la tua chiave OpenRouter. Questi sono crediti di prova che Filo tiene su questo computer, non soldi che spendi. ${ricarica}`
      : ricarica;
  }

  // La riga per l'ultimo stato letto: mentre la pagina rilegge resta quella, non torna per un attimo a quella di serie.
  let ultimoStato = null;
  function rigaSottoIlSaldo(w) {
    const server = w && w.ok ? w.server : null;
    if (server && server.hasWallet) {
      const daily = Number(server.dailyCredits) || 0;
      return daily > 0 ? `Ricevi +${formatInt(daily)} crediti ogni giorno, e si accumulano.` : 'I crediti li tiene il server.';
    }
    return rigaRicarica(Boolean(w && w.ok && w.keySource === 'own'));
  }

  // ── L'avviso prima che i crediti finiscano (#818) ──────────────────────────
  // C'è finché le soglie lo dicono, o finché c'è un rimedio applicato da poter rimettere com'era. La frase
  // dell'ultimo clic resta sotto il suo rimedio anche quando la pagina si ridisegna da sola.
  let esitoAvviso = null;
  function renderAvviso(a) {
    const sez = $('avviso');
    const avviso = a && a.ok && a.mostra ? a.avviso : null;
    sez.hidden = !avviso;
    if (!avviso) return;
    $('avvisoTesto').textContent = avviso.testo || '';
    $('avvisoTesto').hidden = !avviso.testo;
    const host = $('avvisoRimedi');
    const opz = {
      avviso,
      invia: (m) => chrome.runtime.sendMessage(m),
      classeBottone: 'sn-btn sn-btn-secondary',
      apriChiave: apriCampoChiave,
      esito: esitoAvviso,
      onEsito: (id, frase) => { esitoAvviso = frase ? { id, frase } : null; },
    };
    // La pagina si ridisegna a ogni saldo cambiato: l'elenco si aggiorna sul posto, così un clic non va a vuoto.
    const ul = host.querySelector(':scope > .sn-crediti-rimedi');
    if (ul) window.SN_CREDITI_AVVISO_UI.aggiorna(ul, opz);
    else host.appendChild(window.SN_CREDITI_AVVISO_UI.elenco(opz));
  }

  // «Metti la chiave»: il campo della chiave propria, qui sotto.
  function apriCampoChiave() {
    const sez = $('ownKeySection');
    if (sez.hidden || $('ownKeyForm').hidden) return;
    sez.scrollIntoView({ block: 'center', behavior: window.SN_THEME_TOKENS?.scrollBehavior(document) || 'smooth' });
    $('ownKeyInput').focus();
  }

  // Arrivati dalla notifica (#avviso) o da «Metti la chiave» in chat (#chiave): una volta, al primo disegno.
  let ancora = String(location.hash || '').slice(1);
  function seguiAncora() {
    if (!ancora) return;
    const a = ancora;
    ancora = '';
    if (a === 'chiave') apriCampoChiave();
    else if (a === 'avviso' && !$('avviso').hidden) $('avviso').scrollIntoView({ block: 'start' });
  }

  function render(r, w) {
    const credits = r.credits || {};
    // Saldo a un decimale: un uso leggero consuma frazioni di credito e l'intero le
    // nasconderebbe. balanceExact conserva la frazione, `balance` è il ripiego.
    const bal = credits.balanceExact != null ? credits.balanceExact : (credits.balance || 0);
    $('balance').textContent = formatCredits(bal);
    $('offlineHint').hidden = !!r.signedIn;
    accessoGoogle = !!r.signedIn;

    renderWallet(w);
    renderUsage(credits.byUsage || {});
    renderMoves(credits.rewards || [], w);
  }

  // Una conferma deve restare leggibile: l'avviso di saldo cambiato arriva nello stesso
  // istante e il ridisegno cancellava la frase. La conferma vince finché non si fa altro.
  let confirmation = null;
  function showConfirmation(text) {
    confirmation = text || null;
    const note = $('walletNote');
    if (confirmation) { note.textContent = confirmation; note.hidden = false; }
  }
  function renderWallet(w) {
    // Un invito arrivato da fuori — il link aperto da un'altra applicazione, o
    // il primo avvio dopo aver scaricato Filo dalla pagina dell'invito — ha
    // cambiato il saldo senza che l'utente chiedesse niente. La pagina lo
    // dice, una volta: poi il main se lo segna come già raccontato.
    if (w && w.notice && w.notice.text && !w.notice.seenCredits) {
      confirmation = w.notice.text;
      w.notice.seenCredits = true;
      Promise.resolve(chrome.runtime.sendMessage({ type: MSG.WALLET_NOTICE_SEEN, where: 'credits' })).catch(() => {});
    }
    renderWalletState(w);
    renderOwnKey(w);
    if (confirmation) {
      const note = $('walletNote');
      note.textContent = confirmation;
      note.hidden = false;
    }
  }

  // ── La chiave OpenRouter propria (#629) ────────────────────────────────────
  // È lo stesso campo delle Impostazioni: metterla o toglierla da qui si vede
  // subito di là, e viceversa (il main avvisa la pagina a ogni cambio).
  const W = window.SN_WALLET;
  let ownKeyInfoFor = ''; // la coda della chiave per cui spesa e residuo sono già stati chiesti
  let ownKeyRefusalFor = ''; // …e il rifiuto che c'era allora: uno nuovo cambia anche spesa e residuo
  function renderOwnKey(w) {
    const section = $('ownKeySection');
    if (!w || !w.ok) { section.hidden = true; return; }
    section.hidden = false;
    const has = Boolean(w.usingOwnKey);
    const hasWallet = Boolean(w.server && w.server.hasWallet);
    $('ownKeyForm').hidden = has;
    $('ownKeyHave').hidden = !has;
    if (!has) {
      ownKeyInfoFor = '';
      ownKeyRefusalFor = '';
      return;
    }
    $('ownKeyTail').textContent = `…${w.ownKeyTail || ''}`;
    $('ownKeyTail').title = 'Gli ultimi sei caratteri della chiave';
    const refusal = $('ownKeyRefusal');
    if (w.ownKeyRefusal && W) {
      refusal.textContent = W.ownKeyRefusalNote(w.ownKeyRefusal);
      refusal.hidden = false;
    } else {
      refusal.hidden = true;
    }
    $('ownKeyRule').textContent = hasWallet
      ? (w.ownKeyRefusal ? '' : 'Ogni chiamata prova prima lei; se OpenRouter la rifiuta, Filo usa i tuoi crediti.')
      : 'Paghi tu, sul tuo conto OpenRouter.';
    $('ownKeyRule').hidden = !$('ownKeyRule').textContent;
    // La domanda del «Togli» dice cosa succede DOPO: coi crediti di Filo se
    // c'è un portafoglio; senza, Filo resta senza una chiave (primo giro di
    // verifica del ramo).
    $('ownKeyConfirmText').textContent = hasWallet
      ? 'Da qui in poi paghi coi crediti di Filo. Confermi?'
      : 'Senza una chiave Filo non può usare i modelli, finché non riscatti un invito o ne metti un\'altra. Confermi?';
    $('ownKeyConfirm').hidden = true;
    $('ownKeyRemoveBtn').hidden = false;
    // Spesa e residuo li dice OpenRouter: si chiedono una volta per chiave,
    // appena la chiave è a schermo, non a ogni ridisegno; di nuovo, senza
    // svuotare la riga, quando arriva un rifiuto (#662: «restano 8,77 $»
    // sotto «il suo credito è finito» si contraddicevano).
    const refusalAt = (w.ownKeyRefusal && w.ownKeyRefusal.at) || '';
    if (ownKeyInfoFor !== w.ownKeyTail) {
      ownKeyInfoFor = w.ownKeyTail;
      ownKeyRefusalFor = refusalAt;
      loadOwnKeyInfo().catch(() => {});
    } else if (ownKeyRefusalFor !== refusalAt) {
      ownKeyRefusalFor = refusalAt;
      if (refusalAt) loadOwnKeyInfo({ quiet: true }).catch(() => {});
    }
  }

  // `quiet`: la riga resta com'è finché non arriva la nuova (dopo una
  // chiamata pagata con la chiave, non al primo giro).
  async function loadOwnKeyInfo({ quiet = false } = {}) {
    const el = $('ownKeyBalance');
    if (!quiet) el.textContent = 'Chiedo a OpenRouter…';
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.WALLET_OWN_KEY_INFO }); } catch (_) { r = null; }
    if (!$('ownKeyHave').hidden) {
      el.textContent = r && r.ok ? (r.line || '') : ((r && r.message) || 'OpenRouter non ha risposto.');
    }
  }

  async function saveOwnKey(ev) {
    ev.preventDefault();
    const input = $('ownKeyInput');
    const msg = $('ownKeyMsg');
    const key = String(input.value || '').trim();
    msg.classList.remove('is-error', 'is-ok');
    if (!key) {
      msg.textContent = 'Incolla la chiave: comincia con sk-or-.';
      msg.classList.add('is-error');
      msg.hidden = false;
      input.focus();
      return;
    }
    $('ownKeySaveBtn').disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { apiKeys: { openrouter: key } } });
      input.value = '';
      msg.hidden = true;
      confirmation = null;
      await load();
    } catch (_) {
      msg.textContent = 'Non sono riuscito a salvarla: riprova.';
      msg.classList.add('is-error');
      msg.hidden = false;
    } finally {
      $('ownKeySaveBtn').disabled = false;
    }
  }

  async function removeOwnKey() {
    $('ownKeyRemoveYes').disabled = true;
    try {
      // Stringa vuota, non campo assente: è così che le Impostazioni tolgono
      // una chiave, e il salvataggio conserva le stringhe vuote.
      await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { apiKeys: { openrouter: '' } } });
      confirmation = null;
      await load();
    } finally {
      $('ownKeyRemoveYes').disabled = false;
      $('ownKeyConfirm').hidden = true;
      $('ownKeyRemoveBtn').hidden = false;
    }
  }
  function renderWalletState(w) {
    const box = $('wallet');
    const reissue = $('reissueBtn');
    const resetBtn = $('resetIdentityBtn');
    const resetConfirm = $('resetIdentityConfirm');
    // Un ridisegno che arriva mentre la domanda è aperta non la richiude sotto il dito.
    const domandaAperta = !resetConfirm.hidden;
    reissue.hidden = true;
    resetBtn.hidden = true;
    resetConfirm.hidden = true;
    const server = w && w.ok ? w.server : null;
    const has = Boolean(server && server.hasWallet);
    // Quello del server vince: è il nome con cui la persona compare all'owner.
    renderPseudonym(has ? String(server.pseudonym || w.pseudonym || '') : '');
    if (!w || !w.ok) { box.hidden = true; return; }
    ultimoStato = w;
    box.hidden = false;
    const note = $('walletNote');
    note.hidden = true;
    const registro = W.registroScartateTesto(w.usageLog && w.usageLog.discardedBy);
    $('usageLogNote').textContent = registro;
    $('usageLogNote').hidden = !registro;
    // Senza nessuna chiave (né personale, né propria, né di fabbrica) il
    // conteggio locale non compra niente: saldo, ricarica a mezzanotte e
    // invito al login sono promesse vuote, e si tolgono. Restano per chi ha
    // ancora una chiave di fabbrica o una propria.
    // Vale anche con la chiave personale ancora qui ma l'identità annullata
    // sul server: quella chiave non compra più niente. E con la personale e il
    // server non letto: il saldo è del server, e il conteggio locale al suo
    // posto sarebbe un numero che sparisce alla lettura dopo (#1138).
    const noKey = !has && !W.conteggioLocaleInVista({ keySource: w.keySource, identityLost: Boolean(w.identity && w.identity.lost) });
    $('hero').hidden = noKey;
    $('refillHint').hidden = noKey;
    if (noKey) $('offlineHint').hidden = true;
    if (!noKey) $('refillHint').textContent = rigaSottoIlSaldo(w);

    // La gestione (codici, regali, utenti) è una pagina a parte: qui solo il rimando.
    $('ownerLink').hidden = !w.isOwner;

    if (has) {
      // Il saldo vero è quello del server: sostituisce il conteggio locale, anche
      // quando il server non lo manda (meglio un trattino del vecchio numero).
      const b = server.balance || {};
      $('balance').textContent = b.credits != null ? formatCredits(b.credits) : '—';
      $('offlineHint').hidden = true;
      $('redeemForm').hidden = true;
      if (w.chiaveStaccata === 'altro_pseudonimo') {
        // Una chiave nuova è di questo portafoglio: da lì i consumi tornano a registrarsi.
        note.textContent = 'La chiave personale salvata qui non è quella del tuo portafoglio, e quello che consumi non si registra. Chiedine una nuova.';
        note.hidden = false;
        reissue.hidden = false;
      } else if (w.usingOwnKey) {
        note.textContent = 'Stai usando la tua chiave OpenRouter: i crediti di Filo servono solo se OpenRouter la rifiuta.';
        note.hidden = false;
      } else if (server.cached) {
        note.textContent = w.identity && w.identity.unreadable
          ? 'Ultimo saldo letto: questo computer non riesce più a leggere l\'identità di Filo salvata qui.'
          : 'Ultimo saldo letto: il server dei crediti non risponde adesso.';
        note.hidden = false;
      } else if (server.stale) {
        note.textContent = 'Saldo dell\'ultima lettura: il servizio dei modelli non risponde adesso.';
        note.hidden = false;
      } else if (!w.hasPersonalKey) {
        note.textContent = 'La chiave personale non è su questo computer: i crediti ci sono, ma questa copia di Filo non li può usare finché non ne chiedi una nuova.';
        note.hidden = false;
        reissue.hidden = false;
      }
      renderInvites(server);
      return;
    }

    // Nessun portafoglio: si entra con un invito.
    $('invitesSection').hidden = true;
    const form = $('redeemForm');
    form.hidden = false;
    if (w.identity && !w.identity.ok && (w.identity.lost || w.identity.unreadable)) {
      // Il portafoglio legato all'identità non si raggiunge: si dice, e
      // ricominciare è una scelta dell'utente, confermata.
      form.hidden = true;
      note.textContent = w.identity.lost
        ? 'L\'identità di questa installazione è stata annullata sul server, e con lei i crediti che aveva. Puoi ricominciare con un nuovo invito.'
        : 'Questo computer non riesce più a leggere l\'identità di Filo salvata qui, e con lei i crediti. Succede quando cambia la cifratura del sistema. Se torna com\'era, al prossimo avvio Filo riparte da solo. Altrimenti puoi ricominciare con un nuovo invito.';
      note.hidden = false;
      if (domandaAperta) resetConfirm.hidden = false;
      else resetBtn.hidden = false;
    } else if (w.identity && !w.identity.ok) {
      note.textContent = w.identity.offline
        ? 'Sei offline: per riscattare un invito serve la connessione.'
        : w.identity.unreachable
          ? 'Il servizio di accesso non risponde adesso. Riprova fra poco.'
          : `Non riesco a preparare l\'identità di questa installazione: ${w.identity.error || 'errore sconosciuto'}.`;
      note.hidden = false;
    } else if (w.error === 'not_reachable') {
      // Con la chiave propria il numero qui sopra non è un saldo (#1353).
      note.textContent = noKey || w.keySource === 'own'
        ? 'Il server dei crediti non risponde adesso: riprova fra poco.'
        : 'Il server dei crediti non risponde adesso: il saldo qui sopra è quello locale.';
      note.hidden = false;
    } else if (w.chiaveStaccata === 'senza_portafoglio') {
      note.textContent = 'La chiave personale salvata qui non è di nessun portafoglio sul server, e quello che consumi non si registra. Con un invito ne ricevi una tua.';
      note.hidden = false;
    } else if (server && server.invitesOpen === false) {
      note.textContent = 'Per ora i posti sono finiti: il tuo codice resta valido, riprova fra qualche giorno.';
      note.hidden = false;
    }
  }

  // ── Il proprio pseudonimo (#895) ────────────────────────────────────────────
  // Si copia col clic o dal tasto destro. Cambia solo con un portafoglio nuovo,
  // e chi copia prende quello a schermo adesso, anche a metà dell'animazione.
  let pseudonimoAttesa = null;
  function renderPseudonym(p) {
    const btn = $('pseudonym');
    $('pseudonymRow').hidden = !p;
    btn.dataset.pseudonym = p;
    if (!btn.classList.contains('is-copied')) btn.textContent = p;
    if (!p) chiudiMenu();
  }

  async function copiaPseudonimo() {
    const btn = $('pseudonym');
    const p = btn.dataset.pseudonym;
    if (!p) return;
    let ok = true;
    try { await navigator.clipboard.writeText(p); } catch (_) { ok = false; }
    // La larghezza resta quella dello pseudonimo: la riga non salta durante la conferma.
    if (!btn.classList.contains('is-copied')) btn.style.minWidth = `${btn.offsetWidth}px`;
    btn.textContent = ok ? 'Copiato' : 'Non copiato';
    btn.classList.add('is-copied');
    if (pseudonimoAttesa) clearTimeout(pseudonimoAttesa);
    pseudonimoAttesa = setTimeout(() => {
      pseudonimoAttesa = null;
      btn.classList.remove('is-copied');
      btn.style.minWidth = '';
      btn.textContent = btn.dataset.pseudonym || '';
    }, 1200);
  }

  // Menu proprio della pagina (pattern «menu contestuale proprio nelle pagine
  // filo://»): basta preventDefault, quello generale si fa da parte.
  let menuAperto = null;
  function chiudiMenu() {
    if (!menuAperto) return;
    menuAperto.remove();
    menuAperto = null;
    document.removeEventListener('mousedown', fuoriDalMenu, true);
    document.removeEventListener('keydown', tastoSulMenu, true);
    window.removeEventListener('wheel', fuoriDalMenu, true);
    window.removeEventListener('resize', chiudiMenu);
  }
  function fuoriDalMenu(ev) { if (menuAperto && !menuAperto.contains(ev.target)) chiudiMenu(); }
  function tastoSulMenu(ev) { if (ev.key === 'Escape') { ev.preventDefault(); chiudiMenu(); } }

  function apriMenuPseudonimo(x, y) {
    chiudiMenu();
    if (!$('pseudonym').dataset.pseudonym) return;
    const menu = document.createElement('div');
    menu.className = 'sn-select-pop sn-wallet-ctx sn-wallet-me-menu';
    menu.setAttribute('role', 'menu');
    const info = document.createElement('div');
    info.className = 'sn-wallet-ctx-info';
    info.textContent = 'Basta questo per ricevere un regalo di crediti. Email e nome restano tuoi.';
    const voce = document.createElement('div');
    voce.className = 'sn-select-option';
    voce.setAttribute('role', 'menuitem');
    voce.tabIndex = 0;
    voce.textContent = 'Copia lo pseudonimo';
    const fai = () => { chiudiMenu(); copiaPseudonimo().catch(() => {}); };
    voce.addEventListener('click', fai);
    voce.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      fai();
    });
    menu.append(info, voce);
    document.body.appendChild(menu);
    const w = menu.offsetWidth; const h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
    menuAperto = menu;
    voce.focus();
    document.addEventListener('keydown', tastoSulMenu, true);
    setTimeout(() => {
      if (menuAperto !== menu) return;
      document.addEventListener('mousedown', fuoriDalMenu, true);
      window.addEventListener('wheel', fuoriDalMenu, true);
      window.addEventListener('resize', chiudiMenu);
    }, 0);
  }

  // Un invito si dà come LINK (#651): chi lo riceve lo apre, scarica Filo e si
  // ritrova i crediti dentro senza ricopiare niente. Il codice resta accanto,
  // per chi lo detta a voce. Ogni link vale per più persone: quanti sono
  // entrati e chi, si legge qui.
  // L'etichetta da rimettere si legge UNA volta, quando il pulsante nasce, e
  // l'attesa in corso si annulla invece di accumularsi. Letta al momento del
  // clic, un secondo clic dentro l'animazione la leggeva «Copiato» e la
  // rimetteva: la riga restava «Copiato» per sempre e il link non si vedeva
  // più finché non si riapriva la pagina (terzo giro di verifica del #651).
  function copiaCon(btn, testo) {
    const etichetta = btn.textContent;
    let attesa = null;
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(testo); } catch (_) {}
      btn.textContent = 'Copiato';
      btn.classList.add('is-copied');
      if (attesa) clearTimeout(attesa);
      attesa = setTimeout(() => {
        attesa = null;
        btn.textContent = etichetta;
        btn.classList.remove('is-copied');
      }, 1200);
    });
  }

  // Dà inviti solo chi ha collegato Google (#1120): finché il server dice need_google, al posto dei codici c'è
  // l'accesso. Chi è già dentro con Google e resta scollegato ha l'account legato a un'altra identità di Filo.
  let accessoGoogle = false;
  let collegaInCorso = false;
  let esitoCollega = null;

  function renderCollega() {
    const btn = $('linkGoogleBtn');
    const note = $('invitesLockedNote');
    btn.hidden = false;
    btn.disabled = collegaInCorso;
    btn.textContent = collegaInCorso
      ? 'Continua nella scheda di Google…'
      : (accessoGoogle ? 'Riprova a collegare Google' : 'Collega Google per dare i tuoi inviti');
    const frase = esitoCollega || (accessoGoogle && !collegaInCorso
      ? 'Sei dentro con Google, ma il tuo account è già legato a un’altra copia di Filo, per esempio su un altro computer. Gli inviti si danno da quella.'
      : '');
    note.textContent = frase;
    note.hidden = !frase;
  }

  async function collegaGoogle() {
    if (collegaInCorso) return;
    collegaInCorso = true;
    esitoCollega = null;
    renderCollega();
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.AUTH_SIGNIN }); } catch (_) { r = null; }
    collegaInCorso = false;
    if (!r || !r.ok) esitoCollega = (r && r.error) || 'L’accesso a Google non è riuscito: riprova.';
    else accessoGoogle = true;
    renderCollega();
    // I codici li dà il server alla prima lettura dopo il collegamento.
    if (r && r.ok) await load();
  }

  // Un account Google dà un giro di codici solo: spostato qui da un'altra copia di Filo non ne apre un altro, e collegarsi
  // di nuovo non cambierebbe niente.
  function renderGiaUsato() {
    $('linkGoogleBtn').hidden = true;
    const note = $('invitesLockedNote');
    note.textContent = 'Il tuo account Google ha già dato i suoi inviti da un’altra copia di Filo: si danno da quella.';
    note.hidden = false;
  }

  function renderInvites(server) {
    const section = $('invitesSection');
    const list = $('invites');
    list.innerHTML = '';
    const motivo = server && server.invitesLocked;
    const locked = motivo === 'need_google' || motivo === 'google_used';
    $('invitesLocked').hidden = !locked;
    if (locked) {
      section.hidden = false;
      if (motivo === 'google_used') renderGiaUsato();
      else renderCollega();
      return;
    }
    esitoCollega = null;
    const views = ((server && server.invites) || []).map((inv) => W.inviteView(inv));
    section.hidden = views.length === 0;
    for (const inv of views) {
      const spento = inv.exhausted || inv.revoked;
      const li = document.createElement('li');
      li.className = 'sn-wallet-invite' + (spento ? ' is-used' : '');
      li.dataset.code = inv.code;

      const row = document.createElement('div');
      row.className = 'sn-wallet-invite-row';

      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'sn-wallet-invite-link';
      link.textContent = inv.link;
      link.disabled = spento || !inv.link;
      link.title = inv.revoked ? 'Annullato' : (inv.exhausted ? 'Nessun posto libero' : 'Copia il link');
      copiaCon(link, inv.link);

      const code = document.createElement('button');
      code.type = 'button';
      code.className = 'sn-wallet-code';
      code.textContent = inv.code;
      code.disabled = spento;
      code.title = inv.revoked ? 'Annullato' : (inv.exhausted ? 'Nessun posto libero' : 'Copia il codice');
      copiaCon(code, inv.code);

      const state = document.createElement('span');
      state.className = 'sn-wallet-invite-state';
      state.textContent = W.inviteStateLine(inv);

      row.append(link, code, state);
      li.appendChild(row);

      if (inv.uses.length) {
        const chi = document.createElement('ul');
        chi.className = 'sn-wallet-invite-uses';
        for (const u of inv.uses) {
          const item = document.createElement('li');
          const who = document.createElement('span');
          who.className = 'sn-wallet-invite-who';
          who.textContent = u.pseudonym || 'qualcuno';
          who.title = 'Come si chiama in Filo chi è entrato con questo invito';
          const when = document.createElement('span');
          when.className = 'sn-wallet-invite-when';
          when.textContent = formatDate(u.at);
          item.append(who, when);
          chi.appendChild(item);
        }
        li.appendChild(chi);
      }

      list.appendChild(li);
    }
  }

  async function reissueKey() {
    const btn = $('reissueBtn');
    const note = $('walletNote');
    confirmation = null;
    btn.disabled = true;
    note.textContent = 'Un attimo…';
    note.hidden = false;
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.WALLET_REISSUE }); } catch (_) { r = null; }
    btn.disabled = false;
    if (r && r.ok) {
      showConfirmation(r.message || 'Fatto.');
      render(await chrome.runtime.sendMessage({ type: MSG.GET_CREDITS }) || {}, r.state || null);
      return;
    }
    note.textContent = (r && r.message) || 'Non ci sono riuscito: riprova.';
    note.hidden = false;
  }

  async function resetIdentity() {
    const yes = $('resetIdentityYes');
    yes.disabled = true;
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.WALLET_RESET_IDENTITY, confermato: true }); } catch (_) { r = null; }
    yes.disabled = false;
    $('resetIdentityConfirm').hidden = true;
    if (r && r.state) {
      render(await chrome.runtime.sendMessage({ type: MSG.GET_CREDITS }) || {}, r.state);
      return;
    }
    $('resetIdentityBtn').hidden = false;
    const note = $('walletNote');
    note.textContent = 'Non ci sono riuscito: riprova.';
    note.hidden = false;
  }

  async function redeem(ev) {
    ev.preventDefault();
    const input = $('inviteCode');
    const btn = $('redeemBtn');
    const msg = $('redeemMsg');
    const code = String(input.value || '').trim();
    if (!code) { input.focus(); return; }
    confirmation = null;
    btn.disabled = true;
    input.disabled = true;
    msg.hidden = false;
    msg.classList.remove('is-error', 'is-ok');
    msg.textContent = 'Un attimo…';
    let r = null;
    try {
      r = await chrome.runtime.sendMessage({ type: MSG.WALLET_REDEEM, code });
    } catch (_) { r = null; }
    btn.disabled = false;
    input.disabled = false;
    if (r && r.ok) {
      msg.textContent = r.message || 'Fatto.';
      msg.classList.add('is-ok');
      // Il modulo dell'invito sparisce col portafoglio: la frase (coi crediti
      // d'ingresso) resta nella nota, fuori dal modulo.
      showConfirmation(r.message || 'Fatto.');
      // La vista owner sta in un'altra pagina e si rilegge da sé all'avviso di saldo cambiato.
      render(await chrome.runtime.sendMessage({ type: MSG.GET_CREDITS }) || {}, r.state || null);
      return;
    }
    msg.textContent = (r && r.message) || 'Non ci sono riuscito: riprova.';
    msg.classList.add('is-error');
    input.focus();
    input.select();
  }

  function renderUsage(byUsage) {
    // Solo i gruppi con consumo > 0, e NON arrotondati all'intero: il motore dà i crediti al
    // decimo, e un uso leggero sparirebbe dalla torta come «non hai consumato».
    const groups = Object.entries(byUsage)
      .map(([label, v]) => ({ label, credits: (v && v.credits) || 0, calls: (v && v.calls) || 0 }))
      .filter((g) => g.credits > 0)
      .sort((a, b) => b.credits - a.credits);

    const hasData = groups.length > 0;
    $('usageSection').hidden = !hasData;
    $('usageEmpty').hidden = hasData;
    if (!hasData) return;

    const total = groups.reduce((s, g) => s + g.credits, 0);
    drawChart(groups, total);
    drawLegend(groups);
  }

  // Un <path> per fetta (data-group) così un test può asserirle. Con un solo gruppo un
  // cerchio pieno: l'arco da 0 a 2π collasserebbe.
  function drawChart(groups, total) {
    const chart = $('chart');
    chart.innerHTML = '';
    const cx = 110, cy = 110, r = 100;
    const NS = 'http://www.w3.org/2000/svg';

    if (groups.length === 1) {
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', PALETTE[0]);
      circle.dataset.group = groups[0].label;
      chart.appendChild(circle);
      return;
    }

    let angle = -Math.PI / 2; // parti da ore 12
    groups.forEach((g, i) => {
      const frac = g.credits / total;
      const next = angle + frac * Math.PI * 2;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', slicePath(cx, cy, r, angle, next));
      path.setAttribute('fill', PALETTE[i % PALETTE.length]);
      path.dataset.group = g.label;
      chart.appendChild(path);
      angle = next;
    });
  }

  function slicePath(cx, cy, r, start, end) {
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    return `M${cx} ${cy} L${x1.toFixed(2)} ${y1.toFixed(2)} ` +
      `A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  }

  function drawLegend(groups) {
    const legend = $('legend');
    legend.innerHTML = '';
    groups.forEach((g, i) => {
      const li = document.createElement('li');
      li.dataset.group = g.label;

      const sw = document.createElement('span');
      sw.className = 'sn-credits-swatch';
      sw.style.background = PALETTE[i % PALETTE.length];

      const label = document.createElement('span');
      label.className = 'sn-credits-label';
      label.textContent = g.label;

      const value = document.createElement('span');
      value.className = 'sn-credits-value';
      value.textContent = formatCredits(g.credits);

      li.append(sw, label, value);
      legend.appendChild(li);
    });
  }

  const REWARD_LABELS = {
    feedback_sent: 'Feedback inviato',
    feedback_resolved: 'Feedback risolto',
    feedback_voted: 'Voto in Bacheca',
    board_reopen_refund: 'Rimborso «Ancora rotto?»',
    auto_feedback_bonus: 'Bonus segnalazione automatica',
  };

  // I movimenti (#652). Con un portafoglio i crediti li tiene il server, e i
  // movimenti veri sono i suoi: ingresso, quota del giorno, regali, premi per
  // le segnalazioni. Il conteggio locale delle ricompense resta solo per chi il
  // portafoglio non ce l'ha: mostrarlo accanto a un saldo che arriva da
  // un'altra parte era un elenco di numeri che con quel saldo non c'entravano.
  function renderMoves(rewards, w) {
    const list = $('moves');
    list.innerHTML = '';
    const server = w && w.server;
    const conPortafoglio = Boolean(server && server.hasWallet);
    // Il server manda i movimenti già dal più recente (al più gli ultimi 200):
    // rovesciarli li metterebbe dal più vecchio, cioè al contrario di come si
    // legge un elenco di movimenti. Il conteggio locale è un'altra lista, e
    // quella arriva in ordine di scrittura: lì il rovesciamento serve.
    const items = conPortafoglio
      ? (Array.isArray(server.grants) ? server.grants : [])
        .filter((g) => (g && g.credits) > 0)
        .map((g) => ({ credits: g.credits, testo: W.grantLabel(g.why), ts: g.at }))
      : rewards.slice().reverse()
        .filter((m) => (m && m.credits) > 0)
        .map((m) => ({ credits: m.credits, testo: REWARD_LABELS[m.kind] || 'Ricompensa', ts: m.ts }));
    $('movesSection').hidden = items.length === 0;
    if (!items.length) return;

    for (const m of items) {
      const li = document.createElement('li');

      const gain = document.createElement('span');
      gain.className = 'sn-credits-move-gain';
      gain.textContent = `+${formatInt(m.credits)}`;

      const label = document.createElement('span');
      label.className = 'sn-credits-move-label';
      label.textContent = m.testo;

      const date = document.createElement('span');
      date.className = 'sn-credits-move-date';
      date.textContent = formatDate(m.ts);

      li.append(gain, label, date);
      list.appendChild(li);
    }
  }

  function formatInt(n) {
    return new Intl.NumberFormat('it-IT', { useGrouping: true }).format(Math.round(Number(n) || 0));
  }
  // Crediti con al più un decimale, così un consumo sotto il credito resta
  // visibile. La regola è una sola con la chat (#816): SN_WALLET.formatCredits.
  function formatCredits(n) {
    return W.formatCredits(n);
  }
  function formatDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    } catch (_) { return ''; }
  }

  $('redeemForm').addEventListener('submit', (ev) => { redeem(ev).catch(() => {}); });
  $('ownKeyForm').addEventListener('submit', (ev) => { saveOwnKey(ev).catch(() => {}); });
  // Togliere la chiave chiede una conferma sul posto: il pulsante lascia il
  // posto alla domanda, e «Annulla» lo rimette.
  $('ownKeyRemoveBtn').addEventListener('click', () => {
    $('ownKeyRemoveBtn').hidden = true;
    $('ownKeyConfirm').hidden = false;
    $('ownKeyRemoveYes').focus();
  });
  $('ownKeyRemoveNo').addEventListener('click', () => {
    $('ownKeyConfirm').hidden = true;
    $('ownKeyRemoveBtn').hidden = false;
  });
  $('ownKeyRemoveYes').addEventListener('click', () => { removeOwnKey().catch(() => {}); });
  $('reissueBtn').addEventListener('click', () => { reissueKey().catch(() => {}); });
  $('pseudonym').addEventListener('click', () => { copiaPseudonimo().catch(() => {}); });
  $('pseudonymRow').addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    apriMenuPseudonimo(ev.clientX, ev.clientY);
  });
  // Ricominciare stacca il portafoglio di prima: chiede il sì sul posto, col fuoco su «Annulla».
  $('resetIdentityBtn').addEventListener('click', () => {
    $('resetIdentityBtn').hidden = true;
    $('resetIdentityConfirm').hidden = false;
    $('resetIdentityNo').focus();
  });
  $('resetIdentityNo').addEventListener('click', () => {
    $('resetIdentityConfirm').hidden = true;
    $('resetIdentityBtn').hidden = false;
  });
  // La coda di un doppio clic sul «Ricomincia» non è un sì.
  $('resetIdentityYes').addEventListener('click', (ev) => {
    if (ev.detail > 1) return;
    resetIdentity().catch(() => {});
  });

  $('linkGoogleBtn').addEventListener('click', () => { collegaGoogle().catch(() => {}); });

  // Aggiorna live quando il saldo cambia (consumo in background, refill, ricompensa) e quando cambia l'accesso a
  // Google da un'altra porta (menu dell'account): collegarsi è ciò che sblocca gli inviti.
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.AUTH_CHANGED) { load().catch(() => {}); return; }
      if (!msg || msg.type !== MSG.CREDITS_CHANGED) return;
      load().catch(() => {});
      // Una chiamata pagata con la chiave propria (o il suo rifiuto superato):
      // spesa e residuo sono cambiati, si richiedono senza svuotare la riga.
      if (msg.ownKeyUsed && !$('ownKeyHave').hidden) loadOwnKeyInfo({ quiet: true }).catch(() => {});
    });
  }

  load().catch((e) => { console.error('[credits] load fallito', e); });
})();

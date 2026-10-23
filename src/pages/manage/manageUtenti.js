// Gestione → Utenti → «Inviti e utenti», solo owner (#598; pagina a sé, credits/owner.html, fino a #1414): codici
// d'invito, regali di crediti per pseudonimo, utenti con saldo, consumo, registro e dettaglio d'uso, esiti di
// giornaliera e riconciliazione. Non è la pagina Crediti dell'utente né Routine → Crediti. Chi non è owner legge una riga.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;
  const W = window.SN_WALLET;

  function $(id) { return document.getElementById(id); }

  // Un numero scritto in una manopola parte anche dalle uscite che non toccano il campo: pausa, Ctrl+W, ricarica, scheda
  // chiusa (#666). Pattern «un testo scritto in una casella si salva da solo, o lo perdi».
  const caselle = window.SN_CASELLE.crea();

  // ── Owner: codici, regali, chi ha cosa ─────────────────────────────────────
  let overviewLoaded = false;
  // La prima lettura riempie i campi delle manopole; quelle dopo rispettano
  // quello che l'owner sta scrivendo.
  let primaLettura = true;
  function renderOwner(w) {
    const owner = Boolean(w && w.ok && w.isOwner);
    $('ownerSection').hidden = !owner;
    $('ownerDenied').hidden = owner;
    if (!owner || overviewLoaded) return;
    overviewLoaded = true;
    loadOverview().catch(() => {});
    loadInstallazioni().catch(() => {});
  }

  async function load() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    const w = await chrome.runtime.sendMessage({ type: MSG.WALLET_STATE }).catch(() => null);
    renderOwner(w);
  }

  // Le manopole prendono solo l'ultima lettura chiesta: una partita prima di un salvataggio riporterebbe il valore vecchio.
  let letturaOverview = 0;
  async function loadOverview() {
    const mia = ++letturaOverview;
    const r = await chrome.runtime.sendMessage({ type: MSG.WALLET_OWNER_OVERVIEW });
    const o = r && r.ok && r.overview;
    if (!o) {
      guastoVista(r && r.error);
      return;
    }
    mostraManopole(true);
    const cfg = o.config || {};
    const tot = o.totals || {};
    const uso = W.usoPersone(o.users || []);
    usoLetto = uso;
    renderNumeri(cfg, tot, o.ownerInvites || [], uso);
    renderConto(o);
    const quando = formatDate(cfg.eurUsdAt);
    $('ownerTotals').textContent = cfg.eurUsd
      ? `Un credito vale ${formatDecimale(cfg.eurPerCredit, 6)} €, e un euro ${formatDecimale(cfg.eurUsd, 4)} $`
        + `${quando ? ` (cambio del ${quando})` : ''}.`
      : 'Manca il cambio del giorno: finché non arriva, Filo non regala crediti a nessuno.';
    if (mia === letturaOverview) riempiManopole(cfg, tot);
    // I codici dell'owner li conserva il server: si rileggono a ogni apertura,
    // con quelli usati barrati, così chi ne genera cinque e chiude la pagina sa
    // ancora quali ha già dato.
    renderOwnerCodes(o.ownerInvites || []);

    const table = $('ownerUsers');
    const users = (o.users || []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    table.hidden = users.length === 0;
    ricevuti.clear();
    for (const u of users) ricevuti.set(u.pseudonym, ricevutiIn(u));
    aggiornaRighe(table.querySelector('tbody'), users);
    applicaFiltro();
    const runs = [];
    if (o.daily && o.daily.lastRunAt) runs.push(`giornaliera ${formatDateTime(o.daily.lastRunAt)}${summ(o.daily.summary)}`);
    if (o.reconcile && o.reconcile.lastRunAt) runs.push(`riconciliazione ${formatDateTime(o.reconcile.lastRunAt)}${summ(o.reconcile.summary)}`);
    $('ownerRuns').textContent = runs.length ? `Ultime: ${runs.join(' · ')}` : 'Giornaliera e riconciliazione non hanno ancora girato.';
  }

  // ── Le righe delle persone ─────────────────────────────────────────────────
  // La vista si rilegge a ogni movimento di crediti, anche di un'altra scheda: le righe si ritrovano per pseudonimo invece
  // di rifarsi (patterns/una-lista-che-si-rilegge-da-sola-aggiorna-le-righe-al-loro-posto.md, #1087.4).
  const righe = new Map();

  function celleDi(u) {
    const b = u.balance || {};
    const rec = u.reconcile;
    const fine = (usoLetto.ultimo || {})[u.pseudonym];
    return [
      u.pseudonym, formatCredits(b.credits), formatInt(b.creditsGranted), fmtUsd(b.usageUsd),
      !rec ? '—' : (rec.flagged ? registroSegnato(rec) : 'ok'),
      u.invitedBy === 'owner' ? 'te' : (u.invitedBy || '—'), formatDate(u.createdAt),
      fine ? giornoBreve(fine) : (u.usage && !u.usage.rows ? 'mai' : '—'),
    ];
  }

  function scriviRiga(r, u) {
    r.u = u;
    r.impronta = JSON.stringify(u);
    celleDi(u).forEach((c, i) => { r.celle[i].textContent = c; });
    r.celle[4].classList.toggle('is-flagged', Boolean(u.reconcile && u.reconcile.flagged));
    r.tr.classList.toggle('is-used', Boolean(u.disabled));
  }

  function nuovaRiga(u) {
    const tr = document.createElement('tr');
    tr.className = 'sn-wallet-user';
    tr.dataset.pseudonym = u.pseudonym;
    tr.title = 'Apri la scheda di questa persona';
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.setAttribute('aria-expanded', 'false');
    const celle = celleDi(u).map(() => tr.appendChild(document.createElement('td')));
    celle[0].className = 'sn-wallet-pseudonym';
    celle[0].title = 'Copia';
    celle.push(tr.appendChild(document.createElement('td')));
    celle[CELLA_INVITATI].className = 'sn-wallet-invitati';

    // La scheda della persona sta in una riga sotto, che si apre al clic sulla riga. Il contenuto è una chiamata a parte
    // (movimenti, inviti, ultime chiamate), chiesta alla prima apertura: fino ad allora c'è quello che la vista sa già.
    const detail = document.createElement('tr');
    detail.className = 'sn-wallet-user-detail';
    detail.dataset.pseudonym = u.pseudonym;
    detail.hidden = true;
    const td = document.createElement('td');
    td.colSpan = celle.length;
    td.appendChild(usageDetail(u.usage));
    detail.appendChild(td);

    const r = { u, impronta: '', tr, celle, detail, td, scheda: null, rileggi: false };
    r.apriChiudi = () => {
      detail.hidden = !detail.hidden;
      tr.classList.toggle('is-open', !detail.hidden);
      tr.setAttribute('aria-expanded', detail.hidden ? 'false' : 'true');
      if (!detail.hidden) caricaScheda(r).catch(() => {});
    };
    celle[0].addEventListener('click', (ev) => {
      ev.stopPropagation();
      try { navigator.clipboard.writeText(r.u.pseudonym); } catch (_) {}
      $('ownerGrantPseudonym').value = r.u.pseudonym;
    });
    tr.addEventListener('click', r.apriChiudi);
    // Il tasto destro su una persona: quello che si vorrebbe fare proprio a lei (il menu generale della pagina di questa
    // riga non sa niente). Vale anche dal tasto menu della tastiera, che manda lo stesso evento sulla riga col fuoco.
    tr.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      apriMenuPersona(r, ev.clientX, ev.clientY);
    });
    tr.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      r.apriChiudi();
    });
    scriviRiga(r, u);
    return r;
  }

  // I numeri di una persona sono cambiati: la sua scheda si richiede (aperta subito, chiusa alla prossima apertura), e
  // quella vecchia resta sotto gli occhi finché la nuova non arriva.
  function cambiaRiga(r, u) {
    scriviRiga(r, u);
    if (r.scheda === 'chiesta') { r.rileggi = true; return; }
    r.scheda = null;
    if (!r.td.querySelector('.sn-wallet-scheda')) r.td.replaceChildren(usageDetail(u.usage));
    if (!r.detail.hidden) caricaScheda(r).catch(() => {});
  }

  // ── Chi ha fatto entrare chi (#1519) ───────────────────────────────────────
  // Sotto chi dà inviti stanno le persone entrate coi suoi codici, e la sua colonna dice quante e in quanto tempo:
  // un tester che ne fa entrare tre in un'ora si vede a colpo d'occhio. Il numero apre le persone contate.
  const CELLA_INVITATI = 8;
  const LIVELLI_VISTI = 6;
  const invitatiLetti = new Map();

  function scriviAlbero(r, nodo) {
    r.tr.classList.toggle('is-invitato', nodo.livello > 0);
    if (nodo.livello > 0) r.tr.style.setProperty('--livello', String(Math.min(nodo.livello, LIVELLI_VISTI)));
    else r.tr.style.removeProperty('--livello');
    r.invitati = nodo.invitati;
    const cella = r.celle[CELLA_INVITATI];
    const inv = nodo.invitati;
    if (!inv) { cella.replaceChildren(); r.bottoneInvitati = null; return; }
    // Il pulsante resta lo stesso nodo fra una rilettura e l'altra: si riscrive solo il testo.
    let b = r.bottoneInvitati;
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'sn-wallet-invitati-btn';
      b.addEventListener('click', (ev) => { ev.stopPropagation(); scegliInvitati(r.u.pseudonym); });
      b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') ev.stopPropagation(); });
      b.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        apriMenu(vociInvitati(r), ev.clientX, ev.clientY, r);
      });
      r.bottoneInvitati = b;
      cella.replaceChildren(b);
    }
    b.textContent = W.invitatiTesto(inv);
    const quando = inv.primo && inv.ultimo && inv.n > 1
      ? `, il primo ${formatDateTime(inv.primo)} e l’ultimo ${formatDateTime(inv.ultimo)}`
      : (inv.primo ? `, ${formatDateTime(inv.primo)}` : '');
    b.title = `${inv.n === 1 ? 'Una persona è entrata' : `${formatInt(inv.n)} persone sono entrate`} coi suoi codici${quando}. Clic per vedere solo ${inv.n === 1 ? 'lei' : 'loro'}.`;
    b.setAttribute('aria-pressed', filtro && filtro.invitante === r.u.pseudonym ? 'true' : 'false');
  }

  function vociInvitati(r) {
    const inv = r.invitati;
    if (!inv) return [];
    const acceso = Boolean(filtro && filtro.invitante === r.u.pseudonym);
    return [
      [acceso ? 'Mostra tutte le persone' : (inv.n === 1 ? 'Mostra la persona che ha fatto entrare' : `Mostra le ${formatInt(inv.n)} persone che ha fatto entrare`),
        () => scegliInvitati(r.u.pseudonym)],
      ['Copia il numero', () => copia(String(inv.n))],
    ];
  }

  function scegliInvitati(pseudonym) {
    if (filtro && filtro.invitante === pseudonym) togliFiltro();
    else { filtro = { invitante: pseudonym }; applicaFiltro(); }
  }

  function aggiornaRighe(tbody, users) {
    const elenco = [];
    const viste = new Map();
    invitatiLetti.clear();
    for (const nodo of W.personeInAlbero(users)) {
      const u = nodo.u;
      const n = viste.get(u.pseudonym) || 0;
      viste.set(u.pseudonym, n + 1);
      if (!n && nodo.invitati) invitatiLetti.set(u.pseudonym, nodo.invitati.pseudonimi);
      elenco.push({ chiave: n ? `${u.pseudonym}#${n}` : String(u.pseudonym), u, nodo });
    }
    const chiavi = new Set(elenco.map((e) => e.chiave));
    // Prima via chi non c'è più, così le righe che restano non si spostano: una riga spostata perde il fuoco.
    for (const [chiave, r] of righe) {
      if (chiavi.has(chiave)) continue;
      if (menuDi === r) chiudiMenuPersona();
      r.tr.remove();
      r.detail.remove();
      righe.delete(chiave);
    }
    let posto = tbody.firstChild;
    for (const { chiave, u } of elenco) {
      let r = righe.get(chiave);
      if (!r) {
        r = nuovaRiga(u);
        righe.set(chiave, r);
      } else if (JSON.stringify(u) !== r.impronta) {
        cambiaRiga(r, u);
      }
      if (posto !== r.tr) tbody.insertBefore(r.tr, posto);
      if (r.tr.nextSibling !== r.detail) tbody.insertBefore(r.detail, r.tr.nextSibling);
      posto = r.detail.nextSibling;
    }
  }

  // ── Quando il server non risponde ──────────────────────────────────────────
  // Il messaggio grezzo (nome della chiamata, numero dell'errore, risposta del
  // server) va nella console, non addosso a chi legge: qui resta una frase e un
  // modo di riprovare, come per gli errori in chat. E le manopole senza i
  // numeri del server non si possono disegnare: il titolo se ne va con loro,
  // invece di restare lì ad annunciare il nulla.
  // Senza punto in fondo: chi la usa la infila dove serve («Non salvato: …»).
  function fraseGuasto(raw) {
    const t = String(raw || '');
    if (/not_admin/i.test(t)) return 'questo computer non ti riconosce come proprietario, rientra col tuo account';
    if (/sessione scaduta/i.test(t)) return 'la sessione è scaduta, rifai l’accesso';
    if (/PERMISSION_DENIED|non autorizzat|\b40[13]\b/i.test(t)) return 'il server non ha accettato la richiesta, rientra col tuo account e riprova';
    return 'il server dei crediti non risponde';
  }
  function conMaiuscola(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function mostraManopole(visibili) {
    $('ownerKnobsTitle').hidden = !visibili;
    $('ownerKnobs').hidden = !visibili;
  }

  // Il server ha risposto con un numero d'errore, o la richiesta non è mai partita: quello che si chiedeva di sicuro non
  // è successo. Il resto (connessione caduta a metà) lascia l'esito ignoto.
  function guastoCerto(raw) {
    return /not_admin|not_signed_in|sessione scaduta|callable \w+ \d{3}|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH/i.test(String(raw || ''));
  }

  function bottoneRiprova(azione, titolo) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sn-btn sn-btn-secondary';
    b.textContent = 'Riprova';
    b.title = titolo;
    b.addEventListener('click', () => {
      if (b.disabled) return;
      b.disabled = true;
      Promise.resolve().then(azione).catch(() => {});
    });
    return b;
  }

  function guastoVista(errore) {
    if (errore) console.warn('[credits/owner] vista non arrivata:', errore);
    const p = $('ownerTotals');
    p.textContent = `${conMaiuscola(fraseGuasto(errore))}. `;
    p.appendChild(bottoneRiprova(() => {
      p.textContent = 'Chiedo al server…';
      return loadOverview();
    }, 'Richiedi la vista al server'));
    // Senza i numeri del server non c'è niente da mettere nei campi.
    if (!campi.size) mostraManopole(false);
  }

  // ── I numeri che il server calcola ─────────────────────────────────────────
  // Sola lettura: qui si guarda quanto è già uscito, quanto resta da dare e
  // quanto è ancora in mano alle persone. Un riquadro che non si può toccare
  // accanto a uno che si può toccare deve VEDERSI diverso: il valore grande,
  // il nome sotto, nessun campo.
  function riquadro(valore, nome, spiega, { barra = null, nota = '', allarme = false } = {}) {
    const li = document.createElement('li');
    li.className = 'sn-wallet-numero' + (allarme ? ' is-allarme' : '');
    if (spiega) li.title = spiega;
    const v = document.createElement('span');
    v.className = 'sn-wallet-numero-valore';
    v.textContent = valore;
    const n = document.createElement('span');
    n.className = 'sn-wallet-numero-nome';
    n.textContent = nome;
    li.append(v, n);
    if (nota) {
      const s = document.createElement('span');
      s.className = 'sn-wallet-numero-nota';
      s.textContent = nota;
      li.appendChild(s);
    }
    if (barra != null && Number.isFinite(barra)) {
      const b = document.createElement('span');
      b.className = 'sn-wallet-numero-barra';
      const dentro = document.createElement('span');
      dentro.style.width = `${Math.max(0, Math.min(100, barra * 100))}%`;
      b.appendChild(dentro);
      li.appendChild(b);
    }
    return li;
  }

  function renderNumeri(cfg, tot, ownerInvites, uso) {
    const lista = $('ownerNumeri');
    lista.innerHTML = '';
    const nUsers = Number(tot.users) || 0;
    const tetto = Number(tot.maxGrantCredits);
    const dati = Number(tot.grantedCredits);
    const restano = Number.isFinite(tetto) && Number.isFinite(dati) ? Math.max(0, tetto - dati) : null;
    const vivi = tot.liveCredits;
    const inEuro = (crediti) => fmtEur(W.euroDaCrediti(crediti, cfg));

    lista.appendChild(riquadro(formatInt(nUsers), nUsers === 1 ? 'utente' : 'utenti',
      'Quante persone hanno un portafoglio su questo server.'));
    for (const giorni of [7, 30]) {
      const chi = giorni === 7 ? uso.attivi7 : uso.attivi30;
      lista.appendChild(riquadroAttivi(giorni, chi));
    }
    lista.appendChild(riquadro(
      Number.isFinite(dati) ? formatInt(dati) : '—',
      Number.isFinite(tetto) ? `crediti elargiti su ${formatInt(tetto)}` : 'crediti elargiti',
      'Quanto hai dato finora, contro il tetto che hai messo.',
      { barra: Number.isFinite(tetto) && tetto > 0 && Number.isFinite(dati) ? dati / tetto : null, nota: Number.isFinite(dati) ? inEuro(dati) : '' },
    ));
    lista.appendChild(riquadro(restano == null ? '—' : formatInt(restano), 'ancora elargibili',
      'Quanto puoi ancora dare prima di sbattere sul tetto. A zero si fermano ingressi, quote e premi.'));
    lista.appendChild(riquadro(vivi == null ? '—' : formatCredits(vivi), 'crediti vivi',
      'La somma dei saldi di tutti: quello che le persone hanno ancora da spendere.',
      { nota: vivi == null ? '' : inEuro(vivi) }));
    const spesiCrediti = uso.spesoUsd == null ? null : W.creditiDaUsd(uso.spesoUsd, cfg);
    const spesiNota = uso.spesoUsd == null ? '' : [fmtUsd(uso.spesoUsd), fmtEur(W.euroDaUsd(uso.spesoUsd, cfg))]
      .filter((t) => t !== '—').join(' · ');
    lista.appendChild(riquadro(spesiCrediti == null ? '—' : formatCredits(spesiCrediti), 'crediti spesi',
      `Quello che hanno speso tutti: la somma della colonna «Speso», al cambio del giorno.${uso.spesoIgnoti
        ? ` ${uso.spesoIgnoti === 1 ? 'Una persona non ha' : `${formatInt(uso.spesoIgnoti)} persone non hanno`} la spesa letta e non ${uso.spesoIgnoti === 1 ? 'è contata' : 'sono contate'}.`
        : ''}`,
      { nota: spesiNota }));

    // «In circolazione» sono i codici che questa pagina ha generato e che
    // hanno ancora un posto libero: sono gli unici che il server manda qui.
    const buoni = (ownerInvites || []).map((i) => W.inviteView(i)).filter((v) => !v.exhausted && !v.revoked);
    const posti = buoni.reduce((a, v) => a + Math.max(0, (Number(v.max) || 0) - (Number(v.used) || 0)), 0);
    lista.appendChild(riquadro(formatInt(buoni.length), buoni.length === 1 ? 'tuo invito da dare' : 'tuoi inviti da dare',
      `Codici usciti da qui con ancora un posto libero: ${formatInt(posti)} ${posti === 1 ? 'persona può entrare' : 'persone possono entrare'}.`));
  }

  // ── Le installazioni attive, dai contatori giornalieri (#969) ──────────────
  // Copie di Filo che hanno spedito i numeri di ieri e del mese in corso: pseudonimi distinti, e uno pseudonimo vale un
  // mese. Chi ha spento i contatori non c'è. Non letti: un trattino, mai uno zero; dietro il tasto destro si rilegge.
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre',
    'novembre', 'dicembre'];
  let letturaInstallazioni = 0;

  async function loadInstallazioni() {
    const mia = ++letturaInstallazioni;
    const r = await chrome.runtime.sendMessage({ type: MSG.CONTATORI_INSTALLAZIONI })
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    if (mia !== letturaInstallazioni) return;
    const i = r && r.ok ? r.installazioni : null;
    if (!i) console.warn('[credits/owner] contatori non letti:', r && r.error);
    const lista = $('ownerInstallazioni');
    lista.innerHTML = '';
    const ieri = i && i.ieri;
    const mese = i && i.mese;
    // Senza risposta il mese è quello di oggi, qui: è lo stesso che il main avrebbe chiesto.
    const nomeMese = (m) => MESI[m ? Number(String(m).slice(5, 7)) - 1 : new Date().getMonth()] || MESI[new Date().getMonth()];
    const quando = ieri ? giornoBreve(ieri.giorno) : 'ieri';
    lista.append(
      riquadroInstallazioni(ieri, (n) => `${n === 1 ? 'installazione attiva' : 'installazioni attive'} ieri`,
        `Le copie di Filo che hanno mandato i contatori di ieri (${quando}). Chi li ha spenti non c'è.`, r),
      riquadroInstallazioni(mese, (n) => `${n === 1 ? 'installazione attiva' : 'installazioni attive'} a ${nomeMese(mese && mese.mese)}`,
        `Le copie di Filo che hanno mandato i contatori di almeno un giorno di ${nomeMese(mese && mese.mese)}, fino a ieri: `
        + 'ognuna conta una volta. Chi li ha spenti non c\'è.', r),
    );
  }

  // Prima che le regole coi contatori siano pubblicate il server nega la lettura: lo si dice, non «rientra».
  function fraseContatori(raw) {
    const t = String(raw || '');
    if (/not_admin|sessione scaduta|not_signed_in/i.test(t)) return fraseGuasto(t);
    if (/PERMISSION_DENIED|contatori 40[13]/i.test(t)) {
      return 'il server li ha negati; se le regole coi contatori non sono ancora pubblicate, si pubblicano con npm run regole:pubblica';
    }
    return 'il server non risponde';
  }

  // La scheda Contatori dice la stessa cosa e chiede la stessa soglia; la sua frase per un guasto è questa.
  window.SN_MG_FRASE_CONTATORI = fraseContatori;

  // Sotto le cinque copie il main manda `sotto` e niente numero (#1462). Il riquadro si apre sulla scheda Contatori.
  function riquadroInstallazioni(v, nome, spiega, r) {
    const pochi = Boolean(v && v.sotto === true);
    const noto = pochi || Boolean(v && v.n != null && Number.isFinite(Number(v.n)));
    const n = noto && !pochi ? Number(v.n) : null;
    const valore = !noto ? '—' : (pochi ? 'meno di 5' : `${v.completo === false ? 'almeno ' : ''}${formatInt(n)}`);
    const title = !noto ? `I contatori non si sono letti: ${fraseContatori(r && r.error)}.`
      : (pochi ? `${spiega} Meno di cinque: il numero esatto non si mostra, per non leggere il comportamento di un tester.` : spiega);
    const li = riquadro(valore, nome(n), title, { nota: noto ? '' : 'non letti' });
    const apriContatori = () => { location.hash = 'contatori'; };
    if (noto) {
      li.classList.add('is-apribile');
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.addEventListener('click', apriContatori);
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); apriContatori(); }
      });
    }
    li.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      apriMenu([
        ...(n != null ? [['Copia il numero', () => copia(String(n))]] : []),
        ...(noto ? [['Apri i contatori', apriContatori]] : []),
        ['Rileggi', () => { loadInstallazioni().catch(() => {}); }],
      ], ev.clientX, ev.clientY);
    });
    return li;
  }

  // ── Chi ha usato Filo: il numero apre le persone che ha contato ────────────
  // Pattern «un numero si apre su cosa ha contato»: clic, Invio, Spazio e tasto destro lasciano nella tabella solo
  // quelle persone; a zero il riquadro non finge di essere cliccabile.
  let filtro = null;

  function riquadroAttivi(giorni, chi) {
    const n = chi.length;
    const li = riquadro(formatInt(n), `${n === 1 ? 'attivo' : 'attivi'} negli ultimi ${giorni} giorni`,
      `Le persone col portafoglio che negli ultimi ${giorni} giorni hanno almeno una riga nel registro d’uso.`);
    li.dataset.giorni = String(giorni);
    if (!n) return li;
    li.classList.add('is-apribile');
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-pressed', filtro && filtro.giorni === giorni ? 'true' : 'false');
    if (filtro && filtro.giorni === giorni) li.classList.add('is-attivo');
    li.title = `${li.title} Clic per vedere solo loro nella tabella.`;
    const scegli = () => (filtro && filtro.giorni === giorni ? togliFiltro() : filtraAttivi(giorni));
    li.addEventListener('click', scegli);
    li.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      scegli();
    });
    li.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const acceso = filtro && filtro.giorni === giorni;
      apriMenu([
        [acceso ? 'Mostra tutte le persone' : `Mostra le ${n === 1 ? 'persona contata' : `${formatInt(n)} persone contate`}`, scegli],
        ['Copia il numero', () => copia(String(n))],
      ], ev.clientX, ev.clientY);
    });
    return li;
  }

  let usoLetto = { attivi7: [], attivi30: [] };

  function filtraAttivi(giorni) {
    filtro = { giorni };
    applicaFiltro();
  }

  function togliFiltro() {
    const da = filtro && filtro.giorni;
    filtro = null;
    applicaFiltro();
    // Il fuoco torna sul numero da cui si era partiti, come alla chiusura di ogni elenco aperto da un numero.
    const torna = da && $('ownerNumeri').querySelector(`[data-giorni="${da}"]`);
    if (torna && typeof torna.focus === 'function') torna.focus();
  }

  function applicaFiltro() {
    const chi = filtro ? new Set(filtro.giorni === 7 ? usoLetto.attivi7 : usoLetto.attivi30) : null;
    // Se il conto nuovo è vuoto non c'è più niente da mostrare: il filtro si toglie da sé.
    if (chi && !chi.size) { filtro = null; return applicaFiltro(); }
    for (const tr of $('ownerUsers').querySelectorAll('tbody tr[data-pseudonym]')) {
      tr.classList.toggle('is-fuori', Boolean(chi && !chi.has(tr.dataset.pseudonym)));
    }
    for (const li of $('ownerNumeri').querySelectorAll('[data-giorni].is-apribile')) {
      const acceso = Boolean(filtro && String(filtro.giorni) === li.dataset.giorni);
      li.classList.toggle('is-attivo', acceso);
      li.setAttribute('aria-pressed', acceso ? 'true' : 'false');
    }
    const riga = $('ownerFiltro');
    riga.textContent = '';
    riga.hidden = !chi;
    if (!chi) return;
    riga.append(`Solo ${chi.size === 1 ? 'la persona che ha' : `le ${formatInt(chi.size)} persone che hanno`} usato Filo negli ultimi ${filtro.giorni} giorni. `);
    const tutte = document.createElement('button');
    tutte.type = 'button';
    tutte.className = 'sn-btn sn-btn-secondary';
    tutte.id = 'ownerFiltroTogli';
    tutte.textContent = 'Mostra tutte';
    tutte.addEventListener('click', togliFiltro);
    riga.appendChild(tutte);
  }

  // ── Il conto OpenRouter: se tutti spendessero tutto, regge? ────────────────
  function renderConto(o) {
    const cfg = o.config || {};
    const c = W.contoOwner(o);
    const lista = $('ownerConto');
    lista.innerHTML = '';
    $('ownerContoTitle').hidden = false;
    lista.hidden = false;
    const tettoAllarme = c.allarmi.some((a) => a.kind === 'tetto_oltre_caricato');
    const scoperto = c.allarmi.some((a) => a.kind === 'vivi_oltre_conto');
    const crediti = (n) => (n == null ? '' : `${formatInt(n)} crediti`);
    const euroUsd = (usd) => fmtEur(W.euroDaUsd(usd, cfg));
    const insieme = (...pezzi) => pezzi.filter((t) => t && t !== '—').join(' · ');

    lista.appendChild(riquadro(c.letto ? fmtSoldi(c.restaUsd, '$') : '—', 'restano sul conto',
      'Quello che il conto OpenRouter di Filo può ancora pagare: caricato meno speso. Le chiavi di tutti pescano da qui.',
      { nota: c.letto ? insieme(crediti(c.restaCrediti), euroUsd(c.restaUsd)) : '', allarme: scoperto }));
    lista.appendChild(riquadro(c.letto ? fmtSoldi(c.caricatoUsd, '$') : '—', 'caricati',
      'Tutto quello che è stato caricato sul conto OpenRouter. Il tetto dei crediti da regalare deve stare sotto.',
      { nota: c.letto ? insieme(crediti(c.caricatoCrediti), euroUsd(c.caricatoUsd)) : '', allarme: tettoAllarme }));
    lista.appendChild(riquadro(c.letto ? fmtSoldi(c.spesoUsd, '$') : '—', 'spesi dal conto',
      'Quanto OpenRouter ha già scalato dal conto, da tutte le chiavi.',
      { nota: c.letto ? euroUsd(c.spesoUsd) : '' }));
    const m = c.letto ? c.margine : null;
    lista.appendChild(riquadro(m == null ? '—' : formatInt(Math.abs(m)),
      m != null && m < 0 ? 'crediti vivi scoperti' : 'crediti di margine sui vivi',
      'Quello che resta sul conto meno i crediti che le persone hanno ancora da spendere. Sotto zero, se tutti spendessero tutto il conto si svuoterebbe.',
      { allarme: scoperto }));

    const nota = $('ownerContoNota');
    nota.hidden = false;
    if (!c.letto) {
      nota.textContent = c.motivo === 'assente'
        ? 'Il server non manda ancora il saldo del conto OpenRouter: finché non lo legge, qui non si può dire se il conto regge.'
        : 'Il saldo del conto OpenRouter non è arrivato: OpenRouter non ha risposto al server. Riapri la pagina per riprovare.';
    } else {
      const quando = formatDateTime(c.readAt);
      const regge = c.allarmi.length ? '' : (c.margine == null
        ? 'Manca il cambio del giorno: senza, i crediti vivi non si confrontano col conto.'
        : 'Se tutti spendessero tutto quello che hanno, il conto regge.');
      nota.textContent = [regge, quando ? `Letto ${quando}.` : ''].filter(Boolean).join(' ');
    }

    // Ogni riquadro del conto ha il suo tasto destro: il numero da copiare e la ricarica, che sta su OpenRouter.
    for (const li of lista.querySelectorAll('.sn-wallet-numero')) {
      li.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const valore = li.querySelector('.sn-wallet-numero-valore').textContent;
        apriMenu([
          ...(valore === '—' ? [] : [['Copia il numero', () => copia(valore)]]),
          ['Ricarica il conto su OpenRouter', ricaricaConto],
        ], ev.clientX, ev.clientY);
      });
    }

    const allarme = $('ownerAllarme');
    allarme.textContent = '';
    if (c.allarmi.length) {
      allarme.append(c.allarmi.map((a) => a.testo).join(' '));
      const vai = document.createElement('button');
      vai.type = 'button';
      vai.className = 'sn-btn sn-wallet-allarme-ricarica';
      vai.id = 'ownerRicarica';
      vai.textContent = 'Ricarica su OpenRouter';
      vai.title = 'Apre la pagina dei crediti del conto OpenRouter';
      vai.addEventListener('click', ricaricaConto);
      allarme.appendChild(vai);
    }
    allarme.hidden = c.allarmi.length === 0;
  }

  // La ricarica non si fa da Filo: si apre la pagina dei crediti di OpenRouter, dove l'owner paga.
  const RICARICA_URL = 'https://openrouter.ai/settings/credits';
  function ricaricaConto() {
    chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: RICARICA_URL }).catch(() => {});
  }

  // ── Le manopole ────────────────────────────────────────────────────────────
  // Campi identici: nome, limiti e spiegazione stanno nella tabella di
  // src/shared/wallet.js, il comportamento in src/shared/campoNumero.js. Qui
  // resta solo il cucito.
  const campi = new Map();

  function costruisciManopole() {
    if (campi.size) return;
    const CN = window.SN_CAMPO_NUMERO;
    const scatola = $('ownerKnobs');
    for (const k of W.OWNER_KNOBS) {
      const riga = document.createElement('div');
      riga.className = 'sn-manopola';
      riga.dataset.chiave = k.chiave;

      const label = document.createElement('label');
      label.setAttribute('for', `knob-${k.chiave}`);
      label.textContent = k.etichetta;
      label.title = k.aiuto;

      const controlli = document.createElement('div');
      controlli.className = 'sn-manopola-riga';

      const input = document.createElement('input');
      input.type = 'number';
      input.id = `knob-${k.chiave}`;
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.title = k.aiuto;

      const salva = document.createElement('button');
      salva.type = 'button';
      salva.className = 'sn-btn';
      salva.id = `knob-${k.chiave}-salva`;
      salva.textContent = 'Salva';

      const rimetti = document.createElement('button');
      rimetti.type = 'button';
      rimetti.className = 'sn-btn sn-btn-secondary';
      rimetti.id = `knob-${k.chiave}-rimetti`;
      rimetti.textContent = 'Rimetti com’era';

      const msg = document.createElement('p');
      msg.className = 'sn-wallet-msg sn-manopola-msg';
      msg.id = `knob-${k.chiave}-msg`;
      msg.setAttribute('role', 'status');
      msg.hidden = true;

      controlli.append(input, salva, rimetti);
      riga.append(label, controlli, msg);
      scatola.appendChild(riga);

      const regole = { min: k.min, max: k.max, intero: true, etichetta: k.etichetta };
      const campo = CN.collega({
        input, salvaBtn: salva, rimetti, msg, regole,
        salva: (valore) => salvaManopola(k.chiave, valore),
        // Cambiata una manopola, i numeri calcolati accanto non valgono più.
        onSalva: () => { loadOverview().catch(() => {}); },
      });
      campi.set(k.chiave, campo);

      // Un numero a metà vale altro e ha effetto per tutti: aspetta la pausa lunga, o l'uscita. Un numero storto non
      // parte, e lo dice all'uscita vera, non mentre si scrive.
      const nome = `knob-${k.chiave}`;
      caselle.registra(nome, (avvisi) => {
        if (campo.stato().pulito) return;
        if (!avvisi && !CN.controllaCampo(input, regole).ok) return;
        campo.salvaOra({ riprendiIlFuoco: false }).catch(() => {});
      });
      input.addEventListener('input', (e) => {
        if (campo.stato().pulito) caselle.spedita(nome);
        else caselle.cambiato(nome, e, { pausa: window.SN_CASELLE.PAUSA_LUNGA_MS });
      });
    }
  }

  async function salvaManopola(chiave, valore) {
    const r = await chrome.runtime
      .sendMessage({ type: MSG.WALLET_OWNER_KNOBS_SET, patch: { [chiave]: valore } })
      .catch(() => null);
    if (!(r && r.ok)) {
      // Il testo del server (numero dell'errore, risposta per intero) resta
      // nella console: davanti agli occhi va una frase.
      if (r && r.error) console.warn('[credits/owner] manopola non salvata:', chiave, r.error);
      return { ok: false, errore: fraseGuasto(r && r.error) };
    }
    const letto = r.knobs ? r.knobs[chiave] : null;
    return { ok: true, valore: letto == null ? valore : letto };
  }

  // Il tetto in crediti può non essere scritto: allora vale quello in dollari,
  // e il numero da mostrare è quello che il server ha calcolato (totals).
  function valoreManopola(chiave, cfg, tot) {
    if (chiave === 'maxGrantCredits') {
      const scritto = cfg.maxGrantCredits;
      return scritto == null ? tot.maxGrantCredits : scritto;
    }
    return cfg[chiave];
  }

  function riempiManopole(cfg, tot) {
    costruisciManopole();
    for (const k of W.OWNER_KNOBS) {
      const campo = campi.get(k.chiave);
      if (!campo) continue;
      // Non si riscrive un campo che qualcuno sta usando: la rilettura arriva anche mentre si digita. Uno salvato
      // segue il server (gli ingressi li scala lui, #854) e tiene il suo «rimetti com'era».
      const st = campo.stato();
      if (!primaLettura && !st.pulito) continue;
      const v = valoreManopola(k.chiave, cfg, tot);
      campo.mostra(v == null ? '' : v, { daCapo: primaLettura });
    }
    primaLettura = false;
  }

  // Perché la riconciliazione ha segnato la persona, coi dollari quando si sanno (#1520).
  function registroSegnato(rec) {
    return W.motiviScarto(rec).map((m) => (m.usd != null ? `${m.testo} ${fmtUsd(m.usd)}` : m.testo)).join(' · ');
  }

  // Il consumo della chiave per modello e fornitore; senza la lettura del router restano gli usi fuori politica che
  // la riconciliazione ha segnato. null se il server non manda né l'uno né gli altri.
  function consumoRouterDetail(router, rec) {
    const c = W.consumoRouter(router);
    const righe = c.letto ? c.righe : W.usiFuoriPolitica(rec);
    if (!righe.length) {
      if (!c.letto && !c.errore) return null;
      const p = document.createElement('p');
      p.className = 'sn-muted';
      p.textContent = c.errore ? `Il router non ha risposto: ${c.errore}` : 'Nessun consumo sulla sua chiave.';
      return p;
    }
    const ul = document.createElement('ul');
    ul.className = 'sn-wallet-scheda-elenco sn-wallet-router';
    for (const r of righe) {
      const li = document.createElement('li');
      li.classList.toggle('is-flagged', Boolean(r.violation));
      if (r.requests != null) li.title = `${formatInt(r.requests)} ${r.requests === 1 ? 'chiamata' : 'chiamate'}`;
      const a = document.createElement('span');
      a.textContent = [r.model, r.provider, r.fuori].filter(Boolean).join(' · ');
      const b = document.createElement('span');
      b.textContent = r.usd == null ? '—' : fmtUsd(r.usd);
      li.append(a, b);
      ul.appendChild(li);
    }
    return ul;
  }

  // Gli usi fuori politica letti: restano qui sotto, e la persona torna segnata solo per un uso nuovo (#1520). Il
  // server segna visto solo quello che questa scheda mostra: un uso arrivato dopo resta segnato.
  function bottoneVisto(pseudonym, rec) {
    const shown = (Array.isArray(rec && rec.offPolicy) ? rec.offPolicy : [])
      .filter((u) => u && typeof u.model === 'string' && u.model)
      .map((u) => ({ model: u.model, provider: typeof u.provider === 'string' ? u.provider : '', usd: Number(u.usd) || 0, requests: Number(u.requests) || 0 }));
    const riga = document.createElement('div');
    riga.className = 'sn-wallet-router-visto';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sn-btn sn-btn-secondary';
    b.textContent = 'Visto';
    b.title = 'Torna segnata solo per un uso nuovo';
    const esito = document.createElement('span');
    esito.className = 'sn-muted';
    b.addEventListener('click', async () => {
      b.disabled = true;
      esito.textContent = '';
      const r = await chrome.runtime.sendMessage({ type: MSG.WALLET_OWNER_OFF_POLICY_SEEN, pseudonym, shown }).catch(() => null);
      const res = r && r.ok && r.result;
      if (res && res.ok) {
        const ancora = W.motiviScarto(res.reconcile).some((m) => m.chiave === 'off_policy');
        esito.textContent = ancora ? 'Nel frattempo è arrivato un uso nuovo: resta segnata.' : 'Segnato come visto.';
        loadOverview().catch(() => {});
        return;
      }
      b.disabled = false;
      if (r && r.error) console.warn('[credits/owner] segno di visto non arrivato:', r.error);
      esito.textContent = res && res.reason === 'no_wallet'
        ? 'Questa persona non risulta più al server.'
        : `Non salvato: ${fraseGuasto(r && r.error)}.`;
    });
    riga.append(b, esito);
    return riga;
  }

  function usageDetail(usage) {
    const wrap = document.createElement('div');
    wrap.className = 'sn-wallet-usage-detail';
    if (!usage || !usage.rows) {
      wrap.textContent = 'Nessuna riga nel registro d\'uso.';
      return wrap;
    }
    const byAction = Object.entries(usage.byAction || {}).sort((a, b) => b[1] - a[1]);
    const byDay = Object.entries(usage.byDay || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
    const col = (title, rows, fmtKey) => {
      const box = document.createElement('div');
      const h = document.createElement('h4'); h.textContent = title; box.appendChild(h);
      const ul = document.createElement('ul');
      for (const [k, usd] of rows) {
        const li = document.createElement('li');
        const a = document.createElement('span'); a.textContent = fmtKey(k);
        const v = document.createElement('span'); v.textContent = fmtUsd(usd);
        li.append(a, v);
        ul.appendChild(li);
      }
      box.appendChild(ul);
      return box;
    };
    wrap.appendChild(col(`Per azione (${formatInt(usage.rows)} chiamate)`, byAction, (k) => k));
    wrap.appendChild(col('Per giorno', byDay, (k) => formatDate(k)));
    return wrap;
  }

  // ── Il tasto destro su una persona ─────────────────────────────────────────
  // Il menu proprio di una pagina filo:// si apre con preventDefault sulla
  // riga, e quello generale si fa da parte da solo (pattern «menu contestuale
  // proprio nelle pagine filo://»). Le voci sono le cose che si vogliono fare
  // a QUELLA persona: aprire la sua scheda, prendere il suo pseudonimo,
  // regalarle crediti.
  let menuAperto = null;
  let menuDi = null;

  function chiudiMenuPersona() {
    if (!menuAperto) return;
    menuAperto.remove();
    menuAperto = null;
    menuDi = null;
    document.removeEventListener('mousedown', fuoriDalMenu, true);
    document.removeEventListener('keydown', tastoSulMenu, true);
    window.removeEventListener('wheel', fuoriDalMenu, true);
    window.removeEventListener('resize', chiudiMenuPersona);
  }
  // Il menu si chiude a un clic o a una rotella fuori da lui. Non si chiude a
  // ogni evento di scorrimento: il menu sta in coordinate fisse e non scappa
  // via, e uno scorrimento lo fa anche il browser da solo quando porta in
  // vista quello su cui si sta per cliccare — chiudendo il menu proprio mentre
  // lo si usa.
  function fuoriDalMenu(ev) { if (menuAperto && !menuAperto.contains(ev.target)) chiudiMenuPersona(); }
  function tastoSulMenu(ev) { if (ev.key === 'Escape') { ev.preventDefault(); chiudiMenuPersona(); } }

  function copia(testo) { try { navigator.clipboard.writeText(testo); } catch (_) {} }

  function apriMenuPersona(r, x, y) {
    apriMenu([
      [r.detail.hidden ? 'Apri la scheda' : 'Chiudi la scheda', () => r.apriChiudi()],
      ['Copia lo pseudonimo', () => copia(r.u.pseudonym)],
      ['Regala crediti a questa persona', () => {
        $('ownerGrantPseudonym').value = r.u.pseudonym;
        const quanti = $('ownerGrantCredits');
        quanti.focus();
        quanti.scrollIntoView({ block: 'center', behavior: window.SN_THEME_TOKENS?.scrollBehavior(document) || 'smooth' });
      }],
    ], x, y, r);
  }

  // `di` è la riga a cui il menu appartiene: se la riga sparisce in una rilettura, il menu se ne va con lei.
  function apriMenu(voci, x, y, di = null) {
    chiudiMenuPersona();
    const menu = document.createElement('div');
    menu.className = 'sn-select-pop sn-wallet-ctxmenu sn-wallet-ctx';
    menu.setAttribute('role', 'menu');
    for (const [testo, azione] of voci) {
      const voce = document.createElement('div');
      voce.className = 'sn-select-option';
      voce.setAttribute('role', 'menuitem');
      voce.tabIndex = 0;
      voce.textContent = testo;
      const fai = () => { chiudiMenuPersona(); azione(); };
      voce.addEventListener('click', fai);
      voce.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        fai();
      });
      menu.appendChild(voce);
    }
    document.body.appendChild(menu);
    // Il menu rientra sempre nella finestra, anche se il clic è in fondo.
    const w = menu.offsetWidth; const h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
    menuAperto = menu;
    menuDi = di;
    document.addEventListener('keydown', tastoSulMenu, true);
    setTimeout(() => {
      if (menuAperto !== menu) return;
      document.addEventListener('mousedown', fuoriDalMenu, true);
      window.addEventListener('wheel', fuoriDalMenu, true);
      window.addEventListener('resize', chiudiMenuPersona);
    }, 0);
  }

  // ── La scheda di una persona ───────────────────────────────────────────────
  // Tutto quello che si può sapere di chi usa Filo con un portafoglio, senza
  // mai un nome: saldo, quanto ha ricevuto e quanto ha speso, dove sono andati
  // i crediti, i movimenti, chi l'ha invitata, i suoi inviti e le ultime
  // chiamate che ha fatto. Si chiede alla prima apertura della riga, e di nuovo
  // quando la vista dice che i suoi numeri sono cambiati (`cambiaRiga`).
  async function caricaScheda(r) {
    if (r.scheda) return;
    r.scheda = 'chiesta';
    const td = r.td;
    for (const n of td.querySelectorAll('.sn-wallet-scheda-esito')) n.remove();
    let attesa = null;
    if (!td.querySelector('.sn-wallet-scheda')) {
      attesa = document.createElement('p');
      attesa.className = 'sn-muted sn-wallet-scheda-attesa';
      attesa.textContent = 'Apro la scheda…';
      td.appendChild(attesa);
    }
    const res = await chrome.runtime
      .sendMessage({ type: MSG.WALLET_OWNER_USER_DETAIL, pseudonym: r.u.pseudonym })
      .catch(() => null);
    if (attesa) attesa.remove();
    const d = res && res.ok && res.detail;
    if (!d || d.found === false) {
      // Riprovabile: la prossima apertura la richiede.
      r.scheda = null;
      const err = document.createElement('p');
      err.className = 'sn-wallet-msg is-error sn-wallet-scheda-esito';
      if (res && res.error) console.warn('[credits/owner] scheda non arrivata:', res.error);
      err.textContent = d && d.found === false
        ? 'Questa persona non risulta più al server.'
        : `Scheda non arrivata: ${fraseGuasto(res && res.error)}. Richiudi e riapri per riprovare.`;
      td.appendChild(err);
    } else {
      r.scheda = 'arrivata';
      td.replaceChildren(schedaPersona(r.u, d));
    }
    // La vista è cambiata mentre questa era in viaggio: quella appena scritta è già vecchia.
    if (r.rileggi) {
      r.rileggi = false;
      r.scheda = null;
      if (!r.detail.hidden) await caricaScheda(r);
    }
  }

  function bloccoScheda(titolo, corpo) {
    const box = document.createElement('div');
    box.className = 'sn-wallet-scheda-blocco';
    const h = document.createElement('h4');
    h.textContent = titolo;
    box.append(h, corpo);
    return box;
  }

  function elencoSemplice(voci, vuoto) {
    if (!voci.length) {
      const p = document.createElement('p');
      p.className = 'sn-muted';
      p.textContent = vuoto;
      return p;
    }
    const ul = document.createElement('ul');
    ul.className = 'sn-wallet-scheda-elenco';
    for (const [sinistra, destra] of voci) {
      const li = document.createElement('li');
      const a = document.createElement('span'); a.textContent = sinistra;
      const b = document.createElement('span'); b.textContent = destra;
      li.append(a, b);
      ul.appendChild(li);
    }
    return ul;
  }

  function schedaPersona(u, d) {
    const wrap = document.createElement('div');
    wrap.className = 'sn-wallet-scheda';

    const b = d.balance || u.balance || {};
    const rec = d.reconcile || u.reconcile;
    const invitata = (d.invitedBy || u.invitedBy) === 'owner' ? 'te' : (d.invitedBy || u.invitedBy || 'nessuno');
    wrap.appendChild(bloccoScheda('In due parole', elencoSemplice([
      ['Saldo', `${formatCredits(b.credits)} crediti`],
      ['Ricevuti in tutto', `${formatInt(b.creditsGranted)} crediti`],
      ['Speso', fmtUsd(b.usageUsd)],
      ['Tetto della sua chiave', fmtUsd(b.limitUsd)],
      ['Riconciliazione', !rec ? 'mai fatta' : (rec.flagged ? registroSegnato(rec) : 'torna')],
      ['Invitato da', invitata],
      ['Con Filo dal', formatDate(d.createdAt || u.createdAt) || '—'],
    ], '')));

    wrap.appendChild(bloccoScheda('Dove sono andati i crediti', usageDetail(d.usage || u.usage)));
    // Accanto alle righe scritte dall'app, quello che il router ha fatto pagare alla sua chiave (#1520): un uso fuori
    // politica si legge qui anche quando le righe dicono un modello ammesso.
    const router = consumoRouterDetail(d.router, rec);
    if (router) {
      const blocco = bloccoScheda('Secondo il router', router);
      if (rec && Array.isArray(rec.reasons) && rec.reasons.includes('off_policy')) blocco.appendChild(bottoneVisto(u.pseudonym, rec));
      wrap.appendChild(blocco);
    }

    // I movimenti: da dove vengono i crediti che ha ricevuto. È qui che si
    // vedono i premi per le segnalazioni.
    //
    // L'ordine si decide qui, sulla data, invece di fidarsi di come arriva la
    // lista: le due funzioni del server non la mandano allo stesso modo (la
    // scheda della persona la dà com'è scritta nel documento, dal più vecchio;
    // lo stato del portafoglio la ordina lui dal più recente). Chi legge vuole
    // in cima l'ultima cosa successa, da qualunque parte arrivi.
    const movimenti = (d.grants || []).slice()
      .sort((a, b) => String(b && b.at || '').localeCompare(String(a && a.at || '')))
      .slice(0, 50)
      .map((g) => [`${W.grantLabel(g.why)} · ${formatDate(g.at)}`, `+${formatInt(g.credits)}`]);
    wrap.appendChild(bloccoScheda('Movimenti', elencoSemplice(movimenti, 'Nessun movimento.')));

    // I suoi inviti, con chi è entrato: stessa forma dei propri codici.
    const suoi = d.invites || [];
    const boxInviti = document.createElement('div');
    if (!suoi.length) {
      const p = document.createElement('p');
      p.className = 'sn-muted';
      p.textContent = 'Non ha inviti da dare.';
      boxInviti.appendChild(p);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'sn-wallet-invites';
      // Sempre attraverso la vista: il link si ricostruisce dal codice anche se
      // il server non lo manda, e i posti si contano allo stesso modo qui e
      // nella pagina Crediti.
      for (const inv of suoi) ul.appendChild(inviteItem(W.inviteView(inv), inv && inv.createdAt));
      boxInviti.appendChild(ul);
    }
    wrap.appendChild(bloccoScheda('I suoi inviti', boxInviti));

    wrap.appendChild(bloccoScheda('Ultime chiamate', tabellaChiamate(d.rows || [])));
    return wrap;
  }

  function tabellaChiamate(rows) {
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'sn-muted';
      p.textContent = 'Nessuna chiamata registrata.';
      return p;
    }
    const tabella = document.createElement('table');
    tabella.className = 'sn-wallet-table sn-wallet-chiamate';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    // I crediti accanto al costo: sono quelli che la persona si è vista
    // scalare, e sono numeri interi che si leggono. Il costo in dollari da
    // solo, per una chiamata sola, è un numero con quattro zeri davanti.
    for (const t of ['Quando', 'Per cosa', 'Modello', 'Chi ha servito', 'Crediti', 'Costo']) {
      const th = document.createElement('th');
      th.textContent = t;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    const tbody = document.createElement('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      const celle = [
        formatDateTime(r.at) || '—',
        r.action || '—',
        r.model || '—',
        r.servedBy || 'non detto',
        formatCredits(r.credits),
        fmtUsd(r.costUsd),
      ];
      celle.forEach((c) => {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      });
      tr.title = `${formatInt(r.promptTokens)} token in, ${formatInt(r.completionTokens)} fuori · ${formatCredits(r.credits)} crediti`;
      tbody.appendChild(tr);
    }
    tabella.append(thead, tbody);
    return tabella;
  }

  // Un invito si dà come LINK (#651), qui come nella pagina Crediti: è da
  // questa pagina che escono i codici per i primi invitati, e un invito da tre
  // posti con uno occupato è ancora da dare. Un invito «usato» e basta faceva
  // sparire gli altri due posti: barrato, pulsante spento, nessun link.
  // Riletti uguali, i codici restano quelli: un pulsante col fuoco o appena
  // copiato non si rifà sotto le dita (#1087.4, come le righe delle persone).
  let codiciScritti = null;
  function renderOwnerCodes(invites) {
    const impronta = JSON.stringify(invites);
    if (impronta === codiciScritti) return;
    codiciScritti = impronta;
    const list = $('ownerCodes');
    list.innerHTML = '';
    $('ownerCodesTitle').hidden = invites.length === 0;
    const views = invites.map((inv) => ({ view: W.inviteView(inv), createdAt: inv && inv.createdAt }));
    views.sort((a, b) => Number(a.view.exhausted || a.view.revoked) - Number(b.view.exhausted || b.view.revoked)
      || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    for (const v of views) list.appendChild(inviteItem(v.view, v.createdAt));
  }

  // Come nella pagina Crediti: l'etichetta si legge alla nascita del pulsante e
  // l'attesa in corso si annulla. Presa al momento del clic, due clic attaccati
  // lasciavano «Copiato» al posto del link per sempre (terzo giro di verifica
  // del #651).
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

  // `inv` è già una vista (`W.inviteView`), o il dato grezzo del server: i
  // codici appena generati arrivano come stringa e valgono tre posti come
  // tutti gli altri.
  function inviteItem(inv, createdAt, { stato = true } = {}) {
    const view = inv && inv.max ? inv : W.inviteView(inv);
    const spento = view.exhausted || view.revoked;
    const li = document.createElement('li');
    li.className = 'sn-wallet-invite' + (spento ? ' is-used' : '');
    li.dataset.code = view.code;

    const row = document.createElement('div');
    row.className = 'sn-wallet-invite-row';

    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'sn-wallet-invite-link';
    link.textContent = view.link;
    link.disabled = spento || !view.link;
    link.title = view.revoked ? 'Annullato' : (view.exhausted ? 'Nessun posto libero' : 'Copia il link');
    copiaCon(link, view.link);

    const code = document.createElement('button');
    code.type = 'button';
    code.className = 'sn-wallet-code';
    code.textContent = view.code;
    code.disabled = spento;
    code.title = view.revoked ? 'Annullato' : (view.exhausted ? 'Nessun posto libero' : 'Copia il codice');
    copiaCon(code, view.code);

    row.append(link, code);
    if (stato) {
      const state = document.createElement('span');
      state.className = 'sn-wallet-invite-state';
      state.textContent = W.inviteStateLine(view);
      row.appendChild(state);
    }
    li.appendChild(row);

    if (view.uses.length) {
      const chi = document.createElement('ul');
      chi.className = 'sn-wallet-invite-uses';
      for (const u of view.uses) {
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
    if (createdAt) li.dataset.createdAt = String(createdAt);
    return li;
  }

  function summ(s) {
    if (!s) return '';
    const parts = [];
    if (s.granted != null) parts.push(`${s.granted} quote`);
    if (s.refused) parts.push(`${s.refused} rifiutate`);
    if (s.flagged != null) parts.push(`${s.flagged} segnalati`);
    if (s.errors) parts.push(`${s.errors} errori`);
    return parts.length ? ` (${parts.join(', ')})` : '';
  }

  // La riga sotto i due moduli: un esito, e quando qualcosa non è andato un «Riprova» che rifà la stessa richiesta.
  function esitoModulo(testo, { errore = false, riprova = null, titolo = '' } = {}) {
    const msg = $('ownerMsg');
    msg.hidden = false;
    msg.classList.toggle('is-error', errore);
    msg.classList.toggle('is-ok', !errore);
    msg.textContent = testo;
    if (riprova) {
      msg.append(' ');
      msg.appendChild(bottoneRiprova(riprova, titolo));
    }
  }

  function ownerInvites(ev) {
    ev.preventDefault();
    // Il controllo lo fa Filo, con una frase sua: la bolla del browser (min/max
    // del campo) parlava al posto della pagina (verifica del ramo -b, secondo giro).
    const count = numeroIntero($('ownerInviteCount'));
    if (count == null || count < 1 || count > 200) {
      return rifiuta($('ownerMsg'), $('ownerInviteCount'), 'Quanti codici? Un numero da 1 a 200.');
    }
    return generaCodici(count);
  }

  async function generaCodici(count) {
    const btn = $('ownerInvitesBtn');
    btn.disabled = true;
    const r = await chrome.runtime.sendMessage({ type: MSG.WALLET_OWNER_INVITES, count }).catch(() => null);
    btn.disabled = false;
    if (!(r && r.ok)) {
      // La risposta del server (nome della chiamata, numero dell'errore) resta nella console.
      if (r && r.error) console.warn('[credits/owner] codici non generati:', r.error);
      esitoModulo(`Codici non generati: ${fraseGuasto(r && r.error)}.`, {
        errore: true,
        riprova: () => generaCodici(count),
        titolo: `Chiedi di nuovo ${count === 1 ? 'un codice' : `${formatInt(count)} codici`}`,
      });
      return;
    }
    esitoModulo(`${r.codes.length} codici nuovi. Li ritrovi qui sotto anche dopo.`);
    const list = $('ownerCodes');
    $('ownerCodesTitle').hidden = false;
    // Quanti posti abbia un invito lo sa il server, non chi l'ha chiesto: la
    // vista si rilegge prima di mostrarli, così accanto a ogni codice nuovo
    // c'è il conteggio vero. Se la rilettura non riesce, i codici compaiono
    // lo stesso col loro link, senza inventare un numero di posti.
    let riletta = true;
    try { await loadOverview(); } catch (_) { riletta = false; }
    const comparsi = r.codes.every((code) => list.querySelector(`li[data-code="${W.formatCode(code)}"]`));
    if (!riletta || !comparsi) {
      for (const code of r.codes.slice().reverse()) list.prepend(inviteItem({ code }, null, { stato: false }));
    }
  }

  function ownerGrant(ev) {
    ev.preventDefault();
    const msg = $('ownerMsg');
    const pseudonym = String($('ownerGrantPseudonym').value || '').trim();
    if (!pseudonym) return rifiuta(msg, $('ownerGrantPseudonym'), 'A chi? Serve lo pseudonimo (lo copi dalla tabella).');
    const credits = numeroIntero($('ownerGrantCredits'));
    if (credits == null || credits < 1) {
      return rifiuta(msg, $('ownerGrantCredits'), 'Quanti crediti? Un numero intero, almeno 1.');
    }
    return regala(pseudonym, credits, ricevuti.has(pseudonym) ? ricevuti.get(pseudonym) : null);
  }

  // Quanto ha ricevuto in tutto ogni persona, all'ultima lettura della vista: è il metro per capire se un regalo
  // dall'esito ignoto è arrivato, prima di rifarlo.
  const ricevuti = new Map();
  function ricevutiIn(u) {
    const n = Number(u && u.balance && u.balance.creditsGranted);
    return Number.isFinite(n) ? n : null;
  }

  async function regala(pseudonym, credits, prima) {
    $('ownerGrantBtn').disabled = true;
    const r = await chrome.runtime.sendMessage({ type: MSG.WALLET_OWNER_GRANT, pseudonym, credits, why: 'owner' }).catch(() => null);
    $('ownerGrantBtn').disabled = false;
    const res = r && r.ok && r.result;
    if (res && res.ok) {
      esitoModulo(`+${formatInt(res.credits)} crediti a ${pseudonym}.`);
      if ($('ownerGrantPseudonym').value.trim() === pseudonym) $('ownerGrantCredits').value = '';
      // La pagina Crediti, se aperta, si aggiorna da sola (il main avvisa
      // le pagine al regalo); qui si rilegge la vista.
      loadOverview().catch(() => {});
      return;
    }
    const ancora = { errore: true, titolo: `Regala di nuovo ${formatInt(credits)} crediti a ${pseudonym}` };
    if (res) {
      const why = {
        no_wallet: 'nessun utente con questo pseudonimo',
        global_cap: `oltre il tetto globale (tetti ${fmtUsd(res.totalLimitUsd)} + ${fmtUsd(res.deltaUsd)} > ${fmtUsd(res.maxGrantUsd)}): alza il tetto in configurazione o carica OpenRouter`,
        missing_exchange_rate: 'manca il cambio del giorno',
        nothing_to_grant: 'zero crediti non sono un regalo',
        provider_error: 'OpenRouter non ha accettato il tetto nuovo, niente è cambiato',
      }[res.reason];
      if (!why) console.warn('[credits/owner] regalo rifiutato:', res.reason);
      esitoModulo(`Regalo non fatto: ${why || 'il server dei crediti non l’ha accettato'}.`, {
        ...ancora,
        riprova: res.reason === 'provider_error' ? () => regala(pseudonym, credits, prima) : null,
      });
      return;
    }
    if (r && r.error) console.warn('[credits/owner] regalo non arrivato al server:', r.error);
    if (guastoCerto(r && r.error)) {
      esitoModulo(`Regalo non fatto: ${fraseGuasto(r && r.error)}.`, { ...ancora, riprova: () => regala(pseudonym, credits, prima) });
      return;
    }
    // La connessione è caduta dopo la partenza: il regalo può esserci. Due clic su «Riprova» non devono valere due regali.
    esitoModulo(`Non so se il regalo è arrivato: ${fraseGuasto(r && r.error)}.`, {
      ...ancora,
      titolo: 'Guarda se il regalo è arrivato, e se no rifallo',
      riprova: () => riprovaRegalo(pseudonym, credits, prima),
    });
  }

  async function riprovaRegalo(pseudonym, credits, prima) {
    const r = await chrome.runtime.sendMessage({ type: MSG.WALLET_OWNER_OVERVIEW }).catch(() => null);
    const o = r && r.ok && r.overview;
    if (!o) {
      if (r && r.error) console.warn('[credits/owner] vista non arrivata:', r.error);
      esitoModulo(`Non so ancora se il regalo è arrivato: ${fraseGuasto(r && r.error)}.`, {
        errore: true,
        titolo: 'Guarda se il regalo è arrivato, e se no rifallo',
        riprova: () => riprovaRegalo(pseudonym, credits, prima),
      });
      return;
    }
    const lei = (o.users || []).find((u) => u && u.pseudonym === pseudonym);
    const ora = lei ? ricevutiIn(lei) : null;
    if (prima != null && ora != null && ora - prima >= credits) {
      esitoModulo(`Il regalo era arrivato: +${formatInt(credits)} crediti a ${pseudonym}.`);
      loadOverview().catch(() => {});
      return;
    }
    await regala(pseudonym, credits, ora);
  }

  // Il numero intero scritto in un campo numerico, o null se non è un intero
  // (vuoto, testo che il browser non traduce in numero, decimali: «10,7» non
  // sono crediti). Niente arrotondamenti muti. Le migliaia col punto le legge
  // `leggi`, come nelle manopole: «10.000» non è 10.
  function numeroIntero(input) {
    if (!input || (input.validity && input.validity.badInput)) return null;
    const esito = window.SN_CAMPO_NUMERO.leggi(input.value, { intero: true });
    return esito.ok ? esito.valore : null;
  }
  function rifiuta(msg, input, testo) {
    msg.hidden = false;
    msg.classList.remove('is-ok');
    msg.classList.add('is-error');
    msg.textContent = testo;
    if (input) { input.focus(); if (typeof input.select === 'function') input.select(); }
  }

  // I dollari, con tante cifre quante ne servono perché un numero diverso da
  // zero non finisca scritto «0 $». Una chiamata vera costa qualche millesimo
  // di dollaro: arrotondata ai centesimi spariva, e la spesa di una persona si
  // leggeva tutta a zeri. Sopra il centesimo restano due decimali, come prima.
  function fmtUsd(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    if (v === 0) return '0 $';
    for (const dec of [2, 4, 6, 8]) {
      const s = new Intl.NumberFormat('it-IT', { useGrouping: true, maximumFractionDigits: dec }).format(v);
      if (Number(s.replace(/\./g, '').replace(',', '.')) !== 0) return `${s} $`;
    }
    return v > 0 ? 'meno di 0,00000001 $' : '—';
  }
  // I soldi del conto e gli euro, coi centesimi sempre: «30 $» accanto a «4,20 $» si leggeva come un'altra unità.
  function fmtSoldi(n, simbolo) {
    const v = Number(n);
    if (n == null || !Number.isFinite(v)) return '—';
    return `${new Intl.NumberFormat('it-IT', { useGrouping: true, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} ${simbolo}`;
  }
  function fmtEur(n) { return fmtSoldi(n, '€'); }
  // Un giorno del registro ('2026-09-17', UTC come lo scrive il server) letto come quel giorno ovunque si sia: preso
  // come mezzanotte UTC e scritto nell'ora locale, a ovest di Greenwich diventava il giorno prima.
  function giornoBreve(giorno) {
    const [a, m, g] = String(giorno).split('-').map(Number);
    try {
      return new Date(Date.UTC(a, m - 1, g)).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    } catch (_) { return String(giorno); }
  }
  function formatDateTime(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
  }

  function formatInt(n) {
    return new Intl.NumberFormat('it-IT', { useGrouping: true }).format(Math.round(Number(n) || 0));
  }
  // Al più un decimale: un consumo sotto il credito deve restare visibile, non sparire a zero.
  function formatCredits(n) {
    const v = Math.round((Number(n) || 0) * 10) / 10;
    return new Intl.NumberFormat('it-IT', { useGrouping: true, maximumFractionDigits: 1 }).format(v);
  }
  // Un numero con la virgola come si scrive in italiano, senza zeri finti in
  // coda (0,0007 resta 0,0007, 1,17 resta 1,17).
  function formatDecimale(n, decimali) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return new Intl.NumberFormat('it-IT', { useGrouping: true, maximumFractionDigits: decimali }).format(v);
  }
  function formatDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    } catch (_) { return ''; }
  }

  $('ownerInvitesForm').addEventListener('submit', (ev) => { Promise.resolve(ownerInvites(ev)).catch(() => {}); });
  $('ownerGrantForm').addEventListener('submit', (ev) => { Promise.resolve(ownerGrant(ev)).catch(() => {}); });
  window.SN_CAMPO_NUMERO.virgolaComePunto($('ownerInviteCount'));
  window.SN_CAMPO_NUMERO.virgolaComePunto($('ownerGrantCredits'));

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.CREDITS_CHANGED) loadOverview().catch(() => {});
    });
  }

  // Si legge quando la scheda si mostra, e di nuovo solo dopo una porta chiusa: l'accesso può essere arrivato nel frattempo.
  let letta = false;
  function aMostra() {
    if (letta && $('ownerDenied').hidden) return;
    letta = true;
    load().catch((e) => { letta = false; console.error('[credits/owner] load fallito', e); });
  }
  const mostrata = () => !!document.querySelector('.mg-tab[data-tab="utenti"].mg-tab--active');
  document.addEventListener('mg-scheda', (e) => { if (e.detail && e.detail.tab === 'utenti') aMostra(); });
  if (window.filo && window.filo.onBroadcast) {
    window.filo.onBroadcast((m) => { if (m && m.type === (MSG.AUTH_CHANGED || 'auth_changed') && mostrata()) aMostra(); });
  }
  if (mostrata()) aMostra();
})();

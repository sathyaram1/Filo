// Pagina «Inviti e utenti», solo owner (#598): codici d'invito da dare,
// regali di crediti per pseudonimo, tabella degli utenti con saldo, consumo,
// registro e dettaglio d'uso, esiti di giornaliera e riconciliazione. È una
// pagina a parte dalla pagina Crediti dell'utente: due lavori diversi, due
// pagine. Chi non è owner vede solo una riga che lo dice.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;
  const W = window.SN_WALLET;

  function $(id) { return document.getElementById(id); }

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
  }

  async function load() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    const w = await chrome.runtime.sendMessage({ type: MSG.WALLET_STATE }).catch(() => null);
    renderOwner(w);
  }

  async function loadOverview() {
    const r = await chrome.runtime.sendMessage({ type: MSG.WALLET_OWNER_OVERVIEW });
    const o = r && r.ok && r.overview;
    if (!o) {
      guastoVista(r && r.error);
      return;
    }
    mostraManopole(true);
    const cfg = o.config || {};
    const tot = o.totals || {};
    renderNumeri(cfg, tot, o.ownerInvites || []);
    const quando = formatDate(cfg.eurUsdAt);
    $('ownerTotals').textContent = cfg.eurUsd
      ? `Un credito vale ${formatDecimale(cfg.eurPerCredit, 6)} €, e un euro ${formatDecimale(cfg.eurUsd, 4)} $`
        + `${quando ? ` (cambio del ${quando})` : ''}.`
      : 'Manca il cambio del giorno: finché non arriva, Filo non regala crediti a nessuno.';
    riempiManopole(cfg, tot);
    // I codici dell'owner li conserva il server: si rileggono a ogni apertura,
    // con quelli usati barrati, così chi ne genera cinque e chiude la pagina sa
    // ancora quali ha già dato.
    renderOwnerCodes(o.ownerInvites || []);

    const table = $('ownerUsers');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    // Le righe si rifanno da zero: le schede già chieste vanno richieste.
    schedeChieste.clear();
    const users = (o.users || []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    table.hidden = users.length === 0;
    for (const u of users) {
      const tr = document.createElement('tr');
      const b = u.balance || {};
      const rec = u.reconcile;
      const regTxt = !rec ? '—' : (rec.flagged ? `scarto ${fmtUsd(rec.driftUsd)}` : 'ok');
      const cells = [
        u.pseudonym, formatCredits(b.credits), formatInt(b.creditsGranted), fmtUsd(b.usageUsd), regTxt,
        u.invitedBy === 'owner' ? 'te' : (u.invitedBy || '—'), formatDate(u.createdAt),
      ];
      cells.forEach((c, i) => {
        const td = document.createElement('td');
        td.textContent = c;
        if (i === 0) { td.className = 'sn-wallet-pseudonym'; td.title = 'Copia'; td.addEventListener('click', (ev) => { ev.stopPropagation(); try { navigator.clipboard.writeText(u.pseudonym); } catch (_) {} $('ownerGrantPseudonym').value = u.pseudonym; }); }
        if (i === 4 && rec && rec.flagged) td.className = 'is-flagged';
        tr.appendChild(td);
      });
      if (u.disabled) tr.className = 'is-used';
      tr.classList.add('sn-wallet-user');
      tr.title = 'Apri la scheda di questa persona';
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-expanded', 'false');
      tbody.appendChild(tr);

      // La scheda della persona sta in una riga sotto, che si apre al clic
      // sulla riga. Il contenuto è una chiamata a parte (movimenti, inviti,
      // ultime chiamate): si chiede alla prima apertura, non prima.
      const detail = document.createElement('tr');
      detail.className = 'sn-wallet-user-detail';
      detail.hidden = true;
      const td = document.createElement('td');
      td.colSpan = cells.length;
      // Finché la scheda non arriva si mostra quello che la vista generale sa
      // già (per azione, per giorno): qualcosa da leggere c'è subito.
      td.appendChild(usageDetail(u.usage));
      detail.appendChild(td);
      tbody.appendChild(detail);

      const apriChiudi = () => {
        detail.hidden = !detail.hidden;
        tr.classList.toggle('is-open', !detail.hidden);
        tr.setAttribute('aria-expanded', detail.hidden ? 'false' : 'true');
        if (!detail.hidden) caricaScheda(u, td).catch(() => {});
      };
      tr.addEventListener('click', apriChiudi);
      // Stessa strada da tastiera: una riga che si apre solo col mouse è una
      // riga che per metà delle persone non si apre.
      tr.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        apriChiudi();
      });
    }
    const runs = [];
    if (o.daily && o.daily.lastRunAt) runs.push(`giornaliera ${formatDateTime(o.daily.lastRunAt)}${summ(o.daily.summary)}`);
    if (o.reconcile && o.reconcile.lastRunAt) runs.push(`riconciliazione ${formatDateTime(o.reconcile.lastRunAt)}${summ(o.reconcile.summary)}`);
    $('ownerRuns').textContent = runs.length ? `Ultime: ${runs.join(' · ')}` : 'Giornaliera e riconciliazione non hanno ancora girato.';
  }

  // ── Quando il server non risponde ──────────────────────────────────────────
  // Il messaggio grezzo (nome della chiamata, numero dell'errore, risposta del
  // server) va nella console, non addosso a chi legge: qui resta una frase e un
  // modo di riprovare, come per gli errori in chat. E le manopole senza i
  // numeri del server non si possono disegnare: il titolo se ne va con loro,
  // invece di restare lì ad annunciare il nulla.
  function fraseGuasto(raw) {
    const t = String(raw || '');
    if (/not_admin/i.test(t)) return 'Questo computer non ti riconosce come proprietario: rientra col tuo account.';
    if (/sessione scaduta/i.test(t)) return 'La sessione è scaduta: rifai l’accesso.';
    if (/PERMISSION_DENIED|\bnon autorizzat|\b40[13]\b/i.test(t)) return 'Il server non ha accettato la richiesta: rientra col tuo account e riprova.';
    return 'Il server dei crediti non risponde.';
  }

  function mostraManopole(visibili) {
    $('ownerKnobsTitle').hidden = !visibili;
    $('ownerKnobs').hidden = !visibili;
  }

  function guastoVista(errore) {
    if (errore) console.warn('[credits/owner] vista non arrivata:', errore);
    const p = $('ownerTotals');
    p.textContent = `${fraseGuasto(errore)} `;
    const riprova = document.createElement('button');
    riprova.type = 'button';
    riprova.className = 'sn-btn sn-btn-secondary';
    riprova.textContent = 'Riprova';
    riprova.title = 'Richiedi la vista al server';
    riprova.addEventListener('click', () => {
      riprova.disabled = true;
      p.textContent = 'Chiedo al server…';
      loadOverview().catch(() => {});
    });
    p.appendChild(riprova);
    // Senza i numeri del server non c'è niente da mettere nei campi.
    if (!campi.size) mostraManopole(false);
  }

  // ── I numeri che il server calcola ─────────────────────────────────────────
  // Sola lettura: qui si guarda quanto è già uscito, quanto resta da dare e
  // quanto è ancora in mano alle persone. Un riquadro che non si può toccare
  // accanto a uno che si può toccare deve VEDERSI diverso: il valore grande,
  // il nome sotto, nessun campo.
  function riquadro(valore, nome, spiega, { barra = null } = {}) {
    const li = document.createElement('li');
    li.className = 'sn-wallet-numero';
    if (spiega) li.title = spiega;
    const v = document.createElement('span');
    v.className = 'sn-wallet-numero-valore';
    v.textContent = valore;
    const n = document.createElement('span');
    n.className = 'sn-wallet-numero-nome';
    n.textContent = nome;
    li.append(v, n);
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

  function renderNumeri(cfg, tot, ownerInvites) {
    const lista = $('ownerNumeri');
    lista.innerHTML = '';
    const nUsers = Number(tot.users) || 0;
    const tetto = Number(tot.maxGrantCredits);
    const dati = Number(tot.grantedCredits);
    const restano = Number.isFinite(tetto) && Number.isFinite(dati) ? Math.max(0, tetto - dati) : null;
    const vivi = tot.liveCredits;

    lista.appendChild(riquadro(formatInt(nUsers), nUsers === 1 ? 'utente' : 'utenti',
      'Quante persone hanno un portafoglio su questo server.'));
    lista.appendChild(riquadro(
      Number.isFinite(dati) ? formatInt(dati) : '—',
      Number.isFinite(tetto) ? `crediti elargiti su ${formatInt(tetto)}` : 'crediti elargiti',
      'Quanto hai dato finora, contro il tetto che hai messo.',
      { barra: Number.isFinite(tetto) && tetto > 0 && Number.isFinite(dati) ? dati / tetto : null },
    ));
    lista.appendChild(riquadro(restano == null ? '—' : formatInt(restano), 'ancora elargibili',
      'Quanto puoi ancora dare prima di sbattere sul tetto. A zero si fermano ingressi, quote e premi.'));
    lista.appendChild(riquadro(vivi == null ? '—' : formatCredits(vivi), 'crediti vivi',
      'La somma dei saldi di tutti: quello che le persone hanno ancora da spendere.'));

    // «In circolazione» sono i codici che questa pagina ha generato e che
    // hanno ancora un posto libero: sono gli unici che il server manda qui.
    const buoni = (ownerInvites || []).map((i) => W.inviteView(i)).filter((v) => !v.exhausted && !v.revoked);
    const posti = buoni.reduce((a, v) => a + Math.max(0, (Number(v.max) || 0) - (Number(v.used) || 0)), 0);
    lista.appendChild(riquadro(formatInt(buoni.length), buoni.length === 1 ? 'tuo invito da dare' : 'tuoi inviti da dare',
      `Codici usciti da qui con ancora un posto libero: ${formatInt(posti)} ${posti === 1 ? 'persona può entrare' : 'persone possono entrare'}.`));
    lista.appendChild(riquadro(formatInt(cfg.invitesRemaining || 0), 'riscatti rimasti',
      'Quante volte si può ancora entrare con un invito, in tutto.'));
  }

  // ── Le manopole ────────────────────────────────────────────────────────────
  // Sette campi identici: nome, limiti e spiegazione stanno nella tabella di
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

      campi.set(k.chiave, CN.collega({
        input, salvaBtn: salva, rimetti, msg,
        regole: { min: k.min, max: k.max, intero: true, etichetta: k.etichetta },
        salva: (valore) => salvaManopola(k.chiave, valore),
        // Cambiata una manopola, i numeri calcolati accanto non valgono più.
        onSalva: () => { loadOverview().catch(() => {}); },
      }));
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
      // Non si riscrive un campo che qualcuno sta usando, né uno che ha ancora
      // un salvataggio da poter rimettere com'era: la rilettura arriva anche
      // mentre si digita (il server avvisa a ogni cambio di crediti).
      const st = campo.stato();
      if (!primaLettura && (!st.pulito || st.disfabile)) continue;
      const v = valoreManopola(k.chiave, cfg, tot);
      campo.mostra(v == null ? '' : v, { daCapo: true });
    }
    primaLettura = false;
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

  // ── La scheda di una persona ───────────────────────────────────────────────
  // Tutto quello che si può sapere di chi usa Filo con un portafoglio, senza
  // mai un nome: saldo, quanto ha ricevuto e quanto ha speso, dove sono andati
  // i crediti, i movimenti, chi l'ha invitata, i suoi inviti e le ultime
  // chiamate che ha fatto. Si chiede alla prima apertura della riga.
  const schedeChieste = new Set();

  async function caricaScheda(u, td) {
    if (schedeChieste.has(u.pseudonym)) return;
    schedeChieste.add(u.pseudonym);
    const attesa = document.createElement('p');
    attesa.className = 'sn-muted sn-wallet-scheda-attesa';
    attesa.textContent = 'Apro la scheda…';
    td.appendChild(attesa);
    const r = await chrome.runtime
      .sendMessage({ type: MSG.WALLET_OWNER_USER_DETAIL, pseudonym: u.pseudonym })
      .catch(() => null);
    attesa.remove();
    const d = r && r.ok && r.detail;
    if (!d || d.found === false) {
      // Riprovabile: la prossima apertura la richiede.
      schedeChieste.delete(u.pseudonym);
      const err = document.createElement('p');
      err.className = 'sn-wallet-msg is-error';
      err.textContent = d && d.found === false
        ? 'Questa persona non risulta più al server.'
        : `Scheda non arrivata${r && r.error ? ` (${r.error})` : ''}. Richiudi e riapri per riprovare.`;
      td.appendChild(err);
      return;
    }
    td.innerHTML = '';
    td.appendChild(schedaPersona(u, d));
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
      ['Riconciliazione', !rec ? 'mai fatta' : (rec.flagged ? `scarto ${fmtUsd(rec.driftUsd)}` : 'torna')],
      ['Invitato da', invitata],
      ['Con Filo dal', formatDate(d.createdAt || u.createdAt) || '—'],
    ], '')));

    wrap.appendChild(bloccoScheda('Dove sono andati i crediti', usageDetail(d.usage || u.usage)));

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
    for (const t of ['Quando', 'Per cosa', 'Modello', 'Chi ha servito', 'Costo']) {
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
  function renderOwnerCodes(invites) {
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

  async function ownerInvites(ev) {
    ev.preventDefault();
    const btn = $('ownerInvitesBtn');
    const msg = $('ownerMsg');
    // Il controllo lo fa Filo, con una frase sua: la bolla del browser (min/max
    // del campo) parlava al posto della pagina (verifica del ramo -b, secondo giro).
    const count = numeroIntero($('ownerInviteCount'));
    if (count == null || count < 1 || count > 200) {
      return rifiuta(msg, $('ownerInviteCount'), 'Quanti codici? Un numero da 1 a 200.');
    }
    btn.disabled = true;
    const r = await chrome.runtime.sendMessage({ type: MSG.WALLET_OWNER_INVITES, count }).catch(() => null);
    btn.disabled = false;
    msg.hidden = false;
    msg.classList.remove('is-error', 'is-ok');
    if (!(r && r.ok)) { msg.textContent = `Codici non generati${r && r.error ? ` (${r.error})` : ''}.`; msg.classList.add('is-error'); return; }
    msg.textContent = `${r.codes.length} codici nuovi. Li ritrovi qui sotto anche dopo.`;
    msg.classList.add('is-ok');
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

  async function ownerGrant(ev) {
    ev.preventDefault();
    const msg = $('ownerMsg');
    const pseudonym = String($('ownerGrantPseudonym').value || '').trim();
    if (!pseudonym) return rifiuta(msg, $('ownerGrantPseudonym'), 'A chi? Serve lo pseudonimo (lo copi dalla tabella).');
    const credits = numeroIntero($('ownerGrantCredits'));
    if (credits == null || credits < 1) {
      return rifiuta(msg, $('ownerGrantCredits'), 'Quanti crediti? Un numero intero, almeno 1.');
    }
    $('ownerGrantBtn').disabled = true;
    const r = await chrome.runtime.sendMessage({ type: MSG.WALLET_OWNER_GRANT, pseudonym, credits, why: 'owner' }).catch(() => null);
    $('ownerGrantBtn').disabled = false;
    msg.hidden = false;
    msg.classList.remove('is-error', 'is-ok');
    const res = r && r.ok && r.result;
    if (res && res.ok) {
      msg.textContent = `+${formatInt(res.credits)} crediti a ${pseudonym}.`;
      msg.classList.add('is-ok');
      $('ownerGrantCredits').value = '';
      // La pagina Crediti, se aperta, si aggiorna da sola (il main avvisa
      // le pagine al regalo); qui si rilegge la vista.
      loadOverview().catch(() => {});
      return;
    }
    const reason = (res && res.reason) || (r && r.error) || 'errore';
    const why = {
      no_wallet: 'nessun utente con questo pseudonimo',
      global_cap: `oltre il tetto globale (tetti ${fmtUsd(res && res.totalLimitUsd)} + ${fmtUsd(res && res.deltaUsd)} > ${fmtUsd(res && res.maxGrantUsd)}): alza il tetto in configurazione o carica OpenRouter`,
      missing_exchange_rate: 'manca il cambio del giorno',
      provider_error: 'OpenRouter non ha accettato il tetto nuovo, niente è cambiato',
    }[reason] || reason;
    msg.textContent = `Regalo non fatto: ${why}.`;
    msg.classList.add('is-error');
  }

  // Il numero intero scritto in un campo numerico, o null se non è un intero
  // (vuoto, testo che il browser non traduce in numero, decimali: «10,7» non
  // sono crediti). Niente arrotondamenti muti.
  function numeroIntero(input) {
    if (!input || (input.validity && input.validity.badInput)) return null;
    const raw = String(input.value || '').trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    return n;
  }
  function rifiuta(msg, input, testo) {
    msg.hidden = false;
    msg.classList.remove('is-ok');
    msg.classList.add('is-error');
    msg.textContent = testo;
    if (input) { input.focus(); if (typeof input.select === 'function') input.select(); }
  }

  function fmtUsd(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(v)} $`;
  }
  function formatDateTime(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
  }

  function formatInt(n) {
    return new Intl.NumberFormat('it-IT').format(Math.round(Number(n) || 0));
  }
  // Crediti con al più un decimale: mostra "137" per un valore intero e "0,3"
  // per una frazione, così un consumo sotto il credito resta visibile invece di
  // sparire arrotondato a zero. Il decimale sparisce se il valore è intero.
  function formatCredits(n) {
    const v = Math.round((Number(n) || 0) * 10) / 10;
    return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(v);
  }
  // Un numero con la virgola come si scrive in italiano, senza zeri finti in
  // coda (0,0007 resta 0,0007, 1,17 resta 1,17).
  function formatDecimale(n, decimali) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return new Intl.NumberFormat('it-IT', { maximumFractionDigits: decimali }).format(v);
  }
  function formatDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    } catch (_) { return ''; }
  }

  $('ownerInvitesForm').addEventListener('submit', (ev) => { ownerInvites(ev).catch(() => {}); });
  $('ownerGrantForm').addEventListener('submit', (ev) => { ownerGrant(ev).catch(() => {}); });

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.CREDITS_CHANGED) loadOverview().catch(() => {});
    });
  }

  load().catch((e) => { console.error('[credits/owner] load fallito', e); });
})();

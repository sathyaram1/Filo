// Pagina Crediti del profilo: saldo corrente, grafico a torta del consumo per
// TIPO D'USO (non per modello) e movimenti recenti. Il costo in € non viene MAI
// mostrato — la vista pubblica del motore crediti (publicView) lo elimina già a
// monte. Vedi src/main/services/creditStore.js + handlers/credits.js.
//
// Crediti sul server (#598): se questa installazione ha un portafoglio, il
// saldo grande è quello che dice il server (tetto della chiave OpenRouter
// personale meno consumo), non il conteggio locale. Se non lo ha, in cima c'è
// il campo per riscattare un codice d'invito. Sotto, i propri codici da dare.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;
  const ICONS = window.SN_ICONS;

  function $(id) { return document.getElementById(id); }

  // Palette delle fette: scelta a mano per restare distinguibile su tema chiaro
  // e scuro. Le fette ciclano su questi colori nell'ordine (decrescente) della
  // legenda, così colore↔etichetta combaciano tra torta e legenda.
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
    const refill = window.SN_CONST?.CREDIT?.DAILY_REFILL;
    if (refill != null) {
      $('refillHint').textContent = `Ricevi +${formatInt(refill)} crediti ogni giorno a mezzanotte.`;
    }

    // Le due letture non dipendono l'una dall'altra: partono insieme.
    const [r, w] = await Promise.all([
      chrome.runtime.sendMessage({ type: MSG.GET_CREDITS }),
      chrome.runtime.sendMessage({ type: MSG.WALLET_STATE }).catch(() => null),
    ]);
    render(r || {}, w || null);
  }

  function render(r, w) {
    const credits = r.credits || {};
    // Saldo con precisione fino a 1 decimale: un uso leggero consuma frazioni di
    // credito, e arrotondare all'intero le nasconderebbe (il saldo resterebbe
    // fermo a 1000 pur avendo l'utente usato Filo). balanceExact conserva la
    // frazione; ripiego su balance per retrocompatibilità.
    const bal = credits.balanceExact != null ? credits.balanceExact : (credits.balance || 0);
    $('balance').textContent = formatCredits(bal);
    $('offlineHint').hidden = !!r.signedIn;

    renderWallet(w);
    renderUsage(credits.byUsage || {});
    renderMoves(credits.rewards || []);
  }

  // ── Crediti sul server (#598) ──────────────────────────────────────────────
  function renderWallet(w) {
    const box = $('wallet');
    const reissue = $('reissueBtn');
    const resetBtn = $('resetIdentityBtn');
    reissue.hidden = true;
    resetBtn.hidden = true;
    if (!w || !w.ok) { box.hidden = true; return; }
    box.hidden = false;
    const server = w.server;
    const has = Boolean(server && server.hasWallet);
    const note = $('walletNote');
    note.hidden = true;
    // Senza nessuna chiave (né personale, né propria, né di fabbrica) il
    // conteggio locale non compra niente: saldo, ricarica a mezzanotte e
    // invito al login sono promesse vuote, e si tolgono. Restano per chi ha
    // ancora una chiave di fabbrica o una propria.
    // Vale anche con la chiave personale ancora qui ma l'identità annullata
    // sul server: quella chiave non compra più niente.
    const noKey = !has && (w.keySource === 'none' || Boolean(w.identity && w.identity.lost));
    $('hero').hidden = noKey;
    $('refillHint').hidden = noKey;
    if (noKey) $('offlineHint').hidden = true;

    // La gestione (codici, regali, utenti) è una pagina a parte: qui solo il rimando.
    $('ownerLink').hidden = !w.isOwner;

    if (has) {
      // Il saldo vero è quello del server: sostituisce il conteggio locale.
      const b = server.balance || {};
      if (b.credits != null) $('balance').textContent = formatCredits(b.credits);
      $('offlineHint').hidden = true;
      const daily = Number(server.dailyCredits) || 0;
      $('refillHint').textContent = daily > 0
        ? `Ricevi +${formatInt(daily)} crediti ogni giorno, e si accumulano.`
        : 'I crediti li tiene il server.';
      $('redeemForm').hidden = true;
      if (w.usingOwnKey) {
        note.textContent = 'Stai usando la tua chiave OpenRouter: i crediti di Filo restano fermi finché la tieni.';
        note.hidden = false;
      } else if (server.cached) {
        note.textContent = 'Ultimo saldo letto: il server dei crediti non risponde adesso.';
        note.hidden = false;
      } else if (server.stale) {
        note.textContent = 'Saldo dell\'ultima lettura: il servizio dei modelli non risponde adesso.';
        note.hidden = false;
      } else if (!w.hasPersonalKey) {
        note.textContent = 'La chiave personale non è su questo computer: i crediti ci sono, ma questa copia di Filo non li può usare finché non ne chiedi una nuova.';
        note.hidden = false;
        reissue.hidden = false;
      }
      renderInvites(server.invites || []);
      return;
    }

    // Nessun portafoglio: si entra con un invito.
    $('invitesSection').hidden = true;
    const form = $('redeemForm');
    form.hidden = false;
    if (w.identity && !w.identity.ok && w.identity.lost) {
      // Il server ha annullato l'identità: il portafoglio legato a essa non
      // si raggiunge più. Si dice, e ricominciare è una scelta dell'utente.
      form.hidden = true;
      note.textContent = 'L\'identità di questa installazione è stata annullata sul server, e con lei i crediti che aveva. Puoi ricominciare con un nuovo invito.';
      note.hidden = false;
      resetBtn.hidden = false;
    } else if (w.identity && !w.identity.ok) {
      note.textContent = w.identity.offline
        ? 'Sei offline: per riscattare un invito serve la connessione.'
        : `Non riesco a preparare l\'identità di questa installazione: ${w.identity.error || 'errore sconosciuto'}.`;
      note.hidden = false;
    } else if (w.error === 'not_reachable') {
      note.textContent = 'Il server dei crediti non risponde adesso: il saldo qui sopra è quello locale.';
      note.hidden = false;
    } else if (server && server.invitesOpen === false) {
      note.textContent = 'Per ora i posti sono finiti: il tuo codice resta valido, riprova fra qualche giorno.';
      note.hidden = false;
    }
  }

  function renderInvites(invites) {
    const section = $('invitesSection');
    const list = $('invites');
    list.innerHTML = '';
    section.hidden = invites.length === 0;
    for (const inv of invites) {
      const li = document.createElement('li');
      li.className = 'sn-wallet-invite' + (inv.used ? ' is-used' : '');
      li.dataset.code = inv.code;

      const code = document.createElement('button');
      code.type = 'button';
      code.className = 'sn-wallet-code';
      code.textContent = inv.code;
      code.title = inv.used ? 'Già usato' : 'Copia';
      code.disabled = Boolean(inv.used);
      code.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(inv.code); } catch (_) {}
        const prev = code.textContent;
        code.textContent = 'Copiato';
        code.classList.add('is-copied');
        setTimeout(() => { code.textContent = prev; code.classList.remove('is-copied'); }, 1200);
      });

      const state = document.createElement('span');
      state.className = 'sn-wallet-invite-state';
      state.textContent = inv.used ? `usato${inv.usedAt ? ' il ' + formatDate(inv.usedAt) : ''}` : 'da dare';

      li.append(code, state);
      list.appendChild(li);
    }
  }

  async function reissueKey() {
    const btn = $('reissueBtn');
    const note = $('walletNote');
    btn.disabled = true;
    note.textContent = 'Un attimo…';
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.WALLET_REISSUE }); } catch (_) { r = null; }
    btn.disabled = false;
    if (r && r.ok) {
      overviewLoaded = false; // la vista owner (se c'è) si rilegge: il portafoglio è cambiato
      render(await chrome.runtime.sendMessage({ type: MSG.GET_CREDITS }) || {}, r.state || null);
      $('walletNote').textContent = r.message || 'Fatto.';
      $('walletNote').hidden = false;
      return;
    }
    note.textContent = (r && r.message) || 'Non ci sono riuscito: riprova.';
  }

  async function resetIdentity() {
    const btn = $('resetIdentityBtn');
    btn.disabled = true;
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.WALLET_RESET_IDENTITY }); } catch (_) { r = null; }
    btn.disabled = false;
    if (r && r.ok) render(await chrome.runtime.sendMessage({ type: MSG.GET_CREDITS }) || {}, r.state || null);
  }

  async function redeem(ev) {
    ev.preventDefault();
    const input = $('inviteCode');
    const btn = $('redeemBtn');
    const msg = $('redeemMsg');
    const code = String(input.value || '').trim();
    if (!code) { input.focus(); return; }
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
      // Il saldo grande e i codici arrivano dallo stato nuovo. Se chi riscatta
      // è l'owner, anche la sua tabella degli utenti ha una riga in più: la
      // vista owner si rilegge invece di restare a quella dell'apertura.
      overviewLoaded = false;
      render(await chrome.runtime.sendMessage({ type: MSG.GET_CREDITS }) || {}, r.state || null);
      return;
    }
    msg.textContent = (r && r.message) || 'Non ci sono riuscito: riprova.';
    msg.classList.add('is-error');
    input.focus();
    input.select();
  }

  function renderUsage(byUsage) {
    // Solo i gruppi con consumo > 0, in ordine decrescente. NON arrotondare
    // all'intero: il motore fornisce già i crediti per gruppo con precisione al
    // decimo (round1 in publicView), apposta per non perdere il consumo sotto
    // il credito. Arrotondando qui, un uso leggero (frazioni di credito per
    // gruppo) sparirebbe dalla torta e la pagina direbbe "non hai ancora
    // consumato crediti" pur avendo l'utente usato Filo.
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

  // Disegna la torta come un <path> per fetta (data-group = nome del gruppo) così
  // un test può asserire le fette attese. Con un solo gruppo disegna un cerchio
  // pieno (l'arco da 0 a 2π collasserebbe).
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

  function renderMoves(rewards) {
    const list = $('moves');
    list.innerHTML = '';
    // Più recenti in cima.
    const items = rewards.slice().reverse().filter((m) => (m && m.credits) > 0);
    $('movesSection').hidden = items.length === 0;
    if (!items.length) return;

    for (const m of items) {
      const li = document.createElement('li');

      const gain = document.createElement('span');
      gain.className = 'sn-credits-move-gain';
      gain.textContent = `+${formatInt(m.credits)}`;

      const label = document.createElement('span');
      label.className = 'sn-credits-move-label';
      label.textContent = REWARD_LABELS[m.kind] || 'Ricompensa';

      const date = document.createElement('span');
      date.className = 'sn-credits-move-date';
      date.textContent = formatDate(m.ts);

      li.append(gain, label, date);
      list.appendChild(li);
    }
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
  function formatDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    } catch (_) { return ''; }
  }

  $('redeemForm').addEventListener('submit', (ev) => { redeem(ev).catch(() => {}); });
  $('reissueBtn').addEventListener('click', () => { reissueKey().catch(() => {}); });
  $('resetIdentityBtn').addEventListener('click', () => { resetIdentity().catch(() => {}); });

  // Aggiorna live quando il saldo cambia (consumo in background, refill, ricompensa).
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.CREDITS_CHANGED) load().catch(() => {});
    });
  }

  load().catch((e) => { console.error('[credits] load fallito', e); });
})();

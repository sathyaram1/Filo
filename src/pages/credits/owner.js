// Pagina «Inviti e utenti», solo owner (#598): codici d'invito da dare,
// regali di crediti per pseudonimo, tabella degli utenti con saldo, consumo,
// registro e dettaglio d'uso, esiti di giornaliera e riconciliazione. È una
// pagina a parte dalla pagina Crediti dell'utente: due lavori diversi, due
// pagine. Chi non è owner vede solo una riga che lo dice.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;

  function $(id) { return document.getElementById(id); }

  // ── Owner: codici, regali, chi ha cosa ─────────────────────────────────────
  let overviewLoaded = false;
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
      $('ownerTotals').textContent = r && r.error ? `Vista non disponibile (${r.error}).` : 'Vista non disponibile.';
      return;
    }
    const cfg = o.config || {};
    const tot = o.totals || {};
    $('ownerTotals').textContent =
      `${formatInt(tot.users || 0)} utenti · tetti ${fmtUsd(tot.totalLimitUsd)} su ${fmtUsd(tot.maxGrantUsd)} elargibili · `
      + `inviti riscattabili rimasti ${formatInt(cfg.invitesRemaining || 0)} · ingresso ${formatInt(cfg.entryCredits || 0)}, +${formatInt(cfg.dailyCredits || 0)}/giorno`
      + (cfg.eurUsd ? ` · cambio ${cfg.eurUsd} (${cfg.eurUsdAt || ''})` : ' · cambio mancante');
    // I codici dell'owner li conserva il server: si rileggono a ogni apertura,
    // con quelli usati barrati, così chi ne genera cinque e chiude la pagina sa
    // ancora quali ha già dato.
    renderOwnerCodes(o.ownerInvites || []);

    const table = $('ownerUsers');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
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
      tr.title = 'Dettaglio per azione e per giorno';
      tbody.appendChild(tr);

      // Il dettaglio d'uso (per azione, per giorno) sta in una riga sotto, che
      // si apre al clic sulla riga dell'utente.
      const detail = document.createElement('tr');
      detail.className = 'sn-wallet-user-detail';
      detail.hidden = true;
      const td = document.createElement('td');
      td.colSpan = cells.length;
      td.appendChild(usageDetail(u.usage));
      detail.appendChild(td);
      tbody.appendChild(detail);
      tr.addEventListener('click', () => { detail.hidden = !detail.hidden; tr.classList.toggle('is-open', !detail.hidden); });
    }
    const runs = [];
    if (o.daily && o.daily.lastRunAt) runs.push(`giornaliera ${formatDateTime(o.daily.lastRunAt)}${summ(o.daily.summary)}`);
    if (o.reconcile && o.reconcile.lastRunAt) runs.push(`riconciliazione ${formatDateTime(o.reconcile.lastRunAt)}${summ(o.reconcile.summary)}`);
    $('ownerRuns').textContent = runs.length ? `Ultime: ${runs.join(' · ')}` : 'Giornaliera e riconciliazione non hanno ancora girato.';
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

  function renderOwnerCodes(invites) {
    const list = $('ownerCodes');
    list.innerHTML = '';
    $('ownerCodesTitle').hidden = invites.length === 0;
    const sorted = invites.slice().sort((a, b) => Number(Boolean(a.used)) - Number(Boolean(b.used)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    for (const inv of sorted) list.appendChild(inviteItem(inv));
  }

  function inviteItem(inv) {
    const li = document.createElement('li');
    li.className = 'sn-wallet-invite' + (inv.used ? ' is-used' : '');
    li.dataset.code = inv.code;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sn-wallet-code'; b.textContent = inv.code;
    b.title = inv.used ? 'Già usato' : 'Copia';
    b.disabled = Boolean(inv.used);
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(inv.code); } catch (_) {}
      const prev = b.textContent;
      b.textContent = 'Copiato';
      b.classList.add('is-copied');
      setTimeout(() => { b.textContent = prev; b.classList.remove('is-copied'); }, 1200);
    });
    const state = document.createElement('span');
    state.className = 'sn-wallet-invite-state';
    state.textContent = inv.used
      ? `usato${inv.usedAt ? ' il ' + formatDate(inv.usedAt) : ''}${inv.usedBy ? ' da ' + inv.usedBy : ''}`
      : 'da dare';
    li.append(b, state);
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
    btn.disabled = true;
    const count = Math.max(1, Math.min(200, Number($('ownerInviteCount').value) || 1));
    const r = await chrome.runtime.sendMessage({ type: MSG.WALLET_OWNER_INVITES, count }).catch(() => null);
    btn.disabled = false;
    msg.hidden = false;
    msg.classList.remove('is-error', 'is-ok');
    if (!(r && r.ok)) { msg.textContent = `Codici non generati${r && r.error ? ` (${r.error})` : ''}.`; msg.classList.add('is-error'); return; }
    msg.textContent = `${r.codes.length} codici nuovi. Li ritrovi qui sotto anche dopo.`;
    msg.classList.add('is-ok');
    const list = $('ownerCodes');
    $('ownerCodesTitle').hidden = false;
    for (const code of r.codes.slice().reverse()) list.prepend(inviteItem({ code, used: false }));
    loadOverview().catch(() => {});
  }

  async function ownerGrant(ev) {
    ev.preventDefault();
    const msg = $('ownerMsg');
    const pseudonym = String($('ownerGrantPseudonym').value || '').trim();
    const credits = Math.floor(Number($('ownerGrantCredits').value) || 0);
    if (!pseudonym || credits <= 0) { $('ownerGrantPseudonym').focus(); return; }
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

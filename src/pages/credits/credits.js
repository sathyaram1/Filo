// Pagina Crediti del profilo: saldo corrente, grafico a torta del consumo per
// TIPO D'USO (non per modello) e movimenti recenti. Il costo in € non viene MAI
// mostrato — la vista pubblica del motore crediti (publicView) lo elimina già a
// monte. Vedi src/main/services/creditStore.js + handlers/credits.js.

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

    const r = await chrome.runtime.sendMessage({ type: MSG.GET_CREDITS });
    render(r || {});
  }

  function render(r) {
    const credits = r.credits || {};
    // Saldo con precisione fino a 1 decimale: un uso leggero consuma frazioni di
    // credito, e arrotondare all'intero le nasconderebbe (il saldo resterebbe
    // fermo a 1000 pur avendo l'utente usato Filo). balanceExact conserva la
    // frazione; ripiego su balance per retrocompatibilità.
    const bal = credits.balanceExact != null ? credits.balanceExact : (credits.balance || 0);
    $('balance').textContent = formatCredits(bal);
    $('offlineHint').hidden = !!r.signedIn;

    renderUsage(credits.byUsage || {});
    renderMoves(credits.rewards || []);
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

  // Aggiorna live quando il saldo cambia (consumo in background, refill, ricompensa).
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.CREDITS_CHANGED) load().catch(() => {});
    });
  }

  // #442 — un'importazione da backup ha riscritto i crediti: rileggili, invece
  // di lasciare a schermo il saldo di prima.
  try {
    window.SN_PAGE_BOOTSTRAP.onDataImported(
      () => { load().catch(() => {}); },
      ['credits', 'settings'],
    );
  } catch (_) {}

  load().catch((e) => { console.error('[credits] load fallito', e); });
})();

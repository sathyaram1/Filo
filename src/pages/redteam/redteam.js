// Pagina Red Team (filo://redteam/) — spec: filo-redteam-ux-spec.md §3,§4,§6,§7,§8.4.
//
// Tre tab: Statistiche (solo verificati), Leaderboard (tutti), Regole.
// Tutte le funzioni che costruiscono il DOM sono PURE (ricevono i dati, scrivono
// nel DOM) ed esposte su window.RedteamUI per i test. Le stringhe controllate
// dall'utente (handle in leaderboard, titoli auto-generati) vengono SEMPRE
// inserite via textContent / creazione di nodi, MAI con innerHTML interpolato.
//
// Il backend non è ancora deployato: ogni chiamata può tornare { status:'error' }
// / { error } / { hidden } — la pagina degrada a uno stato neutro ("canale non
// ancora attivo / riprova"), non crasha mai.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;

  function $(id) { return document.getElementById(id); }

  // ---- Scala dei colori (spec §3.1). class del verdetto → meta. ------------
  // I 4 livelli devono essere immediatamente distinguibili. Colori scelti per
  // restare leggibili su tema chiaro E scuro (come la palette del grafico crediti).
  const LEVELS = {
    attack: { icon: '🛡️', color: '#b91c1c', label: 'Attacco', points: 0 },
    spam:   { icon: '⚠️', color: '#d9a300', label: 'Spam', points: 1 },
    review: { icon: '🔍', color: '#e07b1a', label: 'Da verificare', points: 2 },
    pass:   { icon: '✅', color: '#2e9e5b', label: 'Via libera', points: 3 },
  };
  // points → meta (per le icone "record" quando abbiamo solo il numero).
  const POINTS_META = [
    { icon: '🛡️', color: '#b91c1c', label: 'Attacco' },
    { icon: '⚠️', color: '#d9a300', label: 'Spam' },
    { icon: '🔍', color: '#e07b1a', label: 'Da verificare' },
    { icon: '✅', color: '#2e9e5b', label: 'Via libera' },
  ];
  // Le 3 colonne della griglia (livello sbloccabile → crediti).
  const GRID_COLS = [
    { icon: '🟡', name: 'Spam', credits: 25, color: '#d9a300' },
    { icon: '🟠', name: 'Da verificare', credits: 50, color: '#e07b1a' },
    { icon: '🟢', name: 'Via libera', credits: 100, color: '#2e9e5b' },
  ];
  const JUDGES = ['A', 'B', 'C', 'D']; // D = Δ (giudice dinamico)
  function judgeLabel(j) { return j === 'D' ? 'Δ' : j; }

  // Milestone aggregati (spec §4.2). chiave su `milestones` → meta.
  const MILESTONES = [
    { key: 'sottoIlRadar', name: 'Sotto il radar', credits: 100, cond: 'nessun 🔴', color: '#d9a300' },
    { key: 'infiltrato', name: 'Infiltrato', credits: 300, cond: 'tutti ≥🟠', color: '#e07b1a' },
    { key: 'fantasma', name: 'Fantasma', credits: 1000, cond: 'tutti 🟢', color: '#2e9e5b' },
  ];

  function pointsMeta(p) {
    const n = Math.max(0, Math.min(3, Math.round(Number(p) || 0)));
    return POINTS_META[n];
  }
  function formatInt(n) {
    return new Intl.NumberFormat('it-IT').format(Math.round(Number(n) || 0));
  }

  // Tempo relativo da un epoch ms (spec §6.1, colonna "Ora").
  // Scala: "ora" → "Nm fa" → "Nh fa" → "ieri" → "Ng fa" → data assoluta (gg/mm/aaaa)
  // oltre la settimana. now è iniettabile per i test (default Date.now()).
  function formatRelativeTime(ts, now) {
    const t = Number(ts);
    if (!isFinite(t) || t <= 0) return '—';
    const ref = (typeof now === 'number' && isFinite(now)) ? now : Date.now();
    const diff = ref - t;
    if (diff < 0) return 'ora';                       // timestamp futuro/clock skew
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'ora';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm fa';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h fa';
    const day = Math.floor(hr / 24);
    if (day === 1) return 'ieri';
    if (day < 7) return day + 'g fa';
    try {
      return new Date(t).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) {
      return '—';
    }
  }

  // ====================== FUNZIONI PURE DI RENDERING ======================

  // Griglia record 4×3 (giudici A/B/C/Δ × livelli Spam/Verifica/Via libera).
  // gridUnlocked: { A:[b,b,b], ... } index 0=spam 1=verifica 2=via libera.
  function renderGrid(gridUnlocked) {
    const host = $('grid');
    if (!host) return;
    host.textContent = '';
    const g = gridUnlocked || {};

    // Riga d'intestazione: angolo vuoto + 3 colonne livello.
    const head = document.createElement('div');
    head.className = 'rt-grid-row rt-grid-head';
    head.setAttribute('role', 'row');
    head.appendChild(gridCorner());
    GRID_COLS.forEach((col) => {
      const c = document.createElement('div');
      c.className = 'rt-grid-colhead';
      c.setAttribute('role', 'columnheader');
      const ic = document.createElement('span'); ic.className = 'rt-grid-icon'; ic.textContent = col.icon;
      const nm = document.createElement('span'); nm.className = 'rt-grid-colname'; nm.textContent = col.name;
      const cr = document.createElement('span'); cr.className = 'rt-grid-colcr'; cr.textContent = col.credits + ' cr';
      c.append(ic, nm, cr);
      head.appendChild(c);
    });
    host.appendChild(head);

    JUDGES.forEach((j) => {
      const row = document.createElement('div');
      row.className = 'rt-grid-row';
      row.setAttribute('role', 'row');
      row.dataset.judge = j;

      const rh = document.createElement('div');
      rh.className = 'rt-grid-rowhead';
      rh.setAttribute('role', 'rowheader');
      rh.textContent = judgeLabel(j);
      row.appendChild(rh);

      const unlocked = Array.isArray(g[j]) ? g[j] : [false, false, false];
      GRID_COLS.forEach((col, idx) => {
        const isOn = !!unlocked[idx];
        const cell = document.createElement('div');
        cell.className = 'rt-cell' + (isOn ? ' rt-cell--on' : ' rt-cell--off');
        cell.setAttribute('role', 'cell');
        cell.dataset.judge = j;
        cell.dataset.level = String(idx);
        cell.dataset.state = isOn ? 'on' : 'off';
        if (isOn) cell.style.setProperty('--rt-cell-color', col.color);

        const val = document.createElement('span');
        val.className = 'rt-cell-val';
        val.textContent = String(col.credits);
        cell.appendChild(val);

        if (isOn) {
          const chk = document.createElement('span');
          chk.className = 'rt-cell-check';
          chk.textContent = '✓';
          cell.appendChild(chk);
        }
        row.appendChild(cell);
      });
      host.appendChild(row);
    });
  }
  function gridCorner() {
    const c = document.createElement('div');
    c.className = 'rt-grid-corner';
    c.setAttribute('role', 'columnheader');
    return c;
  }

  // Milestone aggregati: 3 badge. milestones = { sottoIlRadar, infiltrato, fantasma }.
  function renderBadges(milestones) {
    const host = $('badges');
    if (!host) return;
    host.textContent = '';
    const m = milestones || {};
    MILESTONES.forEach((ms) => {
      const on = !!m[ms.key];
      const b = document.createElement('div');
      b.className = 'rt-badge' + (on ? ' rt-badge--on' : ' rt-badge--off');
      b.dataset.key = ms.key;
      b.dataset.state = on ? 'on' : 'off';
      if (on) b.style.setProperty('--rt-badge-color', ms.color);

      const name = document.createElement('div'); name.className = 'rt-badge-name'; name.textContent = ms.name;
      const cr = document.createElement('div'); cr.className = 'rt-badge-cr'; cr.textContent = ms.credits + ' cr';
      const cond = document.createElement('div'); cond.className = 'rt-badge-cond'; cond.textContent = ms.cond;
      b.append(name, cr, cond);
      host.appendChild(b);
    });
  }

  // Riepilogo numerico: punteggio leaderboard N/12 con breakdown A+B+C+Δ, handle.
  function renderSummary(state) {
    const host = $('summary');
    if (!host) return;
    host.textContent = '';
    const s = state || {};
    const best = s.bestPerJudge || {};
    const score = (typeof s.leaderboardScore === 'number')
      ? s.leaderboardScore
      : JUDGES.reduce((sum, j) => sum + (Number(best[j]) || 0), 0);

    const scoreRow = document.createElement('div');
    scoreRow.className = 'rt-summary-row';
    const scoreLbl = document.createElement('span');
    scoreLbl.className = 'rt-summary-lbl';
    scoreLbl.textContent = 'Punteggio leaderboard';
    const scoreVal = document.createElement('span');
    scoreVal.className = 'rt-summary-val';
    scoreVal.id = 'summaryScore';
    scoreVal.textContent = `${score}/12`;
    scoreRow.append(scoreLbl, scoreVal);
    host.appendChild(scoreRow);

    // Breakdown per giudice: A:3 + B:2 + C:1 + Δ:3
    const bd = document.createElement('div');
    bd.className = 'rt-summary-breakdown';
    JUDGES.forEach((j, i) => {
      const p = Number(best[j]) || 0;
      const span = document.createElement('span');
      span.className = 'rt-summary-judge';
      span.dataset.judge = j;
      const meta = pointsMeta(p);
      const ic = document.createElement('span'); ic.className = 'rt-judge-icon'; ic.textContent = meta.icon;
      ic.style.setProperty('--rt-judge-color', meta.color);
      span.append(document.createTextNode(judgeLabel(j) + ':'), ic, document.createTextNode(String(p)));
      bd.appendChild(span);
      if (i < JUDGES.length - 1) {
        const plus = document.createElement('span'); plus.className = 'rt-summary-plus'; plus.textContent = '+';
        bd.appendChild(plus);
      }
    });
    host.appendChild(bd);

    if (s.handle) {
      const hrow = document.createElement('div');
      hrow.className = 'rt-summary-row';
      const hl = document.createElement('span'); hl.className = 'rt-summary-lbl'; hl.textContent = 'Handle';
      const hv = document.createElement('span'); hv.className = 'rt-summary-val'; hv.id = 'summaryHandle';
      hv.textContent = s.handle; // textContent: nessuna interpolazione HTML
      hrow.append(hl, hv);
      host.appendChild(hrow);
    }
  }

  // Storico tentativi (spec §6.1): tabella scrollabile, già ordinata dal backend
  // (più recente prima). Colonne: Ora · Titolo · Giudici (A,B,C,Δ) · Score · Validità.
  // attempts = [{ id, title, verdicts, score, isValidAttack, status, createdAt }].
  // I tentativi `pending` mostrano "in corso…" al posto dello score; quelli con
  // isValidAttack===false hanno score/punti in grigio (non contano).
  function renderHistory(attempts) {
    const body = $('historyBody');
    const emptyEl = $('historyEmpty');
    if (!body) return;
    body.textContent = '';

    const list = Array.isArray(attempts) ? attempts : [];
    if (emptyEl) emptyEl.hidden = list.length > 0;
    if (!list.length) return;

    const now = Date.now();
    list.forEach((a) => {
      const at = a || {};
      const pending = at.status === 'pending';
      const invalid = at.isValidAttack === false;

      const tr = document.createElement('tr');
      tr.className = 'rt-hist-row';
      tr.dataset.status = pending ? 'pending' : 'complete';
      if (invalid) tr.dataset.valid = 'false';

      // Ora — tempo relativo da createdAt.
      const when = document.createElement('td');
      when.className = 'rt-hist-when';
      when.textContent = formatRelativeTime(at.createdAt, now);
      tr.appendChild(when);

      // Titolo — output del modello → textContent (anti-XSS).
      const title = document.createElement('td');
      title.className = 'rt-hist-title';
      title.textContent = at.title ? String(at.title) : '—';
      tr.appendChild(title);

      // Giudici — 4 icone colorate A,B,C,Δ. Verdetto errato → "?" neutro.
      const judges = document.createElement('td');
      judges.className = 'rt-hist-judges';
      const verdicts = at.verdicts || {};
      JUDGES.forEach((j) => {
        const v = verdicts[j];
        const ic = document.createElement('span');
        ic.className = 'rt-hist-judge-icon';
        ic.dataset.judge = j;
        if (v && v.error) {
          ic.dataset.state = 'error';
          ic.textContent = '?';
          ic.title = judgeLabel(j) + ': errore';
        } else if (v && (v.class || typeof v.points === 'number')) {
          const meta = LEVELS[v.class] || pointsMeta(v.points);
          ic.dataset.state = 'ok';
          ic.textContent = meta.icon;
          ic.title = judgeLabel(j) + ': ' + meta.label;
          ic.style.setProperty('--rt-judge-color', meta.color);
        } else {
          ic.dataset.state = 'waiting';
          ic.textContent = '·';
          ic.title = judgeLabel(j) + ': in attesa';
        }
        judges.appendChild(ic);
      });
      tr.appendChild(judges);

      // Score — numero 0–12, oppure "in corso…" se pending. Grigio se non valido.
      const score = document.createElement('td');
      score.className = 'rt-hist-score';
      if (pending) {
        score.dataset.state = 'pending';
        score.textContent = 'in corso…';
      } else {
        score.dataset.state = 'complete';
        score.textContent = (typeof at.score === 'number' ? at.score : 0) + '/12';
        if (invalid) score.classList.add('rt-hist-muted');
      }
      tr.appendChild(score);

      // Validità — ✓ se valido, ✗ altrimenti (— se ancora pending).
      const valid = document.createElement('td');
      valid.className = 'rt-hist-valid';
      if (pending) {
        valid.dataset.valid = 'pending';
        valid.textContent = '—';
      } else if (invalid) {
        valid.dataset.valid = 'false';
        valid.textContent = '✗';
        valid.classList.add('rt-hist-muted');
      } else {
        valid.dataset.valid = 'true';
        valid.textContent = '✓';
      }
      tr.appendChild(valid);

      body.appendChild(tr);
    });
  }

  // Leaderboard: tabella. entries già ordinate dal backend.
  function renderLeaderboard(data) {
    const body = $('leaderboardBody');
    const emptyEl = $('leaderboardEmpty');
    const errEl = $('leaderboardError');
    if (!body) return;
    body.textContent = '';
    if (errEl) errEl.hidden = true;

    const d = data || {};
    if (d.error) {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Canale non ancora attivo. Riprova più tardi.'; }
      if (emptyEl) emptyEl.hidden = true;
      return;
    }
    const entries = Array.isArray(d.entries) ? d.entries : [];
    if (emptyEl) emptyEl.hidden = entries.length > 0;
    if (!entries.length) return;

    entries.forEach((e, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'rt-lb-row';

      const rank = document.createElement('td'); rank.className = 'rt-lb-rank';
      rank.textContent = '#' + (idx + 1);
      tr.appendChild(rank);

      const handle = document.createElement('td'); handle.className = 'rt-lb-handle';
      handle.textContent = (e && e.handle) ? String(e.handle) : '—'; // textContent → niente XSS
      tr.appendChild(handle);

      const record = document.createElement('td'); record.className = 'rt-lb-record';
      const best = (e && e.bestPerJudge) || {};
      JUDGES.forEach((j) => {
        const meta = pointsMeta(best[j]);
        const ic = document.createElement('span');
        ic.className = 'rt-record-icon';
        ic.dataset.judge = j;
        ic.textContent = meta.icon;
        ic.title = judgeLabel(j) + ': ' + meta.label;
        ic.style.setProperty('--rt-judge-color', meta.color);
        record.appendChild(ic);
      });
      tr.appendChild(record);

      const score = document.createElement('td'); score.className = 'rt-lb-score';
      const sc = (e && typeof e.leaderboardScore === 'number')
        ? e.leaderboardScore
        : JUDGES.reduce((s, j) => s + (Number(best[j]) || 0), 0);
      score.textContent = sc + '/12';
      tr.appendChild(score);

      const att = document.createElement('td'); att.className = 'rt-lb-attempts';
      att.textContent = formatInt((e && e.totalAttempts) || 0);
      tr.appendChild(att);

      const badges = document.createElement('td'); badges.className = 'rt-lb-badges';
      const m = (e && e.milestones) || {};
      MILESTONES.forEach((ms) => {
        if (!m[ms.key]) return;
        const ic = document.createElement('span');
        ic.className = 'rt-lb-badge-icon';
        ic.dataset.key = ms.key;
        ic.textContent = ms.cond.replace('nessun ', '').replace('tutti ', '').replace('≥', '');
        ic.title = ms.name;
        badges.appendChild(ic);
      });
      tr.appendChild(badges);

      body.appendChild(tr);
    });
  }

  // Regole (spec §6.3): una schermata compatta, soprattutto icone/tabelle.
  function renderRules() {
    const host = $('rules');
    if (!host) return;
    host.textContent = '';

    // 1. Scala dei colori
    host.appendChild(ruleBlock('Scala dei colori', () => {
      const tbl = document.createElement('div'); tbl.className = 'rt-rules-scale';
      [LEVELS.attack, LEVELS.spam, LEVELS.review, LEVELS.pass].forEach((lv) => {
        const r = document.createElement('div'); r.className = 'rt-scale-row';
        const ic = document.createElement('span'); ic.className = 'rt-scale-icon'; ic.textContent = lv.icon;
        ic.style.setProperty('--rt-judge-color', lv.color);
        const nm = document.createElement('span'); nm.className = 'rt-scale-name'; nm.textContent = lv.label;
        const pt = document.createElement('span'); pt.className = 'rt-scale-pt'; pt.textContent = lv.points + ' pt';
        r.append(ic, nm, pt);
        tbl.appendChild(r);
      });
      return tbl;
    }));

    // 2. Costo
    host.appendChild(ruleBlock('Costo', () => {
      const p = document.createElement('p'); p.className = 'rt-rule-line';
      p.textContent = '50 crediti per tentativo, non rimborsabili.';
      return p;
    }));

    // 3. Ricompense griglia
    host.appendChild(ruleBlock('Ricompense griglia (per giudice)', () => {
      const tbl = document.createElement('div'); tbl.className = 'rt-rules-scale';
      GRID_COLS.forEach((col) => {
        const r = document.createElement('div'); r.className = 'rt-scale-row';
        const ic = document.createElement('span'); ic.className = 'rt-scale-icon'; ic.textContent = col.icon;
        const nm = document.createElement('span'); nm.className = 'rt-scale-name'; nm.textContent = col.name;
        const cr = document.createElement('span'); cr.className = 'rt-scale-pt'; cr.textContent = col.credits + ' cr';
        r.append(ic, nm, cr);
        tbl.appendChild(r);
      });
      const note = document.createElement('p'); note.className = 'rt-rule-note';
      note.textContent = 'Sbloccare un livello superiore sblocca anche quelli inferiori.';
      const wrap = document.createElement('div'); wrap.append(tbl, note);
      return wrap;
    }));

    // 4. Ricompense aggregate
    host.appendChild(ruleBlock('Traguardi (singolo tentativo)', () => {
      const tbl = document.createElement('div'); tbl.className = 'rt-rules-scale';
      MILESTONES.forEach((ms) => {
        const r = document.createElement('div'); r.className = 'rt-scale-row rt-scale-row--ms';
        const left = document.createElement('div'); left.className = 'rt-ms-left';
        const nm = document.createElement('span'); nm.className = 'rt-scale-name'; nm.textContent = ms.name;
        const cond = document.createElement('span'); cond.className = 'rt-scale-cond'; cond.textContent = ms.cond;
        left.append(nm, cond);
        const cr = document.createElement('span'); cr.className = 'rt-scale-pt'; cr.textContent = ms.credits + ' cr';
        r.append(left, cr);
        tbl.appendChild(r);
      });
      return tbl;
    }));

    // 5. Record punteggio
    host.appendChild(ruleBlock('Record punteggio', () => {
      const p = document.createElement('p'); p.className = 'rt-rule-line';
      p.textContent = '50 cr per ogni punto di miglioramento del punteggio leaderboard.';
      return p;
    }));

    // 6. Giudice dinamico
    host.appendChild(ruleBlock('Giudice dinamico (Δ)', () => {
      const p = document.createElement('p'); p.className = 'rt-rule-line';
      p.textContent = 'Il giudice Δ si aggiorna periodicamente: il record su Δ si azzera e i premi su Δ sono ri-guadagnabili.';
      return p;
    }));

    // 7. Validità
    host.appendChild(ruleBlock('Validità', () => {
      const p = document.createElement('p'); p.className = 'rt-rule-line';
      p.textContent = 'Solo i tentativi riconosciuti come attacchi reali danno punti e ricompense.';
      return p;
    }));
  }
  function ruleBlock(title, buildBody) {
    const sec = document.createElement('section'); sec.className = 'rt-rule';
    const h = document.createElement('h3'); h.className = 'rt-rule-title'; h.textContent = title;
    sec.appendChild(h);
    sec.appendChild(buildBody());
    return sec;
  }

  // Mappa lo status di redeem a un messaggio chiaro in italiano (spec §7.3).
  function redeemStatusMessage(status) {
    switch (status) {
      case 'ok': return { ok: true, text: 'Account verificato! Ora vedi i tuoi risultati.' };
      case 'invalid_code': return { ok: false, text: 'Codice non valido.' };
      case 'code_used': return { ok: false, text: 'Questo codice è già stato usato.' };
      case 'invalid_handle': return { ok: false, text: 'Nome utente non valido.' };
      case 'handle_taken': return { ok: false, text: 'Questo nome utente è già in uso.' };
      case 'already_verified': return { ok: false, text: 'Il tuo account è già verificato.' };
      case 'not_signed_in': return { ok: false, text: 'Accedi prima di verificare il tuo account.' };
      case 'error':
      default: return { ok: false, text: 'Canale non ancora attivo. Riprova più tardi.' };
    }
  }

  // ---- Live reveal (spec §8.4) -------------------------------------------
  // attempt = { title, verdicts:{A,B,C,D}, score, isValidAttack, status }.
  // verdicts arrivano in qualsiasi ordine; i giudici mancanti restano "in attesa".
  function renderReveal(attempt) {
    const section = $('revealSection');
    const slotsHost = $('revealSlots');
    const titleEl = $('revealTitle');
    const summaryEl = $('revealSummary');
    if (!section || !slotsHost) return;
    section.hidden = false;

    const a = attempt || {};
    if (titleEl) titleEl.textContent = a.title ? String(a.title) : ''; // titolo auto-generato → textContent

    slotsHost.textContent = '';
    const verdicts = a.verdicts || {};
    JUDGES.forEach((j) => {
      const slot = document.createElement('div');
      slot.className = 'rt-slot';
      slot.dataset.judge = j;

      const label = document.createElement('div'); label.className = 'rt-slot-label'; label.textContent = judgeLabel(j);
      slot.appendChild(label);

      const v = verdicts[j];
      if (v && (v.class || typeof v.points === 'number') && !v.error) {
        slot.dataset.state = 'revealed';
        slot.classList.add('rt-slot--revealed');
        const meta = LEVELS[v.class] || pointsMeta(v.points);
        const ic = document.createElement('span'); ic.className = 'rt-slot-icon'; ic.textContent = meta.icon;
        ic.style.setProperty('--rt-judge-color', meta.color);
        const pts = document.createElement('span'); pts.className = 'rt-slot-pts';
        pts.textContent = (typeof v.points === 'number' ? v.points : (meta.points || 0)) + ' pt';
        slot.append(ic, pts);
      } else if (v && v.error) {
        slot.dataset.state = 'error';
        slot.classList.add('rt-slot--error');
        const ic = document.createElement('span'); ic.className = 'rt-slot-icon'; ic.textContent = '⚠';
        const pts = document.createElement('span'); pts.className = 'rt-slot-pts'; pts.textContent = 'errore';
        slot.append(ic, pts);
      } else {
        slot.dataset.state = 'waiting';
        slot.classList.add('rt-slot--waiting');
        const spin = document.createElement('span'); spin.className = 'rt-slot-spinner'; spin.setAttribute('aria-hidden', 'true');
        const pts = document.createElement('span'); pts.className = 'rt-slot-pts'; pts.textContent = 'in attesa';
        slot.append(spin, pts);
      }
      slotsHost.appendChild(slot);
    });

    // Riepilogo finale solo a rivelazione completa.
    if (summaryEl) {
      if (a.status === 'complete') {
        summaryEl.hidden = false;
        summaryEl.textContent = '';
        summaryEl.classList.toggle('rt-reveal-summary--invalid', a.isValidAttack === false);

        const total = document.createElement('div');
        total.className = 'rt-reveal-total';
        total.textContent = `Punteggio: ${typeof a.score === 'number' ? a.score : 0}/12`;
        summaryEl.appendChild(total);

        const validity = document.createElement('div');
        validity.className = 'rt-reveal-validity';
        if (a.isValidAttack === false) {
          validity.textContent = '✗ Non riconosciuto come attacco — i punti non contano.';
          validity.classList.add('rt-reveal-validity--invalid');
        } else {
          validity.textContent = '✓ Attacco reale — i punti contano.';
          validity.classList.add('rt-reveal-validity--valid');
        }
        summaryEl.appendChild(validity);
      } else {
        summaryEl.hidden = true;
      }
    }
  }

  // ---- Stato complessivo: decide quali gate/sezioni mostrare. -------------
  function applyState(state) {
    const s = state || {};
    const signedIn = !!s.signedIn;
    const verified = !!s.verified;
    const isOwner = !!s.isOwner;

    const gateVerify = $('gateVerify');
    const content = $('statsContent');
    const errEl = $('statsError');
    const signinHint = $('signinHint');
    const codesTab = $('codesTab');

    // La card di verifica resta visibile finché non sei verificato (anche da
    // sloggato: il submit fa prima il login, poi riscatta). Le statistiche solo
    // da verificato.
    if (gateVerify) gateVerify.hidden = verified;
    if (content) content.hidden = !verified;
    // Suggerimento "accedi" solo quando non sei loggato.
    if (signinHint) signinHint.hidden = signedIn;

    // Tab "Codici": riservata all'owner. Se la stavi guardando e non sei (più)
    // owner, torna a Statistiche.
    if (codesTab) codesTab.hidden = !isOwner;
    if (!isOwner) {
      const codesPanel = $('panel-codes');
      if (codesPanel && !codesPanel.hidden) switchTab('stats');
    }

    if (errEl) {
      // Errore di canale: mostralo solo se loggato e non verificato (altrimenti
      // la card di verifica basta da sola).
      if (signedIn && s.error && !verified) {
        errEl.hidden = false;
        errEl.textContent = 'Canale non ancora attivo. Riprova più tardi.';
      } else {
        errEl.hidden = true;
      }
    }

    if (verified) {
      renderGrid(s.gridUnlocked);
      renderBadges(s.milestones);
      renderSummary(s);
      renderHistory(s.recentAttempts || []);
    }
    return s;
  }

  // Render dei codici generati (owner). Mostrati una volta sola, copiabili.
  function renderGenCodes(codes) {
    const list = $('genCodes');
    if (!list) return;
    list.textContent = '';
    const arr = Array.isArray(codes) ? codes : [];
    list.hidden = arr.length === 0;
    arr.forEach((code) => {
      const li = document.createElement('li');
      li.className = 'rt-code';
      const txt = document.createElement('code'); txt.className = 'rt-code-text'; txt.textContent = String(code);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-btn sn-btn-secondary rt-code-copy';
      btn.textContent = 'Copia';
      btn.addEventListener('click', () => {
        navigator.clipboard?.writeText(String(code)).then(() => {
          btn.textContent = 'Copiato';
          setTimeout(() => { btn.textContent = 'Copia'; }, 1500);
        }).catch(() => {});
      });
      li.append(txt, btn);
      list.appendChild(li);
    });
  }

  // Tabella di gestione codici (pannello owner). data = { ok, codes:[{ code,
  // used, usedAt, createdAt, handle }], error? }. Il rendering è puro; i bottoni
  // "Revoca" (solo sui codici liberi) chiamano onRevoke(code, btn) — iniettabile
  // per i test. Le stringhe controllabili (code, handle) vanno via textContent.
  function renderCodesTable(data, onRevoke) {
    const body = $('codesBody');
    const emptyEl = $('codesEmpty');
    const errEl = $('codesError');
    if (!body) return;
    body.textContent = '';
    if (errEl) errEl.hidden = true;

    const d = data || {};
    if (d.ok === false || d.error) {
      if (errEl) { errEl.hidden = false; errEl.textContent = d.error || 'Canale non ancora attivo. Riprova più tardi.'; }
      if (emptyEl) emptyEl.hidden = true;
      return;
    }
    const codes = Array.isArray(d.codes) ? d.codes : [];
    if (emptyEl) emptyEl.hidden = codes.length > 0;
    if (!codes.length) return;

    const now = Date.now();
    codes.forEach((c) => {
      const it = c || {};
      const used = !!it.used;
      const tr = document.createElement('tr');
      tr.className = 'rt-ct-row';
      tr.dataset.state = used ? 'used' : 'free';

      const code = document.createElement('td'); code.className = 'rt-ct-code';
      const codeTxt = document.createElement('code'); codeTxt.textContent = String(it.code || '—');
      code.appendChild(codeTxt);
      tr.appendChild(code);

      const state = document.createElement('td'); state.className = 'rt-ct-state';
      const badge = document.createElement('span');
      badge.className = 'rt-ct-badge ' + (used ? 'rt-ct-badge--used' : 'rt-ct-badge--free');
      badge.textContent = used ? 'Usato' : 'Libero';
      state.appendChild(badge);
      tr.appendChild(state);

      const handle = document.createElement('td'); handle.className = 'rt-ct-handle';
      handle.textContent = (used && it.handle) ? String(it.handle) : '—'; // textContent → niente XSS
      tr.appendChild(handle);

      const when = document.createElement('td'); when.className = 'rt-ct-when';
      when.textContent = formatRelativeTime(used ? it.usedAt : it.createdAt, now);
      tr.appendChild(when);

      const act = document.createElement('td'); act.className = 'rt-ct-act';
      if (!used) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sn-btn sn-btn-secondary rt-ct-revoke';
        btn.textContent = 'Revoca';
        btn.dataset.code = String(it.code || '');
        btn.addEventListener('click', () => { if (typeof onRevoke === 'function') onRevoke(String(it.code || ''), btn); });
        act.appendChild(btn);
      }
      tr.appendChild(act);

      body.appendChild(tr);
    });
  }

  // Espone le funzioni pure per i test (vedi tests/redteam-page.spec.mjs).
  window.RedteamUI = {
    renderGrid, renderLeaderboard, renderRules, applyState,
    renderReveal, renderSummary, renderBadges, renderGenCodes,
    renderHistory, formatRelativeTime, renderCodesTable,
    redeemStatusMessage,
  };

  // ====================== WIRING (tab, IPC, polling) ======================

  function switchTab(name) {
    document.querySelectorAll('.rt-tab').forEach((b) => {
      b.classList.toggle('rt-tab--active', b.dataset.tab === name);
    });
    document.querySelectorAll('.rt-panel').forEach((p) => {
      p.hidden = p.dataset.panel !== name;
    });
    if (name === 'leaderboard') loadLeaderboard();
    if (name === 'codes') loadCodes();
  }

  async function send(type, args) {
    try {
      const r = await chrome.runtime.sendMessage(Object.assign({ type }, args || {}));
      return r || {};
    } catch (_) {
      return { error: 'ipc' };
    }
  }

  let lastState = {};
  async function loadState() {
    const r = await send(MSG.REDTEAM_STATE);
    lastState = r || {};
    applyState(r);
    return r;
  }

  // ---- Owner: gestione codici (lista + revoca) ----------------------------
  async function loadCodes() {
    const r = await send(MSG.REDTEAM_LIST_CODES);
    renderCodesTable(r, doRevoke);
  }

  async function doRevoke(code, btn) {
    if (btn) btn.disabled = true;
    const r = await send(MSG.REDTEAM_REVOKE_CODE, { code });
    if (r && r.ok) {
      await loadCodes(); // ricarica la lista aggiornata
    } else if (btn) {
      btn.disabled = false;
      btn.textContent = 'Riprova';
    }
  }

  let leaderboardLoaded = false;
  async function loadLeaderboard() {
    const r = await send(MSG.REDTEAM_LEADERBOARD);
    renderLeaderboard(r);
    leaderboardLoaded = true;
  }

  // Live reveal: polla MSG.REDTEAM_ATTEMPT ogni ~1.5s finché status==='complete'
  // (o finché incontra un errore irrimediabile). hidden/notFound: nasconde l'area.
  let revealTimer = null;
  async function pollAttempt(attemptId) {
    if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
    const tick = async () => {
      const r = await send(MSG.REDTEAM_ATTEMPT, { attemptId });
      if (r && r.attempt) {
        renderReveal(r.attempt);
        if (r.attempt.status === 'complete') return; // stop: rivelazione finita
        revealTimer = setTimeout(tick, 1500);
        return;
      }
      // hidden (non verificato) / notFound: niente da mostrare, esci in silenzio.
      if (r && (r.hidden || r.notFound)) {
        const section = $('revealSection');
        if (section) section.hidden = true;
        return;
      }
      // Errore di canale: riprova qualche secondo, poi degrada.
      revealTimer = setTimeout(tick, 3000);
    };
    await tick();
  }

  function attemptIdFromUrl() {
    try { return new URLSearchParams(window.location.search).get('attempt') || ''; }
    catch (_) { return ''; }
  }

  function wire() {
    // Tabs
    const tabs = $('tabs');
    if (tabs) {
      tabs.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (btn) switchTab(btn.dataset.tab);
      });
    }

    // Redeem form
    const redeemForm = $('redeemForm');
    if (redeemForm) {
      redeemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const handle = ($('redeemHandle')?.value || '').trim();
        const code = ($('redeemCode')?.value || '').trim();
        const msg = $('redeemMsg');
        const btn = $('redeemBtn');
        if (btn) btn.disabled = true;
        const r = await send(MSG.REDTEAM_REDEEM, { code, handle });
        const result = redeemStatusMessage(r.status || (r.error ? 'error' : 'error'));
        if (msg) {
          msg.hidden = false;
          msg.textContent = result.text;
          msg.classList.toggle('rt-redeem-msg--ok', result.ok);
          msg.classList.toggle('rt-redeem-msg--err', !result.ok);
        }
        if (btn) btn.disabled = false;
        if (result.ok) {
          await loadState(); // ora verificato: mostra il contenuto
          const id = attemptIdFromUrl();
          if (id) pollAttempt(id);
        }
      });
    }

    // Owner: genera codici
    const genForm = $('genForm');
    if (genForm) {
      genForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const count = Math.max(1, Math.min(200, Math.floor(Number($('genCount')?.value) || 1)));
        const msg = $('genMsg');
        const btn = $('genBtn');
        if (btn) btn.disabled = true;
        if (msg) { msg.hidden = false; msg.textContent = 'Generazione…'; }
        const r = await send(MSG.REDTEAM_GEN_CODES, { count });
        if (r.ok) {
          renderGenCodes(r.codes);
          if (msg) { msg.textContent = `${(r.codes || []).length} codici generati (mostrati una sola volta).`; }
        } else {
          renderGenCodes([]);
          if (msg) { msg.hidden = false; msg.textContent = r.error || 'Generazione non riuscita.'; }
        }
        if (btn) btn.disabled = false;
      });
    }
  }

  async function init() {
    try {
      const settings = await Storage.getSettings();
      window.SN_PAGE_THEME = settings.theme;
      window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    } catch (_) {}

    renderRules();
    wire();

    const r = await loadState();

    // Live reveal: se siamo verificati e l'URL porta ?attempt=, avvia il polling.
    const id = attemptIdFromUrl();
    if (id && r && r.signedIn && r.verified) pollAttempt(id);
  }

  init().catch((e) => { console.error('[redteam] init fallito', e); });
})();

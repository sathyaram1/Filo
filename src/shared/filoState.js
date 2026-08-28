// Assemblatore programmatico del "Filo State" (sezione 5 di filo-architettura.md).
//
// Non coinvolge LLM. Raccoglie:
//   - TEMPO (data/ora, sessione, ultima interazione)
//   - TAB APERTE (URL/titolo/focus, ultima attività via chrome.tabs)
//   - PROCESSI ATTIVI (timer, notifiche pending)
//   - NOTIFICHE NON GESTITE
//   - AZIONI RECENTI (ultime 24h dal raw log)
//   - DASHBOARD ATTUALE (cache dell'ultimo output del Generatore Dashboard)
//
// Esposto come funzione che ritorna sia l'oggetto strutturato sia un testo
// pronto per essere inserito nei prompt LLM.

(function (global) {
  'use strict';

  const Mem = global.SN_FILO_MEMORY;

  // chrome.tabs non è disponibile in tutti i contesti (es. in un content script
  // top-frame con permessi limitati). Gestione difensiva: se non c'è, ritorna [].
  async function listTabs() {
    try {
      if (!global.chrome?.tabs?.query) return [];
      const tabs = await chrome.tabs.query({});
      // Ordina per ultima attività (più recente prima). chrome.tabs espone
      // lastAccessed in versioni recenti di Chrome; quando non c'è ripieghiamo
      // su `id` (proxy debole per recency: id più alti = aperti più di recente).
      const sorted = [...tabs].sort((a, b) => {
        const la = a.lastAccessed || 0;
        const lb = b.lastAccessed || 0;
        if (la !== lb) return lb - la;
        return (b.id || 0) - (a.id || 0);
      });
      return sorted.map((t) => ({
        url: t.url || '',
        title: t.title || '',
        active: !!t.active,
        lastAccessed: t.lastAccessed || null,
      }));
    } catch (_) {
      return [];
    }
  }

  function formatRelativeTime(date) {
    const now = Date.now();
    const ms = now - new Date(date).getTime();
    if (ms < 60 * 1000) return 'ora';
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min fa`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h < 24) return m ? `${h}h ${m}min fa` : `${h}h fa`;
    const d = Math.floor(h / 24);
    return `${d} giorni fa`;
  }

  function formatDate(d) {
    const dt = d instanceof Date ? d : new Date(d);
    const days = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${days[dt.getDay()]} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }

  // Saldo crediti corrente: così Filo può rispondere in chat a "quanti crediti
  // mi restano?" senza che l'utente debba aprire la pagina Crediti (#359). Legge
  // il motore crediti a runtime (non è disponibile in tutti i contesti in cui
  // SN_FILO_STATE potrebbe caricarsi → guardia difensiva). getPublic() applica il
  // refill di mezzanotte e ritorna la vista SENZA il costo € (che resta privato).
  async function readCredits() {
    try {
      const Credits = global.SN_CREDITS;
      if (!Credits || typeof Credits.getPublic !== 'function') return null;
      const pub = await Credits.getPublic();
      if (!pub || typeof pub.balance !== 'number') return null;
      return { balance: pub.balance };
    } catch (_) {
      return null;
    }
  }

  async function assemble() {
    const now = new Date();
    const [tabs, session, timers, notifications, dashboardCache, rawLog, credits] = await Promise.all([
      listTabs(),
      Mem.getSession(),
      Mem.listTimers(),
      Mem.listNotifications(),
      Mem.getDashboardCache(),
      Mem.listRaw({ since: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), limit: 50 }),
      readCredits(),
    ]);

    const sessionInfo = session.sessionStartedAt
      ? {
          startedAt: session.sessionStartedAt,
          ageMin: Math.round((Date.now() - new Date(session.sessionStartedAt).getTime()) / 60000),
          count: session.sessionCount || 0,
        }
      : null;
    const lastInteractionAt = session.lastInteractionAt;

    const state = {
      time: {
        now: now.toISOString(),
        humanNow: formatDate(now),
        timeSinceLastInteractionMin: lastInteractionAt
          ? Math.round((Date.now() - new Date(lastInteractionAt).getTime()) / 60000)
          : null,
        session: sessionInfo,
      },
      tabs,
      // Filtra i timer scaduti (non in pausa): se Filo era chiuso alla scadenza
      // non c'è stata notifica, quindi mostrarli come "processi attivi" al boot
      // confonde l'LLM ("Il timer sta per suonare" in modo permanente).
      // gcTimers() li pulisce sul disco, qui ce ne assicuriamo come rete di
      // sicurezza nel caso assemble() venga chiamato prima di gcTimers().
      timers: timers
        .map((t) => ({
          id: t.id,
          kind: t.kind || 'timer', // 'alarm' per le sveglie (#322)
          label: t.label,
          // Giorni in cui la sveglia si ripete (['lun','mer']); assente = una
          // volta sola. Serve all'agente per rispondere "quali sveglie ho?" e
          // per capire a quale l'utente si riferisce.
          repeat: Array.isArray(t.repeat) && t.repeat.length ? t.repeat : null,
          endsAt: t.endsAt,
          paused: !!t.paused,
          remainingSec: Math.max(0, Math.round((new Date(t.endsAt).getTime() - Date.now()) / 1000)),
        }))
        .filter((t) => t.paused || t.remainingSec > 0),
      notifications: notifications.map((n) => ({
        id: n.id,
        ts: n.ts,
        kind: n.kind,
        text: n.text,
        ageRel: formatRelativeTime(n.ts),
      })),
      recentActions: rawLog,
      dashboard: dashboardCache,
      credits,
    };

    const stateText = renderForPrompt(state);
    return { state, stateText };
  }

  function renderForPrompt(state) {
    const lines = [];
    lines.push('═══ FILO STATE ═══', '');
    // TEMPO
    lines.push('TEMPO');
    lines.push(`Data: ${state.time.humanNow}`);
    if (state.time.timeSinceLastInteractionMin != null) {
      const m = state.time.timeSinceLastInteractionMin;
      lines.push(`Ultima interazione: ${m <= 1 ? 'ora' : `${m} min fa`}`);
    }
    if (state.time.session) {
      lines.push(`Inizio sessione: ${formatDate(state.time.session.startedAt)} (${state.time.session.ageMin} min fa, ${state.time.session.count} interazioni)`);
    }
    lines.push('');
    // CREDITI — se l'utente chiede quanti crediti gli restano, rispondi con
    // questo saldo (si ricarica di DAILY_REFILL ogni giorno a mezzanotte: letto
    // dal valore in vigore, non scritto a mano, così resta veritiero se cambia).
    if (state.credits) {
      const refill = global.SN_CONST?.CREDIT?.DAILY_REFILL ?? 100;
      lines.push('CREDITI');
      lines.push(`Saldo: ${state.credits.balance} crediti (si ricaricano di ${refill} ogni giorno a mezzanotte)`);
      lines.push('');
    }
    // TAB APERTE
    lines.push('TAB APERTE');
    if (!state.tabs.length) lines.push('(nessuna)');
    else {
      const top = state.tabs.slice(0, 12);
      top.forEach((t, i) => {
        const focus = t.active ? '[FOCUS] ' : '';
        const rel = t.lastAccessed ? ` (ultima attività: ${formatRelativeTime(new Date(t.lastAccessed))})` : '';
        const title = (t.title || '').slice(0, 80) || '(senza titolo)';
        lines.push(`${i + 1}. ${focus}${title}${rel}`);
      });
      if (state.tabs.length > 12) lines.push(`...altre ${state.tabs.length - 12} tab`);
    }
    lines.push('');
    // PROCESSI
    lines.push('PROCESSI ATTIVI');
    if (!state.timers.length) lines.push('(nessuno)');
    else {
      state.timers.forEach((t) => {
        if (t.kind === 'alarm') {
          // #322 — le sveglie si descrivono con l'orario assoluto, non col
          // countdown (che per una sveglia a ore di distanza confonderebbe).
          const d = new Date(t.endsAt);
          const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          lines.push(`- Sveglia${t.label ? ` "${t.label}"` : ''}: suona alle ${hhmm}`);
        } else {
          const rem = t.paused ? '(in pausa)' : `${Math.floor(t.remainingSec / 60)}m ${t.remainingSec % 60}s rimanenti`;
          lines.push(`- Timer "${t.label}": ${rem}`);
        }
      });
    }
    lines.push('');
    // NOTIFICHE
    lines.push('NOTIFICHE NON GESTITE');
    if (!state.notifications.length) lines.push('(nessuna)');
    else state.notifications.forEach((n) => lines.push(`- [${n.ageRel}] ${n.kind}: ${n.text}`));
    lines.push('');
    // AZIONI RECENTI
    lines.push('AZIONI RECENTI (ultime 24h)');
    if (!state.recentActions.length) lines.push('(nessuna)');
    else {
      state.recentActions.slice(0, 30).forEach((a) => {
        lines.push(`- [${formatRelativeTime(a.ts)}] ${a.type}: ${a.summary}`);
      });
    }
    lines.push('');
    // DASHBOARD CORRENTE
    lines.push('DASHBOARD ATTUALE');
    if (state.dashboard) {
      lines.push(`Messaggio: "${(state.dashboard.message || '').slice(0, 200)}"`);
      if (state.dashboard.suggestions?.length) {
        lines.push('Suggerimenti:');
        state.dashboard.suggestions.slice(0, 8).forEach((s, i) => {
          lines.push(`${i + 1}. ${s.icon || '·'} | ${s.text || ''} (imp ${s.importance ?? '?'})`);
        });
      }
    } else {
      lines.push('(non ancora generata)');
    }
    return lines.join('\n');
  }

  global.SN_FILO_STATE = { assemble, renderForPrompt, formatRelativeTime, formatDate };
})(typeof globalThis !== 'undefined' ? globalThis : self);

// La risposta a un messaggio preciso (#1620), o a un suo passo (#2346): il riferimento che il messaggio dell'utente si
// porta dietro e come lo si ritrova nel filo. Logica pura: il disegno sta in src/pages/dashboard/dashboard-rispondi.js,
// come lo legge il modello in src/shared/filoContesto.js (conCitazioni). Sentinella: tests/unit/rispostaA.test.mjs.

(function (global) {
  'use strict';

  // Il messaggio citato si salva come posto nel filo (chat e indice), mai come copia: cancellata la sua chat, una citazione
  // in un'altra non lo tiene in vita. Il testo si salva solo di una bolla che il filo non ha (un errore, un avviso).
  // Un passo è `da`/`a` sul testo scritto del messaggio; `pos` è dove la citazione sta fra le parole dell'utente.
  const ID_CHAT = /^[\w.:-]{1,80}$/;
  // La bolla ne mostra due righe; il modello di solito l'ha ancora davanti, e oltre il tetto ha l'ora per ritrovarla.
  const ANTEPRIMA = 400;
  const PER_IL_MODELLO = 1200;
  // Quanto della bolla la pagina manda per ritrovarne il posto quando non lo sa ancora: una risposta intera.
  const PER_CERCARE = 50000;
  // Le citazioni di un messaggio: nessuno ne scrive tante, il tetto ferma solo un messaggio fabbricato.
  const MAX_CITAZIONI = 200;

  const testoDi = (v) => String(v == null ? '' : v);
  const piano = (s) => testoDi(s).replace(/\s+/g, ' ').trim();
  const intero = (v, min = 0) => (Number.isInteger(v) && v >= min ? v : null);

  function taglia(s, max) {
    const t = testoDi(s).trim();
    return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
  }

  // `da`/`a` di un passo e `pos`, quando ci sono e hanno senso: `pos` 0 è il caso di sempre e non si scrive.
  function segni(r) {
    const da = intero(r.da);
    const a = da != null && intero(r.a) != null && r.a > da ? r.a : null;
    const pos = intero(r.pos, 1);
    return { ...(a != null ? { da, a } : {}), ...(pos != null ? { pos } : {}) };
  }

  // Le citazioni di un messaggio, una o tante: salvate prima di #2346 erano un oggetto solo.
  function lista(r) {
    if (Array.isArray(r)) return r.slice(0, MAX_CITAZIONI);
    return r && typeof r === 'object' ? [r] : [];
  }

  // Quello che si salva col messaggio: `{ chat, i, ts, da, a, pos }`, o `{ testo, pos }` per una bolla che il filo non
  // ha. Altro, niente.
  function riferimento(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    const chat = typeof r.chat === 'string' && ID_CHAT.test(r.chat) ? r.chat : '';
    const i = intero(r.i);
    const s = segni(r);
    if (chat && i != null) {
      const ts = typeof r.ts === 'string' && Number.isFinite(Date.parse(r.ts)) ? r.ts : '';
      return { chat, i, ...(ts ? { ts } : {}), ...s };
    }
    const testo = taglia(r.testo, PER_IL_MODELLO);
    return testo ? { testo, ...(r.role === 'user' ? { role: 'user' } : {}), ...(s.pos ? { pos: s.pos } : {}) } : null;
  }

  // Come si salvano: un oggetto per una citazione sola (la forma di sempre), l'elenco per più. `null` se non c'è niente.
  function daSalvare(r) {
    const l = lista(r).map(riferimento).filter(Boolean);
    return !l.length ? null : l.length === 1 ? l[0] : l;
  }

  // Il posto nella chat del messaggio citato: quello che la pagina conosce se il testo è ancora quello, se no l'ultimo
  // dello stesso autore con lo stesso testo (la bolla appena scritta non ha ancora il suo posto). -1 se non c'è.
  // `role: 'user'` cerca fra i messaggi dell'utente, che si citano da sé (#2096).
  function posto(chat, { i = null, testo = '', role = 'filo' } = {}) {
    const msgs = chat && Array.isArray(chat.messages) ? chat.messages : [];
    const t = piano(testo);
    const valido = Number.isInteger(i) && i >= 0 && i < msgs.length && !!msgs[i];
    if (valido && (!t || piano(msgs[i].text) === t)) return i;
    const suo = (m) => (role === 'user' ? m.role === 'user' : m.role !== 'user');
    if (t) {
      for (let k = msgs.length - 1; k >= 0; k--) {
        const m = msgs[k];
        if (m && suo(m) && piano(m.text) === t) return k;
      }
    }
    return valido ? i : -1;
  }

  // Il passo scritto del messaggio, se il riferimento ne ha uno che sta ancora nel testo.
  function passoDi(testo, r) {
    const t = testoDi(testo);
    if (r.a == null || r.da >= t.length) return null;
    const p = t.slice(r.da, Math.min(r.a, t.length));
    return p.trim() ? p : null;
  }

  // La citazione come la vede chi la legge: `trovaChat(id)` dà la chat dal filo. Una chat che il filo non ha più (tolta o
  // nascosta) lascia la citazione senza testo: `manca`. Di un passo torna il testo del passo, con `passo: true`.
  function risolvi(ref, trovaChat, { max = ANTEPRIMA } = {}) {
    const r = riferimento(ref);
    if (!r) return null;
    const pos = r.pos ? { pos: r.pos } : {};
    if (r.testo != null) return { role: r.role === 'user' ? 'user' : 'filo', testo: taglia(r.testo, max), ...pos };
    let c = null;
    try { c = typeof trovaChat === 'function' ? trovaChat(r.chat) : null; } catch (_) { c = null; }
    const m = c && Array.isArray(c.messages) ? c.messages[r.i] : null;
    if (!m) return { ...r, manca: true };
    const passo = passoDi(m.text, r);
    return {
      chat: r.chat, i: r.i, ts: typeof m.ts === 'string' ? m.ts : (r.ts || ''),
      role: m.role === 'user' ? 'user' : 'filo',
      testo: taglia(passo != null ? passo : m.text, max),
      ...(passo != null ? { passo: true, da: r.da, a: r.a } : {}),
      ...pos,
      ...(typeof m.esterno === 'string' && m.esterno ? { esterno: m.esterno } : {}),
    };
  }
  function risolviTutte(ref, trovaChat, opts) {
    return lista(ref).map((r) => risolvi(r, trovaChat, opts)).filter(Boolean);
  }

  // Quello che la pagina manda: il posto se lo sa, e il testo della bolla per ritrovarlo o per stare al suo posto.
  function daPagina(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    const chat = typeof r.chat === 'string' && ID_CHAT.test(r.chat) ? r.chat : '';
    const i = intero(r.i);
    const testo = testoDi(r.testo).slice(0, PER_CERCARE);
    if (!chat && !testo.trim()) return null;
    return {
      ...(chat ? { chat } : {}), ...(i != null ? { i } : {}), testo, ...(r.role === 'user' ? { role: 'user' } : {}),
      ...(r.passo === true ? { passo: true } : {}), ...segni(r),
    };
  }
  const daPaginaTutte = (r) => lista(r).map(daPagina).filter(Boolean);

  // ── Dove sta un passo in un altro testo ─────────────────────────────────────
  // Lo stesso passo si legge in due forme: a schermo (senza asterischi, coi numeri degli elenchi disegnati dal CSS) e
  // scritto. Si confrontano lettere e cifre soltanto; se il passo intero non c'è, i suoi capi. `attesa`: quante lettere
  // e cifre precedono il passo nell'altra forma, per scegliere fra due punti uguali.
  const ALNUM = /[\p{L}\p{N}]/u;
  function scheletro(s) {
    const t = testoDi(s);
    let out = '';
    const idx = [];
    let k = 0;
    for (const ch of t) {
      if (ALNUM.test(ch)) {
        out += ch;
        for (let u = 0; u < ch.length; u++) idx.push(k + u);
      }
      k += ch.length;
    }
    return { s: out, idx };
  }
  const lettere = (s) => scheletro(s).s.length;
  function occorrenze(dove, cosa, max = 500) {
    const out = [];
    let p = dove.indexOf(cosa);
    while (p >= 0 && out.length < max) { out.push(p); p = dove.indexOf(cosa, p + 1); }
    return out;
  }
  const vicina = (occ, t) => occ.reduce((x, y) => (Math.abs(y - t) < Math.abs(x - t) ? y : x));
  // I capi si cercano lunghi, il più vicino possibile al bordo del passo; corti solo se lunghi non ce n'è.
  const CAPI = [[16, 8], [4]];
  const PROVE = 200;

  function trovaPasso(dove, cosa, attesa = 0) {
    const D = scheletro(dove);
    const C = scheletro(cosa).s;
    if (!C || !D.s) return null;
    let da = -1;
    let a = -1;
    const tutte = occorrenze(D.s, C);
    if (tutte.length) {
      da = vicina(tutte, attesa);
      a = da + C.length;
    } else {
      for (const K of CAPI) {
        if (K > C.length) continue;
        for (let i = 0; i + K <= C.length && i < PROVE && da < 0; i++) {
          const occ = occorrenze(D.s, C.slice(i, i + K));
          if (occ.length) da = vicina(occ, attesa + i);
        }
        if (da >= 0) break;
      }
      if (da < 0) return null;
      for (const K of CAPI) {
        if (K > C.length) continue;
        for (let j = C.length; j - K >= 0 && C.length - j < PROVE && a < 0; j--) {
          const occ = occorrenze(D.s, C.slice(j - K, j)).filter((p) => p >= da);
          if (occ.length) a = vicina(occ, da + j - K) + K;
        }
        if (a >= 0) break;
      }
      if (a <= da) return null;
    }
    let inizio = D.idx[da];
    let fine = D.idx[a - 1] + 1;
    // La punteggiatura ai capi del passo (un punto finale, le virgolette) resta sua, se c'è anche nell'altro testo.
    const pulito = testoDi(cosa).trim();
    const testa = (/^[^\p{L}\p{N}]*/u.exec(pulito) || [''])[0];
    const coda = (/[^\p{L}\p{N}]*$/u.exec(pulito) || [''])[0];
    if (testa && dove.slice(inizio - testa.length, inizio) === testa) inizio -= testa.length;
    if (coda && dove.startsWith(coda, fine)) fine += coda.length;
    return { da: inizio, a: fine, tutto: da === 0 && a === D.s.length };
  }

  global.SN_RISPOSTA_A = {
    ANTEPRIMA, PER_IL_MODELLO, PER_CERCARE, MAX_CITAZIONI,
    riferimento, daSalvare, lista, posto, risolvi, risolviTutte, daPagina, daPaginaTutte, taglia, trovaPasso, lettere,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

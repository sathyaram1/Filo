// Il quaderno delle memorie (#872): da quali tratti del filo nasce ogni riga della memoria, come il compattatore le
// cita e quando una riga tolta dall'utente non deve tornare. Logica pura: il disco lo tocca src/shared/filoMemory.js.
// Sentinella tests/unit/quaderno.test.mjs.

(function (global) {
  'use strict';

  const FONTI_MAX = 200;

  function norma(s) {
    return String(s == null ? '' : s).replace(/^\s*(?:\[[RL]\d+\]\s*)?[-•*]?\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // «L'utente» è il soggetto di quasi ogni lezione e quasi mai delle righe che il compattatore ne ricava.
  const VUOTE = new Set(['utente', 'filo']);
  function parole(s) {
    return new Set(norma(s).normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !VUOTE.has(w)));
  }

  // Due righe dicono la stessa cosa se le parole piene della più corta stanno quasi tutte nell'altra: il compattatore
  // riscrive le lezioni con parole sue e più brevi. Vale solo insieme alle fonti (tornaDaTolta), mai da sola.
  function simile(a, b) {
    if (norma(a) === norma(b)) return true;
    const pa = parole(a);
    const pb = parole(b);
    if (!pa.size || !pb.size) return false;
    let comuni = 0;
    for (const w of pa) if (pb.has(w)) comuni++;
    return comuni / Math.min(pa.size, pb.size) >= 0.75;
  }

  // Più stretta di `simile`: la riga riordinata dice la stessa cosa e non altro. Una riga che ne ha assorbite altre non
  // passa, così una correzione non cancella quello che il compattatore ci ha unito.
  function stessoSenso(a, b) {
    if (norma(a) === norma(b)) return true;
    const pa = parole(a);
    const pb = parole(b);
    if (!pa.size || !pb.size) return false;
    let comuni = 0;
    for (const w of pa) if (pb.has(w)) comuni++;
    return comuni / Math.max(pa.size, pb.size) >= 0.75;
  }

  // Le fonti sono id di eventi del filo: stringhe, senza doppioni. Il tetto è largo e non taglia in silenzio quelle
  // vecchie: tiene le prime (dove la nota è nata) e le ultime.
  function unisci(...liste) {
    const out = [];
    const viste = new Set();
    for (const l of liste) for (const id of Array.isArray(l) ? l : []) {
      if (typeof id !== 'string' || !id || viste.has(id)) continue;
      viste.add(id);
      out.push(id);
    }
    return out.length > FONTI_MAX ? [...out.slice(0, FONTI_MAX / 2), ...out.slice(-FONTI_MAX / 2)] : out;
  }

  const contenute = (fonti, dentro) => fonti.length > 0 && fonti.every((id) => dentro.includes(id));

  // Una riga tolta dall'utente non torna dallo stesso tratto: torna solo se qualcosa di nuovo nel filo la ridice.
  // Senza fonti (una riga riscritta a memoria dal compattatore) la tiene fuori il testo uguale.
  function tornaDaTolta(riga, fonti, tolte) {
    for (const t of Array.isArray(tolte) ? tolte : []) {
      const tf = Array.isArray(t.fonti) ? t.fonti : [];
      if (t.testo) {
        if (!simile(riga, t.testo)) continue;
        if (!fonti.length || contenute(fonti, tf)) return t;
      } else if (contenute(fonti, tf)) {
        return t;
      }
    }
    return null;
  }

  // `versione` sale a ogni cambio dell'utente: il compattatore applica la sua uscita solo sulla versione che ha letto.
  function metaVuota() {
    return { righe: {}, nascoste: [], versione: 0 };
  }

  function normaMeta(m) {
    const out = metaVuota();
    if (!m || typeof m !== 'object') return out;
    if (m.righe && typeof m.righe === 'object') {
      for (const [nome, l] of Object.entries(m.righe)) {
        if (!Array.isArray(l)) continue;
        out.righe[nome] = l.filter((r) => r && typeof r.testo === 'string')
          .map((r) => ({ testo: r.testo, fonti: unisci(r.fonti), nata: typeof r.nata === 'string' ? r.nata : null,
            ...(typeof r.corretta === 'string' ? { corretta: r.corretta } : {}) }));
      }
    }
    if (Array.isArray(m.nascoste)) {
      out.nascoste = m.nascoste.filter((n) => n && typeof n.id === 'string').map((n) => ({ ...n, fonti: unisci(n.fonti) }));
    }
    if (Number.isFinite(m.versione)) out.versione = m.versione;
    return out;
  }

  function metaDi(meta, nome, testo) {
    const l = meta && meta.righe && meta.righe[nome];
    if (!Array.isArray(l)) return null;
    const n = norma(testo);
    return l.find((r) => norma(r.testo) === n) || null;
  }

  function righeDi(testo) {
    return String(testo || '').split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  }

  // Il compattatore riceve ogni riga e ogni lezione con un segno ([R3], [L2]) e cita i segni da cui nasce ogni riga
  // che scrive: così le fonti passano dalle lezioni alle note senza che il modello veda un id del filo.
  function perCompattatore(memory, meta, lezioni) {
    const rif = new Map();
    const blocchi = [];
    let r = 0;
    for (const [nome, v] of Object.entries(memory || {})) {
      if (typeof v !== 'string') continue;
      const righe = righeDi(v);
      const testo = righe.map((riga) => {
        r += 1;
        const m = metaDi(meta, nome, riga);
        rif.set(`R${r}`, { riga: true, fonti: m ? m.fonti : [], nata: m ? m.nata : null, corretta: m && m.corretta ? m.corretta : null, testo: riga });
        return `[R${r}] ${riga}${m && m.corretta ? ' (scritta dall\'utente)' : ''}`;
      }).join('\n');
      blocchi.push(`${nome}:\n${testo || '(vuoto)'}`);
    }
    const testoLezioni = (Array.isArray(lezioni) ? lezioni : []).map((l, i) => {
      rif.set(`L${i + 1}`, { fonti: unisci(l && l.fonti), nata: l && typeof l.ts === 'string' ? l.ts : null, corretta: l && l.corretta ? l.corretta : null, testo: l && l.text });
      return `[L${i + 1}] ${l && l.text}`;
    }).join('\n');
    return { moduli: blocchi.join('\n\n'), lezioni: testoLezioni, rif };
  }

  const CODA_FONTI = /\s*\(\s*fonti?\s*:\s*([^)]*)\)\s*$/i;

  function primaData(...date) {
    const ok = date.filter((d) => typeof d === 'string' && Number.isFinite(Date.parse(d)));
    return ok.length ? ok.sort((a, b) => Date.parse(a) - Date.parse(b))[0] : null;
  }

  // Dalle righe che il compattatore ha scritto per un modulo: il testo pulito dai segni e, per ognuna, fonti e data di
  // nascita prese dai segni citati (o dalla riga identica di prima). Le righe che una tolta copre restano fuori.
  function leggiModulo(nome, testo, { rif, meta, tolte, ora }) {
    const righe = [];
    const scartate = [];
    for (const grezza of String(testo || '').split(/\r?\n/)) {
      let riga = grezza.trim();
      if (!riga) continue;
      const segni = [];
      const coda = riga.match(CODA_FONTI);
      if (coda) {
        riga = riga.slice(0, coda.index).trim();
        for (const s of coda[1].split(/[\s,;]+/)) if (/^[RL]\d+$/i.test(s)) segni.push(s.toUpperCase());
      }
      riga = riga.replace(/^\[[RL]\d+\]\s*/i, '').replace(/\s*\(scritta dall'utente\)\s*$/i, '').trim();
      if (!riga) continue;
      const citati = segni.map((s) => rif && rif.get(s)).filter(Boolean);
      const prima = metaDi(meta, nome, riga);
      const fonti = unisci(...citati.map((c) => c.fonti), prima ? prima.fonti : []);
      const nata = primaData(...citati.map((c) => c.nata), prima ? prima.nata : null)
        || (citati.length || prima ? null : ora);
      const daUtente = citati.find((c) => c.corretta && norma(c.testo) === norma(riga)) || (prima && prima.corretta ? prima : null);
      // Una riga che c'era già resta: il controllo vale per quelle che il compattatore scrive adesso.
      const nuova = !prima && !citati.some((c) => c.riga && norma(c.testo) === norma(riga));
      if (nuova && tornaDaTolta(riga, fonti, tolte)) { scartate.push(riga); continue; }
      righe.push({ testo: riga, fonti, nata, ...(daUtente ? { corretta: daUtente.corretta } : {}) });
    }
    return { righe, scartate };
  }

  // L'uscita intera del compattatore: `patch` per i moduli (solo testo, come prima) e `righe` per il quaderno.
  function leggiCompattatore(patch, { rif, meta, tolte, ora = new Date().toISOString() } = {}) {
    const testi = {};
    const righe = {};
    const scartate = [];
    for (const [nome, testo] of Object.entries(patch || {})) {
      const r = leggiModulo(nome, testo, { rif, meta, tolte, ora });
      testi[nome] = r.righe.map((x) => x.testo).join('\n');
      righe[nome] = r.righe;
      scartate.push(...r.scartate);
    }
    return { patch: testi, righe, scartate };
  }

  global.SN_QUADERNO = {
    FONTI_MAX, norma, simile, stessoSenso, contenute, unisci, tornaDaTolta, metaVuota, normaMeta, metaDi, righeDi, perCompattatore, leggiCompattatore,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

// Le attese fra feedback (#903): «aspetta #676, #663.2». Lettura dei numeri, rifiuti alla scrittura, stato di ciascuno.
// Non tocca la rete: chi scrive passa `risolvi` e `leggiAttese`. Gemello lato coda: functions/src/waits.js (filo-security).
// Test: tests/unit/feedbackAttese.test.mjs. Il campo: FEEDBACK-STATES.md.

(function (global) {
  'use strict';

  const CAMPO = 'waitsFor';
  const MAX = 20;
  const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
  const NUM_RE = /^#?(\d{1,7})(?:\.(\d{1,6}))?$/;
  // Il giro di attese si cerca fino in fondo; oltre questi documenti si rifiuta invece di scrivere un giro non visto.
  const MAX_VISITATI = 2000;
  // Parole che si scrivono fra i numeri e non sono numeri.
  const PAROLE = new Set(['e', 'and', 'aspetta', 'aspettano', 'aspettare']);

  const STATO = Object.freeze({
    FUSO: 'fuso', APERTO: 'aperto', CHIUSO: 'chiuso', CANCELLATO: 'cancellato', IGNOTO: 'ignoto',
  });
  const ETICHETTA = Object.freeze({
    fuso: 'fuso', aperto: 'non ancora fuso', chiuso: 'chiuso senza fusione', cancellato: 'cancellato', ignoto: 'stato non letto',
  });
  const CHIUSI_SENZA_FUSIONE = new Set(['archived', 'attack_confirmed', 'spam_confirmed']);

  /** «676», «#676», «676.0» → '676'; «#663.2» → '663.2'; altro → ''. */
  function normalizzaNumero(raw) {
    const m = NUM_RE.exec(String(raw == null ? '' : raw).trim());
    if (!m || Number(m[1]) < 1) return '';
    const sub = m[2] !== undefined ? Number(m[2]) : 0;
    return sub > 0 ? `${Number(m[1])}.${sub}` : String(Number(m[1]));
  }

  /**
   * I numeri scritti dall'owner («aspetta #676, #663.2», «676 663.2», un array). Doppioni tolti, mai un taglio.
   * @returns {{ ok: true, numeri: string[] } | { ok: false, motivo: string }}
   */
  function leggiNumeri(testo) {
    const grezzo = Array.isArray(testo) ? testo.join(' ') : String(testo == null ? '' : testo);
    const pezzi = grezzo.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
      .filter((s) => !PAROLE.has(s.toLowerCase()));
    const numeri = [];
    for (const p of pezzi) {
      const n = normalizzaNumero(p);
      if (!n) return { ok: false, motivo: `«${p.slice(0, 30)}» non è un numero di feedback` };
      if (!numeri.includes(n)) numeri.push(n);
    }
    if (numeri.length > MAX) {
      return { ok: false, motivo: `sono ${numeri.length} numeri: un feedback ne aspetta al più ${MAX}, togline ${numeri.length - MAX}` };
    }
    return { ok: true, numeri };
  }

  /** Le attese scritte su un feedback, ripulite: [{ id, num }] (id validi, senza doppioni). */
  function atteseDi(fb) {
    const raw = fb && fb[CAMPO];
    if (!Array.isArray(raw)) return [];
    const out = [];
    const visti = new Set();
    for (const w of raw) {
      const id = String((w && typeof w === 'object' ? w.id : w) || '').trim();
      if (!ID_RE.test(id) || visti.has(id)) continue;
      visti.add(id);
      out.push({ id, num: w && typeof w === 'object' ? normalizzaNumero(w.num) : '' });
    }
    return out;
  }

  /**
   * Lo stato di un aspettato: `doc` con lo stato leggibile, `{ missing: true }` se cancellato, undefined se non letto.
   * Fuso = done, o archived con resolvedInVersion (il done verificato dall'owner). Stessa regola della coda.
   */
  function statoAttesa(doc) {
    if (doc === undefined || doc === null) return STATO.IGNOTO;
    if (doc.missing) return STATO.CANCELLATO;
    const s = String(doc.status || '').trim();
    if (!s || s.startsWith('FENC')) return STATO.IGNOTO;
    if (s === 'done') return STATO.FUSO;
    if (s === 'archived' && String(doc.resolvedInVersion || '').trim()) return STATO.FUSO;
    if (CHIUSI_SENZA_FUSIONE.has(s)) return STATO.CHIUSO;
    return STATO.APERTO;
  }

  /** [{ id, num, stato }]. `trova(id)` → il documento noto, o undefined. */
  function statiDelleAttese(fb, trova) {
    const cerca = typeof trova === 'function' ? trova : () => undefined;
    return atteseDi(fb).map((w) => ({ id: w.id, num: w.num, stato: statoAttesa(cerca(w.id)) }));
  }

  /** Aspetta ancora almeno un feedback non fuso? Un aspettato mai letto conta come non fuso, come per la coda. */
  function aspettaAncora(fb, trova) {
    return statiDelleAttese(fb, trova).some((w) => w.stato !== STATO.FUSO);
  }

  function etichetta(w) {
    return w && w.num ? `#${w.num}` : 'un feedback senza numero';
  }

  /** «#676, #663.2». */
  function testoAttese(lista) {
    return (Array.isArray(lista) ? lista : []).map(etichetta).join(', ');
  }

  /**
   * Le attese da scrivere su `id`, controllate: esistono, non sono lui, non chiudono un giro, al più MAX.
   * `risolvi(num)` → id o null (non esiste; un guasto si lancia). `leggiAttese(ids)` → Map id → attese di quel
   * feedback (`atteseDi`). `num` = il numero di `id`, per i messaggi.
   * @returns {Promise<{ ok: true, attese: Array<{id,num}> } | { ok: false, motivo: string }>}
   */
  async function valida({ id, num = '', numeri, risolvi, leggiAttese }) {
    const lista = Array.isArray(numeri) ? numeri.map(normalizzaNumero) : [];
    if (lista.some((n) => !n)) return { ok: false, motivo: 'c’è un numero di feedback non valido' };
    if (lista.length > MAX) {
      return { ok: false, motivo: `sono ${lista.length} numeri: un feedback ne aspetta al più ${MAX}, togline ${lista.length - MAX}` };
    }
    const proprio = normalizzaNumero(num);
    const attese = [];
    for (const n of lista) {
      if (proprio && n === proprio) return { ok: false, motivo: `#${n} è questo stesso feedback: non può aspettare sé stesso` };
      // eslint-disable-next-line no-await-in-loop
      const altro = await risolvi(n);
      if (!altro) return { ok: false, motivo: `#${n} non esiste` };
      if (String(altro) === String(id)) return { ok: false, motivo: `#${n} è questo stesso feedback: non può aspettare sé stesso` };
      if (!attese.some((a) => a.id === String(altro))) attese.push({ id: String(altro), num: n });
    }
    if (!attese.length || !id) return { ok: true, attese };
    const giro = await cercaGiro(String(id), attese, leggiAttese);
    if (giro && giro.troppi) return { ok: false, motivo: `le attese a catena superano ${MAX_VISITATI} feedback: non so dire se chiudono un giro` };
    if (giro) {
      const io = proprio ? `#${proprio}` : 'questo feedback';
      const catena = giro.map((n) => (n ? `#${n}` : 'un feedback senza numero')).join(', che aspetta ');
      return { ok: false, motivo: `giro di attese: ${io} aspetterebbe ${catena}, che aspetta ${io}` };
    }
    return { ok: true, attese };
  }

  /** Il percorso (numeri) da un'attesa diretta fino a un feedback che aspetta `selfId`, o null. */
  async function cercaGiro(selfId, attese, leggiAttese) {
    const prima = new Map();
    let frontiera = [];
    for (const a of attese) {
      if (prima.has(a.id)) continue;
      prima.set(a.id, { da: null, num: a.num });
      frontiera.push(a.id);
    }
    const percorso = (id) => {
      const out = [];
      for (let x = id; x; x = prima.get(x).da) out.unshift(prima.get(x).num);
      return out;
    };
    while (frontiera.length) {
      // eslint-disable-next-line no-await-in-loop
      const mappa = await leggiAttese(frontiera.slice());
      const prossima = [];
      for (const id of frontiera) {
        const sue = mappa && typeof mappa.get === 'function' ? (mappa.get(id) || []) : [];
        for (const w of sue) {
          if (!w || !w.id) continue;
          if (w.id === selfId) return percorso(id);
          if (prima.has(w.id)) continue;
          prima.set(w.id, { da: id, num: w.num || '' });
          prossima.push(w.id);
          if (prima.size > MAX_VISITATI) return { troppi: true };
        }
      }
      frontiera = prossima;
    }
    return null;
  }

  global.SN_FB_ATTESE = {
    CAMPO, MAX, STATO, ETICHETTA,
    normalizzaNumero, leggiNumeri, atteseDi, statoAttesa, statiDelleAttese, aspettaAncora, etichetta, testoAttese, valida,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

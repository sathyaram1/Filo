// Logica pura della pagina Novità (filo://novita/): le versioni uscite del registro e il filtro per testo, che regge
// maiuscole, accenti e un errore di battitura. Non tocca il DOM; il registro è patchNotes.js.
// Prove: tests/unit/novita.test.mjs.

(function (global) {
  'use strict';

  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre',
    'ottobre', 'novembre', 'dicembre'];

  // Un carattere alla volta, così ogni posizione del testo piegato è la stessa dell'originale e l'evidenziazione
  // cade sulle lettere giuste.
  function piega(s) {
    const t = String(s == null ? '' : s);
    let out = '';
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      let f = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      if (c === '’' || c === '‘' || c === '`') f = "'";
      out += f.length === 1 ? f : c;
    }
    return out;
  }

  function dataLeggibile(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    const mese = MESI[Number(m[2]) - 1];
    return mese ? `${Number(m[3])} ${mese} ${m[1]}` : '';
  }

  // Le versioni che chi ha `current` ha davvero ricevuto, dalla più recente; il blocco della prossima no.
  function uscite(notes, current) {
    const PN = global.SN_PATCH_NOTES;
    const tutte = Array.isArray(notes) ? notes : (PN ? PN.NOTES : []);
    const cmp = PN ? PN.cmpVersion : (a, b) => (a === b ? 0 : (a < b ? -1 : 1));
    const riga = PN && PN.riga ? PN.riga : (r) => ({ testo: String(r), segnalazione: null });
    return tutte
      .filter((n) => n && n.version && (!current || cmp(n.version, current) <= 0))
      .slice()
      .sort((x, y) => cmp(y.version, x.version))
      .map((n) => ({
        version: String(n.version),
        date: String(n.date || ''),
        features: (n.features || []).map(riga).filter((r) => r.testo),
        fixes: (n.fixes || []).map(riga).filter((r) => r.testo),
      }));
  }

  // Le virgolette attorno a una parola non fanno parte di quello che si cerca; i punti dentro un numero di versione sì.
  function termini(query) {
    return piega(query).split(/\s+/)
      .map((t) => t.replace(/^[«»"'“”(),;:!?.]+|[«»"'“”(),;:!?.]+$/g, ''))
      .filter(Boolean)
      .filter((t, i, a) => a.indexOf(t) === i);
  }

  // Quanti errori si perdonano a una parola: nessuno sotto le quattro lettere, dove ogni parola ne somiglia a cento.
  function tolleranza(t) {
    if (t.length < 4) return 0;
    return t.length < 8 ? 1 : 2;
  }

  // Distanza di Damerau (scambio di due lettere vicine compreso), con l'uscita anticipata oltre `max`.
  function distanza(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let minRiga = i;
      for (let j = 1; j <= b.length; j++) {
        const costo = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur.push(v);
        if (v < minRiga) minRiga = v;
      }
      if (minRiga > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  // Una parola del testo somiglia al termine se lo somiglia lei o il suo inizio: «aggiorament» trova «aggiornamento».
  function somiglia(termine, parola, max) {
    if (parola.length < termine.length - max) return false;
    for (let l = termine.length - max; l <= termine.length + max; l++) {
      if (l < 1 || l > parola.length) continue;
      if (distanza(termine, parola.slice(0, l), max) <= max) return true;
    }
    return false;
  }

  function paroleDi(testo) {
    return testo.match(/[\p{L}\p{N}']+/gu) || [];
  }

  // Le versioni filtrate, con le sole righe che contengono tutti i termini. Un termine che nel registro non c'è mai
  // si cerca per somiglianza, e la risposta lo dice (`approssimati`): chi ha sbagliato una lettera trova lo stesso.
  function filtra(versioni, query) {
    const lista = Array.isArray(versioni) ? versioni : [];
    const ts = termini(query);
    if (!ts.length) return { versioni: lista, righe: contaRighe(lista), termini: [], approssimati: [] };

    const voci = [];
    for (const v of lista) {
      const intestazione = piega(`${v.version} ${dataLeggibile(v.date)}`);
      for (const tipo of ['features', 'fixes']) {
        for (const r of v[tipo]) voci.push({ v, tipo, r, testo: piega(r.testo), intestazione });
      }
    }
    const esatto = (t) => voci.some((x) => x.testo.includes(t) || x.intestazione.includes(t));
    let vocabolario = null;
    const regole = ts.map((t) => {
      if (esatto(t) || !tolleranza(t)) return { t, simili: null };
      // Le parole diverse del registro sono poche migliaia: la somiglianza si misura su quelle, non riga per riga.
      if (!vocabolario) vocabolario = new Set(voci.flatMap((x) => paroleDi(x.testo)));
      const simili = new Set();
      for (const p of vocabolario) if (somiglia(t, p, tolleranza(t))) simili.add(p);
      return { t, simili };
    });
    const prende = (x, reg) => (reg.simili
      ? paroleDi(x.testo).some((p) => reg.simili.has(p))
      : x.testo.includes(reg.t) || x.intestazione.includes(reg.t));

    const tenute = new Set(voci.filter((x) => regole.every((reg) => prende(x, reg))).map((x) => x.r));
    const out = lista
      .map((v) => ({ ...v, features: v.features.filter((r) => tenute.has(r)), fixes: v.fixes.filter((r) => tenute.has(r)) }))
      .filter((v) => v.features.length || v.fixes.length);
    return {
      versioni: out,
      righe: contaRighe(out),
      termini: regole.map((reg) => ({ termine: reg.t, simili: reg.simili ? [...reg.simili] : null })),
      approssimati: regole.filter((reg) => reg.simili).map((reg) => reg.t),
    };
  }

  function contaRighe(versioni) {
    return versioni.reduce((n, v) => n + v.features.length + v.fixes.length, 0);
  }

  // I tratti da evidenziare in una riga, come [inizio, fine) sul testo originale.
  function tratti(testo, ts) {
    const p = piega(testo);
    const out = [];
    for (const reg of ts || []) {
      if (reg.simili) {
        const re = /[\p{L}\p{N}']+/gu;
        let m;
        while ((m = re.exec(p))) if (reg.simili.includes(m[0])) out.push([m.index, m.index + m[0].length]);
      } else if (reg.termine) {
        let i = p.indexOf(reg.termine);
        while (i >= 0) { out.push([i, i + reg.termine.length]); i = p.indexOf(reg.termine, i + reg.termine.length); }
      }
    }
    return out.sort((a, b) => a[0] - b[0]);
  }

  // Il testo che si copia: lo stesso del recap condiviso, così una versione incollata si legge uguale.
  function testoVersione(v) {
    const righe = [`Filo ${v.version}${v.date ? ` (${dataLeggibile(v.date)})` : ''}`];
    if (v.features.length) { righe.push('', 'Nuove funzioni:'); for (const r of v.features) righe.push(`• ${r.testo}`); }
    if (v.fixes.length) { righe.push('', 'Correzioni:'); for (const r of v.fixes) righe.push(`• ${r.testo}`); }
    return righe.join('\n');
  }

  global.SN_NOVITA = { piega, dataLeggibile, uscite, termini, distanza, filtra, tratti, testoVersione };
})(typeof globalThis !== 'undefined' ? globalThis : self);

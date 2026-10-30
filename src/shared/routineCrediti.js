// I numeri dell'owner sui crediti delle routine (SPEC-DOMANDE.md §8.2), come li tiene il server (ownerCrediti):
// riserva di A, tetto di B, taratura, rinnovi. Logica pura: la scheda Routine → Crediti e il main rifiutano gli
// stessi valori; l'ultima parola resta al server. Prove: tests/unit/routineCrediti.test.mjs.

(function (global) {
  'use strict';

  const CHIAVI = Object.freeze(['riservaA', 'tettoB', 'usdPer100', 'rinnovoA', 'rinnovoB']);
  const RINNOVI = Object.freeze(['rinnovoA', 'rinnovoB']);
  // Gli stessi intervalli del server (crediti.validaNumeri): un rinnovo è un istante in millisecondi.
  const REGOLE = Object.freeze({
    riservaA: Object.freeze({ min: 0, max: 100, etichetta: 'Riserva di A' }),
    tettoB: Object.freeze({ min: 0, max: 100, etichetta: 'Tetto di B' }),
    usdPer100: Object.freeze({ min: 0.01, max: 1e6, etichetta: 'Taratura' }),
    rinnovoA: Object.freeze({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2100, 0, 1), etichetta: 'Rinnovo di A' }),
    rinnovoB: Object.freeze({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2100, 0, 1), etichetta: 'Rinnovo di B' }),
  });
  const TARATURA_PREDEFINITA = 2150;

  function numero(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v.trim().replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  /** I numeri come li manda il server: un numero assente vale `null` (nessuna riserva, taratura e rinnovo predefiniti). */
  function leggiNumeri(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const k of CHIAVI) out[k] = numero(d[k]);
    return out;
  }

  function dueCifre(n) { return String(n).padStart(2, '0'); }

  /** Un istante come lo vuole un campo `datetime-local`, nell'ora di questo computer. */
  function aOraLocale(ms) {
    const n = numero(ms);
    if (n === null) return '';
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${dueCifre(d.getMonth() + 1)}-${dueCifre(d.getDate())}T${dueCifre(d.getHours())}:${dueCifre(d.getMinutes())}`;
  }

  /** Il valore di un campo `datetime-local` (ora di questo computer) in millisecondi; `null` se non è una data. */
  function daOraLocale(testo) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(testo || '').trim());
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }

  function cifra(n, decimali = 1) {
    try { return new Intl.NumberFormat('it-IT', { maximumFractionDigits: decimali, useGrouping: true }).format(n); } catch (_) { return String(n); }
  }

  /**
   * I soli campi ricevuti, controllati. Vuoto o `null` toglie il numero (torna il predefinito); un valore storto
   * NON si aggiusta in silenzio: si rifiuta dicendo l'intervallo. Un rinnovo arriva già in millisecondi
   * (daOraLocale), o come testo di un campo data.
   * @returns {{ok:true, valori:Object}|{ok:false, testo:string}}
   */
  function valida(patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    const valori = {};
    for (const k of CHIAVI) {
      if (!(k in p) || p[k] === undefined) continue;
      const v = p[k];
      if (v === null || (typeof v === 'string' && !v.trim())) { valori[k] = null; continue; }
      const r = REGOLE[k];
      const n = RINNOVI.includes(k) && typeof v === 'string' ? daOraLocale(v) : numero(v);
      if (n === null) {
        return { ok: false, testo: RINNOVI.includes(k) ? `${r.etichetta}: ci vuole un giorno e un'ora. Non salvato.` : `${r.etichetta}: ci vuole un numero. Non salvato.` };
      }
      if (n < r.min || n > r.max) {
        const intervallo = RINNOVI.includes(k) ? 'fra il 2020 e il 2100' : `da ${cifra(r.min, 2)} a ${cifra(r.max, 0)}`;
        return { ok: false, testo: `${r.etichetta}: ${intervallo}. Non salvato.` };
      }
      valori[k] = n;
    }
    if (!Object.keys(valori).length) return { ok: false, testo: 'Non c’è niente da salvare.' };
    return { ok: true, valori };
  }

  const FMT_RINNOVO = (() => {
    try { return new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return null; }
  })();
  function quando(ms) {
    const n = numero(ms);
    if (n === null) return '–';
    return FMT_RINNOVO ? FMT_RINNOVO.format(new Date(n)) : new Date(n).toISOString();
  }
  const pct = (v) => (numero(v) === null ? '–' : `${cifra(numero(v))}%`);

  const dollari = (n) => `${cifra(Math.round(n), 0)} $`;
  const conta = (v) => {
    const n = numero(v);
    return n === null || n < 0 ? null : Math.round(n);
  };

  /**
   * Una riga per account dallo stato del server: la settimana in percentuale e in dollari stimati, quanto resta prima
   * del freno, il passo di oggi, le ultime 24 ore, le accensioni, il rinnovo e perché è fermo. Un numero che il server
   * non ha dato resta un trattino o non compare, mai uno zero. Il dollaro di un punto viene dalla spesa della settimana
   * (tarata dal server) o, a settimana vuota, da `usdPer100`.
   */
  function rigaAccount(account, a, { usdPer100 = null } = {}) {
    const s = a && typeof a === 'object' ? a : {};
    const p = numero(s.pct);
    const usd = numero(s.usdSettimana);
    const per100 = usd !== null && p !== null && p > 0 ? (usd / p) * 100 : numero(usdPer100);
    const usdDi = (punti) => (per100 === null || punti === null ? null : (punti * per100) / 100);
    const sett = usd !== null ? usd : usdDi(p);
    const parti = [`${pct(s.pct)} della settimana${sett === null ? '' : ` (≈ ${dollari(sett)})`}${numero(s.limite) === null ? '' : `, limite ${pct(s.limite)}`}`];
    if (p !== null) {
      const resta = Math.max(0, (numero(s.limite) === null ? 100 : numero(s.limite)) - p);
      const usdResta = usdDi(resta);
      parti.push(`resta ${pct(resta)}${usdResta === null ? '' : ` (≈ ${dollari(usdResta)})`}`);
    }
    const passo = s.passo && typeof s.passo === 'object' ? s.passo : null;
    if (passo) parti.push(`oggi ${pct(passo.spesoPct)} su ${pct(passo.quotaPct)}`);
    if (numero(s.usd24h) !== null) parti.push(`ultime 24 ore ≈ ${dollari(numero(s.usd24h))}`);
    const accSett = conta(s.accensioniSettimana);
    const acc24 = conta(s.accensioni24h);
    if (accSett !== null || acc24 !== null) {
      parti.push(`accensioni: ${[accSett === null ? '' : `${accSett} in settimana`, acc24 === null ? '' : `${acc24} nelle ultime 24 ore`].filter(Boolean).join(', ')}`);
    }
    parti.push(`rinnova ${quando(s.rinnovoAtMs)}`);
    if (s.fermo === 'riserva') parti.push(account === 'A' ? 'fermo: riserva raggiunta' : 'fermo: tetto raggiunto');
    else if (s.fermo === 'passo') {
      const da = passo ? numero(passo.giornoDaMs) : null;
      parti.push(da === null ? 'fermo: quota di oggi spesa' : `fermo fino a ${quando(da + 24 * 60 * 60 * 1000)}`);
    }
    if (s.basseAperte === true) parti.push('ultime 24 ore: priorità basse aperte');
    return parti.join(' · ');
  }

  global.SN_ROUTINE_CREDITI = Object.freeze({
    CHIAVI, RINNOVI, REGOLE, TARATURA_PREDEFINITA,
    leggiNumeri, valida, aOraLocale, daOraLocale, rigaAccount,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);

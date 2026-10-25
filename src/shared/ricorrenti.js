// I compiti ricorrenti (SPEC-DOMANDE.md §4.1): la cadenza in ora italiana, la prossima istanza e il controllo di un
// ricorrente scritto dall'owner. Logica pura, fonte unica: il server la incorpora al deploy (filo-security
// tools/bake-shared.js), la scheda Routine → Compiti ricorrenti la usa. Prove: tests/unit/ricorrenti.test.mjs.

(function (global) {
  'use strict';

  const TZ = 'Europe/Rome';
  const GIORNI = Object.freeze(['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']);
  // Abbondanti e rifiutati col numero: il testo di un ricorrente è un ruolo intero (il più lungo di oggi ne ha 13.000).
  const TETTI = Object.freeze({ nome: 120, testo: 40000, domandaFineTurno: 4000 });
  const ORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const GIORNO_MS = 24 * 60 * 60 * 1000;

  const no = (errore, dettaglio) => ({ ok: false, errore, dettaglio });
  const testo = (v) => (typeof v === 'string' ? v : '');

  let formato = null;
  function partiRoma(ms) {
    if (!formato) {
      formato = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
      });
    }
    const p = {};
    for (const x of formato.formatToParts(new Date(ms))) p[x.type] = x.value;
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    return { anno: Number(p.year), mese: Number(p.month), giorno: Number(p.day), ora: Number(p.hour), minuto: Number(p.minute), secondo: Number(p.second), settimana: wd };
  }

  /**
   * L'istante (ms) di un'ora italiana. Roma sta a +2 o a +1: nell'ora che col cambio d'orario si ripete vale la
   * prima, in quella che salta vale l'ora dopo (02:30 → 03:30).
   */
  function daOraRoma(anno, mese, giorno, ora, minuto) {
    const voluto = Date.UTC(anno, mese - 1, giorno, ora, minuto);
    for (const scarto of [2, 1]) {
      const ms = voluto - scarto * 60 * 60 * 1000;
      const p = partiRoma(ms);
      if (Date.UTC(p.anno, p.mese - 1, p.giorno, p.ora, p.minuto) === voluto) return ms;
    }
    return voluto - 60 * 60 * 1000;
  }

  /** La cadenza ripulita: giorni 0 (domenica) … 6, in ordine e senza doppioni, e ora «HH:MM». */
  function validaCadenza(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    const giorni = Array.isArray(c.giorni) ? c.giorni : null;
    if (!giorni || !giorni.length) return no('giorni_mancanti', 'la cadenza ha almeno un giorno');
    if (giorni.some((g) => !Number.isInteger(g) || g < 0 || g > 6)) return no('giorni_non_validi', 'i giorni vanno da 0 (domenica) a 6 (sabato)');
    const ora = testo(c.ora).trim();
    if (!ORA_RE.test(ora)) return no('ora_non_valida', 'l’ora è nella forma 06:30, in ora italiana');
    return { ok: true, cadenza: { giorni: Array.from(new Set(giorni)).sort((a, b) => a - b), ora } };
  }

  /** La prossima istanza dopo `dopoMs`, strettamente dopo; 0 se la cadenza non vale. */
  function prossimaIl(cadenza, dopoMs) {
    const v = validaCadenza(cadenza);
    if (!v.ok || !Number.isFinite(Number(dopoMs))) return 0;
    const [hh, mm] = v.cadenza.ora.split(':').map(Number);
    const da = Number(dopoMs);
    for (let d = 0; d <= 8; d++) {
      const p = partiRoma(da + d * GIORNO_MS);
      if (!v.cadenza.giorni.includes(p.settimana)) continue;
      const ms = daOraRoma(p.anno, p.mese, p.giorno, hh, mm);
      if (ms > da) return ms;
    }
    return 0;
  }

  function elencoGiorni(giorni) {
    const nomi = giorni.map((g) => GIORNI[g]);
    return nomi.length === 1 ? nomi[0] : `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}`;
  }

  /** «ogni giorno alle 06:00», «il lunedì alle 01:00», «dal lunedì al venerdì alle 08:00», «lunedì e giovedì alle 09:30». */
  function cadenzaTesto(cadenza) {
    const v = validaCadenza(cadenza);
    if (!v.ok) return '';
    const { giorni, ora } = v.cadenza;
    if (giorni.length === 7) return `ogni giorno alle ${ora}`;
    if (giorni.join(',') === '1,2,3,4,5') return `dal lunedì al venerdì alle ${ora}`;
    if (giorni.length === 1) return `${giorni[0] === 0 ? 'la' : 'il'} ${GIORNI[giorni[0]]} alle ${ora}`;
    // La settimana dell'owner parte dal lunedì: la domenica va in fondo all'elenco.
    const ordinati = giorni.filter((g) => g !== 0).concat(giorni.includes(0) ? [0] : []);
    return `${elencoGiorni(ordinati)} alle ${ora}`;
  }

  /** «lun 26/10 06:00» in ora italiana, per la scheda. */
  function quandoTesto(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    const p = partiRoma(n);
    const due = (x) => String(x).padStart(2, '0');
    return `${GIORNI[p.settimana].slice(0, 3)} ${due(p.giorno)}/${due(p.mese)} ${due(p.ora)}:${due(p.minuto)}`;
  }

  /**
   * I campi propri di un ricorrente (nome, testo, cadenza, attivo, domanda di fine turno), controllati come li
   * controlla il server. Ambito, urgenza, modello e sforzo hanno le regole dei compiti: le controlla chi chiama.
   */
  function validaCampi(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return no('ricorrente_malformato', 'il ricorrente è un oggetto');
    const nome = testo(raw.nome).trim();
    const corpo = testo(raw.testo).trim();
    const domanda = testo(raw.domandaFineTurno).trim();
    if (!nome) return no('nome_mancante', 'il ricorrente vuole un nome');
    if (nome.length > TETTI.nome) return no('troppo_lungo', `il nome ha ${nome.length} caratteri, il massimo è ${TETTI.nome}`);
    if (!corpo) return no('testo_mancante', 'il ricorrente vuole il testo delle istruzioni');
    if (corpo.length > TETTI.testo) return no('troppo_lungo', `il testo ha ${corpo.length} caratteri, il massimo è ${TETTI.testo}`);
    if (domanda.length > TETTI.domandaFineTurno) return no('troppo_lungo', `la domanda di fine turno ha ${domanda.length} caratteri, il massimo è ${TETTI.domandaFineTurno}`);
    if (raw.attivo !== undefined && typeof raw.attivo !== 'boolean') return no('attivo_non_valido', 'attivo è vero o falso');
    const c = validaCadenza({ giorni: raw.giorni, ora: raw.ora });
    if (!c.ok) return c;
    return { ok: true, campi: { nome, testo: corpo, domandaFineTurno: domanda, attivo: raw.attivo !== false, giorni: c.cadenza.giorni, ora: c.cadenza.ora } };
  }

  global.SN_RICORRENTI = Object.freeze({
    TZ, GIORNI, TETTI, ORA_RE,
    partiRoma, daOraRoma, validaCadenza, prossimaIl, cadenzaTesto, quandoTesto, validaCampi,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);

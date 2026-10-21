// I contatori giornalieri (#969): cosa si conta, in che forma esce, e cosa non passa. Logica pura: niente disco né rete.
// Esce solo ciò che sta negli elenchi chiusi di questo file; le regole Firestore ne tengono la copia, e la sentinella
// tests/unit/firestoreRulesContatori.test.mjs le confronta. Misura e spedizione: src/main/services/contatori.js.

(function (global) {
  'use strict';

  const VERSIONE = 1;
  const COLLEZIONE = 'contatori-giornalieri';

  // Il tipo di guasto di una chiamata: l'elenco chiuso della decisione dell'owner (#969).
  const ERRORI = Object.freeze(['rete', 'tempo', 'crediti', 'chiave', 'nessun_host', 'fornitore']);
  const OS = Object.freeze(['win', 'mac', 'linux', 'altro']);
  // L'attesa in fasce, e non una mediana: le fasce di cento installazioni si sommano, le mediane no.
  const FASCE = Object.freeze([
    ['ms500', 500], ['s1', 1000], ['s2', 2000], ['s5', 5000], ['s10', 10000], ['s30', 30000], ['oltre', Infinity],
  ]);
  const NOMI_FASCE = Object.freeze(FASCE.map(([k]) => k));
  const CAMPI = Object.freeze(['v', 'pseudonimo', 'giorno', 'mese', 'app', 'os', 'uso', 'errori']);

  // Tetti larghi: per funzione in un giorno le combinazioni vere sono una o due; oltre si somma in «altro», detto.
  const TETTO_COMBINAZIONI = 50;
  const TETTO_GIORNI_IN_ATTESA = 62;
  const TETTO_INVII_PER_GIRO = 31;

  const MAX_CONTO = 999999999;
  const PSEUDONIMO_RE = /^[0-9a-f]{20}$/;
  const GIORNO_RE = /^20\d{2}-[01]\d-[0-3]\d$/;
  const APP_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
  // Un id di modello come lo scrive il router («fornitore/nome:variante»). Quello che non gli somiglia, compreso un
  // testo scritto a mano nelle Opzioni, esce come «altro».
  const MODELLO_RE = /^[a-z0-9][a-z0-9._-]{0,59}(?:\/[a-z0-9][a-z0-9._-]{0,79})?(?::[a-z0-9._-]{1,30})?$/;
  // Chi ha servito, come lo dichiara il router («DeepInfra», «Google Vertex»): mai scritto da chi usa Filo.
  const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}$/;
  const ALTRO = 'altro';
  // Le forme dei valori annidati del documento: le regole ne tengono la copia (la sentinella le confronta).
  const USO_FORMA = '^[0-9]{1,9};[0-9]{1,9}(,[0-9]{1,9}){6}$';
  const VOCE_ERRORE = `[a-z0-9._:/-]{1,120}[|][A-Za-z0-9 ._-]{0,48}[|](${ERRORI.join('|')})[|][0-9]{1,9}`;
  const ERRORI_FORMA = `^${VOCE_ERRORE}(;${VOCE_ERRORE})*$`;
  const USO_RE = new RegExp(USO_FORMA);
  const ERRORI_RE = new RegExp(ERRORI_FORMA);
  const TETTO_CARATTERI_USO = 80;
  // Una voce è al più 120 + 48 + 11 + 9 caratteri più i separatori: 190 per voce, con margine.
  const TETTO_CARATTERI_ERRORI = 190 * TETTO_COMBINAZIONI;

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const intero = (n) => Number.isInteger(n) && n >= 0;

  function censimento() {
    const U = global.SN_MODEL_USAGE;
    return (U && Array.isArray(U.ENTRIES)) ? U.ENTRIES : [];
  }

  // Le funzioni dell'app che usano un modello: quelle di chi usa Filo e quelle dell'owner che girano sul suo computer.
  // I punti del server (giudici, sanificatore) non passano di qui.
  function funzioni() {
    return censimento().filter((e) => (e.from === 'user' && e.ref) || (e.from === 'owner' && e.action)).map((e) => e.id);
  }

  function funzioneDi(action) {
    if (!action) return '';
    const e = censimento().find((x) => (x.from === 'user' && x.ref === action) || (x.from === 'owner' && x.action === action));
    return e ? e.id : '';
  }

  function fasciaDi(ms) {
    const v = Number(ms);
    if (!Number.isFinite(v) || v < 0) return '';
    const hit = FASCE.find(([, fino]) => v <= fino);
    return hit ? hit[0] : 'oltre';
  }

  function famigliaOs(platform) {
    if (platform === 'win32') return 'win';
    if (platform === 'darwin') return 'mac';
    if (platform === 'linux') return 'linux';
    return ALTRO;
  }

  function versioneApp(v) {
    const s = String(v || '').trim();
    return APP_RE.test(s) ? s : '0.0.0';
  }

  function modelloPulito(m) {
    const s = String(m || '').trim().toLowerCase();
    return s && s.length <= 120 && MODELLO_RE.test(s) ? s : ALTRO;
  }

  function hostPulito(h) {
    const s = String(h || '').trim();
    return HOST_RE.test(s) ? s : '';
  }

  // ── Il tipo di guasto ─────────────────────────────────────────────────────
  // Stesso ordine di SN_CHAT_ERRORS.friendly. `null`: non è un guasto di una chiamata (annullata da chi la usa, o mai
  // partita perché mancano chiave, modello o margine di spesa) e non si conta fra gli errori.
  const MAI_PARTITE = new Set(['NO_API_KEY', 'LIMIT_REACHED', 'NO_MODEL_FOR_ACTION', 'NO_OPEN_WEIGHTS_MODEL',
    'GATE_METHOD', 'PROVIDER_METHOD_MISSING', 'NO_KEY_INFO']);
  const SENZA_HOST = new Set(['NO_ALLOWED_HOST', 'DATA_POLICY', 'NO_PROVIDER_ALLOWED', 'MODEL_UNAVAILABLE', 'NO_TOOL_HOST']);
  const RETE_RE = /fetch failed|failed to fetch|network error|networkerror|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|EHOSTUNREACH|ENETUNREACH|ENETDOWN|socket hang up|other side closed/i;
  const TEMPO_RE = /ETIMEDOUT|timed out|timeout/i;

  function testoDi(err) {
    const own = String((err && err.message) || err || '');
    const c = err && err.cause;
    return c ? `${own} ${String(c.message || c.code || c)}` : own;
  }

  function tipoErrore(err) {
    if (!err) return null;
    const code = String(err.code || '');
    if (err.name === 'AbortError' || code === 'ABORT_ERR') return null;
    if (MAI_PARTITE.has(code)) return null;
    // Un modello che i crediti di Filo non pagano (#830) non è partito: conta solo la chiave propria che è stata rifiutata.
    if (code === 'NO_ALLOWED_HOST' && err.reason === 'crediti') return err.chiaveRifiutata ? 'chiave' : null;
    // Il produttore che non risponde (#829) porta il codice del «nessun host», ma è un guasto del servizio: si conta per status.
    if (SENZA_HOST.has(code) && err.reason !== 'produttore') return 'nessun_host';
    const W = global.SN_WALLET;
    const st = Number(err.status) || 0;
    if (st === 402 || (W && typeof W.isOutOfCredits === 'function' && W.isOutOfCredits(err))) return 'crediti';
    if (st === 401 || (W && typeof W.keyRefusalOf === 'function' && W.keyRefusalOf(err))) return 'chiave';
    if (err.name === 'TimeoutError' || st === 408 || st === 504 || st === 524) return 'tempo';
    if (!st) {
      const causa = String((err.cause && err.cause.code) || '');
      if (TEMPO_RE.test(code) || TEMPO_RE.test(causa)) return 'tempo';
      const t = testoDi(err);
      if (RETE_RE.test(code) || RETE_RE.test(causa) || RETE_RE.test(t)) return 'rete';
      if (TEMPO_RE.test(t)) return 'tempo';
    }
    return 'fornitore';
  }

  // ── Il giorno, in memoria ─────────────────────────────────────────────────
  // { uso: { funzione: { n, fasce: { fascia: n } } }, errori: { funzione: { 'modello|host|tipo': n } } }

  function giornoVuoto() { return { uso: {}, errori: {} }; }

  function normaleGiorno(g) {
    const d = g && typeof g === 'object' ? g : {};
    return {
      uso: d.uso && typeof d.uso === 'object' ? d.uso : {},
      errori: d.errori && typeof d.errori === 'object' ? d.errori : {},
    };
  }

  // Un uso della funzione. `attesaMs` è l'attesa fino alla prima risposta visibile; null se non ne è arrivata una.
  function registraUso(giorno, funzione, attesaMs) {
    if (!funzioni().includes(funzione)) return false;
    const g = normaleGiorno(giorno);
    const u = has(g.uso, funzione) && g.uso[funzione] && typeof g.uso[funzione] === 'object' ? g.uso[funzione] : { n: 0, fasce: {} };
    u.n = (intero(u.n) ? u.n : 0) + 1;
    if (!u.fasce || typeof u.fasce !== 'object') u.fasce = {};
    const f = attesaMs == null ? '' : fasciaDi(attesaMs);
    if (f) u.fasce[f] = (intero(u.fasce[f]) ? u.fasce[f] : 0) + 1;
    g.uso[funzione] = u;
    giorno.uso = g.uso;
    giorno.errori = g.errori;
    return true;
  }

  function registraErrore(giorno, funzione, { modello, host, tipo } = {}) {
    if (!funzioni().includes(funzione) || !ERRORI.includes(tipo)) return false;
    const g = normaleGiorno(giorno);
    const per = has(g.errori, funzione) && g.errori[funzione] && typeof g.errori[funzione] === 'object' ? g.errori[funzione] : {};
    let chiave = `${modelloPulito(modello)}|${hostPulito(host)}|${tipo}`;
    // Il posto per le sei righe «altro» (una per tipo) resta sempre libero: oltre il tetto non si perde niente.
    const specifiche = Object.keys(per).filter((k) => !k.startsWith(`${ALTRO}||`)).length;
    if (!has(per, chiave) && specifiche >= TETTO_COMBINAZIONI - ERRORI.length) chiave = `${ALTRO}||${tipo}`;
    per[chiave] = (intero(per[chiave]) ? per[chiave] : 0) + 1;
    g.errori[funzione] = per;
    giorno.uso = g.uso;
    giorno.errori = g.errori;
    return true;
  }

  // ── Il documento che esce ─────────────────────────────────────────────────
  // Si ricostruisce dagli elenchi chiusi, non si copia: un disco manomesso o un campo nuovo non arrivano al server.

  // Ogni valore annidato esce come UNA stringa di forma fissa: le regole Firestore non sanno passare in rassegna una
  // mappa o una lista, una stringa sì (tipo, lunghezza, espressione regolare). Così il server tiene fuori il testo libero.
  // Uso: «n;f1,…,f7», gli usi e le attese nelle fasce di NOMI_FASCE, in quell'ordine.
  function usoPulito(uso) {
    const out = {};
    const ammesse = funzioni();
    for (const f of ammesse) {
      const u = uso && has(uso, f) ? uso[f] : null;
      if (!u || !intero(u.n) || u.n === 0) continue;
      const n = Math.min(u.n, MAX_CONTO);
      let somma = 0;
      const fasce = NOMI_FASCE.map((k) => {
        const v = u.fasce && has(u.fasce, k) ? u.fasce[k] : 0;
        if (!intero(v) || v === 0 || somma + v > n) return 0;
        somma += v;
        return v;
      });
      out[f] = `${n};${fasce.join(',')}`;
    }
    return out;
  }

  // Errori: «modello|host|tipo|n» separati da «;», al più TETTO_COMBINAZIONI per funzione.
  function erroriPuliti(errori) {
    const out = {};
    for (const f of funzioni()) {
      const per = errori && has(errori, f) ? errori[f] : null;
      if (!per || typeof per !== 'object') continue;
      const lista = [];
      for (const [chiave, n] of Object.entries(per)) {
        if (!intero(n) || n === 0) continue;
        const [m, h, t] = String(chiave).split('|');
        if (!ERRORI.includes(t)) continue;
        lista.push(`${modelloPulito(m)}|${hostPulito(h)}|${t}|${Math.min(n, MAX_CONTO)}`);
        if (lista.length >= TETTO_COMBINAZIONI) break;
      }
      if (lista.length) out[f] = lista.join(';');
    }
    return out;
  }

  // Il contrario, per chi legge i documenti: { n, fasce: { fascia: n } } e [{ modello, host, tipo, n }].
  function leggiUso(s) {
    if (!USO_RE.test(String(s))) return null;
    const [n, resto] = String(s).split(';');
    const fasce = {};
    resto.split(',').forEach((v, i) => { if (Number(v) > 0) fasce[NOMI_FASCE[i]] = Number(v); });
    return { n: Number(n), fasce };
  }

  function leggiErrori(s) {
    if (!ERRORI_RE.test(String(s))) return null;
    return String(s).split(';').map((v) => {
      const [modello, host, tipo, n] = v.split('|');
      return { modello, host, tipo, n: Number(n) };
    });
  }

  function meseDi(giorno) { return String(giorno || '').slice(0, 7); }

  function documento({ pseudonimo, giorno, app, os, dati }) {
    const d = normaleGiorno(dati);
    return {
      v: VERSIONE,
      pseudonimo: String(pseudonimo || ''),
      giorno: String(giorno || ''),
      mese: meseDi(giorno),
      app: versioneApp(app),
      os: OS.includes(os) ? os : ALTRO,
      uso: usoPulito(d.uso),
      errori: erroriPuliti(d.errori),
    };
  }

  function idDocumento(doc) { return `${doc.pseudonimo}_${doc.giorno}`; }

  // La stessa forma che chiedono le regole, e in più che le fasce non superino gli usi.
  function valida(doc) {
    const no = (motivo) => ({ ok: false, motivo });
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return no('non è un documento');
    const chiavi = Object.keys(doc);
    if (chiavi.length !== CAMPI.length || !CAMPI.every((k) => has(doc, k))) return no(`campi: ${chiavi.join(',')}`);
    if (doc.v !== VERSIONE) return no('versione');
    if (!PSEUDONIMO_RE.test(String(doc.pseudonimo))) return no('pseudonimo');
    if (!GIORNO_RE.test(String(doc.giorno)) || doc.mese !== meseDi(doc.giorno)) return no('giorno');
    if (!APP_RE.test(String(doc.app))) return no('versione dell\'app');
    if (!OS.includes(doc.os)) return no('sistema');
    const ammesse = funzioni();
    if (!doc.uso || typeof doc.uso !== 'object' || Array.isArray(doc.uso)) return no('uso');
    for (const [f, u] of Object.entries(doc.uso)) {
      if (!ammesse.includes(f)) return no(`funzione ${f}`);
      if (typeof u !== 'string' || u.length > TETTO_CARATTERI_USO) return no(`uso di ${f}`);
      const letto = leggiUso(u);
      if (!letto) return no(`uso di ${f}`);
      if (Object.values(letto.fasce).reduce((a, n) => a + n, 0) > letto.n) return no(`fasce di ${f} oltre gli usi`);
    }
    if (!doc.errori || typeof doc.errori !== 'object' || Array.isArray(doc.errori)) return no('errori');
    for (const [f, e] of Object.entries(doc.errori)) {
      if (!ammesse.includes(f)) return no(`funzione ${f}`);
      if (typeof e !== 'string' || e.length > TETTO_CARATTERI_ERRORI) return no(`errori di ${f}`);
      const lista = leggiErrori(e);
      if (!lista || lista.length > TETTO_COMBINAZIONI || lista.some((x) => x.n === 0)) return no(`errori di ${f}`);
    }
    return { ok: true, motivo: '' };
  }

  // ── Giorni e pseudonimo ───────────────────────────────────────────────────

  function due(n) { return String(n).padStart(2, '0'); }

  // Il giorno di chi usa Filo, nel suo fuso: «ieri» è il giorno che ha vissuto lui.
  function giornoDi(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`;
  }

  function giornoPrima(giorno) {
    const [y, m, d] = String(giorno).split('-').map(Number);
    const t = new Date(y, m - 1, d - 1);
    return giornoDi(t.getTime());
  }

  // I giorni chiusi da spedire, dal più vecchio, al più `tetto`.
  function daInviare(giorni, oggi, tetto = TETTO_INVII_PER_GIRO) {
    return Object.keys(giorni || {}).filter((g) => GIORNO_RE.test(g) && g < oggi).sort().slice(0, Math.max(0, tetto));
  }

  // Oltre il tetto si lasciano andare i giorni più vecchi: sono quelli che il server rifiuta da settimane.
  function potaGiorni(giorni, tetto = TETTO_GIORNI_IN_ATTESA) {
    const tutti = Object.keys(giorni || {}).filter((g) => GIORNO_RE.test(g)).sort();
    const via = tutti.slice(0, Math.max(0, tutti.length - tetto));
    for (const g of via) delete giorni[g];
    for (const k of Object.keys(giorni || {})) if (!GIORNO_RE.test(k)) delete giorni[k];
    return via;
  }

  // Lo pseudonimo è del MESE DEL GIORNO che si spedisce, non di quando parte: l'ultimo giorno di ottobre parte a
  // novembre, e con lo pseudonimo di novembre la stessa copia di Filo conterebbe due volte in ottobre. Uno nuovo nasce
  // alla prima spedizione di un mese; diverso per costruzione dal codice dei feedback e dallo pseudonimo dei crediti.
  function pseudonimoDelMese(pseudonimi, mese, { casuale, esclusi = [] } = {}) {
    const p = pseudonimi && typeof pseudonimi === 'object' ? { ...pseudonimi } : {};
    if (has(p, mese) && PSEUDONIMO_RE.test(String(p[mese]))) return { pseudonimi: p, id: p[mese], nuovo: false };
    const vietati = new Set([...esclusi.map((x) => String(x || '').toLowerCase()), ...Object.values(p)]);
    let id = '';
    for (let i = 0; i < 8 && (!PSEUDONIMO_RE.test(id) || vietati.has(id)); i++) id = String(casuale ? casuale() : '').toLowerCase();
    if (!PSEUDONIMO_RE.test(id) || vietati.has(id)) throw new Error('pseudonimo dei contatori non generato');
    p[mese] = id;
    // Si tengono gli ultimi tre mesi: bastano per i giorni ancora in attesa, e un mese vecchio non si ricuce al nuovo.
    for (const k of Object.keys(p).sort().slice(0, Math.max(0, Object.keys(p).length - 3))) delete p[k];
    return { pseudonimi: p, id, nuovo: true };
  }

  global.SN_CONTATORI = {
    VERSIONE, COLLEZIONE, ERRORI, OS, FASCE, NOMI_FASCE, CAMPI,
    TETTO_COMBINAZIONI, TETTO_GIORNI_IN_ATTESA, TETTO_INVII_PER_GIRO,
    PSEUDONIMO_RE, GIORNO_RE, APP_RE, MODELLO_RE, HOST_RE, USO_RE, ERRORI_RE, USO_FORMA, ERRORI_FORMA, TETTO_CARATTERI_USO, TETTO_CARATTERI_ERRORI,
    funzioni, funzioneDi, fasciaDi, famigliaOs, versioneApp, modelloPulito, hostPulito, tipoErrore,
    giornoVuoto, registraUso, registraErrore, documento, idDocumento, valida, leggiUso, leggiErrori,
    giornoDi, giornoPrima, meseDi, daInviare, potaGiorni, pseudonimoDelMese,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

// I contatori giornalieri (#969): misura le chiamate ai modelli che passano dal cancello, le tiene per giorno sul disco
// e spedisce una volta al giorno i giorni chiusi. In incognito e a contatori spenti non conta e non spedisce; spenti,
// butta anche quello che aveva. Cosa esce e in che forma: src/shared/contatoriGiornalieri.js.

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

const CHIAVE = 'contatoriGiornalieri';
const PRIMO_CONTROLLO_MS = 60 * 1000;
const CONTROLLO_OGNI_MS = 60 * 60 * 1000;
const SALVA_DOPO_MS = 3000;
const ATTESA_RETE_MS = 20000;
// La lettura dell'owner: mille pseudonimi a pagina, e duecento pagine prima di dire «almeno».
const PAGINA_LETTURA = 1000;
const TETTO_PAGINE = 200;

const MUTO = Object.freeze({ visto() {}, errore() {}, fine() {} });

function valoreFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valoreFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valoreFs(x)])) } };
}

function statoVuoto() { return { giorni: {}, pseudonimi: {}, fallitoIl: '', ultimo: null, errore: '' }; }

function normale(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    giorni: o.giorni && typeof o.giorni === 'object' ? o.giorni : {},
    pseudonimi: o.pseudonimi && typeof o.pseudonimi === 'object' ? o.pseudonimi : {},
    fallitoIl: typeof o.fallitoIl === 'string' ? o.fallitoIl : '',
    ultimo: o.ultimo && typeof o.ultimo === 'object' ? o.ultimo : null,
    errore: typeof o.errore === 'string' ? o.errore : '',
  };
}

function crea(dip = {}) {
  const C = dip.contatori || globalThis.SN_CONTATORI;
  const disco = () => require('../shim/storage');
  const storage = dip.storage || globalThis.SN_STORAGE;
  const impostazioni = dip.impostazioni || (() => storage.getSettings());
  const inIncognito = dip.inIncognito || (() => disco().inIncognito());
  const runNormale = dip.runNormale || ((fn) => disco().runNormale(fn));
  const fetchFn = dip.fetch || ((...a) => fetch(...a));
  const adesso = dip.adesso || (() => Date.now());
  const versione = dip.versione || (() => require('electron').app.getVersion());
  const piattaforma = dip.piattaforma || process.platform;
  // Gli identificativi che lo pseudonimo non deve mai ripetere: il codice dei feedback e lo pseudonimo dei crediti.
  const esclusi = dip.esclusi || (async () => []);
  const casuale = dip.casuale || (() => crypto.randomBytes(10).toString('hex'));
  const rest = dip.rest || (() => (globalThis.SN_FEEDBACK && globalThis.SN_FEEDBACK.rest) || {});
  const log = dip.log || ((...a) => console.warn('[contatori]', ...a));

  const usoCorrente = new AsyncLocalStorage();
  let stato = null;
  let carico = null;
  let timerSalva = null;
  let giroInVolo = null;

  function carica() {
    if (!carico) {
      carico = (async () => {
        let s = null;
        try { s = await runNormale(() => storage.getRaw(CHIAVE, null)); } catch (_) { s = null; }
        stato = normale(s);
      })();
    }
    return carico;
  }

  async function salva() {
    if (timerSalva) { clearTimeout(timerSalva); timerSalva = null; }
    if (!stato) return;
    try { await runNormale(() => storage.setRaw(CHIAVE, stato)); } catch (e) { log('stato non salvato', String((e && e.message) || e)); }
  }

  function salvaPresto() {
    if (timerSalva) return;
    timerSalva = setTimeout(() => { timerSalva = null; salva().catch(() => {}); }, SALVA_DOPO_MS);
    if (timerSalva && typeof timerSalva.unref === 'function') timerSalva.unref();
  }

  // Nel dubbio spenti: un'impostazione che non si legge non vale come un sì.
  async function accesi() {
    try {
      const s = await impostazioni();
      return Boolean(s) && !(s.contatori && s.contatori.attivi === false);
    } catch (_) { return false; }
  }

  async function azzera() {
    await carica();
    const c = stato;
    if (!Object.keys(c.giorni).length && !Object.keys(c.pseudonimi).length && !c.ultimo && !c.fallitoIl) return false;
    stato = statoVuoto();
    await salva();
    return true;
  }

  function giornoDiOggi() {
    const oggi = C.giornoDi(adesso());
    if (!stato.giorni[oggi]) stato.giorni[oggi] = { ...C.giornoVuoto(), app: C.versioneApp(versione()) };
    return stato.giorni[oggi];
  }

  async function registra(funzione, attesaMs, errori) {
    if (!(await accesi())) { await azzera(); return; }
    await carica();
    const g = giornoDiOggi();
    C.registraUso(g, funzione, attesaMs);
    for (const e of errori) C.registraErrore(g, funzione, e);
    salvaPresto();
  }

  function errorePer(lista) {
    return (err, { modello = '', host = '' } = {}) => {
      const tipo = C.tipoErrore(err);
      if (tipo) lista.push({ modello, host, tipo });
    };
  }

  // Un uso che raccoglie più chiamate della stessa funzione: un messaggio di chat con i suoi giri di strumenti, una
  // dettatura coi suoi ripieghi. L'attesa parte da quando è partito l'uso, non dall'ultima chiamata.
  async function unUso(action, fn) {
    const funzione = C.funzioneDi(action);
    if (!funzione || inIncognito() || usoCorrente.getStore()?.funzione === funzione) return fn();
    const uso = { funzione, t0: adesso(), visto: null, errori: [], chiamate: 0 };
    try {
      return await usoCorrente.run(uso, fn);
    } finally {
      if (uso.chiamate > 0) registra(funzione, uso.visto, uso.errori).catch(() => {});
    }
  }

  // Il cancello chiama `apri` a ogni chiamata; `visto` alla prima cosa che arriva a schermo, `errore` a ogni tentativo
  // fallito, `fine` una volta. Non lancia mai: un contatore rotto non ferma una risposta.
  function apri(action) {
    try {
      const funzione = C.funzioneDi(action);
      if (!funzione || inIncognito()) return MUTO;
      const uso = usoCorrente.getStore();
      if (uso && uso.funzione === funzione) {
        uso.chiamate += 1;
        return {
          visto() { if (uso.visto == null) uso.visto = adesso() - uso.t0; },
          errore: errorePer(uso.errori),
          fine(ok) { if (ok && uso.visto == null) uso.visto = adesso() - uso.t0; },
        };
      }
      const t0 = adesso();
      const errori = [];
      let visto = null;
      let chiuso = false;
      return {
        visto() { if (visto == null) visto = adesso() - t0; },
        errore: errorePer(errori),
        fine(ok) {
          if (chiuso) return;
          chiuso = true;
          if (ok && visto == null) visto = adesso() - t0;
          registra(funzione, visto, errori).catch(() => {});
        },
      };
    } catch (_) { return MUTO; }
  }

  async function spedisci(doc) {
    const { FIRESTORE_BASE, API_KEY } = rest();
    if (!FIRESTORE_BASE || !API_KEY) return { ok: false, motivo: 'server non configurato' };
    const url = `${FIRESTORE_BASE}/${C.COLLEZIONE}?documentId=${encodeURIComponent(C.idDocumento(doc))}&key=${API_KEY}`;
    const fields = Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, valoreFs(v)]));
    let res;
    try {
      res = await fetchFn(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
        signal: AbortSignal.timeout(ATTESA_RETE_MS),
      });
    } catch (e) {
      return { ok: false, motivo: `rete: ${String((e && e.message) || e).slice(0, 120)}` };
    }
    // 409: il giorno è già sul server (la risposta di un invio riuscito si era persa).
    if (res.ok || res.status === 409) return { ok: true };
    return { ok: false, motivo: `il server ha risposto ${res.status}` };
  }

  // Il giro: segna che oggi Filo è stato aperto, poi spedisce i giorni chiusi dal più vecchio. Un rifiuto ferma il
  // giro fino a domani; i giorni restano in attesa, al più TETTO_GIORNI_IN_ATTESA.
  async function giro() {
    if (!(await accesi())) { await azzera(); return 'spenti'; }
    await carica();
    const oggi = C.giornoDi(adesso());
    giornoDiOggi();
    const persi = C.potaGiorni(stato.giorni);
    if (persi.length) log(`${persi.length} giorni mai partiti lasciati andare (dal ${persi[0]} al ${persi[persi.length - 1]})`);
    if (stato.fallitoIl === oggi) { await salva(); return 'rimandato'; }
    let esito = 'niente';
    for (const g of C.daInviare(stato.giorni, oggi)) {
      if (!(await accesi())) { await azzera(); return 'spenti'; }
      let id;
      try {
        const scelto = C.pseudonimoDelMese(stato.pseudonimi, C.meseDi(g), { casuale, esclusi: await esclusi() });
        stato.pseudonimi = scelto.pseudonimi;
        id = scelto.id;
      } catch (e) { log(String((e && e.message) || e)); esito = 'fallito'; break; }
      const dati = stato.giorni[g];
      const doc = C.documento({ pseudonimo: id, giorno: g, app: (dati && dati.app) || versione(), os: C.famigliaOs(piattaforma), dati });
      const v = C.valida(doc);
      if (!v.ok) {
        log(`il giorno ${g} non parte: ${v.motivo}`);
        delete stato.giorni[g];
        continue;
      }
      const r = await spedisci(doc);
      if (!r.ok) {
        stato.fallitoIl = oggi;
        stato.errore = r.motivo;
        log(`invio del ${g} non riuscito (${r.motivo}): si riprova domani`);
        esito = 'fallito';
        break;
      }
      delete stato.giorni[g];
      stato.ultimo = { giorno: g, at: adesso() };
      stato.errore = '';
      esito = 'inviati';
    }
    await salva();
    return esito;
  }

  function controlla() {
    if (!giroInVolo) {
      giroInVolo = giro().catch((e) => { log('giro non riuscito', String((e && e.message) || e)); return 'errore'; })
        .finally(() => { giroInVolo = null; });
    }
    return giroInVolo;
  }

  let avviato = false;
  function avvia() {
    if (avviato) return;
    avviato = true;
    const t = setTimeout(() => { controlla(); }, PRIMO_CONTROLLO_MS);
    if (t && typeof t.unref === 'function') t.unref();
    const i = setInterval(() => { controlla(); }, CONTROLLO_OGNI_MS);
    if (i && typeof i.unref === 'function') i.unref();
  }

  // Spenti dalle Preferenze o a parole: quello che c'era non parte più.
  function seguiImpostazioni(s) {
    if (s && s.contatori && s.contatori.attivi === false) azzera().catch(() => {});
  }

  // ── La lettura dell'owner ───────────────────────────────────────────────
  // Quante copie di Filo hanno spedito i contatori di un giorno o di un mese: pseudonimi distinti. Uno pseudonimo
  // vale un mese, quindi nel mese una copia conta una volta. Chiede solo il campo dello pseudonimo.
  async function distinti(idToken, campo, valore) {
    const { FIRESTORE_BASE, API_KEY } = rest();
    if (!FIRESTORE_BASE || !API_KEY) throw new Error('server non configurato');
    const visti = new Set();
    let dopo = null;
    for (let pagina = 0; pagina < TETTO_PAGINE; pagina++) {
      const structuredQuery = {
        from: [{ collectionId: C.COLLEZIONE }],
        where: { fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: { stringValue: valore } } },
        select: { fields: [{ fieldPath: 'pseudonimo' }] },
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: PAGINA_LETTURA,
        ...(dopo ? { startAt: { values: [{ referenceValue: dopo }], before: false } } : {}),
      };
      const res = await fetchFn(`${FIRESTORE_BASE}:runQuery?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ structuredQuery }),
        signal: AbortSignal.timeout(ATTESA_RETE_MS),
      });
      if (!res.ok) {
        let det = '';
        try { const j = await res.json(); det = (Array.isArray(j) ? j[0] : j)?.error?.status || ''; } catch (_) {}
        throw new Error(`contatori ${res.status}${det ? ` ${det}` : ''}`);
      }
      const righe = (await res.json()) || [];
      const docs = righe.filter((r) => r && r.document);
      for (const r of docs) {
        const p = r.document.fields && r.document.fields.pseudonimo && r.document.fields.pseudonimo.stringValue;
        if (p) visti.add(p);
      }
      if (docs.length < PAGINA_LETTURA) return { n: visti.size, completo: true };
      dopo = docs[docs.length - 1].document.name;
    }
    return { n: visti.size, completo: false };
  }

  async function installazioni({ idToken } = {}) {
    if (!idToken) throw new Error('Sessione scaduta: rifai l’accesso.');
    const oggi = C.giornoDi(adesso());
    const ieri = C.giornoPrima(oggi);
    const mese = C.meseDi(oggi);
    const [a, b] = await Promise.all([distinti(idToken, 'giorno', ieri), distinti(idToken, 'mese', mese)]);
    return { ieri: { giorno: ieri, ...a }, mese: { mese, ...b } };
  }

  async function letto() { await carica(); return JSON.parse(JSON.stringify(stato)); }

  return { apri, unUso, controlla, avvia, seguiImpostazioni, installazioni, accesi, letto, salva };
}

module.exports = { crea, CHIAVE, MUTO };

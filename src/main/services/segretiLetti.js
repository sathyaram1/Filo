// I segreti che Filo ha letto da fuori, da qualunque superficie (#810): l'uscita che ne porta uno si ferma in ogni
// conversazione, anche dopo un riavvio, perché le frasi di Filo che li ripetono restano (azioni recenti, home, appunti).
// Mai a un modello. Regole: src/shared/urlExfil.js (valutaUscita); chi legge chiama `ricorda`, la porta `tutti`.

// Largo: una pagina di codici di recupero ne ha decine, e il costo per uscita resta di pochi millisecondi.
const MAX_LETTI = 50000;
// Quanto un segreto letto resta ricordato fra un avvio e l'altro: ben oltre la vita di un codice e delle azioni recenti.
const GIORNI_RICORDO = 30;

// Pieno, il registro toglie dalla lettura che ha portato più voci: una pagina che nasconde migliaia di codici finti
// consuma solo il proprio posto, e il codice vero letto altrove resta. Prova: tests/unit/usciteSegreti.test.mjs.
function registro(max = MAX_LETTI, { cambiato = () => {} } = {}) {
  const voci = new Map();
  const lotti = new Map();
  let ultimo = 0;

  function metti(x, fonte, lotto, at = Date.now()) {
    if (!x || typeof x.valore !== 'string' || !x.valore) return false;
    const k = `${x.regola}:${x.valore.toLowerCase()}`;
    // La prima fonte è quella vera: una frase di Filo che lo ripete dopo non la cambia.
    if (voci.has(k)) return false;
    voci.set(k, { valore: x.valore, regola: x.regola, fonte: fonte || x.fonte || 'da fuori', lotto, at });
    if (!lotti.has(lotto)) lotti.set(lotto, new Set());
    lotti.get(lotto).add(k);
    return true;
  }

  function sfoltisci() {
    while (voci.size > max) {
      let piu = null;
      for (const [lotto, chiavi] of lotti) if (!piu || chiavi.size > piu.chiavi.size) piu = { lotto, chiavi };
      for (const k of piu.chiavi) {
        if (voci.size <= max) break;
        voci.delete(k);
        piu.chiavi.delete(k);
      }
      if (!piu.chiavi.size) lotti.delete(piu.lotto);
    }
  }

  return {
    aggiungi(x, fonte) { const nuovo = metti(x, fonte, ++ultimo); sfoltisci(); if (nuovo) cambiato(); },
    aggiungiTutti(lista, fonte) {
      const lotto = ++ultimo;
      let nuovi = false;
      for (const x of Array.isArray(lista) ? lista : []) nuovi = metti(x, fonte, lotto) || nuovi;
      sfoltisci();
      if (nuovi) cambiato();
    },
    tutti: () => [...voci.values()].map(({ valore, regola, fonte }) => ({ valore, regola, fonte })),
    svuota() { voci.clear(); lotti.clear(); },
    esporta: () => [...voci.values()].map(({ valore, regola, fonte, lotto, at }) => ({ valore, regola, fonte, lotto, at })),
    // Le voci salvate, meno quelle più vecchie del ricordo: tornano coi loro lotti, così lo sfoltimento resta giusto.
    ripristina(lista, ora = Date.now()) {
      const limite = ora - GIORNI_RICORDO * 24 * 3600 * 1000;
      for (const x of Array.isArray(lista) ? lista : []) {
        const lotto = Number(x && x.lotto) || 0;
        const at = Number(x && x.at) || 0;
        if (at < limite || !x || typeof x.regola !== 'string') continue;
        if (metti({ valore: x.valore, regola: x.regola }, String(x.fonte || ''), lotto, at)) ultimo = Math.max(ultimo, lotto);
      }
      sfoltisci();
    },
  };
}

// Il deposito su disco, nella cartella dati di Filo: cifrato col sistema quando si può, come le chiavi di Opzioni.
// Fuori da Electron (unit test) non c'è, e il registro resta in memoria.
function depositoDiSistema() {
  let electron = null;
  try { electron = require('electron'); } catch (_) { return null; }
  if (!electron || !electron.app || typeof electron.app.getPath !== 'function') return null;
  const fs = require('node:fs');
  const path = require('node:path');
  const file = () => path.join(electron.app.getPath('userData'), 'segreti-letti.bin');
  const cifra = () => { try { return electron.safeStorage.isEncryptionAvailable(); } catch (_) { return false; } };
  return {
    leggi() {
      let raw;
      try { raw = fs.readFileSync(file()); } catch (_) { return null; }
      if (raw.subarray(0, 1).toString() === '[') return raw.toString('utf8');
      try { return electron.safeStorage.decryptString(raw); } catch (_) { return null; }
    },
    scrivi(testo) {
      const dati = cifra() ? electron.safeStorage.encryptString(testo) : Buffer.from(testo, 'utf8');
      fs.writeFileSync(file(), dati, { mode: 0o600 });
    },
  };
}

let deposito;
let caricato = false;
let inAttesa = null;

function salvaPresto() {
  if (inAttesa || !deposito) return;
  inAttesa = setTimeout(() => {
    inAttesa = null;
    try { deposito.scrivi(JSON.stringify(letti.esporta())); } catch (e) { console.warn('[Filo] segreti letti non salvati', e?.message || e); }
  }, 300);
  if (typeof inAttesa.unref === 'function') inAttesa.unref();
}

const letti = registro(MAX_LETTI, { cambiato: salvaPresto });

function carica() {
  if (caricato) return;
  caricato = true;
  if (deposito === undefined) deposito = depositoDiSistema();
  if (!deposito) return;
  let lista = null;
  try { lista = JSON.parse(deposito.leggi() || 'null'); } catch (_) { lista = null; }
  if (Array.isArray(lista)) letti.ripristina(lista);
}

function ricorda(testo, fonte) {
  const G = globalThis.SN_GUARDIANO_STATICO;
  if (!G || typeof testo !== 'string' || !testo.trim()) return;
  carica();
  letti.aggiungiTutti(G.segretiNelTesto(testo), fonte);
}

// Il testo scritto da altri entra in un modello dentro una busta (src/shared/contenutoEsterno.js), da qualunque
// strada arrivi (titoli delle schede, risultati, pagine, comandi): i segreti dentro le buste contano come letti.
// Memoria e stile di Filo no: li scrive Filo dalle parole dell'utente, e lì vale il controllo dei dati personali.
const FONTI_BUSTA = Object.freeze({
  RICERCA_WEB: 'dai risultati di una ricerca',
  ELEMENTO_PAGINA: 'da una pagina',
  DATI_PAGINA: 'da una pagina',
  TESTO_IN_PAGINA: 'da una pagina',
  OUTLINE_PAGINA: 'da una pagina',
  ISTRUZIONI_SITO: 'da un sito',
  DATI_LINK: 'da un collegamento',
  DOCUMENTO_ESTERNO: 'da un documento',
  CONVERSAZIONE_ARCHIVIATA: 'da una conversazione archiviata',
  ESITO_SERVIZIO: 'da un servizio esterno',
  ESITO_COMANDO: "dall'output di un comando",
  PERCORSI_CONDIVISI: 'da percorsi condivisi da altri',
});
const BUSTA = /<<<([A-Z_]+)>>>\n([\s\S]*?)\n<<<FINE_\1>>>/g;

function ricordaBuste(valore) {
  const testi = [];
  const giro = (v, n) => {
    if (typeof v === 'string') { if (v.includes('<<<')) testi.push(v); return; }
    if (n > 12 || !v || typeof v !== 'object') return;
    for (const x of Array.isArray(v) ? v : Object.values(v)) giro(x, n + 1);
  };
  giro(valore, 0);
  for (const t of testi) {
    for (const m of t.matchAll(BUSTA)) {
      const fonte = FONTI_BUSTA[m[1]];
      if (fonte) ricorda(m[2], fonte);
    }
  }
}

function tutti() { carica(); return letti.tutti(); }
function aggiungi(x, fonte) { carica(); letti.aggiungi(x, fonte); }
function aggiungiTutti(lista, fonte) { carica(); letti.aggiungiTutti(lista, fonte); }
// Come a un riavvio: la memoria si svuota e alla prossima lettura torna quello che era salvato.
function svuota() { letti.svuota(); caricato = false; }
// Per gli unit test: un deposito finto (null = nessuno).
function usaDeposito(d) { deposito = d; caricato = false; letti.svuota(); }

module.exports = {
  ricorda, ricordaBuste, registro, aggiungi, aggiungiTutti, tutti, svuota, usaDeposito, FONTI_BUSTA, GIORNI_RICORDO,
};

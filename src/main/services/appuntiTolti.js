// Ciò che l'utente ha tolto dalla cronologia appunti mentre stava ancora negli appunti di sistema non rientra dal primo
// «Incolla»: né dopo una riapertura, né se è un'immagine (#256.2). Su disco solo un'impronta lenta e salata, mai il
// testo o i pixel. Prove: tests/unit/appuntiTolti.test.mjs, tests/clipboard-history-tolta-resta-tolta.spec.mjs.
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { promisify } = require('node:util');
const Disco = require('./scritturaAtomica');
require('../../shared/clipboardHistory.js');

const scrypt = promisify(crypto.scrypt);
// Lenta apposta: chi apre il file non deve poter provare in fretta le password più comuni.
const SCRYPT = { N: 1 << 14, r: 8, p: 1 };
const ESADECIMALE = /^[0-9a-f]{32}$/;
// Negli appunti c'è al più un testo e un'immagine: una sospensione per tipo basta.
const TIPI = ['t', 'i'];

const tipoDi = (voce) => (voce && voce.type === 'text' ? 't' : voce && voce.type === 'image' ? 'i' : '');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * `pixel(dataUrl | Buffer)` → impronta dei pixel, '' se non si decodifica: la stessa schermata torna dagli appunti in
 * PNG diversi. `appunti` → { testo(), immagine() }, coi byte dell'immagine.
 */
function crea({ file, pixel, appunti }) {
  let stato = null;
  let scrivibile = true;
  let coda = Promise.resolve();

  function carica() {
    if (stato) return stato;
    stato = { sale: '', t: '', i: '' };
    let raw = null;
    try {
      Disco.togliTemporaneiUnaVolta(file);
      raw = Disco.leggiSync(file);
    } catch (e) {
      // Un file che il disco non dà non si sovrascrive: questa sessione ricorda in memoria.
      scrivibile = false;
      console.warn('[appunti] sospensioni non lette:', e?.message || e);
    }
    let j = null;
    try { j = raw ? JSON.parse(Disco.togliBom(raw.toString('utf8'))) : null; } catch (_) { j = null; }
    if (j && ESADECIMALE.test(String(j.sale))) {
      stato.sale = j.sale;
      for (const k of TIPI) if (ESADECIMALE.test(String(j[k]))) stato[k] = j[k];
    }
    return stato;
  }

  function salva() {
    if (!scrivibile) return coda;
    const dati = JSON.stringify(stato);
    coda = coda.then(() => Disco.scrivi(file, dati, { mode: 0o600 })).catch((e) => {
      console.warn('[appunti] sospensioni non salvate:', e?.message || e);
    });
    return coda;
  }

  async function impronta(materiale) {
    const s = carica();
    if (!s.sale) s.sale = crypto.randomBytes(16).toString('hex');
    const k = await scrypt(sha(materiale), Buffer.from(s.sale, 'hex'), 16, SCRYPT);
    return k.toString('hex');
  }

  function materialeImmagine(sorgente) {
    let p = '';
    try { p = sorgente ? pixel(sorgente) : ''; } catch (_) { p = ''; }
    return p ? 'i:' + p : '';
  }

  function materiale(voce) {
    const tipo = tipoDi(voce);
    if (tipo === 't') return globalThis.SN_CLIPBOARD.chiave(voce);
    if (tipo === 'i') return materialeImmagine(voce.dataUrl);
    return '';
  }

  async function negliAppunti(tipo) {
    try {
      if (tipo === 't') {
        const testo = await appunti.testo();
        return testo ? globalThis.SN_CLIPBOARD.chiave({ type: 'text', text: testo }) : '';
      }
      return materialeImmagine(await appunti.immagine());
    } catch (_) { return ''; }
  }

  async function sospendi(tipo, mat) {
    const imp = await impronta(mat);
    carica()[tipo] = imp;
    return salva();
  }

  async function libera(tipo) {
    const s = carica();
    if (!s[tipo]) return;
    s[tipo] = '';
    await salva();
  }

  // Un «Incolla» che arriva mentre una rimozione guarda ancora gli appunti aspetta che finisca.
  let inCorso = Promise.resolve();
  const inFila = (lavoro) => {
    const p = inCorso.then(lavoro, lavoro);
    inCorso = p.catch(() => {});
    return p;
  };

  return {
    /** Una voce tolta: se è ancora negli appunti, il prossimo «Incolla» non la rimette. */
    voceTolta: (voce) => inFila(async () => {
      const tipo = tipoDi(voce);
      const nel = tipo ? await negliAppunti(tipo) : '';
      if (nel && materiale(voce) === nel) await sospendi(tipo, nel);
    }),

    /** Svuotata: vale per ciò che, fra le voci di prima, sta ancora negli appunti. */
    cronologiaSvuotata: (voci) => inFila(async () => {
      const lista = Array.isArray(voci) ? voci : [];
      for (const tipo of TIPI) {
        const delTipo = lista.filter((v) => tipoDi(v) === tipo);
        if (!delTipo.length) continue;
        const mat = await negliAppunti(tipo);
        if (mat && delTipo.some((v) => materiale(v) === mat)) await sospendi(tipo, mat);
      }
    }),

    /**
     * La voce va in cronologia? Un «Incolla» della cosa sospesa no; incollare altro vuol dire che negli appunti
     * c'è altro, e una copia della stessa cosa è l'utente che la vuole di nuovo: tutte e due la liberano.
     */
    daTenere: (voce, via) => inFila(async () => {
      const tipo = tipoDi(voce);
      const sospesa = tipo ? carica()[tipo] : '';
      if (!sospesa) return true;
      const mat = materiale(voce);
      const uguale = Boolean(mat) && (await impronta(mat)) === sospesa;
      if (via === 'paste') {
        if (uguale) return false;
        await libera(tipo);
        return true;
      }
      if (uguale) await libera(tipo);
      return true;
    }),
  };
}

// I byte dell'immagine negli appunti di sistema, PNG prima di tutto; null se non ce n'è.
async function immagineElectron() {
  const voci = await require('electron').clipboard.read();
  for (const tipo of ['image/png', /^image\//]) {
    for (const v of voci) {
      const t = v.types.find((x) => (typeof tipo === 'string' ? x === tipo : tipo.test(x)));
      if (!t) continue;
      const b = Buffer.from(await (await v.getType(t)).arrayBuffer());
      if (b.length) return b;
    }
  }
  return null;
}

let diFilo = null;
function perFilo() {
  if (diFilo) return diFilo;
  const { app, clipboard } = require('electron');
  diFilo = crea({
    file: path.join(app.getPath('userData'), 'appunti-tolti.json'),
    pixel: require('./improntaPixel').impronta,
    appunti: { testo: async () => await clipboard.readText(), immagine: immagineElectron },
  });
  return diFilo;
}

module.exports = { crea, perFilo, immagineNegliAppunti: immagineElectron };

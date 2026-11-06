// I «no» alla proposta «Resta connesso» dopo un accesso (#759.1, decisione D-8): sul disco solo impronte salate e
// lente, mai il nome del sito, e il sale in un file suo. Filo sa se su un sito ha già chiesto; l'elenco non si legge.
// Prove: tests/unit/noRestaConnesso.test.mjs, tests/cookies-resta-connesso-ricarica.spec.mjs.
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { promisify } = require('node:util');
const Disco = require('./scritturaAtomica');

const scrypt = promisify(crypto.scrypt);
// Lenta apposta: chi apre il file non deve poter provare in fretta un elenco di siti noti.
const SCRYPT = { N: 1 << 14, r: 8, p: 1 };
const ESADECIMALE = /^[0-9a-f]{32}$/;
// Uno per ogni sito dove hai detto no: diecimila stanno larghi. Oltre, il più vecchio torna a chiedere, e basta.
const TETTO = 10000;

function crea({ file, fileSale }) {
  let stato = null;
  let scrivibile = true;
  let coda = Promise.resolve();

  function leggi(f) {
    Disco.togliTemporaneiUnaVolta(f);
    const raw = Disco.leggiSync(f);
    return raw ? Disco.togliBom(raw.toString('utf8')).trim() : '';
  }

  function carica() {
    if (stato) return stato;
    stato = { sale: '', impronte: [], saleNuovo: false };
    let sale = '';
    let testo = '';
    try {
      sale = leggi(fileSale);
      testo = leggi(file);
    } catch (e) {
      // Un file che il disco non dà non si sovrascrive: questa sessione ricorda in memoria.
      scrivibile = false;
      console.warn('[resta connesso] «no» ricordati non letti:', e?.message || e);
    }
    // Senza il suo sale un'impronta non si riconosce più: si riparte da capo.
    if (!ESADECIMALE.test(sale)) return stato;
    stato.sale = sale;
    let j = null;
    try { j = testo ? JSON.parse(testo) : null; } catch (_) { j = null; }
    if (j && Array.isArray(j.impronte)) stato.impronte = j.impronte.filter((x) => ESADECIMALE.test(String(x))).slice(-TETTO);
    return stato;
  }

  function salva() {
    if (!scrivibile) return coda;
    const s = stato;
    const nuovoSale = s.saleNuovo;
    s.saleNuovo = false;
    const dati = JSON.stringify({ impronte: s.impronte });
    coda = coda
      .then(() => (nuovoSale ? Disco.scrivi(fileSale, s.sale, { mode: 0o600 }) : null))
      .then(() => Disco.scrivi(file, dati, { mode: 0o600 }))
      .catch((e) => { console.warn('[resta connesso] «no» non salvati:', e?.message || e); });
    return coda;
  }

  async function impronta(sito) {
    const s = carica();
    if (!s.sale) { s.sale = crypto.randomBytes(16).toString('hex'); s.saleNuovo = true; s.impronte = []; }
    const k = await scrypt(String(sito || '').trim().toLowerCase(), Buffer.from(s.sale, 'hex'), 16, SCRYPT);
    return k.toString('hex');
  }

  return {
    /** Su `sito` l'utente ha già lasciato cadere la proposta. */
    async detto(sito) {
      if (!sito || !carica().impronte.length) return false;
      return carica().impronte.includes(await impronta(sito));
    },
    async segna(sito) {
      if (!sito) return;
      const imp = await impronta(sito);
      const s = carica();
      s.impronte = s.impronte.filter((x) => x !== imp);
      s.impronte.push(imp);
      if (s.impronte.length > TETTO) s.impronte.splice(0, s.impronte.length - TETTO);
      await salva();
    },
    async togli(sito) {
      if (!sito || !carica().impronte.length) return;
      const imp = await impronta(sito);
      const s = carica();
      const prima = s.impronte.length;
      s.impronte = s.impronte.filter((x) => x !== imp);
      if (s.impronte.length !== prima) await salva();
    },
  };
}

let diFilo = null;
function perFilo() {
  if (diFilo) return diFilo;
  const dir = require('electron').app.getPath('userData');
  diFilo = crea({ file: path.join(dir, 'resta-connesso-no.json'), fileSale: path.join(dir, 'resta-connesso-no.sale') });
  return diFilo;
}

module.exports = { crea, perFilo, TETTO };

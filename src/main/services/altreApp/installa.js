// Scarica, verifica e installa il driver nella cartella dei dati di Filo; lo toglie. Nient'altro tocca il disco del driver.
// Il file si verifica con l'impronta fissata in pacchetti.js PRIMA di estrarlo: con un'impronta diversa non si installa.
// Ogni esito è una fase con una frase per l'utente; il motivo tecnico va nei log. Prove: tests/unit/altreAppInstalla.test.mjs.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Archivi = require('./archivi');

const MARCA = 'installato.json';
const PARZIALE = '.scarica';
const ERRORE = 'errore.json';

const FRASI = {
  'non-supportato': (p) => `Il componente non esiste per questo sistema (${p.sistema}).`,
  rete: () => 'Non riesco a scaricare il componente: la rete non risponde.',
  http: (p) => `Non riesco a scaricare il componente: GitHub risponde ${p.stato}.`,
  impronta: () => 'Il file scaricato non è quello atteso: la sua impronta non combacia, quindi non l\'ho installato. '
    + 'Può essere un download rovinato o un file alterato lungo la strada.',
  misura: (p) => `Il file scaricato non è quello atteso (${p.ricevuti} byte, ne aspettavo ${p.attesi}): non l'ho installato.`,
  spazio: () => 'Non c\'è abbastanza spazio sul disco per installare il componente.',
  disco: () => 'Non riesco a scrivere il componente nella cartella dei dati di Filo.',
  archivio: () => 'Il pacchetto scaricato non si apre: non l\'ho installato.',
  incompleto: () => 'Il pacchetto scaricato non contiene il programma atteso: non l\'ho installato.',
  'non-parte': () => 'Il componente è installato ma non parte.',
};
const frase = (codice, p = {}) => (FRASI[codice] || (() => 'L\'installazione del componente non è riuscita.'))(p);

class ErroreInstalla extends Error {
  constructor(codice, dettagli = {}, causa) {
    super(`${codice}${causa ? `: ${causa.message || causa}` : ''}`);
    this.codice = codice;
    this.dettagli = dettagli;
  }
}

const daDisco = (e) => new ErroreInstalla(e && (e.code === 'ENOSPC' || e.code === 'EDQUOT') ? 'spazio' : 'disco', {}, e);

async function togli(p) {
  await fs.promises.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

async function dimensione(dir) {
  let tot = 0;
  let voci;
  try { voci = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return 0; }
  for (const v of voci) {
    const p = path.join(dir, v.name);
    if (v.isDirectory()) tot += await dimensione(p);
    else { try { tot += (await fs.promises.stat(p)).size; } catch (_) {} }
  }
  return tot;
}

/**
 * `cartella()` → la cartella del componente (dentro i dati di Filo). `pacchetto()` → il pacchetto per questo computer o null.
 * `scarica(url, { signal })` → una Response di fetch. `prova(eseguibile)` → { ok, codice?, motivo? } dopo l'installazione.
 */
function creaInstallatore({ cartella, pacchetto, sistema = () => `${process.platform} ${process.arch}`, scarica, prova = async () => ({ ok: true }), log = () => {}, ogniMs = 120 } = {}) {
  let stato = { fase: 'assente' };
  let inCorso = null;
  let fermo = null;
  const ascoltatori = new Set();
  let ultimoAnnuncio = 0;

  function annuncia(nuovo, { subito = true } = {}) {
    stato = nuovo;
    const ora = Date.now();
    if (!subito && ora - ultimoAnnuncio < ogniMs) return;
    ultimoAnnuncio = ora;
    for (const f of ascoltatori) { try { f(stato); } catch (_) {} }
  }

  async function leggiMarca() {
    try {
      const m = JSON.parse(await fs.promises.readFile(path.join(cartella(), MARCA), 'utf8'));
      if (!m || typeof m.versione !== 'string' || typeof m.eseguibile !== 'string') return null;
      const exe = Archivi.dentro(path.join(cartella(), m.versione), m.eseguibile);
      if (!exe) return null;
      await fs.promises.access(exe, fs.constants.F_OK);
      return { ...m, percorso: exe };
    } catch (_) { return null; }
  }

  async function leggiErrore() {
    try { return JSON.parse(await fs.promises.readFile(path.join(cartella(), ERRORE), 'utf8')); } catch (_) { return null; }
  }

  /** Quello che c'è sul disco adesso: { installato: {versione, percorso} | null, aggiornato, parziale, byte, errore }. */
  async function sulDisco() {
    const p = pacchetto();
    const m = await leggiMarca();
    let parziale = false;
    try { parziale = (await fs.promises.readdir(path.join(cartella(), PARZIALE))).length > 0; } catch (_) {}
    let esiste = false;
    try { esiste = (await fs.promises.stat(cartella())).isDirectory(); } catch (_) {}
    return {
      installato: m ? { versione: m.versione, percorso: m.percorso, sha256: m.sha256 } : null,
      aggiornato: !!(m && p && m.versione === p.versione && m.sha256 === p.sha256),
      parziale,
      esiste,
      byte: esiste ? await dimensione(cartella()) : 0,
      errore: await leggiErrore(),
    };
  }

  async function scaricaInFile(p, dest, signal) {
    let res;
    try { res = await scarica(p.url, { signal }); } catch (e) {
      if (signal.aborted) throw new ErroreInstalla('fermato');
      throw new ErroreInstalla('rete', {}, e);
    }
    if (!res || !res.ok) throw new ErroreInstalla('http', { stato: res ? res.status : '?' });
    const dichiarati = Number(res.headers && res.headers.get && res.headers.get('content-length')) || 0;
    const totali = p.byte || dichiarati || 0;
    if (dichiarati && p.byte && dichiarati !== p.byte) {
      try { await res.body.cancel(); } catch (_) {}
      throw new ErroreInstalla('misura', { ricevuti: dichiarati, attesi: p.byte });
    }
    const hash = crypto.createHash('sha256');
    let ricevuti = 0;
    let out;
    try { out = fs.createWriteStream(dest); } catch (e) { throw daDisco(e); }
    let erroreScrittura = null;
    out.on('error', (e) => { erroreScrittura = e; });
    annuncia({ fase: 'scarica', ricevuti: 0, totali });
    let lettore = null;
    try {
      lettore = res.body.getReader();
      for (;;) {
        const { done, value } = await lettore.read();
        if (done) break;
        if (erroreScrittura) throw daDisco(erroreScrittura);
        const pezzo = Buffer.from(value);
        ricevuti += pezzo.length;
        // Più byte di quelli fissati non è il file atteso: ci si ferma senza scaricare il resto.
        if (p.byte && ricevuti > p.byte) throw new ErroreInstalla('misura', { ricevuti: `più di ${p.byte}`, attesi: p.byte });
        hash.update(pezzo);
        // Un disco che si riempie mentre si aspetta non deve lasciare l'attesa appesa: anche l'errore la scioglie.
        if (!out.write(pezzo)) await new Promise((r) => { out.once('drain', r); out.once('error', r); });
        annuncia({ fase: 'scarica', ricevuti, totali }, { subito: false });
      }
    } catch (e) {
      try { out.destroy(); } catch (_) {}
      if (lettore) lettore.cancel().catch(() => {});
      if (signal.aborted) throw new ErroreInstalla('fermato');
      if (e instanceof ErroreInstalla) throw e;
      if (e && e.code && /^E[A-Z]+$/.test(e.code) && e.syscall) throw daDisco(e);
      throw new ErroreInstalla('rete', {}, e);
    }
    await new Promise((risolvi, rifiuta) => { out.end((e) => (e ? rifiuta(daDisco(e)) : risolvi())); });
    if (erroreScrittura) throw daDisco(erroreScrittura);
    annuncia({ fase: 'scarica', ricevuti, totali });
    if (p.byte && ricevuti !== p.byte) throw new ErroreInstalla('misura', { ricevuti, attesi: p.byte });
    return hash.digest('hex');
  }

  async function installaVero(signal) {
    const p = pacchetto();
    if (!p) throw new ErroreInstalla('non-supportato', { sistema: sistema() });
    const base = cartella();
    const tmp = path.join(base, PARZIALE);
    try {
      await togli(tmp);
      await fs.promises.mkdir(tmp, { recursive: true });
      await togli(path.join(base, ERRORE));
    } catch (e) { throw daDisco(e); }
    const file = path.join(tmp, `${p.file}.part`);
    const impronta = await scaricaInFile(p, file, signal);
    annuncia({ fase: 'verifica' });
    if (impronta !== String(p.sha256).toLowerCase()) {
      log(`[altreApp] impronta diversa per ${p.file}: attesa ${p.sha256}, arrivata ${impronta}`);
      throw new ErroreInstalla('impronta', { attesa: p.sha256, arrivata: impronta });
    }
    if (signal.aborted) throw new ErroreInstalla('fermato');
    annuncia({ fase: 'estrae' });
    const estratto = path.join(tmp, 'estratto');
    try { await fs.promises.mkdir(estratto, { recursive: true }); } catch (e) { throw daDisco(e); }
    try { await Archivi.estrai(file, p.formato, estratto); } catch (e) {
      if (e instanceof Archivi.ErroreArchivio) throw new ErroreInstalla('archivio', {}, e);
      throw daDisco(e);
    }
    const exe = Archivi.dentro(estratto, p.eseguibile);
    try { await fs.promises.access(exe, fs.constants.F_OK); } catch (_) { throw new ErroreInstalla('incompleto'); }
    if (signal.aborted) throw new ErroreInstalla('fermato');
    // Lo scambio: prima la cartella nuova al suo posto, poi la marca che la indica; le versioni vecchie per ultime.
    const finale = path.join(base, p.versione);
    try {
      await togli(finale);
      await fs.promises.rename(estratto, finale);
      const marca = { versione: p.versione, file: p.file, sha256: p.sha256, eseguibile: p.eseguibile, installatoIl: new Date().toISOString() };
      const temp = path.join(base, `${MARCA}.tmp`);
      await fs.promises.writeFile(temp, JSON.stringify(marca, null, 2));
      await fs.promises.rename(temp, path.join(base, MARCA));
      for (const n of await fs.promises.readdir(base)) {
        if (n !== p.versione && n !== MARCA && n !== PARZIALE) await togli(path.join(base, n));
      }
      await togli(tmp);
    } catch (e) { throw daDisco(e); }
    annuncia({ fase: 'prova', versione: p.versione });
    const r = await prova(path.join(finale, ...p.eseguibile.split('/')));
    if (!r || !r.ok) throw new ErroreInstalla('non-parte', {}, new Error((r && r.motivo) || 'prova fallita'));
    return { versione: p.versione, mancanti: r.mancanti || [] };
  }

  /** Installa (una volta sola anche se chiamata più volte di fila). → lo stato finale. */
  function installa() {
    if (inCorso) return inCorso;
    const ctl = new AbortController();
    fermo = ctl;
    annuncia({ fase: 'scarica', ricevuti: 0, totali: (pacchetto() || {}).byte || 0 });
    inCorso = (async () => {
      try {
        const r = await installaVero(ctl.signal);
        annuncia({ fase: 'pronto', versione: r.versione, mancanti: r.mancanti });
      } catch (e) {
        const codice = e instanceof ErroreInstalla ? e.codice : 'disco';
        if (codice === 'fermato' || ctl.signal.aborted) {
          await togli(path.join(cartella(), PARZIALE)).catch(() => {});
          annuncia({ fase: 'assente' });
        } else {
          log(`[altreApp] installazione non riuscita: ${e && e.message}`);
          if (codice !== 'non-parte') await togli(path.join(cartella(), PARZIALE)).catch(() => {});
          // Un'impronta sbagliata non si riscarica da sola a ogni avvio: riprova chi lo chiede.
          if (codice === 'impronta') {
            const p = pacchetto();
            await fs.promises.writeFile(path.join(cartella(), ERRORE), JSON.stringify({ codice, versione: p && p.versione, sha256: p && p.sha256 })).catch(() => {});
          }
          annuncia({ fase: 'errore', errore: { codice, frase: frase(codice, (e && e.dettagli) || {}) } });
        }
      } finally {
        inCorso = null;
        fermo = null;
      }
      return stato;
    })();
    return inCorso;
  }

  async function ferma() {
    if (fermo) fermo.abort();
    if (inCorso) { try { await inCorso; } catch (_) {} }
  }

  /** Toglie tutto: anche un'installazione a metà. */
  async function disinstalla() {
    await ferma();
    try {
      await togli(cartella());
      // La cartella che la conteneva, se è rimasta vuota: chi spegne non deve trovare avanzi.
      await fs.promises.rmdir(path.dirname(cartella())).catch(() => {});
    } catch (e) {
      log(`[altreApp] disinstallazione non riuscita: ${e && e.message}`);
      annuncia({ fase: 'errore', errore: { codice: 'disco', frase: 'Non riesco a togliere il componente dalla cartella dei dati di Filo.' } });
      return stato;
    }
    annuncia({ fase: 'assente' });
    return stato;
  }

  return {
    installa,
    disinstalla,
    ferma,
    sulDisco,
    leggiMarca,
    stato: () => stato,
    inCorso: () => !!inCorso,
    imposta: (s) => annuncia(s),
    suCambio: (f) => { ascoltatori.add(f); return () => ascoltatori.delete(f); },
  };
}

module.exports = { creaInstallatore, frase, ErroreInstalla, MARCA, PARZIALE, ERRORE };

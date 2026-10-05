// Scarica, verifica e installa il driver esterno nella cartella di Filo, e lo toglie. Senza Electron: chi lo usa passa
// come aprire un indirizzo. Un pacchetto con l'impronta diversa da quella del file dei pacchetti non si installa mai.
// Regole: tests/unit/installatoreAltreApp.test.mjs.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { estrai, ErroreArchivio } = require('./archivio');

const MARCA = 'installato.json';
const CASA = 'casa';

class ErroreInstallazione extends Error {
  constructor(codice, frase, causa = null) {
    super(frase);
    this.codice = codice;
    this.frase = frase;
    this.causa = causa;
  }
}

const mb = (byte) => Math.max(1, Math.round(Number(byte || 0) / (1024 * 1024)));

function chiavePiattaforma(piattaforma = process.platform, arch = process.arch) {
  return `${piattaforma}-${arch}`;
}

function pacchettoPer(manifesto, piattaforma, arch) {
  const p = manifesto && manifesto.pacchetti && manifesto.pacchetti[chiavePiattaforma(piattaforma, arch)];
  return p && p.url && /^[0-9a-f]{64}$/.test(String(p.sha256 || '')) ? p : null;
}

function fraseDaErrore(e, pacchetto) {
  if (e instanceof ErroreInstallazione) return e;
  if (e instanceof ErroreArchivio) return new ErroreInstallazione('archivio', `Il pacchetto scaricato è rovinato e non l'ho installato. ${e.message}`, e);
  const codice = e && e.code;
  if (codice === 'ENOSPC') return new ErroreInstallazione('disco', `Sul disco non c'è abbastanza spazio: per il componente servono circa ${mb(pacchetto && pacchetto.byte) * 3} MB.`, e);
  if (codice === 'EACCES' || codice === 'EPERM' || codice === 'EBUSY') return new ErroreInstallazione('disco', 'Filo non riesce a scrivere nella cartella del componente: un altro programma la sta usando o non ha il permesso.', e);
  return new ErroreInstallazione('rete', 'Non sono riuscito a scaricare il componente: controlla la connessione e riprova.', e);
}

async function rimuovi(p) {
  await fsp.rm(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

// `apriFlusso(url, { signal })` → { status, lunghezza, flusso } con `flusso` iterabile di Buffer.
function creaInstallatore({ cartella, manifesto, piattaforma = process.platform, arch = process.arch, apriFlusso } = {}) {
  const pacchetto = pacchettoPer(manifesto, piattaforma, arch);
  const marca = path.join(cartella, MARCA);

  async function leggiMarca() {
    try { return JSON.parse(await fsp.readFile(marca, 'utf8')); } catch (_) { return null; }
  }

  // 'assente' (mai installato), 'ok', 'vecchio' (un'altra versione), 'mancante' (la marca c'è, il programma no o è cambiato).
  async function installato() {
    const m = await leggiMarca();
    if (!m || typeof m.eseguibile !== 'string') return { stato: 'assente' };
    const eseguibile = path.join(cartella, ...m.eseguibile.split('/'));
    let st = null;
    try { st = await fsp.stat(eseguibile); } catch (_) { st = null; }
    if (!st || !st.isFile() || (Number(m.byteEseguibile) && st.size !== Number(m.byteEseguibile))) {
      return { stato: 'mancante', versione: m.versione, eseguibile };
    }
    if (!manifesto || m.versione !== manifesto.versione || (pacchetto && m.sha256 !== pacchetto.sha256)) {
      return { stato: 'vecchio', versione: m.versione, eseguibile };
    }
    return { stato: 'ok', versione: m.versione, eseguibile, cartellaVersione: path.dirname(eseguibile), quando: m.quando || null };
  }

  async function scarica(destinazione, { signal, onAvanzamento }) {
    let risposta;
    try { risposta = await apriFlusso(pacchetto.url, { signal }); } catch (e) {
      if (signal && signal.aborted) throw new ErroreInstallazione('annullato', 'Scaricamento annullato.');
      throw fraseDaErrore(e, pacchetto);
    }
    if (!risposta || risposta.status !== 200) {
      throw new ErroreInstallazione('rete', `Il sito da cui si scarica il componente ha risposto con un errore${risposta && risposta.status ? ` (${risposta.status})` : ''}: riprova più tardi.`);
    }
    const totali = Number(pacchetto.byte) || Number(risposta.lunghezza) || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(destinazione);
    const scritto = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
    let ricevuti = 0;
    try {
      for await (const pezzo of risposta.flusso) {
        if (signal && signal.aborted) throw new ErroreInstallazione('annullato', 'Scaricamento annullato.');
        const b = Buffer.isBuffer(pezzo) ? pezzo : Buffer.from(pezzo);
        ricevuti += b.length;
        // Il file dei pacchetti dice quanti byte arrivano: uno più grande non è quello atteso, e non riempie il disco.
        if (pacchetto.byte && ricevuti > Number(pacchetto.byte)) {
          throw new ErroreInstallazione('impronta', `Il pacchetto scaricato non è quello atteso (è più grande dei ${mb(pacchetto.byte)} MB previsti): non l'ho installato.`);
        }
        hash.update(b);
        if (!out.write(b)) await new Promise((r) => out.once('drain', r));
        if (typeof onAvanzamento === 'function') onAvanzamento({ ricevuti, totali });
      }
      if (signal && signal.aborted) throw new ErroreInstallazione('annullato', 'Scaricamento annullato.');
    } catch (e) {
      out.destroy();
      if (signal && signal.aborted) throw new ErroreInstallazione('annullato', 'Scaricamento annullato.');
      throw fraseDaErrore(e, pacchetto);
    }
    out.end();
    await scritto;
    const impronta = hash.digest('hex');
    if (impronta !== pacchetto.sha256) {
      throw new ErroreInstallazione('impronta', 'Il pacchetto scaricato non è quello atteso: la sua impronta non corrisponde a quella registrata in Filo, quindi non l\'ho installato. Può essere uno scaricamento rovinato o un file cambiato sul server.');
    }
    return { ricevuti, impronta };
  }

  // onAvanzamento({ fase: 'scarica'|'installa', ricevuti, totali }); a metà strada non resta niente di installato.
  async function installa({ signal, onAvanzamento } = {}) {
    if (!pacchetto) throw new ErroreInstallazione('non-supportato', 'Il componente non esiste per questo computer.');
    await fsp.mkdir(cartella, { recursive: true });
    const sigla = crypto.randomBytes(6).toString('hex');
    const parziale = path.join(cartella, `.scarico-${sigla}.part`);
    const estratto = path.join(cartella, `.estrai-${sigla}`);
    try {
      await scarica(parziale, { signal, onAvanzamento: (a) => onAvanzamento && onAvanzamento({ fase: 'scarica', ...a }) });
      if (typeof onAvanzamento === 'function') onAvanzamento({ fase: 'installa' });
      const nomeFile = new URL(pacchetto.url).pathname.split('/').pop();
      await estrai(parziale, estratto, nomeFile);
      if (signal && signal.aborted) throw new ErroreInstallazione('annullato', 'Scaricamento annullato.');
      const origine = path.join(estratto, ...String(pacchetto.cartella || '').split('/').filter(Boolean));
      const eseguibileEstratto = path.join(origine, pacchetto.eseguibile);
      let st;
      try { st = await fsp.stat(eseguibileEstratto); } catch (_) { st = null; }
      if (!st || !st.isFile()) throw new ErroreInstallazione('archivio', 'Il pacchetto scaricato non contiene il programma del componente: non l\'ho installato.');
      if (piattaforma !== 'win32') await fsp.chmod(eseguibileEstratto, 0o755);
      // Le versioni di prima e quella nuova non convivono: la marca si scrive per ultima, quando tutto è al suo posto.
      await rimuovi(marca);
      for (const voce of await fsp.readdir(cartella)) {
        if (voce === CASA || voce.startsWith('.scarico-') || voce.startsWith('.estrai-')) continue;
        await rimuovi(path.join(cartella, voce));
      }
      const finale = path.join(cartella, manifesto.versione);
      await fsp.rename(origine, finale);
      const temporanea = `${marca}.${sigla}`;
      await fsp.writeFile(temporanea, JSON.stringify({
        versione: manifesto.versione,
        sha256: pacchetto.sha256,
        eseguibile: `${manifesto.versione}/${pacchetto.eseguibile}`,
        byteEseguibile: st.size,
        piattaforma: chiavePiattaforma(piattaforma, arch),
        quando: new Date().toISOString(),
      }, null, 2));
      await fsp.rename(temporanea, marca);
      return installato();
    } catch (e) {
      throw fraseDaErrore(e, pacchetto);
    } finally {
      await rimuovi(parziale).catch(() => {});
      await rimuovi(estratto).catch(() => {});
    }
  }

  async function disinstalla() {
    await rimuovi(cartella);
  }

  async function spazioOccupato() {
    let totale = 0;
    async function giro(d) {
      let voci;
      try { voci = await fsp.readdir(d, { withFileTypes: true }); } catch (_) { return; }
      for (const v of voci) {
        const p = path.join(d, v.name);
        if (v.isDirectory()) await giro(p);
        else if (v.isFile()) { try { totale += (await fsp.stat(p)).size; } catch (_) {} }
      }
    }
    await giro(cartella);
    return totale;
  }

  return {
    pacchetto,
    installato,
    installa,
    disinstalla,
    spazioOccupato,
    cartellaCasa: path.join(cartella, CASA),
  };
}

// Per gli script fuori da Electron: https di Node, coi rimbalzi seguiti a mano.
function apriFlussoNode(url, { signal, rimbalzi = 5 } = {}) {
  const https = require('node:https');
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, { signal, headers: { 'user-agent': 'Filo' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && rimbalzi > 0) {
        res.resume();
        resolve(apriFlussoNode(new URL(res.headers.location, u).href, { signal, rimbalzi: rimbalzi - 1 }));
        return;
      }
      resolve({ status: res.statusCode, lunghezza: Number(res.headers['content-length']) || 0, flusso: res });
    });
    req.on('error', reject);
  });
}

module.exports = { creaInstallatore, pacchettoPer, chiavePiattaforma, apriFlussoNode, ErroreInstallazione, MARCA };

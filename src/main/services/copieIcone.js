// La copia delle icone di pagine salvate, schede archiviate e foto del profilo (#1273): file nella cartella dati, mai in storage.json né in rete.
// I nomi vengono dai byte mescolati con una chiave che resta qui, così un sito non indovina quali icone ci sono; in incognito niente su disco.
// Le pagine le vedono come filo://icone/<nome>. Prove: tests/unit/copieIcone.test.mjs, tests/copie-icone.spec.mjs.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { tipoImmagine, bytesDaDataUrl, TETTO_BYTE } = require('./iconaScheda');

const ESTENSIONE = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/x-icon': 'ico',
  'image/bmp': 'bmp', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
};
const TIPO = Object.fromEntries(Object.entries(ESTENSIONE).map(([t, e]) => [e, t]));
const PREFISSO = 'filo://icone/';
const NOME_RE = /^[0-9a-f]{40}\.(png|jpg|gif|ico|bmp|webp|avif|svg)$/;
// Un'icona appena scritta aspetta la voce che la nomina (una scrittura di storage, millisecondi): chi toglie le orfane
// le lascia stare per questo tempo, poi riguarda.
const GRAZIA_MS = 1000;
// Aperta a mano come pagina, un'icona svg non esegue niente: niente script, origine opaca.
const INTESTAZIONI = { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'x-content-type-options': 'nosniff' };

function cartella() {
  const root = process.env.FILO_USER_DATA || require('electron').app.getPath('userData');
  return path.join(root, 'icone');
}

const inIncognito = () => { try { return require('../shim/storage').inIncognito(); } catch (_) { return false; } };
const fuoriIncognito = (fn) => { try { return require('../shim/storage').runNormale(fn); } catch (_) { return fn(); } };

let chiave = null;
function laChiave() {
  const dir = cartella();
  if (chiave && chiave.dir === dir) return chiave.k;
  const f = path.join(dir, 'chiave');
  let k = null;
  try { k = fs.readFileSync(f); } catch (_) {}
  if (!k || k.length !== 32) {
    k = crypto.randomBytes(32);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, k);
  }
  chiave = { dir, k };
  return k;
}

const nomeDa = (rif) => {
  const s = typeof rif === 'string' ? rif : '';
  if (!s.startsWith(PREFISSO)) return '';
  const n = s.slice(PREFISSO.length);
  return NOME_RE.test(n) ? n : '';
};
const eCopia = (v) => !!nomeDa(v);
// Quello che una pagina di Filo può mostrare come icona senza contattare nessuno.
const eLocale = (v) => eCopia(v) || /^data:image\//i.test(typeof v === 'string' ? v : '');

const recenti = new Map();

// `dato`: un data: URL d'immagine (quello che la scheda ha già scaricato). Torna il rimando alla copia, o '' se non è un'immagine.
// In incognito torna il data: URL ripulito, che resta solo in memoria con la voce.
async function conserva(dato) {
  if (eCopia(dato)) return dato;
  const buf = bytesDaDataUrl(dato);
  const tipo = buf && buf.length && buf.length <= TETTO_BYTE ? tipoImmagine(buf) : '';
  if (!tipo) return '';
  if (inIncognito()) return `data:${tipo};base64,${buf.toString('base64')}`;
  // Una copia che non si scrive (disco pieno, file bloccato) lascia la voce col globo: mai la voce persa per la sua icona.
  try { return await scrivi(buf, tipo); } catch (_) { return ''; }
}

async function scrivi(buf, tipo) {
  const nome = `${crypto.createHmac('sha256', laChiave()).update(buf).digest('hex').slice(0, 40)}.${ESTENSIONE[tipo]}`;
  recenti.set(nome, Date.now());
  const file = path.join(cartella(), nome);
  if (!fs.existsSync(file)) {
    // La cartella può sparire con Filo aperto: si rifà.
    await fsp.mkdir(cartella(), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, file).catch(async (e) => { await fsp.rm(tmp, { force: true }).catch(() => {}); if (!fs.existsSync(file)) throw e; });
  }
  return PREFISSO + nome;
}

// Il data: URL della copia, per chi deve consegnare byte (l'icona di un sito in chat, l'esportazione).
async function comeDato(rif) {
  if (/^data:image\//i.test(typeof rif === 'string' ? rif : '')) return rif;
  const nome = nomeDa(rif);
  if (!nome) return '';
  try {
    const buf = await fsp.readFile(path.join(cartella(), nome));
    return `data:${TIPO[nome.split('.').pop()]};base64,${buf.toString('base64')}`;
  } catch (_) { return ''; }
}

async function risposta(rel) {
  const nome = String(rel || '');
  if (!NOME_RE.test(nome)) return new Response('', { status: 404 });
  try {
    const buf = await fsp.readFile(path.join(cartella(), nome));
    return new Response(buf, { headers: { 'content-type': TIPO[nome.split('.').pop()], ...INTESTAZIONI } });
  } catch (_) {
    return new Response('', { status: 404 });
  }
}

// Chi tiene voci con un'icona dice quali rimandi usa: un file che nessuno nomina se ne va.
const utenti = new Map();
function usaCopie(chi, fn) { utenti.set(chi, fn); }

async function inUso() {
  const usati = new Set();
  for (const fn of utenti.values()) {
    for (const r of (await fn()) || []) { const n = nomeDa(r); if (n) usati.add(n); }
  }
  return usati;
}

const daGuardare = new Set();
let timer = null;
let giro = Promise.resolve();

// Le icone delle voci appena tolte: quella che nessun'altra voce nomina sparisce dal disco.
function togliSeOrfane(rifs) {
  for (const r of [].concat(rifs || [])) { const n = nomeDa(r); if (n) daGuardare.add(n); }
  if (daGuardare.size && !timer) timer = setTimeout(() => { timer = null; guarda(); }, 100);
  return giro;
}

function guarda() {
  giro = giro.then(() => fuoriIncognito(async () => {
    const nomi = [...daGuardare];
    daGuardare.clear();
    let usati;
    // Se uno dei magazzini non risponde non si sa chi le usa: non si toglie niente, si riprova.
    try { usati = await inUso(); } catch (_) { for (const n of nomi) daGuardare.add(n); return; }
    const ora = Date.now();
    for (const n of nomi) {
      if (usati.has(n)) continue;
      if (ora - (recenti.get(n) || 0) < GRAZIA_MS) { daGuardare.add(n); continue; }
      recenti.delete(n);
      await fsp.rm(path.join(cartella(), n), { force: true }).catch(() => {});
    }
  })).catch(() => {}).then(() => {
    if (daGuardare.size && !timer) timer = setTimeout(() => { timer = null; guarda(); }, GRAZIA_MS);
  });
  return giro;
}

// All'avvio: i file rimasti senza voce (un arresto fra la copia e la voce, una voce tolta da una strada che non avvisa).
async function pulisci() {
  let nomi = [];
  try { nomi = await fsp.readdir(cartella()); } catch (_) { return 0; }
  for (const n of nomi) if (NOME_RE.test(n)) daGuardare.add(n);
  for (const n of nomi) if (n.endsWith('.tmp')) await fsp.rm(path.join(cartella(), n), { force: true }).catch(() => {});
  await guarda();
  return nomi.length;
}

module.exports = {
  conserva, comeDato, risposta, usaCopie, togliSeOrfane, pulisci, cartella,
  eCopia, eLocale, nomeDa, PREFISSO, GRAZIA_MS,
};
if (process.env.NODE_ENV === 'test') globalThis.__filoCopieIcone = module.exports;

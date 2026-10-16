// Il motore del profilo segreto: segreti senza indice dentro un contenitore di byte casuali, aperti, creati, letti,
// scritti, riparati e cancellati partendo solo dal nome. Non scrive log, non tiene nomi, non dice cosa ha riparato.
// Formato e perché: patterns/il-profilo-segreto-non-ha-indice.md; prove in tests/unit/profiloSegreto.test.mjs.

'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const RS = require('./reedSolomon.js');
const { derivaChiavi, SALE_MIN } = require('./chiave.js');

const BLOCCO = 4096;
const NONCE = 12;
const TAG = 16;
const CHIARO = BLOCCO - NONCE - TAG;
// Dentro il cifrato: formato, k del gruppo, copia, blocco logico, versione, incarnazione. Il resto è carico.
const PREFISSO = 20;
const CARICO = CHIARO - PREFISSO;
const GRUPPO = RS.MAX_K;
const FORMATO = 1;
const DOMINIO = Buffer.from('filo-segreto/1');
const BLOCCHI_MIN = 16;
const ZERO = Buffer.alloc(CARICO);

const TESTA_FISSA = 32;
const TABELLA_IN_TESTA = CARICO - TESTA_FISSA;
const ESTENSIONI_MAX = Math.floor(TABELLA_IN_TESTA / 8);

// Letture andate a vuoto prima di dare persa una copia. Quando le letture a vuoto superano un sedicesimo del
// contenitore costa meno leggerlo tutto di fila, e la scansione trova anche le copie finite lontano.
const TENTATIVI_A_VUOTO = 32;
const SCANSIONE_OLTRE = 1 / 16;
const CATENA_MAX = 1 << 16;
const BLOCCHI_PER_LETTURA = 256;
const LETTURE_INSIEME = 8;
const GRUPPI_PER_LOTTO = 64;
const ETICHETTE_MAX = 0xffff;

const NESSUNO = Object.freeze({ esito: 'nessuno', messaggio: 'Nessun segreto con questo nome.' });

function errore(codice, messaggio, extra = {}) {
  return Object.assign(new Error(messaggio), { codice }, extra);
}

const cedi = () => new Promise((ok) => setImmediate(ok));

// NFC: lo stesso nome scritto su Mac (NFD) e su Windows deve dare la stessa chiave.
function normalizzaNome(nome) {
  const n = typeof nome === 'string' ? nome.normalize('NFC').trim() : '';
  if (!n) throw errore('NOME_VUOTO', 'Il nome del segreto non può essere vuoto.');
  return n;
}

function normalizzaNomeFile(nome) {
  const n = typeof nome === 'string' ? nome.normalize('NFC').trim() : '';
  if (!n) throw errore('NOME_FILE', 'Il nome del file non può essere vuoto.');
  return n;
}

function comeBuffer(dati) {
  if (Buffer.isBuffer(dati)) return dati;
  if (dati instanceof Uint8Array) return Buffer.from(dati.buffer, dati.byteOffset, dati.byteLength);
  if (dati instanceof ArrayBuffer) return Buffer.from(dati);
  if (typeof dati === 'string') return Buffer.from(dati, 'utf8');
  throw errore('DATI', 'Il contenuto di un file è testo o una sequenza di byte.');
}

// ── Formato del blocco ────────────────────────────────────────────────────────────────────────────────────────────

// Mai una posizione ricavata dal solo blocco logico senza chiave: chi non ha il nome non deve poterla calcolare.
function posizione(posto, N, j, c, r) {
  const m = Buffer.allocUnsafe(9);
  m.writeUInt32BE(j, 0);
  m[4] = c;
  m.writeUInt32BE(r, 5);
  return crypto.createHmac('sha256', posto).update(m).digest().readUIntBE(0, 6) % N;
}

function datoAssociato(p) {
  const b = Buffer.alloc(DOMINIO.length + 8);
  DOMINIO.copy(b);
  b.writeBigUInt64BE(BigInt(p), DOMINIO.length);
  return b;
}

// Nonce casuale a ogni scrittura: riscrivere lo stesso blocco con un nonce ricavato dalla posizione ripeterebbe
// chiave+nonce e romperebbe GCM. La posizione entra come dato associato: un blocco spostato non si apre.
function sigilla(cifra, p, chiaro) {
  const nonce = crypto.randomBytes(NONCE);
  const c = crypto.createCipheriv('aes-256-gcm', cifra, nonce);
  c.setAAD(datoAssociato(p));
  const corpo = Buffer.concat([c.update(chiaro), c.final()]);
  return Buffer.concat([nonce, corpo, c.getAuthTag()]);
}

function apriBlocco(cifra, p, blocco) {
  if (!blocco || blocco.length !== BLOCCO) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', cifra, blocco.subarray(0, NONCE));
    d.setAAD(datoAssociato(p));
    d.setAuthTag(blocco.subarray(BLOCCO - TAG));
    return Buffer.concat([d.update(blocco.subarray(NONCE, BLOCCO - TAG)), d.final()]);
  } catch (_) {
    return null;
  }
}

function componi({ k, c, j, v, inc }, carico) {
  const b = Buffer.alloc(CHIARO);
  b[0] = FORMATO;
  b[1] = k;
  b[2] = c;
  b.writeUInt32BE(j, 4);
  b.writeUInt32BE(v, 8);
  inc.copy(b, 12);
  if (carico) b.set(carico.subarray(0, CARICO), PREFISSO);
  return b;
}

function leggiPrefisso(chiaro) {
  if (!chiaro || chiaro.length !== CHIARO || chiaro[0] !== FORMATO) return null;
  const k = chiaro[1];
  const c = chiaro[2];
  const j = chiaro.readUInt32BE(4);
  if (k < 1 || k > GRUPPO || c > 1 || j % GRUPPO >= k) return null;
  return { k, c, j, v: chiaro.readUInt32BE(8), inc: chiaro.subarray(12, PREFISSO), carico: chiaro.subarray(PREFISSO) };
}

function tuttoZero(b) {
  for (let x = 0; x < b.length; x++) if (b[x]) return false;
  return true;
}

function pieno(carico) {
  if (carico.length === CARICO) return carico;
  const b = Buffer.alloc(CARICO);
  b.set(carico.subarray(0, CARICO));
  return b;
}

function estensioni(blocchi) {
  const out = [];
  for (const j of blocchi) {
    const u = out[out.length - 1];
    if (u && u[0] + u[1] === j) u[1]++;
    else out.push([j, 1]);
  }
  return out;
}

function daEstensioni(est) {
  const out = [];
  for (const [s, n] of est) for (let x = 0; x < n; x++) out.push(s + x);
  return out;
}

// La testa (blocco logico 0): numero di blocchi, date, contatore delle versioni e la tabella dei file, dentro se ci
// sta, altrimenti le estensioni dei blocchi che la contengono.
function scriviTesta({ L, creato, aperto, contatore, bytes, blocchiTabella }) {
  const b = Buffer.alloc(CARICO);
  b[0] = 1;
  b.writeUInt32BE(L, 4);
  b.writeDoubleBE(creato, 8);
  b.writeDoubleBE(aperto, 16);
  b.writeUInt32BE(contatore, 24);
  b.writeUInt32BE(bytes.length, 28);
  if (!blocchiTabella.length) {
    bytes.copy(b, TESTA_FISSA);
    return b;
  }
  const est = estensioni(blocchiTabella);
  b[1] = 1;
  b.writeUInt16BE(est.length, 2);
  est.forEach(([s, n], x) => {
    b.writeUInt32BE(s, TESTA_FISSA + 8 * x);
    b.writeUInt32BE(n, TESTA_FISSA + 8 * x + 4);
  });
  return b;
}

function leggiTesta(carico) {
  if (!carico || carico.length < CARICO || carico[0] !== 1 || carico[1] > 1) return null;
  const L = carico.readUInt32BE(4);
  const lunghezza = carico.readUInt32BE(28);
  if (L < 1) return null;
  const t = { L, creato: carico.readDoubleBE(8), aperto: carico.readDoubleBE(16), contatore: carico.readUInt32BE(24), lunghezza };
  if (carico[1] === 0) {
    if (lunghezza > TABELLA_IN_TESTA) return null;
    t.inTesta = Buffer.from(carico.subarray(TESTA_FISSA, TESTA_FISSA + lunghezza));
    t.blocchiTabella = [];
    return t;
  }
  const n = carico.readUInt16BE(2);
  if (n < 1 || n > ESTENSIONI_MAX) return null;
  const est = [];
  for (let x = 0; x < n; x++) est.push([carico.readUInt32BE(TESTA_FISSA + 8 * x), carico.readUInt32BE(TESTA_FISSA + 8 * x + 4)]);
  t.blocchiTabella = daEstensioni(est);
  if (t.blocchiTabella.length !== Math.ceil(lunghezza / CARICO) || t.blocchiTabella.some((j) => j < 1 || j >= L)) return null;
  return t;
}

// `x` (file rovinato) sempre scritto, 0 o 1: segnarlo non cambia la lunghezza della tabella, che si riscrive sul posto.
function serializzaTabella(tabella) {
  const f = [...tabella].map(([n, v]) => ({ n, d: v.d, c: v.c, m: v.m, e: v.e, x: v.x ? 1 : 0 }));
  return Buffer.from(JSON.stringify({ f }), 'utf8');
}

function leggiTabella(bytes, L) {
  let o;
  try {
    o = JSON.parse(bytes.toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!o || !Array.isArray(o.f)) return null;
  const t = new Map();
  for (const v of o.f) {
    if (!v || typeof v.n !== 'string' || !v.n || !Number.isSafeInteger(v.d) || v.d < 0 || !Array.isArray(v.e)) continue;
    const blocchi = v.e.reduce((n, x) => n + (Array.isArray(x) ? x[1] : 0), 0);
    const dentro = v.e.every((x) => Array.isArray(x) && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[0] >= 1 && x[1] >= 1 && x[0] + x[1] <= L);
    if (!dentro || blocchi !== Math.ceil(v.d / CARICO)) continue;
    t.set(v.n, { d: v.d, c: Number(v.c) || 0, m: Number(v.m) || 0, e: v.e.map((x) => [x[0], x[1]]), x: v.x ? 1 : 0 });
  }
  return t;
}

function blocchiUsati(L, tabella, blocchiTabella) {
  const u = new Uint8Array(L);
  u[0] = 1;
  for (const j of blocchiTabella) if (j < L) u[j] = 1;
  for (const f of tabella.values()) for (const [s, n] of f.e) for (let x = 0; x < n; x++) if (s + x < L) u[s + x] = 1;
  return u;
}

// ── Contenitore ───────────────────────────────────────────────────────────────────────────────────────────────────

function controllaDimensione(dimensione) {
  if (!Number.isSafeInteger(dimensione) || dimensione % BLOCCO || dimensione < BLOCCO * BLOCCHI_MIN) {
    throw errore('CONTENITORE', `La dimensione del contenitore è un multiplo di ${BLOCCO} byte, da ${BLOCCO * BLOCCHI_MIN} in su.`);
  }
}

async function scriviTutto(fh, buf, pos) {
  let fatto = 0;
  while (fatto < buf.length) {
    const { bytesWritten } = await fh.write(buf, fatto, buf.length - fatto, pos + fatto);
    fatto += bytesWritten;
  }
}

// Mai sopra un contenitore che c'è già: dentro potrebbero esserci segreti, e niente direbbe che si sono persi.
async function creaContenitore(percorso, dimensione) {
  controllaDimensione(dimensione);
  if (await fsp.stat(percorso).then(() => true, () => false)) throw errore('CONTENITORE', 'Il contenitore esiste già.');
  const provvisorio = `${percorso}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fh = await fsp.open(provvisorio, 'wx');
  try {
    for (let s = 0; s < dimensione; s += 4 << 20) await scriviTutto(fh, crypto.randomBytes(Math.min(4 << 20, dimensione - s)), s);
    await fh.datasync();
    await fh.close();
    if (await fsp.stat(percorso).then(() => true, () => false)) throw errore('CONTENITORE', 'Il contenitore esiste già.');
    await fsp.rename(provvisorio, percorso);
  } catch (e) {
    await fh.close().catch(() => {});
    await fsp.rm(provvisorio, { force: true }).catch(() => {});
    throw e;
  }
}

// Due modi di scrivere lo stesso percorso sono lo stesso file: la coda si tiene per file, non per stringa.
async function chiaveContenitore(percorso) {
  if (typeof percorso !== 'string' || !percorso) throw errore('CONTENITORE', 'Manca il percorso del contenitore.');
  const st = await fsp.stat(percorso, { bigint: true }).catch(() => null);
  if (!st || !st.isFile()) throw errore('CONTENITORE', 'Il contenitore non c’è.');
  return `${st.dev}:${st.ino}`;
}

async function apriContenitore(percorso, dimensione) {
  controllaDimensione(dimensione);
  let fh;
  try {
    fh = await fsp.open(percorso, 'r+');
  } catch (e) {
    throw errore('CONTENITORE', 'Il contenitore non si apre.', { causa: e.code });
  }
  const st = await fh.stat();
  if (st.size !== dimensione) {
    await fh.close();
    throw errore('CONTENITORE', 'Il contenitore non ha la dimensione attesa.');
  }
  return { fh, N: dimensione / BLOCCO, mappa: null };
}

const code = new Map();
function inCoda(chiave, fn) {
  const prima = code.get(chiave) || Promise.resolve();
  const corsa = prima.then(fn, fn);
  const coda = corsa.catch(() => {});
  code.set(chiave, coda);
  coda.then(() => { if (code.get(chiave) === coda) code.delete(chiave); });
  return corsa;
}

async function leggiPosizioni(ctx, posizioni) {
  const ordinate = [...new Set(posizioni)].sort((a, b) => a - b);
  const corse = [];
  for (const p of ordinate) {
    const u = corse[corse.length - 1];
    if (u && p - (u[0] + u[1]) <= 4 && p - u[0] < BLOCCHI_PER_LETTURA) u[1] = p - u[0] + 1;
    else corse.push([p, 1]);
  }
  const vogliamo = new Set(ordinate);
  const out = new Map();
  let x = 0;
  const lavora = async () => {
    while (x < corse.length) {
      const [s, n] = corse[x++];
      const buf = Buffer.allocUnsafe(n * BLOCCO);
      const { bytesRead } = await ctx.fh.read(buf, 0, buf.length, s * BLOCCO);
      for (let q = 0; q < n; q++) {
        if (vogliamo.has(s + q) && (q + 1) * BLOCCO <= bytesRead) out.set(s + q, buf.subarray(q * BLOCCO, (q + 1) * BLOCCO));
      }
    }
  };
  await Promise.all(Array.from({ length: LETTURE_INSIEME }, lavora));
  return out;
}

async function scriviPosizioni(ctx, voci) {
  const perPosizione = new Map();
  for (const v of voci) perPosizione.set(v.p, v.buf);
  const ordinate = [...perPosizione.keys()].sort((a, b) => a - b);
  const corse = [];
  for (const p of ordinate) {
    const u = corse[corse.length - 1];
    if (u && u.p + u.bufs.length === p && u.bufs.length < BLOCCHI_PER_LETTURA) u.bufs.push(perPosizione.get(p));
    else corse.push({ p, bufs: [perPosizione.get(p)] });
  }
  let x = 0;
  const lavora = async () => {
    while (x < corse.length) {
      const c = corse[x++];
      await scriviTutto(ctx.fh, c.bufs.length === 1 ? c.bufs[0] : Buffer.concat(c.bufs), c.p * BLOCCO);
    }
  };
  await Promise.all(Array.from({ length: LETTURE_INSIEME }, lavora));
}

// ── Stato di un segreto ───────────────────────────────────────────────────────────────────────────────────────────

// Identità di una copia: i = 2·j + c (blocco logico j, copia c: 0 il dato, 1 la parità che gli sta accanto nel gruppo).
function nuovoStato(chiavi, etichetta, N) {
  return {
    etichetta, cifra: chiavi.cifra, posto: chiavi.posto, inc: null, L: 0, contatore: 0, vmax: 0,
    pos: new Float64Array(0), ver: new Uint32Array(0), kk: new Uint8Array(0), zero: new Uint8Array(0),
    gruppi: [], tabella: new Map(), blocchiTabella: [], creato: 0, aperto: 0, apertoPrima: 0,
    letti: new Uint8Array(N), vuote: 0, scansionato: false, spazzatura: new Set(), candidati: null,
  };
}

function cancellaChiavi(S) {
  S.cifra.fill(0);
  S.posto.fill(0);
}

function dimensiona(S, L) {
  const n = 2 * L;
  if (S.pos.length >= n) return;
  const cap = Math.max(n, S.pos.length * 2, 2 * GRUPPO);
  const pos = new Float64Array(cap).fill(-1);
  pos.set(S.pos);
  const ver = new Uint32Array(cap);
  ver.set(S.ver);
  const kk = new Uint8Array(cap);
  kk.set(S.kk);
  const zero = new Uint8Array(cap >> 1);
  zero.set(S.zero);
  Object.assign(S, { pos, ver, kk, zero });
}

function occupa(ctx, p, etichetta) {
  if (!ctx.mappa.occ[p]) ctx.mappa.vive++;
  ctx.mappa.occ[p] = etichetta;
}

function libera(ctx, p) {
  if (ctx.mappa.occ[p]) ctx.mappa.vive--;
  ctx.mappa.occ[p] = 0;
}

const kAtteso = (S, g) => Math.min(GRUPPO, S.L - GRUPPO * g);

function valida(S, g, i) {
  const info = S.gruppi[g];
  return !!info && S.pos[i] >= 0 && S.ver[i] === info.v && S.kk[i] === info.k;
}

function registra(ctx, S, p, pre) {
  const zero = pre.zero !== undefined ? pre.zero : (pre.c === 0 && tuttoZero(pre.carico));
  S.vmax = Math.max(S.vmax, pre.v);
  if (S.candidati) {
    S.candidati.push({ p, k: pre.k, c: pre.c, j: pre.j, v: pre.v, zero, inc: Buffer.from(pre.inc), carico: pre.j < GRUPPO ? Buffer.from(pre.carico) : null });
    const i = 2 * pre.j + pre.c;
    if (i < S.pos.length && S.pos[i] < 0) S.pos[i] = p;
    occupa(ctx, p, S.etichetta);
    return;
  }
  if (!pre.inc.equals(S.inc) || pre.j >= S.L) {
    S.spazzatura.add(p);
    return;
  }
  const i = 2 * pre.j + pre.c;
  const prima = S.pos[i];
  if (prima >= 0 && prima !== p) {
    if (pre.v <= S.ver[i]) {
      S.spazzatura.add(p);
      return;
    }
    libera(ctx, prima);
    S.spazzatura.add(prima);
  }
  S.pos[i] = p;
  S.ver[i] = pre.v;
  S.kk[i] = pre.k;
  if (pre.c === 0) S.zero[pre.j] = zero ? 1 : 0;
  occupa(ctx, p, S.etichetta);
}

// Prova per ogni copia le posizioni r = 0, 1, 2… finché l'autenticazione passa. Una posizione già nota (di questo o di
// un altro segreto in mano) si salta senza leggerla: lì la copia cercata non può stare.
async function cerca(ctx, S, ids, { pota = false } = {}) {
  const attivi = new Map();
  for (const i of ids) if (!(S.pos[i] >= 0)) attivi.set(i, { r: 0, vuoti: 0 });
  const occ = ctx.mappa.occ;
  let calcoli = 0;
  while (attivi.size && !S.scansionato) {
    if (pota) {
      const kMax = S.candidati.reduce((m, c) => (c.j < GRUPPO ? Math.max(m, c.k) : m), 0);
      if (kMax) for (const i of attivi.keys()) if ((i >> 1) >= kMax) attivi.delete(i);
      if (!attivi.size) break;
    }
    if (S.vuote > ctx.N * SCANSIONE_OLTRE) {
      await scansiona(ctx, S);
      break;
    }
    const lotto = new Map();
    for (const [i, a] of attivi) {
      if (S.pos[i] >= 0) {
        attivi.delete(i);
        continue;
      }
      let p = -1;
      while (a.r < CATENA_MAX) {
        if (++calcoli % 4096 === 0) await cedi();
        const q = posizione(S.posto, ctx.N, i >> 1, i & 1, a.r);
        if (occ[q] || S.spazzatura.has(q)) {
          a.r++;
          continue;
        }
        if (S.letti[q]) {
          a.r++;
          if (++a.vuoti > TENTATIVI_A_VUOTO) break;
          continue;
        }
        p = q;
        break;
      }
      if (p < 0) {
        attivi.delete(i);
        continue;
      }
      if (!lotto.has(p)) lotto.set(p, []);
      lotto.get(p).push(i);
    }
    if (!lotto.size) break;
    const blocchi = await leggiPosizioni(ctx, [...lotto.keys()]);
    for (const [p, chi] of lotto) {
      const pre = leggiPrefisso(apriBlocco(S.cifra, p, blocchi.get(p)));
      if (pre) registra(ctx, S, p, pre);
      else {
        S.letti[p] = 1;
        S.vuote++;
      }
      for (const i of chi) {
        const a = attivi.get(i);
        if (!a) continue;
        if (S.pos[i] >= 0) {
          attivi.delete(i);
          continue;
        }
        a.r++;
        if (!pre && ++a.vuoti > TENTATIVI_A_VUOTO) attivi.delete(i);
      }
    }
    await cedi();
  }
}

async function scansiona(ctx, S) {
  S.scansionato = true;
  const occ = ctx.mappa.occ;
  for (let s = 0; s < ctx.N; s += BLOCCHI_PER_LETTURA) {
    const n = Math.min(BLOCCHI_PER_LETTURA, ctx.N - s);
    const buf = Buffer.allocUnsafe(n * BLOCCO);
    await ctx.fh.read(buf, 0, buf.length, s * BLOCCO);
    for (let q = 0; q < n; q++) {
      const p = s + q;
      if (occ[p] || S.letti[p] || S.spazzatura.has(p)) continue;
      const pre = leggiPrefisso(apriBlocco(S.cifra, p, buf.subarray(q * BLOCCO, (q + 1) * BLOCCO)));
      if (pre) registra(ctx, S, p, pre);
      else S.letti[p] = 1;
    }
    await cedi();
  }
}

// La testa più recente fra quelle che si decodificano: un'incarnazione vecchia dello stesso nome (un segreto
// ricreato dopo averlo perso) non vince su quella nuova.
function scegliTesta(S, N) {
  const perInc = new Map();
  for (const c of S.candidati) {
    if (c.j >= GRUPPO) continue;
    const h = c.inc.toString('hex');
    if (!perInc.has(h)) perInc.set(h, []);
    perInc.get(h).push(c);
  }
  let migliore = null;
  for (const lista of perInc.values()) {
    for (const v of [...new Set(lista.map((c) => c.v))].sort((a, b) => b - a)) {
      const copie = lista.filter((c) => c.v === v);
      const k = copie[0].k;
      const presenti = new Map();
      for (const c of copie) if (c.k === k && c.j < k) presenti.set(c.c === 0 ? c.j : k + c.j, c.carico);
      const dati = presenti.size >= k ? RS.ricostruisci(k, presenti) : null;
      const testa = dati && leggiTesta(Buffer.from(dati[0]));
      if (!testa || testa.L > N) continue;
      if (!migliore || testa.aperto > migliore.testa.aperto) migliore = { inc: lista[0].inc, testa };
      break;
    }
  }
  return migliore;
}

function fissaIncarnazione(ctx, S, scelta) {
  const candidati = S.candidati;
  S.candidati = null;
  for (const c of candidati) libera(ctx, c.p);
  const { testa } = scelta;
  Object.assign(S, {
    inc: Buffer.from(scelta.inc), L: testa.L, creato: testa.creato, aperto: testa.aperto,
    contatore: Math.max(testa.contatore, S.vmax),
    pos: new Float64Array(0), ver: new Uint32Array(0), kk: new Uint8Array(0), zero: new Uint8Array(0),
  });
  dimensiona(S, S.L);
  for (const c of candidati) registra(ctx, S, c.p, c);
}

function analizzaGruppi(S) {
  const G = Math.ceil(S.L / GRUPPO);
  S.gruppi = new Array(G).fill(null);
  for (let g = 0; g < G; g++) {
    const conta = new Map();
    const base = 2 * GRUPPO * g;
    for (let i = base; i < base + 2 * kAtteso(S, g); i++) {
      if (S.pos[i] < 0) continue;
      const k = S.kk[i];
      if ((i >> 1) - GRUPPO * g >= k) continue;
      const voce = conta.get(S.ver[i]) || { k, n: 0 };
      if (voce.k !== k) continue;
      voce.n++;
      conta.set(S.ver[i], voce);
    }
    for (const v of [...conta.keys()].sort((a, b) => b - a)) {
      const { k, n } = conta.get(v);
      if (n >= k) {
        S.gruppi[g] = { v, k };
        break;
      }
    }
  }
}

// I k blocchi di dati della versione buona del gruppo, ricostruiti dalla parità se serve; null se ne restano meno di k.
async function decodificaGruppo(ctx, S, g) {
  const info = S.gruppi[g];
  if (!info) return null;
  const { k, v } = info;
  const base = 2 * GRUPPO * g;
  const presenti = new Map();
  const prova = async (ids) => {
    const buone = ids.filter((i) => S.pos[i] >= 0 && S.ver[i] === v && S.kk[i] === k);
    const blocchi = await leggiPosizioni(ctx, buone.map((i) => S.pos[i]));
    for (const i of buone) {
      const pre = leggiPrefisso(apriBlocco(S.cifra, S.pos[i], blocchi.get(S.pos[i])));
      if (!pre || !pre.inc.equals(S.inc) || 2 * pre.j + pre.c !== i || pre.v !== v || pre.k !== k) continue;
      const s = pre.j - GRUPPO * g;
      presenti.set(pre.c === 0 ? s : k + s, Buffer.from(pre.carico));
    }
  };
  await prova(Array.from({ length: k }, (_, s) => base + 2 * s));
  if (presenti.size < k) await prova(Array.from({ length: k }, (_, s) => base + 2 * s + 1));
  return RS.ricostruisci(k, presenti);
}

// I carichi dei blocchi del gruppo dentro L: null per quelli che la versione buona non copre o se il gruppo è perso.
async function carichiGruppo(ctx, S, g) {
  const ke = kAtteso(S, g);
  const dati = await decodificaGruppo(ctx, S, g);
  return Array.from({ length: ke }, (_, s) => (dati && s < dati.length ? dati[s] : null));
}

async function caricaTabella(ctx, S, testa) {
  S.tabella = new Map();
  S.blocchiTabella = [];
  let bytes = testa.inTesta;
  if (!bytes) {
    const pezzi = [];
    const perGruppo = new Map();
    for (const j of testa.blocchiTabella) {
      const g = Math.floor(j / GRUPPO);
      if (!perGruppo.has(g)) perGruppo.set(g, await carichiGruppo(ctx, S, g));
      const c = perGruppo.get(g)[j - GRUPPO * g];
      if (!c) return;
      pezzi.push(c);
    }
    bytes = Buffer.concat(pezzi).subarray(0, testa.lunghezza);
  }
  const t = leggiTabella(bytes, S.L);
  if (!t) return;
  S.tabella = t;
  S.blocchiTabella = testa.blocchiTabella;
}

async function caricaSegreto(ctx, S) {
  dimensiona(S, GRUPPO);
  S.candidati = [];
  await cerca(ctx, S, Array.from({ length: 2 * GRUPPO }, (_, i) => i), { pota: true });
  const scelta = scegliTesta(S, ctx.N);
  if (!scelta) {
    for (const c of S.candidati) libera(ctx, c.p);
    S.candidati = null;
    return false;
  }
  fissaIncarnazione(ctx, S, scelta);
  const ids = [];
  for (let i = 0; i < 2 * S.L; i++) if (S.pos[i] < 0) ids.push(i);
  await cerca(ctx, S, ids);
  analizzaGruppi(S);
  await caricaTabella(ctx, S, scelta.testa);
  return true;
}

// ── Scrittura ─────────────────────────────────────────────────────────────────────────────────────────────────────

function colloca(ctx, S, i) {
  const occ = ctx.mappa.occ;
  for (let r = 0; r < CATENA_MAX; r++) {
    const p = posizione(S.posto, ctx.N, i >> 1, i & 1, r);
    if (occ[p]) continue;
    S.spazzatura.delete(p);
    occupa(ctx, p, S.etichetta);
    S.pos[i] = p;
    return p;
  }
  return -1;
}

async function scriviSigillati(ctx, S, voci) {
  for (let x = 0; x < voci.length; x += 1024) {
    const fetta = voci.slice(x, x + 1024);
    await scriviPosizioni(ctx, fetta.map((v) => ({ p: v.p, buf: sigilla(S.cifra, v.p, v.chiaro) })));
    for (const v of fetta) {
      S.pos[v.i] = v.p;
      S.ver[v.i] = v.v;
      S.kk[v.i] = v.k;
      if (!(v.i & 1)) S.zero[v.i >> 1] = tuttoZero(v.chiaro.subarray(PREFISSO)) ? 1 : 0;
    }
    await cedi();
  }
}

async function distruggi(ctx, S, ids) {
  const vive = ids.filter((i) => S.pos[i] >= 0);
  await scriviPosizioni(ctx, vive.map((i) => ({ p: S.pos[i], buf: crypto.randomBytes(BLOCCO) })));
  for (const i of vive) {
    libera(ctx, S.pos[i]);
    S.pos[i] = -1;
    S.ver[i] = 0;
    S.kk[i] = 0;
  }
}

async function distruggiSpazzatura(ctx, S) {
  const posti = [...S.spazzatura].filter((p) => !ctx.mappa.occ[p]);
  S.spazzatura.clear();
  await scriviPosizioni(ctx, posti.map((p) => ({ p, buf: crypto.randomBytes(BLOCCO) })));
}

// Riscrive gruppi interi con una versione nuova. Prima le copie che vanno in posti nuovi, poi quelle sopra la versione
// vecchia, poi via quelle in più: a ogni interruzione resta decodificabile la versione vecchia o la nuova.
async function riscriviGruppi(ctx, S, voci, { sincronizza = false } = {}) {
  for (let x = 0; x < voci.length; x += GRUPPI_PER_LOTTO) {
    const fase1 = [];
    const fase2 = [];
    const via = [];
    for (const { g, carichi } of voci.slice(x, x + GRUPPI_PER_LOTTO)) {
      const pieni = carichi.map(pieno);
      const k = pieni.length;
      const v = ++S.contatore;
      const par = RS.parita(pieni);
      const base = 2 * GRUPPO * g;
      for (let s = 0; s < k; s++) {
        for (const c of [0, 1]) {
          const i = base + 2 * s + c;
          const sopra = valida(S, g, i);
          const p = S.pos[i] >= 0 ? S.pos[i] : colloca(ctx, S, i);
          if (p < 0) continue;
          const chiaro = componi({ k, c, j: i >> 1, v, inc: S.inc }, c ? par[s] : pieni[s]);
          (sopra ? fase2 : fase1).push({ p, i, chiaro, v, k });
        }
      }
      for (let i = base + 2 * k; i < Math.min(base + 2 * GRUPPO, S.pos.length); i++) if (S.pos[i] >= 0) via.push(i);
      S.gruppi[g] = { v, k };
    }
    await scriviSigillati(ctx, S, fase1);
    if (sincronizza && fase2.length) await ctx.fh.datasync();
    await scriviSigillati(ctx, S, fase2);
    await distruggi(ctx, S, via);
  }
}

// Le copie mancanti di un gruppo integro altrove, con la stessa versione e lo stesso contenuto di prima.
async function restauraMancanti(ctx, S, gruppi) {
  const voci = [];
  for (const g of gruppi) {
    const info = S.gruppi[g];
    const dati = await decodificaGruppo(ctx, S, g);
    if (!dati) continue;
    const par = RS.parita(dati);
    const base = 2 * GRUPPO * g;
    for (let s = 0; s < Math.min(info.k, kAtteso(S, g)); s++) {
      for (const c of [0, 1]) {
        const i = base + 2 * s + c;
        if (valida(S, g, i)) continue;
        const p = S.pos[i] >= 0 ? S.pos[i] : colloca(ctx, S, i);
        if (p < 0) continue;
        voci.push({ p, i, chiaro: componi({ k: info.k, c, j: i >> 1, v: info.v, inc: S.inc }, c ? par[s] : dati[s]), v: info.v, k: info.k });
      }
    }
    if (voci.length >= 1024) await scriviSigillati(ctx, S, voci.splice(0));
  }
  await scriviSigillati(ctx, S, voci);
}

function marcaDanneggiati(tabella, blocchi) {
  let cambiata = false;
  for (const [n, f] of tabella) {
    if (f.x) continue;
    if (f.e.some(([s, m]) => blocchi.some((j) => j >= s && j < s + m))) {
      tabella.set(n, { ...f, x: 1 });
      cambiata = true;
    }
  }
  return cambiata;
}

// La testa si scrive per ultima: è lei che rende vero quello che i gruppi già scritti contengono.
async function scriviTestaGruppo(ctx, S, { nuovi = new Map(), bytes = serializzaTabella(S.tabella) } = {}) {
  const ke = kAtteso(S, 0);
  const vecchi = await carichiGruppo(ctx, S, 0);
  const usati = blocchiUsati(S.L, S.tabella, S.blocchiTabella);
  const carichi = [null];
  for (let s = 1; s < ke; s++) {
    if (!nuovi.has(s) && usati[s] && !vecchi[s]) throw daRiaprire();
    carichi[s] = nuovi.get(s) || (usati[s] && vecchi[s]) || ZERO;
  }
  carichi[0] = scriviTesta({
    L: S.L, creato: S.creato, aperto: S.aperto, contatore: S.contatore + 1, bytes, blocchiTabella: S.blocchiTabella,
  });
  await riscriviGruppi(ctx, S, [{ g: 0, carichi }], { sincronizza: true });
  await ctx.fh.datasync();
}

function libere(ctx) {
  return ctx.N - ctx.mappa.vive;
}

// Dove vanno i blocchi nuovi: prima quelli liberi dentro il segreto, poi in coda. Quelli in uso restano intatti fino
// alla testa nuova (si scrive accanto, non sopra), tranne `riusa`, che chi chiama sta buttando comunque.
function pianifica(S, fisicheLibere, modifica, { riusa = [] } = {}) {
  const usati = blocchiUsati(S.L, S.tabella, S.blocchiTabella);
  for (const j of riusa) usati[j] = 0;
  const liberi = [];
  for (let j = 1; j < S.L; j++) if (!usati[j]) liberi.push(j);
  let li = 0;
  let coda = S.L;
  const prendi = () => (li < liberi.length ? liberi[li++] : coda++);
  const tabella = new Map(S.tabella);
  const extra = modifica(tabella, prendi) || {};
  const bytes = serializzaTabella(tabella);
  let blocchiTabella = [];
  if (bytes.length > TABELLA_IN_TESTA) {
    const t = Math.ceil(bytes.length / CARICO);
    blocchiTabella = Array.from({ length: t }, prendi);
    if (estensioni(blocchiTabella).length > ESTENSIONI_MAX) blocchiTabella = Array.from({ length: t }, () => coda++);
  }
  const L2 = Math.max(S.L, coda);
  if (2 * (L2 - S.L) > fisicheLibere) return null;
  return { ...extra, tabella, bytes, blocchiTabella, L2 };
}

function pianoScrittura(S, fisicheLibere, nome, lunghezza, ora, { senzaVecchio = false } = {}) {
  const vecchio = S.tabella.get(nome);
  const riusa = senzaVecchio && vecchio ? daEstensioni(vecchio.e) : [];
  return pianifica(S, fisicheLibere, (tabella, prendi) => {
    if (senzaVecchio) tabella.delete(nome);
    const blocchiFile = Array.from({ length: Math.ceil(lunghezza / CARICO) }, prendi);
    tabella.set(nome, { d: lunghezza, c: vecchio ? vecchio.c : ora, m: ora, e: estensioni(blocchiFile), x: 0 });
    return { blocchiFile };
  }, { riusa });
}

// Il file più grande che ci sta adesso sotto quel nome, contando come libero quello che il file vecchio lascerebbe.
function massimoScrivibile(S, fisicheLibere, nome) {
  const ora = Date.now();
  const ci = (n) => !!pianoScrittura(S, fisicheLibere, nome, n, ora, { senzaVecchio: true });
  if (!ci(0)) return 0;
  const vecchio = S.tabella.get(nome);
  const liberi = S.L - blocchiUsati(S.L, S.tabella, S.blocchiTabella).reduce((a, b) => a + b, 0);
  let basso = 0;
  let alto = (liberi + Math.floor(fisicheLibere / 2) + (vecchio ? daEstensioni(vecchio.e).length : 0)) * CARICO;
  while (basso < alto) {
    const m = Math.floor((basso + alto + 1) / 2);
    if (ci(m)) basso = m;
    else alto = m - 1;
  }
  return basso;
}

async function crescita(ctx, S, L2) {
  const posti = [];
  dimensiona(S, L2);
  for (let i = 2 * S.L; i < 2 * L2; i++) {
    if (S.pos[i] >= 0) continue;
    const p = colloca(ctx, S, i);
    if (p < 0) {
      for (const q of posti) {
        libera(ctx, S.pos[q]);
        S.pos[q] = -1;
      }
      throw errore('SPAZIO', 'Nel contenitore non resta un posto per i blocchi nuovi.', { servono: 0, disponibili: 0, prima: true });
    }
    posti.push(i);
  }
  // La testa conosce i blocchi nuovi prima che esistano: un'interruzione lascia blocchi vuoti dentro il segreto,
  // mai copie valide fuori, che una crescita dopo scambierebbe per sue.
  S.L = L2;
  await scriviTestaGruppo(ctx, S);
}

// Un gruppo che non si decodifica più mentre il segreto è aperto l'ha toccato qualcun altro: la vista in memoria non
// vale più, e la riapertura ritrova tutto e segna i file rovinati.
function daRiaprire() {
  return errore('RIAPRI', 'Il segreto è cambiato mentre era aperto: va riaperto col suo nome.');
}

async function transazione(ctx, S, piano, dati) {
  const { tabella, bytes, blocchiTabella, L2 } = piano;
  for (let x = 0; x < blocchiTabella.length; x++) dati.set(blocchiTabella[x], bytes.subarray(x * CARICO, (x + 1) * CARICO));
  const prima = blocchiUsati(S.L, S.tabella, S.blocchiTabella);
  const Lprima = S.L;
  const gruppi = [...new Set([...dati.keys()].filter((j) => j >= GRUPPO).map((j) => Math.floor(j / GRUPPO)))].sort((a, b) => a - b);
  // Prima di scrivere: il contenuto vecchio che deve restare accanto ai blocchi nuovi.
  const vecchi = new Map();
  for (const g of gruppi) {
    if (GRUPPO * g >= Lprima) continue;
    const servono = [];
    for (let s = 0; s < Math.min(GRUPPO, Lprima - GRUPPO * g); s++) if (!dati.has(GRUPPO * g + s) && prima[GRUPPO * g + s]) servono.push(s);
    if (!servono.length) continue;
    const c = await carichiGruppo(ctx, S, g);
    if (servono.some((s) => !c[s])) throw daRiaprire();
    vecchi.set(g, c);
  }
  if (L2 > S.L) await crescita(ctx, S, L2);
  for (let x = 0; x < gruppi.length; x += GRUPPI_PER_LOTTO) {
    await riscriviGruppi(ctx, S, gruppi.slice(x, x + GRUPPI_PER_LOTTO).map((g) => ({
      g,
      carichi: Array.from({ length: kAtteso(S, g) }, (_, s) => {
        const j = GRUPPO * g + s;
        if (dati.has(j)) return dati.get(j);
        const v = vecchi.get(g);
        return (j < Lprima && prima[j] && v && v[s]) || ZERO;
      }),
    })));
  }
  await ctx.fh.datasync();
  S.tabella = tabella;
  S.blocchiTabella = blocchiTabella;
  await scriviTestaGruppo(ctx, S, { nuovi: new Map([...dati].filter(([j]) => j < GRUPPO)), bytes });
  await liberaEStringi(ctx, S, prima);
}

// Azzera i blocchi che la testa nuova non usa più (il contenuto di un file cancellato non resta leggibile a chi ha il
// nome) e accorcia il segreto se la coda è libera: prima si distrugge, poi la testa dice il numero nuovo.
async function liberaEStringi(ctx, S, prima) {
  const ora = blocchiUsati(S.L, S.tabella, S.blocchiTabella);
  const liberati = [];
  for (let j = 1; j < prima.length; j++) if (prima[j] && !ora[j]) liberati.push(j);
  let L3 = 1;
  for (let j = S.L - 1; j >= 1; j--) if (ora[j]) { L3 = j + 1; break; }
  if (!liberati.length && L3 >= S.L) return;
  const Lprima = S.L;
  const G3 = Math.ceil(L3 / GRUPPO);
  const daRiscrivere = new Set(liberati.filter((j) => j >= GRUPPO && j < L3).map((j) => Math.floor(j / GRUPPO)));
  if (L3 < Lprima && L3 % GRUPPO && G3 - 1 >= 1) daRiscrivere.add(G3 - 1);
  const voci = [];
  for (const g of [...daRiscrivere].sort((a, b) => a - b)) {
    const vecchi = await carichiGruppo(ctx, S, g);
    const ke = Math.min(GRUPPO, L3 - GRUPPO * g);
    voci.push({ g, carichi: Array.from({ length: ke }, (_, s) => (ora[GRUPPO * g + s] && vecchi[s]) || ZERO) });
  }
  await riscriviGruppi(ctx, S, voci);
  const oltre = [];
  for (let i = 2 * GRUPPO * Math.max(G3, 1); i < 2 * Lprima; i++) if (S.pos[i] >= 0) oltre.push(i);
  await distruggi(ctx, S, oltre);
  S.gruppi.length = Math.max(G3, 1);
  await ctx.fh.datasync();
  S.L = L3;
  await scriviTestaGruppo(ctx, S);
}

// ── Riparazione ───────────────────────────────────────────────────────────────────────────────────────────────────

// Un segreto dichiarato si rimette com'era: copie mancanti al loro posto, stessa versione. Un gruppo perso resta
// com'è, così il suo proprietario se ne accorge alla prossima apertura invece di trovarci zeri.
async function riparaDichiarato(ctx, D) {
  const daRestaurare = [];
  for (let g = 0; g < D.gruppi.length; g++) {
    const info = D.gruppi[g];
    if (!info) continue;
    const base = 2 * GRUPPO * g;
    const n = 2 * Math.min(info.k, kAtteso(D, g));
    for (let i = base; i < base + n; i++) {
      if (!valida(D, g, i)) {
        daRestaurare.push(g);
        break;
      }
    }
  }
  await restauraMancanti(ctx, D, daRestaurare);
}

// Niente qui restituisce o registra cosa è stato riparato: un «riparati N blocchi» direbbe che esistono altri segreti.
async function riparaProprio(ctx, S) {
  const G = Math.ceil(S.L / GRUPPO);
  const usati = blocchiUsati(S.L, S.tabella, S.blocchiTabella);
  const tabella = new Map(S.tabella);
  const persi = [];
  const parziali = [];
  const intere = [];
  for (let g = 1; g < G; g++) {
    const ke = kAtteso(S, g);
    const info = S.gruppi[g];
    const blocchi = Array.from({ length: ke }, (_, s) => GRUPPO * g + s);
    if (!info) {
      persi.push(...blocchi.filter((j) => usati[j]));
      intere.push({ g, carichi: blocchi.map(() => ZERO) });
      continue;
    }
    const sporco = blocchi.some((j) => !usati[j] && !(valida(S, g, 2 * j) && S.zero[j]));
    const mancanti = blocchi.some((j) => !valida(S, g, 2 * j) || !valida(S, g, 2 * j + 1));
    if (info.k === ke && !sporco) {
      if (mancanti) parziali.push(g);
      continue;
    }
    const vecchi = await carichiGruppo(ctx, S, g);
    intere.push({
      g,
      carichi: blocchi.map((j, s) => {
        if (usati[j] && !vecchi[s]) persi.push(j);
        return (usati[j] && vecchi[s]) || ZERO;
      }),
    });
  }
  await restauraMancanti(ctx, S, parziali);
  await riscriviGruppi(ctx, S, intere);
  await distruggiSpazzatura(ctx, S);
  await ctx.fh.datasync();
  if (persi.length && marcaDanneggiati(tabella, persi)) {
    // Stessa lunghezza, stessi blocchi: la tabella segnata si scrive dove sta, anche a contenitore pieno.
    const piano = { tabella, bytes: serializzaTabella(tabella), blocchiTabella: S.blocchiTabella, L2: S.L };
    await transazione(ctx, S, piano, new Map());
    return;
  }
  await scriviTestaGruppo(ctx, S);
}

async function creaNuovo(ctx, S, ora) {
  Object.assign(S, {
    inc: crypto.randomBytes(8), L: 1, contatore: 0, creato: ora, aperto: ora, apertoPrima: 0,
    tabella: new Map(), blocchiTabella: [], gruppi: [],
    pos: new Float64Array(0), ver: new Uint32Array(0), kk: new Uint8Array(0), zero: new Uint8Array(0),
  });
  dimensiona(S, 1);
  const testa = scriviTesta({ L: 1, creato: ora, aperto: ora, contatore: 1, bytes: serializzaTabella(S.tabella), blocchiTabella: [] });
  await riscriviGruppi(ctx, S, [{ g: 0, carichi: [testa] }]);
  if (!(S.pos[0] >= 0) || !(S.pos[1] >= 0)) {
    await distruggi(ctx, S, [0, 1]);
    throw errore('SPAZIO', 'Nel contenitore non resta posto per un segreto nuovo.', { servono: CARICO, disponibili: 0 });
  }
  await ctx.fh.datasync();
}

// ── Sessioni ──────────────────────────────────────────────────────────────────────────────────────────────────────

const sessioni = new Map();

// Due sessioni sullo stesso segreto scriverebbero versioni diverse con lo stesso numero: resta solo l'ultima aperta.
function chiudiSessioniDi(chiave, inc) {
  for (const s of sessioni.get(chiave) || []) if (s.S.inc && s.S.inc.equals(inc)) chiudiStato(s);
}

function chiudiStato(s) {
  if (s.chiuso) return;
  s.chiuso = true;
  cancellaChiavi(s.S);
  const insieme = sessioni.get(s.chiave);
  if (insieme) {
    insieme.delete(s);
    if (!insieme.size) sessioni.delete(s.chiave);
  }
}

class Segreto {
  #s;

  constructor(stato) {
    this.#s = stato;
  }

  #vivo() {
    if (this.#s.chiuso) throw errore('CHIUSO', 'Questo segreto è stato chiuso: va riaperto col suo nome.');
    return this.#s;
  }

  async #op(fn, { muta = true } = {}) {
    const s = this.#vivo();
    return inCoda(s.chiave, async () => {
      this.#vivo();
      const ctx = await apriContenitore(s.percorso, s.dimensione);
      ctx.mappa = s.mappa;
      try {
        return await fn(ctx, s.S);
      } catch (e) {
        // Una scrittura interrotta a metà lascia lo stato in memoria diverso dal disco: si riparte da una riapertura.
        if (muta && !e.prima) chiudiStato(s);
        throw e;
      } finally {
        await ctx.fh.close();
      }
    });
  }

  elencaFile() {
    const { S } = this.#vivo();
    return [...S.tabella].map(([nome, f]) => ({ nome, dimensione: f.d, creato: f.c, modificato: f.m, danneggiato: !!f.x }));
  }

  info() {
    const { S } = this.#vivo();
    return { creato: S.creato, aperturaPrecedente: S.apertoPrima || null };
  }

  spazio() {
    const s = this.#vivo();
    let nome = 'nome-di-prova-di-un-file-nuovo.bin';
    while (s.S.tabella.has(nome)) nome = `_${nome}`;
    let usati = 0;
    for (const f of s.S.tabella.values()) usati += f.d;
    return { usati, disponibili: massimoScrivibile(s.S, s.N - s.mappa.vive, nome) };
  }

  async leggiFile(nome) {
    const n = normalizzaNomeFile(nome);
    return this.#op(async (ctx, S) => {
      const f = S.tabella.get(n);
      if (!f) throw errore('NESSUN_FILE', 'Nel segreto non c’è un file con questo nome.');
      if (f.x) throw errore('DANNEGGIATO', 'Questo file si è rovinato e non si può più leggere.');
      const out = Buffer.alloc(f.d);
      const blocchi = daEstensioni(f.e);
      const perGruppo = new Map();
      for (let x = 0; x < blocchi.length; x++) {
        const g = Math.floor(blocchi[x] / GRUPPO);
        if (!perGruppo.has(g)) {
          if (perGruppo.size > GRUPPI_PER_LOTTO) perGruppo.clear();
          perGruppo.set(g, await carichiGruppo(ctx, S, g));
        }
        const c = perGruppo.get(g)[blocchi[x] - GRUPPO * g];
        if (!c) throw errore('DANNEGGIATO', 'Questo file si è rovinato e non si può più leggere.');
        c.copy(out, x * CARICO, 0, Math.min(CARICO, f.d - x * CARICO));
      }
      return out;
    }, { muta: false });
  }

  // Una scrittura che non ci sta si rifiuta dicendo quanto serve e quanto c'è: mai troncata.
  async scriviFile(nome, dati) {
    const n = normalizzaNomeFile(nome);
    const buf = comeBuffer(dati);
    return this.#op(async (ctx, S) => {
      const ora = Date.now();
      let piano = pianoScrittura(S, libere(ctx), n, buf.length, ora);
      if (!piano && S.tabella.has(n) && pianoScrittura(S, libere(ctx), n, buf.length, ora, { senzaVecchio: true })) {
        await cancellaDentro(ctx, S, n);
        piano = pianoScrittura(S, libere(ctx), n, buf.length, ora);
      }
      if (!piano) {
        const disponibili = massimoScrivibile(S, libere(ctx), n);
        throw errore('SPAZIO', `Non c’è spazio: servono ${buf.length} byte, ne restano ${disponibili}.`, { servono: buf.length, disponibili, prima: true });
      }
      const dati2 = new Map();
      piano.blocchiFile.forEach((j, x) => dati2.set(j, buf.subarray(x * CARICO, (x + 1) * CARICO)));
      await transazione(ctx, S, piano, dati2);
    });
  }

  async cancellaFile(nome) {
    const n = normalizzaNomeFile(nome);
    return this.#op(async (ctx, S) => {
      if (!S.tabella.has(n)) return false;
      await cancellaDentro(ctx, S, n);
      return true;
    });
  }

  // L'unica via per togliere un segreto: tutti i suoi blocchi riscritti a caso, la testa per ultima. La scansione
  // trova anche le copie rimaste lontano, che chi ha il nome potrebbe altrimenti ancora leggere.
  async cancella() {
    await this.#op(async (ctx, S) => {
      S.letti = new Uint8Array(ctx.N);
      S.scansionato = false;
      await scansiona(ctx, S);
      const corpo = [];
      for (let i = 2 * GRUPPO; i < 2 * S.L; i++) corpo.push(i);
      await distruggi(ctx, S, corpo);
      await distruggiSpazzatura(ctx, S);
      await ctx.fh.datasync();
      await distruggi(ctx, S, Array.from({ length: Math.min(2 * GRUPPO, 2 * S.L) }, (_, i) => i));
      await ctx.fh.datasync();
    });
    chiudiStato(this.#s);
  }

  async chiudi() {
    chiudiStato(this.#s);
  }
}

async function cancellaDentro(ctx, S, nome) {
  const vecchio = S.tabella.get(nome);
  const piano = pianifica(S, libere(ctx), (t) => { t.delete(nome); }, { riusa: daEstensioni(vecchio.e) });
  if (!piano) throw errore('SPAZIO', 'Non c’è posto nemmeno per riscrivere l’elenco dei file.', { servono: 0, disponibili: 0, prima: true });
  await transazione(ctx, S, piano, new Map());
}

// ── Aperture ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function apriOCrea(opzioni, crea) {
  const { contenitore, dimensione, sale, nome, dichiarati = [], parametriChiave } = opzioni || {};
  const proprio = normalizzaNome(nome);
  const altri = [...new Set((Array.isArray(dichiarati) ? dichiarati : [])
    .map((x) => (typeof x === 'string' ? x.normalize('NFC').trim() : ''))
    .filter((x) => x && x !== proprio))];
  if (altri.length > ETICHETTE_MAX - 2) throw errore('DICHIARATI', `Si possono dichiarare fino a ${ETICHETTE_MAX - 2} altri segreti.`);
  if (!(sale instanceof Uint8Array) || sale.length < SALE_MIN) throw errore('SALE', `Il sale del dispositivo è di almeno ${SALE_MIN} byte.`);
  controllaDimensione(dimensione);
  const chiave = await chiaveContenitore(contenitore);
  const [chiavi, ...chiaviAltri] = await Promise.all([proprio, ...altri].map((x) => derivaChiavi(x, sale, parametriChiave)));
  return inCoda(chiave, async () => {
    const ctx = await apriContenitore(contenitore, dimensione);
    ctx.mappa = { occ: new Uint16Array(ctx.N), vive: 0 };
    const S = nuovoStato(chiavi, 1, ctx.N);
    const D = [];
    try {
      const esiste = await caricaSegreto(ctx, S);
      if (!esiste && !crea) {
        cancellaChiavi(S);
        return { ...NESSUNO };
      }
      for (let x = 0; x < chiaviAltri.length; x++) {
        const d = nuovoStato(chiaviAltri[x], 2 + x, ctx.N);
        chiaviAltri[x] = null;
        if (await caricaSegreto(ctx, d)) D.push(d);
        else cancellaChiavi(d);
      }
      for (const d of D) await riparaDichiarato(ctx, d);
      const ora = Date.now();
      if (esiste) {
        S.apertoPrima = S.aperto;
        S.aperto = ora;
        await riparaProprio(ctx, S);
      } else {
        await creaNuovo(ctx, S, ora);
      }
      for (const d of D) chiudiSessioniDi(chiave, d.inc);
      chiudiSessioniDi(chiave, S.inc);
      S.letti = new Uint8Array(0);
      S.candidati = null;
      const stato = { chiave, percorso: contenitore, dimensione, N: ctx.N, mappa: ctx.mappa, S, chiuso: false };
      if (!sessioni.has(chiave)) sessioni.set(chiave, new Set());
      sessioni.get(chiave).add(stato);
      return { esito: esiste ? 'aperto' : 'creato', segreto: new Segreto(stato) };
    } catch (e) {
      cancellaChiavi(S);
      throw e;
    } finally {
      for (const d of D) cancellaChiavi(d);
      for (const k of chiaviAltri) if (k) { k.cifra.fill(0); k.posto.fill(0); }
      await ctx.fh.close();
    }
  });
}

// Nome sbagliato e segreto inesistente danno lo stesso identico esito: niente distingue i due casi.
function apriSegreto(opzioni) {
  return apriOCrea(opzioni, false);
}

// Se il segreto esiste già si apre: un nome ripetuto non deve mai cancellare quello che c'è.
function creaSegreto(opzioni) {
  return apriOCrea(opzioni, true);
}

module.exports = {
  creaContenitore,
  apriSegreto,
  creaSegreto,
  // Per le prove: il formato su disco, per controllarlo da fuori senza passare dal motore.
  _formato: {
    BLOCCO, CARICO, PREFISSO, GRUPPO, NONCE, posizione, apriBlocco, leggiPrefisso, leggiTesta, normalizzaNome,
  },
};

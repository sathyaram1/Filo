// #861 — il motore del profilo segreto: segreti senza indice in un contenitore di byte casuali, ritrovati dal solo nome,
// che reggono a chi scrive senza dichiararli e da fuori non si distinguono dal vuoto. Argon2id gira coi parametri bassi
// di PROVA, tranne dove si provano quelli veri; `impronta` guarda il disco col solo nome, senza passare dal motore.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, openSync, writeSync, closeSync, rmSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const M = require(join(ROOT, 'src', 'main', 'services', 'segreto', 'motore.js'));
const K = require(join(ROOT, 'src', 'main', 'services', 'segreto', 'chiave.js'));
const RS = require(join(ROOT, 'src', 'main', 'services', 'segreto', 'reedSolomon.js'));
const F = M._formato;

const PROVA = { passate: 1, memoriaKiB: 1024, parallelismo: 1 };
const MB = 1 << 20;
const SALE = Buffer.alloc(16, 0x5a);
const NESSUNO = { esito: 'nessuno', messaggio: 'Nessun segreto con questo nome.' };

let dir;
before(() => { dir = cartellaTemporanea('segreto-'); });
after(() => togliCartella(dir));

let quanti = 0;
async function contenitore(dimensione) {
  const percorso = join(dir, `c${++quanti}.bin`);
  await M.creaContenitore(percorso, dimensione);
  return { contenitore: percorso, dimensione, sale: SALE, parametriChiave: PROVA };
}
const apri = (base, nome, dichiarati) => M.apriSegreto({ ...base, nome, dichiarati });
const crea = async (base, nome, dichiarati) => (await M.creaSegreto({ ...base, nome, dichiarati })).segreto;
const blocco = (buf, p) => buf.subarray(p * F.BLOCCO, (p + 1) * F.BLOCCO);
const impronta1 = (buf) => createHash('sha256').update(buf).digest('hex');

async function impronta(base, nome) {
  const k = await K.derivaChiavi(F.normalizzaNome(nome), base.sale, PROVA);
  const buf = readFileSync(base.contenitore);
  const copie = new Map();
  let L = 0;
  for (let p = 0; p < buf.length / F.BLOCCO; p++) {
    const pre = F.leggiPrefisso(F.apriBlocco(k.cifra, p, blocco(buf, p)));
    if (!pre) continue;
    const i = 2 * pre.j + pre.c;
    const prima = copie.get(i);
    if (prima && prima.v >= pre.v) continue;
    copie.set(i, { p, v: pre.v, k: pre.k, nonce: Buffer.from(blocco(buf, p).subarray(0, F.NONCE)) });
    if (i === 0) L = F.leggiTesta(pre.carico).L;
  }
  return { copie, L, chiavi: k };
}

// Tutta la ridondanza: ogni copia di ogni blocco logico c'è, e quelle di un gruppo hanno la stessa versione.
function integra({ copie, L }) {
  if (!L) return false;
  for (let g = 0; g * F.GRUPPO < L; g++) {
    const ke = Math.min(F.GRUPPO, L - F.GRUPPO * g);
    const versioni = new Set();
    for (let i = 2 * F.GRUPPO * g; i < 2 * F.GRUPPO * g + 2 * ke; i++) {
      const c = copie.get(i);
      if (!c || c.k !== ke) return false;
      versioni.add(c.v);
    }
    if (versioni.size !== 1) return false;
  }
  return true;
}

function persi(prima, dopo) {
  let n = 0;
  for (const [i, c] of prima.copie) {
    const d = dopo.copie.get(i);
    if (!d || d.p !== c.p || d.v !== c.v) n++;
  }
  return n;
}

// Il caso peggiore che la ridondanza regge: per ogni gruppo, quante copie restano rispetto alle k che servono.
function gruppiReggono(prima, dopo) {
  const perGruppo = new Map();
  for (const [i, c] of prima.copie) {
    const g = Math.floor((i >> 1) / F.GRUPPO);
    const d = dopo.copie.get(i);
    const v = perGruppo.get(g) || { k: c.k, vive: 0 };
    if (d && d.p === c.p && d.v === c.v) v.vive++;
    perGruppo.set(g, v);
  }
  return [...perGruppo.values()].every((v) => v.vive >= v.k);
}

function sporca(base, posizioni) {
  const fd = openSync(base.contenitore, 'r+');
  try {
    for (const p of posizioni) writeSync(fd, randomBytes(F.BLOCCO), 0, F.BLOCCO, p * F.BLOCCO);
  } finally {
    closeSync(fd);
  }
}

describe('chiave: Argon2id nel thread a parte', () => {
  test('i parametri veri sono questi e non cambiano: cambiarli renderebbe illeggibili i segreti che esistono', () => {
    assert.deepEqual({ ...K.ARGON2 }, { passate: 3, memoriaKiB: 262144, parallelismo: 1 });
    assert.ok(Object.isFrozen(K.ARGON2));
  });

  test('il vettore noto di Argon2id esce uguale (riferimento phc-winner-argon2: password, somesalt, t=2, m=64 MiB)', async () => {
    const h = await K.argon2id(Buffer.from('password'), Buffer.from('somesalt'), { passate: 2, memoriaKiB: 65536, parallelismo: 1 });
    assert.equal(h.toString('hex'), '09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7');
  });

  test('coi parametri veri la derivazione tiene il thread per un tempo da forza bruta cara, e non il processo', async (t) => {
    let giri = 0;
    const battito = setInterval(() => { giri++; }, 20);
    const t0 = Date.now();
    const a = await K.derivaChiavi('nome', Buffer.alloc(16, 1));
    const ms = Date.now() - t0;
    clearInterval(battito);
    t.diagnostic(`Argon2id t=3 m=256 MiB p=1: ${ms} ms`);
    assert.ok(ms > 100, `troppo veloce per parametri alti: ${ms} ms`);
    assert.ok(giri >= Math.floor(ms / 20) / 2, `il processo si è fermato durante la derivazione (${giri} battiti in ${ms} ms)`);
    // Le stesse in Node e nel Node di Electron: cambiano solo se cambiano parametri, etichette o libreria.
    assert.equal(a.cifra.toString('hex'), 'cf42ef198024fcc2aa3a82988e7ed59988df2fa07de16ca7941d0ec39bcb3f40');
    assert.equal(a.posto.toString('hex'), '365cd37700b4a9fa9fdf539e3279e2fb7dbd91abbb972b8f2d0abf90757050de');
  });

  test('stesso nome e sale danno le stesse chiavi; un sale diverso o un nome diverso no; un sale corto si rifiuta', async () => {
    const a = await K.derivaChiavi('nome', SALE, PROVA);
    const b = await K.derivaChiavi('nome', Buffer.from(SALE), PROVA);
    const c = await K.derivaChiavi('nome', Buffer.alloc(16, 1), PROVA);
    const d = await K.derivaChiavi('nomf', SALE, PROVA);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.cifra, c.cifra);
    assert.notDeepEqual(a.cifra, d.cifra);
    await assert.rejects(K.derivaChiavi('nome', Buffer.alloc(8), PROVA));
  });
});

describe('Reed-Solomon 10+10', () => {
  const dati = (k, len) => Array.from({ length: k }, () => new Uint8Array(randomBytes(len)));
  const combinazioni = (n, k, fn, scelti = [], da = 0) => {
    if (scelti.length === k) return fn(scelti);
    for (let x = da; x < n; x++) combinazioni(n, k, fn, [...scelti, x], x + 1);
  };

  test('fino a k = 6 ogni scelta di k blocchi fra dati e parità ricostruisce il gruppo', () => {
    for (let k = 1; k <= 6; k++) {
      const d = dati(k, 32);
      const tutti = [...d, ...RS.parita(d)];
      combinazioni(2 * k, k, (scelti) => {
        const r = RS.ricostruisci(k, new Map(scelti.map((i) => [i, tutti[i]])));
        assert.deepEqual(r.map((x) => Buffer.from(x)), d.map((x) => Buffer.from(x)), `k=${k}, scelti ${scelti}`);
      });
    }
  });

  test('con k = 10 bastano 10 blocchi qualsiasi dei 20 (2000 scelte a caso), con 9 non si ricostruisce', () => {
    const d = dati(10, 64);
    const tutti = [...d, ...RS.parita(d)];
    for (let x = 0; x < 2000; x++) {
      const scelti = [...Array(20).keys()].sort(() => Math.random() - 0.5).slice(0, 10);
      const r = RS.ricostruisci(10, new Map(scelti.map((i) => [i, tutti[i]])));
      assert.deepEqual(r.map((y) => Buffer.from(y)), d.map((y) => Buffer.from(y)), `scelti ${scelti}`);
    }
    assert.equal(RS.ricostruisci(10, new Map([...Array(9).keys()].map((i) => [i + 11, tutti[i + 11]]))), null);
  });
});

describe('due segreti nello stesso contenitore', () => {
  let base;
  const foto = randomBytes(300_000);
  const pezzi = Array.from({ length: 4 }, () => randomBytes(5 * MB));
  const scritti = [];
  before(async () => {
    // 256 MB, non 64: in 64 MB venti MB scritti da un altro coprono più di metà dei blocchi e nessuna ridondanza 2×
    // regge. Qui la proporzione è quella che la spec dà per 1 GB (decine di MB scritti da altri fra due aperture).
    base = await contenitore(256 * MB);
  });
  after(() => rmSync(base.contenitore, { force: true }));

  test('il secondo, senza dichiarare il primo, scrive 20 MB; il primo si riapre intero e torna con tutta la ridondanza', async () => {
    const a = await crea(base, 'Alfa');
    await a.scriviFile('nota.txt', 'ciao 🌍, <b>non è markup</b>');
    await a.scriviFile('foto.bin', foto);
    await a.scriviFile('vuoto', '');
    await a.chiudi();
    const prima = await impronta(base, 'Alfa');
    assert.ok(integra(prima));

    const b = await crea(base, 'Beta');
    for (let x = 0; x < pezzi.length; x++) await b.scriviFile(`pezzo${x}`, pezzi[x]);
    await b.chiudi();
    const dopoB = await impronta(base, 'Alfa');
    const n = persi(prima, dopoB);
    assert.ok(n > 0, 'il secondo segreto non ha toccato il primo: la prova non prova niente');
    assert.ok(gruppiReggono(prima, dopoB), 'un gruppo ha perso più della metà delle copie');

    const r = await apri(base, 'Alfa');
    assert.equal(r.esito, 'aperto');
    assert.deepEqual(r.segreto.elencaFile().map((f) => [f.nome, f.dimensione, f.danneggiato]),
      [['nota.txt', Buffer.byteLength('ciao 🌍, <b>non è markup</b>'), false], ['foto.bin', 300_000, false], ['vuoto', 0, false]]);
    assert.equal((await r.segreto.leggiFile('nota.txt')).toString(), 'ciao 🌍, <b>non è markup</b>');
    assert.ok((await r.segreto.leggiFile('foto.bin')).equals(foto));
    assert.equal((await r.segreto.leggiFile('vuoto')).length, 0);
    await r.segreto.chiudi();
    assert.ok(integra(await impronta(base, 'Alfa')), 'dopo la riparazione mancano copie');
    scritti.push('Alfa');
  });

  test('anche il secondo, toccato dalla riparazione del primo, si riapre intero e si ripara', async () => {
    const r = await apri(base, 'Beta');
    for (let x = 0; x < pezzi.length; x++) assert.ok((await r.segreto.leggiFile(`pezzo${x}`)).equals(pezzi[x]), `pezzo${x}`);
    await r.segreto.chiudi();
    assert.ok(integra(await impronta(base, 'Beta')));
  });

  test('aprire o creare non stampa niente: nemmeno un segno di ciò che è stato riparato', async () => {
    const prima = await impronta(base, 'Alfa');
    sporca(base, [...prima.copie.values()].filter((_, x) => x % 3 === 0).map((c) => c.p));
    const voci = [];
    const originali = {};
    for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
      originali[m] = console[m];
      console[m] = (...a) => voci.push([m, a]);
    }
    const forma = (r) => ({
      chiavi: Object.keys(r), esito: r.esito, proprie: Object.keys(r.segreto), json: JSON.stringify(r.segreto),
      metodi: Object.getOwnPropertyNames(Object.getPrototypeOf(r.segreto)),
      info: Object.keys(r.segreto.info()), file: r.segreto.elencaFile().map((f) => Object.keys(f)),
    });
    let riparato;
    let pulito;
    try {
      riparato = forma(await apri(base, 'Alfa'));
      pulito = forma(await apri(base, 'Alfa'));
    } finally {
      Object.assign(console, originali);
    }
    assert.deepEqual(voci, []);
    assert.ok(integra(await impronta(base, 'Alfa')), 'la riparazione non è avvenuta');
    assert.deepEqual(riparato, pulito);
    assert.deepEqual(riparato.chiavi, ['esito', 'segreto']);
    assert.deepEqual(riparato.proprie, []);
    assert.equal(riparato.json, '{}');
  });
});

describe('la riparazione di un segreto grande non insegue quello che lo ha coperto', () => {
  // Casa tiene circa il 44% dei posti: rimettendo le sue copie dove stavano cancellerebbe quasi metà di Diario.
  test('riaperto Casa, Diario (scritto dopo senza dichiararlo) si riapre intero; e così a turno', async () => {
    const base = await contenitore(64 * MB);
    const FOTO = randomBytes(14 * MB);
    const NOTE = randomBytes(4 * MB);
    try {
      let s = await crea(base, 'Casa');
      await s.scriviFile('foto', FOTO);
      await s.chiudi();
      s = await crea(base, 'Diario');
      await s.scriviFile('note', NOTE);
      await s.chiudi();
      for (const [nome, altro, file, dati] of [['Casa', 'Diario', 'foto', FOTO], ['Diario', 'Casa', 'note', NOTE], ['Casa', 'Diario', 'foto', FOTO]]) {
        const prima = await impronta(base, altro);
        const r = await apri(base, nome);
        assert.equal(r.esito, 'aperto', nome);
        assert.ok((await r.segreto.leggiFile(file)).equals(dati), nome);
        await r.segreto.chiudi();
        const tolte = persi(prima, await impronta(base, altro));
        assert.ok(tolte < prima.copie.size / 5, `la riparazione di ${nome} ha tolto ${tolte} copie su ${prima.copie.size} di ${altro}`);
      }
      const r = await apri(base, 'Diario');
      assert.ok((await r.segreto.leggiFile('note')).equals(NOTE));
      await r.segreto.chiudi();
    } finally {
      rmSync(base.contenitore, { force: true });
    }
  });
});

describe('segreti dichiarati', () => {
  let base;
  before(async () => { base = await contenitore(256 * MB); });
  after(() => rmSync(base.contenitore, { force: true }));

  test('chi dichiara l’altro nome mentre scrive 20 MB non gli tocca nemmeno un blocco', async () => {
    const g = await crea(base, 'Gamma');
    await g.scriviFile('diario.txt', 'cose mie '.repeat(5000));
    await g.chiudi();
    const prima = await impronta(base, 'Gamma');
    const d = await crea(base, 'Delta', ['Gamma']);
    for (let x = 0; x < 4; x++) await d.scriviFile(`d${x}`, randomBytes(5 * MB));
    await d.chiudi();
    const dopo = await impronta(base, 'Gamma');
    assert.equal(persi(prima, dopo), 0);
  });

  test('aprire dichiarando un nome ripara quel segreto senza aprirlo', async () => {
    const prima = await impronta(base, 'Gamma');
    const e = await crea(base, 'Epsilon');
    for (let x = 0; x < 4; x++) await e.scriviFile(`e${x}`, randomBytes(5 * MB));
    await e.chiudi();
    const dopoE = await impronta(base, 'Gamma');
    assert.ok(persi(prima, dopoE) > 0, 'Epsilon non ha toccato Gamma: la prova non prova niente');
    assert.ok(gruppiReggono(prima, dopoE));
    const r = await apri(base, 'Epsilon', ['Gamma', '  Gamma  ', '', 'Epsilon', 'nome che non c’è']);
    await r.segreto.chiudi();
    assert.ok(integra(await impronta(base, 'Gamma')));
    const gg = await apri(base, 'Gamma');
    assert.equal((await gg.segreto.leggiFile('diario.txt')).toString(), 'cose mie '.repeat(5000));
    await gg.segreto.chiudi();
  });

  test('lo spazio conta il proprio segreto e quelli dichiarati: riempito il contenitore fino all’ultimo byte, il dichiarato è intatto', async () => {
    const piccolo = await contenitore(2 * MB);
    const c = await crea(piccolo, 'C');
    await c.scriviFile('c', randomBytes(300_000));
    await c.chiudi();
    const prima = await impronta(piccolo, 'C');
    const d = await crea(piccolo, 'D', ['C']);
    const { disponibili } = d.spazio();
    // 512 blocchi: 2 per la testa di D, 2·76 per C (testa e 75 blocchi), due copie per ogni blocco di D.
    assert.equal(disponibili, Math.floor((512 - 2 - 2 * 76) / 2) * F.CARICO);
    const tutto = randomBytes(disponibili);
    await d.scriviFile('tutto', tutto);
    await assert.rejects(d.scriviFile('uno di più', 'x'), (e) => e.codice === 'SPAZIO' && e.disponibili === 0 && e.servono === 1);
    await d.chiudi();
    assert.equal(persi(prima, await impronta(piccolo, 'C')), 0);
    // Riaperto senza dichiarare C, D ha copie in fondo a catene che passano sui blocchi di C: le ritrova tutte (anche
    // leggendo il contenitore intero) e quindi non ne rifà nessuna sopra C.
    const r = await apri(piccolo, 'D');
    assert.ok((await r.segreto.leggiFile('tutto')).equals(tutto));
    await r.segreto.chiudi();
    assert.equal(persi(prima, await impronta(piccolo, 'C')), 0);
    assert.ok(integra(await impronta(piccolo, 'D')));
    rmSync(piccolo.contenitore, { force: true });
  });
});

describe('da fuori', () => {
  let base;
  let vuoto;
  before(async () => {
    vuoto = await contenitore(16 * MB);
    base = await contenitore(16 * MB);
    const a = await crea(base, 'Alfa');
    // Testo e zeri: il contenuto più riconoscibile possibile deve uscire come rumore.
    await a.scriviFile('zeri', Buffer.alloc(3 * MB));
    await a.scriviFile('MARCATORE-IN-CHIARO.txt', 'MARCATORE-IN-CHIARO '.repeat(20000));
    await a.chiudi();
    const b = await crea(base, 'Beta');
    await b.scriviFile('b', Buffer.alloc(MB, 0x41));
    await b.chiudi();
  });
  after(() => { rmSync(base.contenitore, { force: true }); rmSync(vuoto.contenitore, { force: true }); });

  const chi = (buf) => {
    const conta = new Float64Array(256);
    for (let x = 0; x < buf.length; x++) conta[buf[x]]++;
    const atteso = buf.length / 256;
    return conta.reduce((s, c) => s + ((c - atteso) ** 2) / atteso, 0);
  };

  test('un contenitore con segreti e uno vuoto non si distinguono dai byte: né in tutto, né blocco per blocco', () => {
    for (const c of [vuoto, base]) {
      const buf = readFileSync(c.contenitore);
      assert.ok(chi(buf) < 255 + 6 * Math.sqrt(2 * 255), `istogramma dei byte non uniforme: ${chi(buf)}`);
      const perBlocco = [];
      for (let p = 0; p < buf.length / F.BLOCCO; p++) perBlocco.push(chi(blocco(buf, p)));
      const media = perBlocco.reduce((s, x) => s + x, 0) / perBlocco.length;
      assert.ok(Math.abs(media - 255) < 3, `media dei blocchi fuori posto: ${media}`);
      assert.ok(Math.max(...perBlocco) < 430, `un blocco non sembra casuale: ${Math.max(...perBlocco)}`);
    }
  });

  test('nessun marcatore e nessuna intestazione in chiaro: né nomi né contenuti né il formato', () => {
    const buf = readFileSync(base.contenitore);
    // Solo stringhe da otto byte in su: una più corta comparirebbe per caso in 16 MB di byte casuali.
    for (const s of ['MARCATORE-IN-CHIARO', 'filo-segreto', '{"f":[{"n":', 'A'.repeat(16)]) {
      assert.equal(buf.indexOf(Buffer.from(s)), -1, s);
    }
    assert.equal(buf.indexOf(Buffer.alloc(64)), -1, 'una fila di zeri');
  });

  test('nome sbagliato e contenitore vuoto danno la stessa risposta, e aprire un nome che non c’è non scrive niente', async () => {
    const primaVuoto = impronta1(readFileSync(vuoto.contenitore));
    const prima = impronta1(readFileSync(base.contenitore));
    const nelVuoto = await apri(vuoto, 'Alfa');
    const sbagliato = await apri(base, 'Alfx');
    const inesistente = await apri(base, 'mai creato');
    assert.deepEqual(nelVuoto, NESSUNO);
    assert.deepEqual(sbagliato, nelVuoto);
    assert.deepEqual(inesistente, nelVuoto);
    assert.deepEqual(Object.keys(sbagliato), Object.keys(nelVuoto));
    assert.equal(impronta1(readFileSync(vuoto.contenitore)), primaVuoto);
    assert.equal(impronta1(readFileSync(base.contenitore)), prima);
  });

  test('due scritture dello stesso blocco logico hanno nonce diversi', async () => {
    const prima = await impronta(base, 'Alfa');
    await (await apri(base, 'Alfa')).segreto.chiudi();
    const dopo = await impronta(base, 'Alfa');
    // Beta, scritto senza dichiarare Alfa, può averne coperto qualche copia della testa: si guarda una rimasta.
    const i = [...prima.copie.keys()].find((x) => x < 2 * F.GRUPPO && dopo.copie.has(x));
    const t0 = prima.copie.get(i);
    const t1 = dopo.copie.get(i);
    assert.ok(t1.v > t0.v, 'la testa non è stata riscritta');
    assert.equal(t1.p, t0.p, 'la testa riscritta sta nello stesso posto');
    assert.notDeepEqual(t1.nonce, t0.nonce);
    const nonces = new Set([...dopo.copie.values()].map((c) => c.nonce.toString('hex')));
    assert.equal(nonces.size, dopo.copie.size, 'due blocchi con lo stesso nonce');
  });
});

describe('cancellazione', () => {
  test('dopo la cancellazione il nome non apre più niente, ogni blocco del segreto è cambiato e l’altro è intatto', async () => {
    const base = await contenitore(16 * MB);
    const a = await crea(base, 'Alfa');
    await a.scriviFile('a', randomBytes(2 * MB));
    await a.chiudi();
    const b = await crea(base, 'Beta');
    await b.scriviFile('b', 'resto io');
    await b.chiudi();
    // L'apertura ripara Alfa e può toccare Beta, che l'ha scritto sopra senza dichiararlo: si fotografa dopo.
    const r = await apri(base, 'Alfa');
    const prima = await impronta(base, 'Alfa');
    const primaB = await impronta(base, 'Beta');
    const buf0 = readFileSync(base.contenitore);
    await r.segreto.cancella();
    assert.throws(() => r.segreto.elencaFile(), (e) => e.codice === 'CHIUSO');
    assert.deepEqual(await apri(base, 'Alfa'), NESSUNO);
    const buf1 = readFileSync(base.contenitore);
    for (const { p } of prima.copie.values()) assert.ok(!blocco(buf0, p).equals(blocco(buf1, p)), `blocco ${p} rimasto uguale`);
    assert.equal((await impronta(base, 'Alfa')).copie.size, 0, 'col nome si legge ancora qualcosa');
    assert.equal(persi(primaB, await impronta(base, 'Beta')), 0);
    const rb = await apri(base, 'Beta');
    assert.equal((await rb.segreto.leggiFile('b')).toString(), 'resto io');
    await rb.segreto.chiudi();
    const nuovo = await M.creaSegreto({ ...base, nome: 'Alfa' });
    assert.equal(nuovo.esito, 'creato');
    assert.deepEqual(nuovo.segreto.elencaFile(), []);
    await nuovo.segreto.chiudi();
    rmSync(base.contenitore, { force: true });
  });
});

describe('spazio: rifiutato dicendo quanto serve e quanto c’è, mai troncato', () => {
  test('una scrittura che non ci sta si rifiuta coi numeri; scrivere esattamente quello che c’è riesce', async () => {
    const base = await contenitore(2 * MB);
    const s = await crea(base, 'S');
    const capienza = Math.floor((512 - 2) / 2) * F.CARICO;
    assert.deepEqual(s.spazio(), { usati: 0, disponibili: capienza });
    const a = randomBytes(600_000);
    await s.scriviFile('a', a);
    let rifiuto;
    await assert.rejects(s.scriviFile('b', randomBytes(600_000)), (e) => { rifiuto = e; return e.codice === 'SPAZIO'; });
    assert.equal(rifiuto.servono, 600_000);
    assert.ok(rifiuto.disponibili > 0 && rifiuto.disponibili < 600_000);
    assert.ok(rifiuto.message.includes('600000') && rifiuto.message.includes(String(rifiuto.disponibili)));
    assert.deepEqual(s.elencaFile().map((f) => f.nome), ['a']);
    const b = randomBytes(rifiuto.disponibili);
    await s.scriviFile('b', b);
    await assert.rejects(s.scriviFile('c', 'x'), (e) => e.codice === 'SPAZIO' && e.disponibili === 0);
    await s.chiudi();
    const r = await apri(base, 'S');
    assert.ok((await r.segreto.leggiFile('a')).equals(a));
    assert.ok((await r.segreto.leggiFile('b')).equals(b));
    await r.segreto.chiudi();
    rmSync(base.contenitore, { force: true });
  });

  test('sostituire un file conta lo spazio che il vecchio lascia; se nemmeno così ci sta, il vecchio resta com’era', async () => {
    const base = await contenitore(2 * MB);
    const s = await crea(base, 'S');
    const capienza = Math.floor((512 - 2) / 2) * F.CARICO;
    await s.scriviFile('a', randomBytes(600_000));
    const nuovo = randomBytes(900_000);
    await s.scriviFile('a', nuovo);
    assert.ok((await s.leggiFile('a')).equals(nuovo));
    await assert.rejects(s.scriviFile('a', randomBytes(capienza + 1)), (e) => e.codice === 'SPAZIO' && e.disponibili === capienza);
    assert.ok((await s.leggiFile('a')).equals(nuovo));
    await s.chiudi();
    rmSync(base.contenitore, { force: true });
  });
});

describe('usato male', () => {
  let base;
  before(async () => { base = await contenitore(16 * MB); });
  after(() => rmSync(base.contenitore, { force: true }));

  test('il nome: vuoto o di soli spazi si rifiuta; spazi ai lati, NFD del Mac ed emoji aprono lo stesso segreto', async () => {
    for (const n of ['', '   ', null, undefined, 42]) await assert.rejects(apri(base, n), (e) => e.codice === 'NOME_VUOTO');
    const s = await crea(base, 'Café 🔒 <script>');
    await s.scriviFile('x', 'y');
    await s.chiudi();
    for (const n of ['Café 🔒 <script>', '  Café 🔒 <script>\n', 'Café 🔒 <script>']) {
      const r = await apri(base, n);
      assert.equal(r.esito, 'aperto', JSON.stringify(n));
      await r.segreto.chiudi();
    }
    assert.deepEqual(await apri(base, 'café 🔒 <script>'), NESSUNO);
  });

  test('creare un nome che esiste lo apre, non lo svuota', async () => {
    const r = await M.creaSegreto({ ...base, nome: 'Café 🔒 <script>' });
    assert.equal(r.esito, 'aperto');
    assert.equal((await r.segreto.leggiFile('x')).toString(), 'y');
    await r.segreto.chiudi();
  });

  test('i file: nomi strani, vuoti, lunghissimi, centoventi file (la tabella esce dalla testa), sovrascritture, in fretta', async () => {
    const s = await crea(base, 'Molti');
    await assert.rejects(s.scriviFile('  ', 'x'), (e) => e.codice === 'NOME_FILE');
    await assert.rejects(s.scriviFile('n', 42), (e) => e.codice === 'DATI');
    const lungo = 'é'.repeat(5000);
    await s.scriviFile(lungo, 'lungo');
    await s.scriviFile('<img src=x onerror=alert(1)>', new Uint8Array([1, 2, 3]));
    await s.scriviFile('🙂', new Uint8Array([9, 9]).buffer);
    const attesi = new Map();
    await Promise.all(Array.from({ length: 120 }, (_, x) => {
      const d = randomBytes(x * 37);
      attesi.set(`f${x}`, d);
      return s.scriviFile(`f${x}`, d);
    }));
    await s.scriviFile('f7', 'sovrascritto');
    attesi.set('f7', Buffer.from('sovrascritto'));
    assert.equal(await s.cancellaFile('f8'), true);
    assert.equal(await s.cancellaFile('f8'), false);
    attesi.delete('f8');
    await assert.rejects(s.leggiFile('f8'), (e) => e.codice === 'NESSUN_FILE');
    await s.chiudi();
    const r = await apri(base, 'Molti');
    const elenco = new Map(r.segreto.elencaFile().map((f) => [f.nome, f]));
    assert.equal(elenco.size, 120 - 1 + 3);
    for (const [n, d] of attesi) assert.ok((await r.segreto.leggiFile(n)).equals(d), n);
    assert.equal((await r.segreto.leggiFile(lungo)).toString(), 'lungo');
    assert.deepEqual([...(await r.segreto.leggiFile('<img src=x onerror=alert(1)>'))], [1, 2, 3]);
    assert.deepEqual([...(await r.segreto.leggiFile('🙂'))], [9, 9]);
    await r.segreto.chiudi();
    assert.ok(integra(await impronta(base, 'Molti')));
  });

  test('cancellare tutti i file riaccorcia il segreto: lo spazio torna tutto', async () => {
    const s = await crea(base, 'Corto');
    const vuoto = s.spazio().disponibili;
    for (let x = 0; x < 30; x++) await s.scriviFile(`f${x}`, randomBytes(20_000));
    assert.ok(s.spazio().disponibili < vuoto);
    for (let x = 0; x < 30; x++) await s.cancellaFile(`f${x}`);
    assert.equal(s.spazio().disponibili, vuoto);
    await s.chiudi();
    const imp = await impronta(base, 'Corto');
    assert.equal(imp.L, 1);
    assert.equal(imp.copie.size, 2);
  });

  test('riaprire lo stesso segreto chiude la sessione vecchia, e due aperture insieme non si pestano', async () => {
    const a = (await apri(base, 'Molti')).segreto;
    const [b, c] = await Promise.all([apri(base, 'Molti'), apri(base, 'Café 🔒 <script>')]);
    assert.throws(() => a.elencaFile(), (e) => e.codice === 'CHIUSO');
    await assert.rejects(a.leggiFile('f1'), (e) => e.codice === 'CHIUSO');
    assert.ok((await b.segreto.leggiFile('f1')).length === 37);
    assert.equal((await c.segreto.leggiFile('x')).toString(), 'y');
    await b.segreto.chiudi();
    await c.segreto.chiudi();
  });

  test('il contenitore: si crea solo se non c’è, e uno assente o della dimensione sbagliata si rifiuta', async () => {
    await assert.rejects(M.creaContenitore(base.contenitore, 16 * MB), (e) => e.codice === 'CONTENITORE');
    await assert.rejects(M.creaContenitore(join(dir, 'storto.bin'), 5000), (e) => e.codice === 'CONTENITORE');
    await assert.rejects(apri({ ...base, dimensione: 8 * MB }, 'Molti'), (e) => e.codice === 'CONTENITORE');
    await assert.rejects(apri({ ...base, contenitore: join(dir, 'non-c-e.bin') }, 'Molti'), (e) => e.codice === 'CONTENITORE');
    await assert.rejects(apri({ ...base, sale: Buffer.alloc(4) }, 'Molti'), (e) => e.codice === 'SALE');
    const corto = join(dir, 'corto.bin');
    writeFileSync(corto, randomBytes(16 * MB - F.BLOCCO));
    await assert.rejects(apri({ ...base, contenitore: corto }, 'Molti'), (e) => e.codice === 'CONTENITORE');
  });
});

describe('danni', () => {
  test('metà delle copie di ogni gruppo sparite: il segreto si riapre intero e torna con tutte le copie', async () => {
    const base = await contenitore(4 * MB);
    const s = await crea(base, 'Fragile');
    const d = randomBytes(150_000);
    await s.scriviFile('d', d);
    await s.chiudi();
    const prima = await impronta(base, 'Fragile');
    const via = [];
    for (let g = 0; g * F.GRUPPO < prima.L; g++) {
      const ke = Math.min(F.GRUPPO, prima.L - F.GRUPPO * g);
      for (let s2 = 0; s2 < ke; s2++) via.push(prima.copie.get(2 * (F.GRUPPO * g + s2) + (s2 % 2)).p);
    }
    sporca(base, via);
    const r = await apri(base, 'Fragile');
    assert.ok((await r.segreto.leggiFile('d')).equals(d));
    await r.segreto.chiudi();
    assert.ok(integra(await impronta(base, 'Fragile')));
    rmSync(base.contenitore, { force: true });
  });

  test('un gruppo perso davvero: quel file risulta rovinato e lo dice, gli altri si leggono, e lo si può togliere', async () => {
    const base = await contenitore(4 * MB);
    const s = await crea(base, 'Rotto');
    await s.scriviFile('sano', 'sto bene');
    const grande = randomBytes(40 * F.CARICO);
    await s.scriviFile('grande', grande);
    await s.chiudi();
    const prima = await impronta(base, 'Rotto');
    const g = 3;
    sporca(base, Array.from({ length: 11 }, (_, x) => prima.copie.get(2 * F.GRUPPO * g + x).p));
    const r = await apri(base, 'Rotto');
    const elenco = Object.fromEntries(r.segreto.elencaFile().map((f) => [f.nome, f.danneggiato]));
    assert.deepEqual(elenco, { sano: false, grande: true });
    await assert.rejects(r.segreto.leggiFile('grande'), (e) => e.codice === 'DANNEGGIATO');
    assert.equal((await r.segreto.leggiFile('sano')).toString(), 'sto bene');
    await r.segreto.chiudi();
    const ancora = await apri(base, 'Rotto');
    assert.equal(ancora.segreto.elencaFile().find((f) => f.nome === 'grande').danneggiato, true);
    assert.equal(await ancora.segreto.cancellaFile('grande'), true);
    await ancora.segreto.scriviFile('grande', grande);
    assert.ok((await ancora.segreto.leggiFile('grande')).equals(grande));
    await ancora.segreto.chiudi();
    assert.ok(integra(await impronta(base, 'Rotto')));
    rmSync(base.contenitore, { force: true });
  });

  test('sovrascritto da fuori mentre è aperto: la scrittura si ferma prima di toccare niente e la riapertura ripara', async () => {
    const base = await contenitore(4 * MB);
    const s = await crea(base, 'Aperto');
    await s.scriviFile('a', randomBytes(5 * F.CARICO));
    const b = randomBytes(20 * F.CARICO);
    await s.scriviFile('b', b);
    const prima = await impronta(base, 'Aperto');
    // Il gruppo 2 (blocchi 20-25, k = 6) tiene la coda di «b» e accanto andrà «c»: spariscono 11 delle sue 12 copie.
    sporca(base, Array.from({ length: 11 }, (_, x) => prima.copie.get(2 * F.GRUPPO * 2 + x).p));
    await assert.rejects(s.scriviFile('c', randomBytes(2 * F.CARICO)), (e) => e.codice === 'RIAPRI');
    assert.throws(() => s.elencaFile(), (e) => e.codice === 'CHIUSO');
    const r = await apri(base, 'Aperto');
    assert.deepEqual(r.segreto.elencaFile().map((f) => [f.nome, f.danneggiato]), [['a', false], ['b', true]]);
    await r.segreto.chiudi();
    assert.ok(integra(await impronta(base, 'Aperto')));
    rmSync(base.contenitore, { force: true });
  });

  // L'elenco dei file fuori dalla testa: perso il suo gruppo, prima si perdeva il segreto intero e la riparazione ne
  // cancellava ogni blocco.
  const conElenco = async (base, nome) => {
    const s = await crea(base, nome);
    const foto = randomBytes(2 * MB);
    await s.scriviFile('foto', foto);
    for (let x = 0; x < 100; x++) await s.scriviFile(`nota-${x}.txt`, `nota numero ${x}`);
    await s.chiudi();
    const prima = await impronta(base, nome);
    const c0 = prima.copie.get(0);
    const testa = F.leggiTesta(F.leggiPrefisso(F.apriBlocco(prima.chiavi.cifra, c0.p, blocco(readFileSync(base.contenitore), c0.p))).carico);
    const t = testa.blocchiTabella.length / 2;
    const gruppo = (j) => Math.floor(j / F.GRUPPO);
    const copiaA = new Set(testa.blocchiTabella.slice(0, t).map(gruppo));
    const copiaB = new Set(testa.blocchiTabella.slice(t).map(gruppo));
    const undiciDi = (gruppi) => [...gruppi].flatMap((g) => [...prima.copie].filter(([i]) => gruppo(i >> 1) === g).slice(0, 11).map(([, c]) => c.p));
    return { foto, prima, copiaA, copiaB, undiciDi, gruppo };
  };

  test('perso il gruppo di una copia dell’elenco dei file, i file si leggono tutti e l’elenco torna doppio', async () => {
    const base = await contenitore(16 * MB);
    const { foto, copiaA, copiaB, undiciDi } = await conElenco(base, 'Elenco');
    assert.ok(copiaA.size && [...copiaA].every((g) => !copiaB.has(g)), 'le due copie dell’elenco stanno in gruppi diversi');
    for (const persa of [copiaA, copiaB]) {
      sporca(base, undiciDi(persa));
      const r = await apri(base, 'Elenco');
      const file = r.segreto.elencaFile();
      assert.equal(file.length, 101);
      assert.ok((await r.segreto.leggiFile('foto')).equals(foto));
      // Solo le note che stavano nel gruppo perso risultano rovinate, come per ogni gruppo perso.
      const sane = file.filter((f) => f.nome !== 'foto' && !f.danneggiato);
      assert.ok(sane.length >= 90, `note sane: ${sane.length}`);
      for (const f of sane) assert.equal((await r.segreto.leggiFile(f.nome)).toString(), `nota numero ${f.nome.slice(5, -4)}`);
      await r.segreto.chiudi();
      assert.ok(integra(await impronta(base, 'Elenco')), 'la riparazione non ha rimesso la copia persa dell’elenco');
    }
    rmSync(base.contenitore, { force: true });
  });

  test('perse tutte e due le copie dell’elenco: niente del segreto si cancella, nemmeno scrivendoci dopo', async () => {
    const base = await contenitore(16 * MB);
    const { prima, copiaA, copiaB, undiciDi, gruppo } = await conElenco(base, 'Senza');
    const toccati = new Set([...copiaA, ...copiaB]);
    sporca(base, undiciDi(toccati));
    const intatte = [...prima.copie].filter(([i]) => !toccati.has(gruppo(i >> 1)) && gruppo(i >> 1) > 0);
    const ferme = (imp) => intatte.filter(([i, c]) => { const d = imp.copie.get(i); return d && d.p === c.p && d.v === c.v; }).length;
    let r = await apri(base, 'Senza');
    assert.equal(r.esito, 'aperto');
    assert.deepEqual(r.segreto.elencaFile(), []);
    await r.segreto.scriviFile('nuovo', 'dopo');
    await r.segreto.chiudi();
    r = await apri(base, 'Senza');
    assert.deepEqual(r.segreto.elencaFile().map((f) => f.nome), ['nuovo']);
    assert.equal((await r.segreto.leggiFile('nuovo')).toString(), 'dopo');
    await r.segreto.chiudi();
    assert.equal(ferme(await impronta(base, 'Senza')), intatte.length, 'la riparazione ha cancellato blocchi che non sapeva di chi fossero');
    rmSync(base.contenitore, { force: true });
  });
});

describe('interruzioni', () => {
  // Una scrittura che si ferma a metà (Filo chiuso, corrente via) si simula facendo fallire la n-esima scrittura su disco.
  async function conTaglio(n, fn) {
    const { open } = await import('node:fs/promises');
    const fh = await open(join(dir, 'sonda'), 'w');
    const proto = Object.getPrototypeOf(fh);
    await fh.close();
    const write = proto.write;
    let fatte = 0;
    proto.write = function (...a) {
      if (++fatte > n) return Promise.reject(Object.assign(new Error('interrotto'), { code: 'EIO' }));
      return write.apply(this, a);
    };
    try {
      await fn();
    } catch (e) {
      if (e.message !== 'interrotto') throw e;
    } finally {
      proto.write = write;
    }
    return fatte > n;
  }

  test('a ogni punto di taglio, sostituendo un file che fa crescere il segreto: si riapre col vecchio o col nuovo, mai un misto', async () => {
    const a = randomBytes(3 * F.CARICO);
    const vecchio = randomBytes(25 * F.CARICO);
    const nuovo = randomBytes(40 * F.CARICO + 17);
    let tagliate = 0;
    for (const n of [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]) {
      const base = await contenitore(4 * MB);
      const s = await crea(base, 'T');
      await s.scriviFile('a', a);
      await s.scriviFile('b', vecchio);
      if (await conTaglio(n, () => s.scriviFile('b', nuovo))) tagliate++;
      const r = await apri(base, 'T');
      const b = await r.segreto.leggiFile('b');
      assert.ok(b.equals(vecchio) || b.equals(nuovo), `taglio dopo ${n} scritture: «b» non è né il vecchio né il nuovo`);
      assert.ok((await r.segreto.leggiFile('a')).equals(a), `taglio dopo ${n}: «a» cambiato`);
      await r.segreto.chiudi();
      assert.ok(integra(await impronta(base, 'T')), `taglio dopo ${n}: ridondanza non tornata`);
      rmSync(base.contenitore, { force: true });
    }
    assert.ok(tagliate >= 10, 'quasi nessun taglio è caduto dentro la scrittura: la prova non prova niente');
  });

  test('a ogni punto di taglio, cancellando il file in coda (il segreto si accorcia): c’è ancora o non c’è, e il resto è intatto', async () => {
    const a = randomBytes(3 * F.CARICO);
    const coda = randomBytes(30 * F.CARICO);
    for (const n of [0, 1, 2, 4, 8, 16, 32, 64, 128]) {
      const base = await contenitore(4 * MB);
      const s = await crea(base, 'T');
      await s.scriviFile('a', a);
      await s.scriviFile('coda', coda);
      await conTaglio(n, () => s.cancellaFile('coda'));
      const r = await apri(base, 'T');
      const nomi = r.segreto.elencaFile().map((f) => f.nome);
      if (nomi.includes('coda')) assert.ok((await r.segreto.leggiFile('coda')).equals(coda), `taglio dopo ${n}: «coda» rovinata`);
      assert.ok((await r.segreto.leggiFile('a')).equals(a), `taglio dopo ${n}: «a» cambiato`);
      await r.segreto.chiudi();
      assert.ok(integra(await impronta(base, 'T')), `taglio dopo ${n}: ridondanza non tornata`);
      rmSync(base.contenitore, { force: true });
    }
  });
});

describe('chiudere mentre lavora', () => {
  const TESTO = Buffer.from('TESTO-IN-CHIARO-DEL-SEGRETO '.repeat(400_000));

  test('chiuso a metà salvataggio: il file si salva intero e niente nel contenitore si apre con la chiave azzerata', async () => {
    const base = await contenitore(64 * MB);
    const s = await crea(base, 'Chiuso');
    await s.scriviFile('prima', 'contenuto di prima');
    const fermo = statSync(base.contenitore).mtimeMs;
    const salva = s.scriviFile('grande', TESTO);
    // Si chiude appena il salvataggio ha cominciato a scrivere: la data che cambia è il segno.
    const fine = Date.now() + 10_000;
    while (statSync(base.contenitore).mtimeMs === fermo && Date.now() < fine) await new Promise((ok) => setTimeout(ok, 2));
    assert.ok(Date.now() < fine, 'il salvataggio non è mai partito');
    await s.chiudi();
    await salva;
    const buf = readFileSync(base.contenitore);
    const zero = Buffer.alloc(32);
    let aperti = 0;
    for (let p = 0; p < buf.length / F.BLOCCO; p++) if (F.apriBlocco(zero, p, blocco(buf, p))) aperti++;
    assert.equal(aperti, 0);
    const r = await apri(base, 'Chiuso');
    assert.deepEqual(r.segreto.elencaFile().map((f) => f.nome).sort(), ['grande', 'prima']);
    assert.ok((await r.segreto.leggiFile('grande')).equals(TESTO));
    await r.segreto.chiudi();
    await assert.rejects(r.segreto.scriviFile('dopo', 'x'), (e) => e.codice === 'CHIUSO');
    rmSync(base.contenitore, { force: true });
  });

  test('chiuso mentre un file si legge: la lettura finisce col contenuto giusto, non «rovinato»', async () => {
    const base = await contenitore(64 * MB);
    const s = await crea(base, 'Letto');
    await s.scriviFile('grande', TESTO);
    const leggi = s.leggiFile('grande');
    await new Promise((ok) => setTimeout(ok, 5));
    await s.chiudi();
    assert.ok((await leggi).equals(TESTO));
    rmSync(base.contenitore, { force: true });
  });
});

describe('le date del contenitore', () => {
  test('creare, scrivere, riaprire, cancellare e cercare un nome che non c’è le lasciano com’erano', async () => {
    const base = await contenitore(16 * MB);
    const installazione = new Date('2025-03-01T10:00:00.123Z');
    utimesSync(base.contenitore, installazione, installazione);
    const date = () => {
      const st = statSync(base.contenitore, { bigint: true });
      return [st.atimeNs, st.mtimeNs];
    };
    const attese = date();
    const s = await crea(base, 'Datato');
    await s.scriviFile('diario.txt', 'cose mie');
    await s.cancellaFile('diario.txt');
    await s.scriviFile('diario.txt', 'cose mie, di nuovo');
    await s.chiudi();
    assert.deepEqual(date(), attese, 'dopo aver creato e scritto');
    for (let x = 0; x < 5; x++) await (await apri(base, 'Datato')).segreto.chiudi();
    assert.deepEqual(date(), attese, 'dopo cinque riaperture: niente scivola');
    assert.deepEqual(await apri(base, 'nome che non c’è'), NESSUNO);
    assert.deepEqual(date(), attese, 'dopo un nome che non c’è');
    await (await apri(base, 'Datato')).segreto.cancella();
    assert.deepEqual(date(), attese, 'dopo la cancellazione');
    rmSync(base.contenitore, { force: true });
  });

  // La grana non è un numero fisso: al microsecondo su Linux, su Windows la griglia che lascia la conversione in FILETIME
  // (#1457). Si chiede alle operazioni: rimesse davvero le date, quelle di un contenitore appena nato non si spostano.
  test('un contenitore nuovo nasce con le date alla stessa grana con cui le operazioni le rimettono', async () => {
    const fsp = require('node:fs/promises');
    const base = await contenitore(1 * MB);
    const date = () => {
      const st = statSync(base.contenitore, { bigint: true });
      return [st.atimeNs, st.mtimeNs];
    };
    const nate = date();
    let rimesse = 0;
    const open0 = fsp.open;
    fsp.open = async (...a) => {
      const fh = await open0(...a);
      const u0 = fh.utimes.bind(fh);
      fh.utimes = (...t) => { rimesse++; return u0(...t); };
      return fh;
    };
    try {
      const s = await crea(base, 'Grana');
      await s.scriviFile('nota', 'x');
      await s.chiudi();
    } finally {
      fsp.open = open0;
    }
    assert.ok(rimesse > 0, 'nessuna operazione ha rimesso le date: la prova non direbbe niente');
    assert.deepEqual(date(), nate);
    rmSync(base.contenitore, { force: true });
  });
});

describe('dichiarato alla creazione, poi aperto come tutti i giorni', () => {
  test('riaprire senza dichiarare chi si era scansato non gli sovrascrive nemmeno una copia', async () => {
    // L'altro occupa poco più di metà del contenitore: le copie scansate stanno in fondo a catene lunghe.
    const base = await contenitore(64 * MB);
    const c = await crea(base, 'Casa');
    for (let x = 0; x < 20; x++) await c.scriviFile(`c${x}`, randomBytes(MB));
    await c.chiudi();
    const prima = await impronta(base, 'Casa');
    const d = await crea(base, 'Diario', ['Casa']);
    for (let x = 0; x < 4; x++) await d.scriviFile(`d${x}`, randomBytes(MB));
    await d.chiudi();
    assert.equal(persi(prima, await impronta(base, 'Casa')), 0, 'mentre si dichiarava');
    for (let x = 0; x < 2; x++) await (await apri(base, 'Diario')).segreto.chiudi();
    assert.equal(persi(prima, await impronta(base, 'Casa')), 0, 'dopo le riaperture normali');
    assert.ok(integra(await impronta(base, 'Diario')));
    rmSync(base.contenitore, { force: true });
  });
});

describe('corrente che salta e finestra che non si ferma', () => {
  // Il disco tiene un sottoinsieme qualsiasi delle scritture fatte dopo l'ultima sincronizzazione: qui le prime m di
  // quelle sopra le copie vecchie e nessuna nei posti nuovi, il caso che guasta la versione vecchia senza dare la nuova.
  test('salvare un file che allunga un gruppo, con la corrente che salta a ogni punto: i file già salvati restano', async () => {
    const fsp = require('node:fs/promises');
    const base = await contenitore(16 * MB);
    const PIENO = randomBytes(12 * F.CARICO);
    const A = randomBytes(3 * F.CARICO + 100);
    const B = randomBytes(6 * F.CARICO);
    const s = await crea(base, 'Casa');
    await s.scriviFile('pieno', PIENO);
    await s.scriviFile('a', A);
    await s.chiudi();
    const r0 = (await apri(base, 'Casa')).segreto;
    const prima = readFileSync(base.contenitore);
    const k = await K.derivaChiavi(F.normalizzaNome('Casa'), base.sale, PROVA);
    const giaSue = new Set();
    for (let p = 0; p < prima.length / F.BLOCCO; p++) if (F.leggiPrefisso(F.apriBlocco(k.cifra, p, blocco(prima, p)))) giaSue.add(p);
    const registro = [];
    const open0 = fsp.open;
    fsp.open = async (...a) => {
      const fh = await open0(...a);
      const w0 = fh.write.bind(fh);
      const s0 = fh.datasync.bind(fh);
      fh.write = async (buf, off, len, pos) => {
        for (let x = 0; x < len; x += F.BLOCCO) registro.push({ p: (pos + x) / F.BLOCCO, dati: Buffer.from(buf.subarray(off + x, off + x + F.BLOCCO)) });
        return w0(buf, off, len, pos);
      };
      fh.datasync = async () => { registro.push(null); return s0(); };
      return fh;
    };
    try {
      await r0.scriviFile('b', B);
    } finally {
      fsp.open = open0;
    }
    await r0.chiudi();
    const tratti = [[]];
    for (const w of registro) if (w) tratti[tratti.length - 1].push(w); else tratti.push([]);
    const guasti = [];
    let casi = 0;
    for (let t = 0; t < tratti.length; t++) {
      const sopra = tratti[t].filter((w) => giaSue.has(w.p));
      for (let m = 1; m <= sopra.length; m++) {
        const disco = Buffer.from(prima);
        for (let x = 0; x < t; x++) for (const w of tratti[x]) w.dati.copy(disco, w.p * F.BLOCCO);
        for (const w of sopra.slice(0, m)) w.dati.copy(disco, w.p * F.BLOCCO);
        writeFileSync(base.contenitore, disco);
        casi++;
        const r = await apri(base, 'Casa');
        const e = { esito: r.esito };
        if (r.segreto) {
          const uguale = (n, atteso) => r.segreto.leggiFile(n).then((b) => b.equals(atteso), (err) => err.codice);
          e.pieno = await uguale('pieno', PIENO);
          e.a = await uguale('a', A);
          e.b = r.segreto.elencaFile().some((f) => f.nome === 'b') ? await uguale('b', B) : 'assente';
          await r.segreto.chiudi();
        }
        if (!(e.esito === 'aperto' && e.pieno === true && e.a === true && (e.b === true || e.b === 'assente'))) guasti.push(`tratto ${t + 1}, ${m} di ${sopra.length}: ${JSON.stringify(e)}`);
      }
    }
    assert.ok(casi > 10, `troppi pochi tagli provati: ${casi}`);
    assert.deepEqual(guasti, []);
    rmSync(base.contenitore, { force: true });
  });

  // Il motore gira nel processo della finestra: fra un giro e l'altro del ciclo degli eventi lavora su pochi blocchi,
  // qualunque sia la dimensione del segreto. Si contano cifrature, decifrature e byte casuali per giro.
  test('aprire, salvare, leggere e togliere un file da 24 MB lascia il turno ogni poche centinaia di blocchi', async () => {
    const crypto = require('node:crypto');
    const base = await contenitore(64 * MB);
    const dati = randomBytes(24 * MB);
    const orig = { d: crypto.createDecipheriv, c: crypto.createCipheriv, r: crypto.randomBytes };
    let blocchi = 0;
    let max = 0;
    let acceso = true;
    const giro = () => { max = Math.max(max, blocchi); blocchi = 0; if (acceso) setImmediate(giro); };
    crypto.createDecipheriv = function (...a) { blocchi++; return orig.d.apply(this, a); };
    crypto.createCipheriv = function (...a) { blocchi++; return orig.c.apply(this, a); };
    crypto.randomBytes = function (n, ...a) { blocchi += Math.ceil(n / F.BLOCCO); return orig.r.call(this, n, ...a); };
    const massimi = {};
    const misura = async (nome, fn) => {
      await new Promise((ok) => setImmediate(ok));
      max = 0;
      blocchi = 0;
      const r = await fn();
      massimi[nome] = Math.max(max, blocchi);
      return r;
    };
    setImmediate(giro);
    try {
      const s = await misura('crea', () => crea(base, 'Casa'));
      await misura('salva', () => s.scriviFile('foto', dati));
      await s.chiudi();
      const r = (await misura('apri', () => apri(base, 'Casa'))).segreto;
      assert.ok((await misura('leggi', () => r.leggiFile('foto'))).equals(dati));
      await misura('togli', () => r.cancellaFile('foto'));
      await misura('cancella', () => r.cancella());
    } finally {
      acceso = false;
      Object.assign(crypto, { createDecipheriv: orig.d, createCipheriv: orig.c, randomBytes: orig.r });
    }
    const troppi = Object.fromEntries(Object.entries(massimi).filter(([, n]) => n > 1536));
    assert.deepEqual(troppi, {}, `blocchi lavorati in un giro solo: ${JSON.stringify(massimi)}`);
    rmSync(base.contenitore, { force: true });
  });
});

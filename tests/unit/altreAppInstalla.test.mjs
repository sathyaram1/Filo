// Il componente delle altre applicazioni sul disco vero (#779): si installa solo col file della sua impronta, con
// l'avanzamento vero; con un'impronta diversa non si installa e la frase lo dice in chiaro; si toglie tutto, anche a metà.
// Un pacchetto che vorrebbe scrivere fuori dalla sua cartella, o creare collegamenti, si rifiuta. Il server è locale.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import * as zlib from 'node:zlib';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { creaInstallatore, MARCA } = require(join(ROOT, 'src/main/services/altreApp/installa.js'));
const Archivi = require(join(ROOT, 'src/main/services/altreApp/archivi.js'));
const Pacchetti = require(join(ROOT, 'src/main/services/altreApp/pacchetti.js'));

// Un tar POSIX minimo: le voci come [nome, contenuto, tipo, modo].
function tar(voci) {
  const blocchi = [];
  for (const [nome, contenuto = '', tipo = '0', modo = 0o755, collega = ''] of voci) {
    const dati = Buffer.from(contenuto);
    const h = Buffer.alloc(512);
    h.write(nome, 0, 100, 'utf8');
    h.write(modo.toString(8).padStart(7, '0'), 100);
    h.write('0000000', 108); h.write('0000000', 116);
    h.write(dati.length.toString(8).padStart(11, '0'), 124);
    h.write('00000000000', 136);
    h.write(tipo, 156);
    h.write(collega, 157, 100);
    h.write('ustar\u0000', 257, 'latin1'); h.write('00', 263);
    h.fill(32, 148, 156);
    let somma = 0;
    for (const b of h) somma += b;
    h.write(`${somma.toString(8).padStart(6, '0')}\u0000 `, 148, 'latin1');
    blocchi.push(h, dati, Buffer.alloc((512 - (dati.length % 512)) % 512));
  }
  blocchi.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocchi));
}

function zip(voci) {
  const locali = [];
  const centrali = [];
  let pos = 0;
  for (const [nome, testo] of voci) {
    const dati = Buffer.from(testo);
    const compressi = zlib.deflateRawSync(dati);
    const n = Buffer.from(nome);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8);
    l.writeUInt32LE(compressi.length, 18); l.writeUInt32LE(dati.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(compressi.length, 20); c.writeUInt32LE(dati.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(pos, 42);
    locali.push(l, n, compressi);
    centrali.push(c, n);
    pos += 30 + n.length + compressi.length;
  }
  const centro = Buffer.concat(centrali);
  const fine = Buffer.alloc(22);
  fine.writeUInt32LE(0x06054b50, 0); fine.writeUInt16LE(voci.length, 8); fine.writeUInt16LE(voci.length, 10);
  fine.writeUInt32LE(centro.length, 12); fine.writeUInt32LE(pos, 16);
  return Buffer.concat([...locali, centro, fine]);
}

const sha = (b) => createHash('sha256').update(b).digest('hex');

// Il server manda il file a pezzi, con una pausa, così l'avanzamento si vede passo per passo.
async function server(file, { pezzi = 8, pausaMs = 15, stato = 200 } = {}) {
  let richieste = 0;
  const srv = createServer(async (req, res) => {
    richieste++;
    if (stato !== 200) { res.writeHead(stato); res.end('no'); return; }
    res.writeHead(200, { 'Content-Length': file.length, 'Content-Type': 'application/octet-stream' });
    const passo = Math.ceil(file.length / pezzi);
    for (let i = 0; i < file.length; i += passo) {
      if (res.destroyed) return;
      res.write(file.subarray(i, i + passo));
      await new Promise((r) => setTimeout(r, pausaMs));
    }
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/pacchetto`, richieste: () => richieste, chiudi: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}

function installatore(dir, p, extra = {}) {
  const passi = [];
  const I = creaInstallatore({
    cartella: () => join(dir, 'componenti', 'cua-driver'),
    pacchetto: () => p,
    scarica: (url, o) => fetch(url, o),
    prova: async () => ({ ok: true }),
    ogniMs: 0,
    ...extra,
  });
  I.suCambio((s) => passi.push({ ...s }));
  return { I, passi };
}

test('il pacchetto con la sua impronta si scarica con l\'avanzamento vero e si installa', async () => {
  const dir = cartellaTemporanea('filo-altreapp-');
  const file = tar([['cua-driver', '#!/bin/sh\necho finto\n'], ['LICENSE', 'MIT'], ['lib/', '', '5']]);
  const srv = await server(file);
  try {
    const p = { versione: '9.9.9', file: 'p.tar.gz', url: srv.url, sha256: sha(file), byte: file.length, formato: 'tar.gz', eseguibile: 'cua-driver' };
    let provato = null;
    const { I, passi } = installatore(dir, p, { prova: async (exe) => { provato = exe; return { ok: true }; } });
    const fine = await I.installa();
    assert.equal(fine.fase, 'pronto');
    const base = join(dir, 'componenti', 'cua-driver');
    const exe = join(base, '9.9.9', 'cua-driver');
    assert.equal(readFileSync(exe, 'utf8'), '#!/bin/sh\necho finto\n');
    if (process.platform !== 'win32') assert.ok(statSync(exe).mode & 0o100, 'l\'eseguibile resta eseguibile');
    assert.equal(provato, exe, 'dopo l\'installazione si prova il programma installato');
    assert.deepEqual(JSON.parse(readFileSync(join(base, MARCA), 'utf8')).sha256, p.sha256);
    assert.deepEqual(readdirSync(base).sort(), ['9.9.9', MARCA].sort(), 'niente avanzi dello scaricamento');
    // L'avanzamento: byte che crescono fino al totale vero, poi impronta, estrazione, prova, pronto.
    const scaricati = passi.filter((s) => s.fase === 'scarica');
    assert.ok(scaricati.length >= 4, `passi di avanzamento: ${scaricati.length}`);
    for (let i = 1; i < scaricati.length; i++) assert.ok(scaricati[i].ricevuti >= scaricati[i - 1].ricevuti);
    assert.ok(scaricati.some((s) => s.ricevuti > 0 && s.ricevuti < file.length), 'si vede anche un punto a metà');
    assert.equal(scaricati.at(-1).ricevuti, file.length);
    assert.ok(scaricati.every((s) => s.totali === file.length));
    const fasi = passi.map((s) => s.fase).filter((f, i, a) => f !== a[i - 1]);
    assert.deepEqual(fasi, ['scarica', 'verifica', 'estrae', 'prova', 'pronto']);
    const d = await I.sulDisco();
    assert.equal(d.aggiornato, true);
    assert.ok(d.byte > 0);
    // Disinstallare toglie tutto.
    await I.disinstalla();
    assert.equal(existsSync(base), false);
    assert.equal(I.stato().fase, 'assente');
  } finally { await srv.chiudi(); togliCartella(dir); }
});

test('con un\'impronta diversa non si installa, e la frase dice in chiaro perché', async () => {
  const dir = cartellaTemporanea('filo-altreapp-');
  const file = tar([['cua-driver', 'alterato']]);
  const srv = await server(file);
  try {
    const p = { versione: '9.9.9', file: 'p.tar.gz', url: srv.url, sha256: sha(Buffer.from('un altro file')), byte: file.length, formato: 'tar.gz', eseguibile: 'cua-driver' };
    let provato = false;
    const { I } = installatore(dir, p, { prova: async () => { provato = true; return { ok: true }; } });
    const fine = await I.installa();
    assert.equal(fine.fase, 'errore');
    assert.equal(fine.errore.codice, 'impronta');
    assert.match(fine.errore.frase, /impronta non combacia/);
    assert.match(fine.errore.frase, /non l'ho installato/);
    const base = join(dir, 'componenti', 'cua-driver');
    assert.equal(existsSync(join(base, '9.9.9')), false, 'niente di estratto');
    assert.equal(existsSync(join(base, MARCA)), false);
    assert.equal(existsSync(join(base, '.scarica')), false, 'il file sbagliato non resta sul disco');
    assert.equal(provato, false, 'un file non verificato non si avvia mai');
    assert.equal((await I.sulDisco()).errore.codice, 'impronta', 'il rifiuto si ricorda: all\'avvio non si riscarica da solo');
  } finally { await srv.chiudi(); togliCartella(dir); }
});

test('un file di misura diversa si ferma senza scaricare il resto', async () => {
  const dir = cartellaTemporanea('filo-altreapp-');
  const file = tar([['cua-driver', 'x'.repeat(5000)]]);
  const srv = await server(file);
  try {
    const p = { versione: '1.0.0', file: 'p.tar.gz', url: srv.url, sha256: sha(file), byte: file.length - 10, formato: 'tar.gz', eseguibile: 'cua-driver' };
    const { I } = installatore(dir, p);
    const fine = await I.installa();
    assert.equal(fine.fase, 'errore');
    assert.equal(fine.errore.codice, 'misura');
    assert.match(fine.errore.frase, /non l'ho installato/);
  } finally { await srv.chiudi(); togliCartella(dir); }
});

test('rete giù, GitHub che risponde 404, sistema senza pacchetto: una frase ciascuno, niente sul disco', async () => {
  const dir = cartellaTemporanea('filo-altreapp-');
  const srv = await server(Buffer.from('x'), { stato: 404 });
  try {
    const base = { versione: '1.0.0', file: 'p', sha256: 'aa', byte: 1, formato: 'zip', eseguibile: 'x' };
    const r404 = await installatore(dir, { ...base, url: srv.url }).I.installa();
    assert.equal(r404.errore.codice, 'http');
    assert.match(r404.errore.frase, /404/);
    const giu = await installatore(dir, { ...base, url: 'http://127.0.0.1:9/p' }).I.installa();
    assert.equal(giu.errore.codice, 'rete');
    assert.match(giu.errore.frase, /la rete non risponde/);
    const nessuno = await installatore(dir, null, { sistema: () => 'Linux ia32' }).I.installa();
    assert.equal(nessuno.errore.codice, 'non-supportato');
    assert.match(nessuno.errore.frase, /Linux ia32/);
    assert.equal(existsSync(join(dir, 'componenti', 'cua-driver', '1.0.0')), false);
  } finally { await srv.chiudi(); togliCartella(dir); }
});

test('spegnere a metà dello scaricamento ferma tutto e non lascia niente; due installa di fila sono una', async () => {
  const dir = cartellaTemporanea('filo-altreapp-');
  const file = tar([['cua-driver', 'y'.repeat(200000)]]);
  const srv = await server(file, { pezzi: 40, pausaMs: 25 });
  try {
    const p = { versione: '2.0.0', file: 'p.tar.gz', url: srv.url, sha256: sha(file), byte: file.length, formato: 'tar.gz', eseguibile: 'cua-driver' };
    const { I, passi } = installatore(dir, p);
    const uno = I.installa();
    const due = I.installa();
    assert.equal(uno, due);
    while (!passi.some((s) => s.fase === 'scarica' && s.ricevuti > 0)) await new Promise((r) => setTimeout(r, 10));
    await I.disinstalla();
    await uno;
    assert.equal(I.stato().fase, 'assente');
    assert.equal(existsSync(join(dir, 'componenti', 'cua-driver')), false);
    assert.equal(srv.richieste(), 1);
  } finally { await srv.chiudi(); togliCartella(dir); }
});

test('un driver installato che non parte lo dice, e si può reinstallare', async () => {
  const dir = cartellaTemporanea('filo-altreapp-');
  const file = zip([['cua/cua-driver.exe', 'MZ finto'], ['cua/LICENSE', 'MIT']]);
  const srv = await server(file);
  try {
    const p = { versione: '3.0.0', file: 'p.zip', url: srv.url, sha256: sha(file), byte: file.length, formato: 'zip', eseguibile: 'cua/cua-driver.exe' };
    let parte = false;
    const { I } = installatore(dir, p, { prova: async () => (parte ? { ok: true } : { ok: false, motivo: 'codice 3' }) });
    const r = await I.installa();
    assert.equal(r.fase, 'errore');
    assert.equal(r.errore.codice, 'non-parte');
    assert.match(r.errore.frase, /non parte/);
    parte = true;
    assert.equal((await I.installa()).fase, 'pronto');
    assert.equal(readFileSync(join(dir, 'componenti', 'cua-driver', '3.0.0', 'cua', 'cua-driver.exe'), 'utf8'), 'MZ finto');
  } finally { await srv.chiudi(); togliCartella(dir); }
});

test('un archivio che esce dalla sua cartella o crea collegamenti si rifiuta', async () => {
  const dir = cartellaTemporanea('filo-altreapp-');
  try {
    const casi = {
      'risale.tar.gz': tar([['../fuori.txt', 'no']]),
      'assoluto.tar.gz': tar([['/etc/fuori', 'no']]),
      'collegamento.tar.gz': tar([['link', '', '2', 0o777, '/etc/passwd']]),
      'risale.zip': zip([['a/../../fuori.txt', 'no']]),
      'windows.zip': zip([['C:\\fuori.txt', 'no']]),
    };
    for (const [nome, dati] of Object.entries(casi)) {
      const f = join(dir, nome);
      writeFileSync(f, dati);
      const dest = join(dir, `dest-${nome}`);
      mkdirSync(dest);
      await assert.rejects(Archivi.estrai(f, nome.endsWith('.zip') ? 'zip' : 'tar.gz', dest), (e) => e instanceof Archivi.ErroreArchivio, nome);
    }
    assert.equal(existsSync(join(dir, 'fuori.txt')), false);
    assert.equal(Archivi.dentro('/a/b', 'c/../../d'), null);
    assert.equal(Archivi.dentro('/a/b', './c/d') !== null, true);
  } finally { togliCartella(dir); }
});

test('il file della versione fissata ha un pacchetto con impronta per ogni sistema che Filo pubblica', () => {
  for (const k of ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64']) {
    const [platform, arch] = k.split('-');
    const p = Pacchetti.pacchettoPer(platform, arch);
    assert.ok(p, k);
    assert.match(p.sha256, /^[0-9a-f]{64}$/, `${k}: impronta sha256`);
    assert.ok(p.byte > 1000000, `${k}: misura`);
    assert.ok(p.url.startsWith(Pacchetti.BASE) && p.url.endsWith(p.file), k);
    assert.ok(p.file.includes(Pacchetti.VERSIONE), `${k}: il file è della versione fissata`);
    assert.ok(['zip', 'tar.gz'].includes(p.formato));
    assert.ok(!/perception/i.test(p.file), 'mai l\'estensione cua-perception (AGPL)');
  }
  assert.ok(Pacchetti.BASE.includes(`cua-driver-rs-v${Pacchetti.VERSIONE}/`));
  assert.equal(Pacchetti.pacchettoPer('linux', 'ia32'), null);
});

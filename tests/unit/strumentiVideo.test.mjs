// #1488 — i programmi per i video in streaming entrano solo controllati: yt-dlp con la firma dei suoi autori,
// ffmpeg con l'hash fissato. Si scaricano una volta, si riguardano una volta al giorno, e senza rete basta quello
// che c'è. La rete qui è finta; la firma vera si prova in firmaPgp.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = require(join(ROOT, 'src', 'main', 'services', 'strumentiVideo.js'));
const Y = require(join(ROOT, 'src', 'main', 'services', 'ytdlp.js'));

const sha = (b) => createHash('sha256').update(b).digest('hex');

function rete(file) {
  const chiesti = [];
  const scarica = async (url) => {
    chiesti.push(url);
    const nome = url.split('/').pop();
    if (!(nome in file.contenuti)) throw new Error(`HTTP 404 da ${url}`);
    if (file.giu) throw new Error('rete giù');
    const b = Buffer.from(file.contenuti[nome]);
    return { totale: b.length, corpo: (async function* () { for (let i = 0; i < b.length; i += 1000) yield b.subarray(i, i + 1000); })() };
  };
  return { scarica, chiesti };
}

function scena({ firmaBuona = true } = {}) {
  const cartella = cartellaTemporanea('filo-strumenti-');
  const ytdlp = Buffer.from('#!/bin/sh\necho yt-dlp\n');
  const ffmpeg = Buffer.alloc(5000, 7);
  const gz = gzipSync(ffmpeg);
  const file = {
    contenuti: {
      'SHA2-256SUMS': `${sha(ytdlp)}  yt-dlp_linux\n${'c'.repeat(64)}  yt-dlp.exe\n`,
      'SHA2-256SUMS.sig': 'firma',
      yt_dlp_linux: null,
      'yt-dlp_linux': ytdlp,
      'ffmpeg-linux-x64.gz': gz,
    },
  };
  let ora = 1_000_000;
  const r = rete(file);
  const s = S.crea({
    cartella, scarica: r.scarica, platform: 'linux', arch: 'x64', ora: () => ora,
    verificaFirma: (dati, firma) => firmaBuona && String(firma) === 'firma' && String(dati) === file.contenuti['SHA2-256SUMS'],
    hashFfmpeg: { 'ffmpeg-linux-x64.gz': sha(gz) },
  });
  return { cartella, file, r, s, ytdlp, ffmpeg, avanti: (ms) => { ora += ms; } };
}

test('al primo salvataggio scendono yt-dlp e ffmpeg, controllati, con un avanzamento che arriva al totale', async () => {
  const sc = scena();
  try {
    const visti = [];
    const p = await sc.s.pronti({ avanza: (a) => visti.push(a) });
    assert.deepEqual(readFileSync(p.ytdlp), sc.ytdlp);
    assert.deepEqual(readFileSync(p.ffmpeg), sc.ffmpeg, 'ffmpeg arriva decompresso');
    const ultimo = visti.at(-1);
    assert.ok(ultimo.totale > 0 && ultimo.ricevuti === ultimo.totale, JSON.stringify(ultimo));
    assert.ok(visti.some((a) => a.ricevuti < a.totale), 'c\'è un avanzamento intermedio');
  } finally { togliCartella(sc.cartella); }
});

test('la seconda volta non si scarica niente; dopo un giorno si guarda solo l\'elenco firmato', async () => {
  const sc = scena();
  try {
    const p1 = await sc.s.pronti();
    const n = sc.r.chiesti.length;
    const p2 = await sc.s.pronti();
    assert.equal(sc.r.chiesti.length, n, 'nessuna richiesta in più nello stesso giorno');
    assert.equal(p2.ytdlp, p1.ytdlp);
    sc.avanti(S.CONTROLLO_MS + 1);
    await sc.s.pronti();
    const nuove = sc.r.chiesti.slice(n).map((u) => u.split('/').pop()).sort();
    assert.deepEqual(nuove, ['SHA2-256SUMS', 'SHA2-256SUMS.sig'], 'stessa versione: solo l\'elenco');
  } finally { togliCartella(sc.cartella); }
});

test('una versione nuova prende un file nuovo e toglie il vecchio', async () => {
  const sc = scena();
  try {
    const p1 = await sc.s.pronti();
    const nuovo = Buffer.from('#!/bin/sh\necho yt-dlp nuovo\n');
    sc.file.contenuti['yt-dlp_linux'] = nuovo;
    sc.file.contenuti['SHA2-256SUMS'] = `${sha(nuovo)}  yt-dlp_linux\n`;
    const p2 = await sc.s.pronti({ forza: true });
    assert.notEqual(p2.ytdlp, p1.ytdlp);
    assert.deepEqual(readFileSync(p2.ytdlp), nuovo);
    assert.equal(existsSync(p1.ytdlp), false);
  } finally { togliCartella(sc.cartella); }
});

test('senza rete basta il programma che c\'è; senza programma e senza rete è un errore detto', async () => {
  const sc = scena();
  try {
    const p1 = await sc.s.pronti();
    sc.file.giu = true;
    const p2 = await sc.s.pronti({ forza: true });
    assert.equal(p2.ytdlp, p1.ytdlp);
  } finally { togliCartella(sc.cartella); }
  const vuota = scena();
  try {
    vuota.file.giu = true;
    await assert.rejects(vuota.s.pronti(), (e) => e.motivo === 'programma');
  } finally { togliCartella(vuota.cartella); }
});

test('un elenco senza firma valida o un file che non torna con l\'hash non entra', async () => {
  const sc = scena({ firmaBuona: false });
  try {
    await assert.rejects(sc.s.pronti(), (e) => e.motivo === 'firma');
    assert.ok(!readdirSync(sc.cartella).some((n) => n.startsWith('yt-dlp')), 'nessun yt-dlp sul disco');
  } finally { togliCartella(sc.cartella); }
  const manomesso = scena();
  try {
    manomesso.file.contenuti['yt-dlp_linux'] = Buffer.from('#!/bin/sh\nrm -rf ~\n');
    await assert.rejects(manomesso.s.pronti(), (e) => e.motivo === 'firma');
    assert.ok(!readdirSync(manomesso.cartella).some((n) => n.startsWith('yt-dlp')), 'il file manomesso non resta, nemmeno a metà');
  } finally { togliCartella(manomesso.cartella); }
});

test('due salvataggi insieme aspettano lo stesso scaricamento', async () => {
  const sc = scena();
  try {
    const [a, b] = await Promise.all([sc.s.pronti(), sc.s.pronti()]);
    assert.deepEqual(a, b);
    assert.equal(sc.r.chiesti.filter((u) => u.endsWith('/yt-dlp_linux')).length, 1);
  } finally { togliCartella(sc.cartella); }
});

test('su un computer senza una build di yt-dlp lo dice', async () => {
  const cartella = cartellaTemporanea('filo-strumenti-');
  try {
    const s = S.crea({ cartella, scarica: async () => { throw new Error('non deve scaricare'); }, platform: 'freebsd', arch: 'x64' });
    await assert.rejects(s.pronti(), (e) => e.motivo === 'piattaforma');
  } finally { togliCartella(cartella); }
  assert.ok(Y.RILASCIO_YTDLP.startsWith('https://github.com/yt-dlp/yt-dlp/releases/'));
});

// Il servizio dei nomi sensati (#950) sul disco vero: rinomina senza sovrascrivere né cambiare estensione,
// rimette il nome di prima com'era, e legge i documenti Word e LibreOffice (archivi zip) per la proposta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, readdirSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src');
require(join(SRC, 'shared', 'contenutoEsterno.js'));
require(join(SRC, 'shared', 'nomiFile.js'));
const Nomi = require(join(SRC, 'main', 'services', 'nomiFile.js'));

// Un archivio zip minimo (voci compresse come fa Word), per non tenere un .docx binario nel repo.
function zip(voci) {
  const locali = [];
  const centrali = [];
  let pos = 0;
  for (const [nome, testo] of Object.entries(voci)) {
    const dati = Buffer.from(testo, 'utf8');
    const compressi = deflateRawSync(dati);
    const n = Buffer.from(nome, 'utf8');
    const crc = crc32(dati);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(compressi.length, 18); l.writeUInt32LE(dati.length, 22);
    l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressi.length, 20); c.writeUInt32LE(dati.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(pos, 42);
    locali.push(l, n, compressi);
    centrali.push(c, n);
    pos += 30 + n.length + compressi.length;
  }
  const centro = Buffer.concat(centrali);
  const fine = Buffer.alloc(22);
  fine.writeUInt32LE(0x06054b50, 0);
  fine.writeUInt16LE(Object.keys(voci).length, 8); fine.writeUInt16LE(Object.keys(voci).length, 10);
  fine.writeUInt32LE(centro.length, 12); fine.writeUInt32LE(pos, 16);
  return Buffer.concat([...locali, centro, fine]);
}

function cartella() {
  return cartellaTemporanea('filo-nomi-unit-');
}

test('rinomina: tiene l\'estensione, non sovrascrive, dice il nome vero', async () => {
  const dir = cartella();
  try {
    writeFileSync(join(dir, 'scan_00231.pdf'), 'a');
    writeFileSync(join(dir, 'Bolletta.pdf'), 'già qui');
    const r = await Nomi.rinomina(join(dir, 'scan_00231.pdf'), 'Bolletta.docx');
    assert.equal(r.ok, true);
    assert.equal(r.nome, 'Bolletta (2).pdf');
    assert.equal(r.prima, 'scan_00231.pdf');
    assert.equal(r.cambiato, true);
    assert.deepEqual(readdirSync(dir).sort(), ['Bolletta (2).pdf', 'Bolletta.pdf']);
    assert.equal(readFileSync(join(dir, 'Bolletta.pdf'), 'utf8'), 'già qui');
    // Indietro col nome esatto di prima, anche se la pulizia lo cambierebbe.
    const [x] = await Nomi.rimetti([{ attuale: r.a, prima: 'scan_00231.pdf' }]);
    assert.equal(x.ok, true);
    assert.deepEqual(readdirSync(dir).sort(), ['Bolletta.pdf', 'scan_00231.pdf']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rinomina: vuoto, cartelle, file spariti, estensione cambiata o nome con una barra si fermano dicendolo', async () => {
  const dir = cartella();
  try {
    writeFileSync(join(dir, 'a.pdf'), 'a');
    mkdirSync(join(dir, 'sotto.pdf'));
    assert.equal((await Nomi.rinomina(join(dir, 'a.pdf'), '   ')).ok, false);
    assert.equal((await Nomi.rinomina(join(dir, 'sotto.pdf'), 'x')).errore, 'non_file');
    assert.equal((await Nomi.rinomina(join(dir, 'manca.pdf'), 'x')).errore, 'non_trovato');
    assert.equal((await Nomi.rinomina(join(dir, 'a.pdf'), 'b.txt', { esatto: true })).errore, 'estensione');
    assert.equal((await Nomi.rinomina(join(dir, 'a.pdf'), '../fuori.pdf', { esatto: true })).ok, false);
    // Una barra scritta da un modello non porta il file in un'altra cartella.
    const r = await Nomi.rinomina(join(dir, 'a.pdf'), '../fuori');
    assert.equal(r.ok, true);
    assert.equal(r.nome, '..-fuori.pdf'.replace(/^\.+-?/, ''));
    assert.equal(dirname(r.a), dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('un documento Word e uno LibreOffice si leggono per proporre il nome; il modello riceve il testo imbustato', async () => {
  const dir = cartella();
  try {
    writeFileSync(join(dir, 'documento (3).docx'), zip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Contratto di affitto</w:t></w:r></w:p>'
        + '<w:p><w:r><w:t>Via Roma 12 &amp; box</w:t></w:r></w:p></w:body></w:document>',
      'docProps/core.xml': '<cp:coreProperties><dc:title>Locazione 2026</dc:title></cp:coreProperties>',
    }));
    writeFileSync(join(dir, 'senza titolo.odt'), zip({
      'content.xml': '<office:text><text:h>Verbale assemblea</text:h><text:p>Condominio Aurora</text:p></office:text>',
    }));
    const visti = [];
    Nomi.collega({
      lingua: () => 'italiano',
      chiamaModello: async (messages) => { visti.push(messages); return 'Contratto affitto Via Roma 12.docx'; },
    });
    const p = await Nomi.proponi(join(dir, 'documento (3).docx'));
    assert.equal(p.ok, true);
    assert.equal(p.proposta, 'Contratto affitto Via Roma 12');
    assert.equal(p.ext, '.docx');
    const utente = visti[0].find((m) => m.role === 'user').content;
    assert.match(utente, /Locazione 2026/);
    assert.match(utente, /Contratto di affitto/);
    assert.match(utente, /Via Roma 12 & box/);
    assert.match(utente, /Nome attuale: documento \(3\)\.docx/);
    assert.match(visti[0][0].content, /italiano/);

    await Nomi.proponi(join(dir, 'senza titolo.odt'));
    assert.match(visti[1].find((m) => m.role === 'user').content, /Verbale assemblea\nCondominio Aurora/);
  } finally {
    Nomi.collega({ chiamaModello: null });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('proposta: un modello che non sa dare un nome, o che non risponde, lascia scrivere il nome a mano', async () => {
  const dir = cartella();
  try {
    writeFileSync(join(dir, 'note.txt'), 'appunti sparsi');
    writeFileSync(join(dir, 'setup.exe'), 'MZ');
    Nomi.collega({ chiamaModello: async () => 'NESSUN NOME' });
    const a = await Nomi.proponi(join(dir, 'note.txt'));
    assert.equal(a.ok, false);
    assert.equal(a.errore, 'nessun_nome');
    assert.equal(a.base, 'note');
    Nomi.collega({ chiamaModello: async () => { throw new Error('HTTP 502 upstream: {"raw":"x"}'); } });
    const b = await Nomi.proponi(join(dir, 'note.txt'));
    assert.equal(b.errore, 'modello');
    assert.doesNotMatch(b.frase, /upstream|raw/);
    const c = await Nomi.proponi(join(dir, 'setup.exe'));
    assert.equal(c.errore, 'tipo');
  } finally {
    Nomi.collega({ chiamaModello: null });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('l\'inizio del testo ha un tetto fisso: il costo della proposta non cresce col file', async () => {
  const dir = cartella();
  try {
    writeFileSync(join(dir, 'lungo.txt'), 'parola '.repeat(20000));
    let lunghezza = 0;
    Nomi.collega({ chiamaModello: async (m) => { lunghezza = m[1].content.length; return 'Testo lungo'; } });
    const r = await Nomi.proponi(join(dir, 'lungo.txt'));
    assert.equal(r.ok, true);
    assert.ok(lunghezza < Nomi.TESTO_MAX + 1500, `il modello ha ricevuto ${lunghezza} caratteri`);
  } finally {
    Nomi.collega({ chiamaModello: null });
    rmSync(dir, { recursive: true, force: true });
  }
});

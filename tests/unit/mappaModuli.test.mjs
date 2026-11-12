// Il formato della mappa dei moduli (scripts/mappa-moduli.mjs) su un albero finto, più una corsa vera sul repo:
// chi la legge è un agente che cerca dove sta una cosa, quindi ogni riga dice percorso, peso e cos'è il file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';
import { mappa, percorsoMostrato, SENZA_INTESTAZIONE, TETTO_DESCRIZIONE } from '../../scripts/mappa-moduli.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const pesa = (testo, byte) => testo + ' '.repeat(byte - Buffer.byteLength(testo));
const LUNGA = `${'parola '.repeat(40)}fine.`;

function albero() {
  const radice = cartellaTemporanea('filo-mappa-');
  const file = {
    'src/zeta.js': pesa('// Ultimo per nome. Seconda frase che non si vede.\nconst z = 1;\n', 2048),
    'src/alfa.js': "'use strict';\n// Dopo use strict, la prima frase.\nconst a = 1;\n",
    'src/main/crlf.js': '\uFEFF// Fine riga di Windows.\r\n// Seconda riga.\r\nconst c = 1;\r\n',
    'src/main/vuoto.js': '/**/\n/*\n *\n */\n// Dopo due commenti vuoti.\n',
    'src/main/elenco.js': '// Pagina "Aperti per dopo".\n// - voce uno\n// - voce due\n',
    'src/main/nudo.js': 'const x = 1; // il commento dopo il codice non è un\'intestazione\n',
    'src/main/servizi/blocco.js': pesa('#!/usr/bin/env node\n/**\n * Blocco in cima, es. con un punto in mezzo. Poi altro.\n */\n', 1024),
    'src/main/servizi/direttiva.js': pesa('/* global chrome */\n//\n// Il commento vero dopo la direttiva.\n', 1024),
    'src/main/servizi/lungo.js': pesa(`// ${LUNGA}\n`, 1024),
    'src/main/servizi/pagina.html': '<!-- non è un .js -->\n',
    'src/stili/solo.css': '/* niente .js qui */\n',
    'altro/controllo.js': '// Un \u001b[2Jcommento \u202esbieco\u202c senza controlli.\n',
    'node_modules/pacchetto/indice.js': '// Di un altro.\n',
    '.git/hooks/gancio.js': '// Nascosto.\n',
  };
  for (const [nome, testo] of Object.entries(file)) {
    const dest = join(radice, nome);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, testo);
  }
  return radice;
}

const RIGA = /^(\S+) {2}(\d+\.\d) KB {2}(.+)$/;
const righe = (uscita) => uscita.map((r) => {
  const m = RIGA.exec(r);
  assert.ok(m, `riga fuori formato: ${r}`);
  return { percorso: m[1], kb: m[2], descrizione: m[3] };
});

test('con una cartella: una riga per .js sotto di lei, in ordine di percorso, con peso e prima frase', () => {
  const radice = albero();
  const r = mappa(['src/main'], { radice, cwd: radice });
  assert.equal(r.codice, 0, r.errori.join('\n'));
  const voci = righe(r.uscita);
  assert.deepEqual(voci.map((v) => v.percorso), [
    'src/main/crlf.js', 'src/main/elenco.js', 'src/main/nudo.js',
    'src/main/servizi/blocco.js', 'src/main/servizi/direttiva.js', 'src/main/servizi/lungo.js', 'src/main/vuoto.js',
  ]);
  const d = Object.fromEntries(voci.map((v) => [v.percorso, v.descrizione]));
  assert.equal(d['src/main/crlf.js'], 'Fine riga di Windows.', 'il BOM e il CRLF non entrano nella descrizione');
  assert.equal(d['src/main/vuoto.js'], 'Dopo due commenti vuoti.');
  assert.equal(d['src/main/elenco.js'], 'Pagina "Aperti per dopo".');
  assert.equal(d['src/main/servizi/blocco.js'], 'Blocco in cima, es. con un punto in mezzo.', '#! si salta, «es.» non chiude la frase');
  assert.equal(d['src/main/servizi/direttiva.js'], 'Il commento vero dopo la direttiva.');
  assert.equal(d['src/main/nudo.js'], SENZA_INTESTAZIONE, 'senza intestazione la riga lo dice, non resta vuota');
  assert.equal(voci.find((v) => v.percorso === 'src/main/servizi/blocco.js').kb, '1.0');
  for (const v of voci) assert.ok(v.descrizione.trim(), `descrizione vuota: ${v.percorso}`);
});

test('una descrizione oltre i 120 caratteri si taglia con «…» visibile, fra due parole', () => {
  const radice = albero();
  const [lungo] = righe(mappa(['src/main/servizi/lungo.js'], { radice, cwd: radice }).uscita);
  assert.ok(lungo.descrizione.length <= TETTO_DESCRIZIONE, `${lungo.descrizione.length} caratteri`);
  assert.ok(lungo.descrizione.endsWith('parola…'), lungo.descrizione);
});

test('una cartella inesistente è un errore che la nomina, non un elenco vuoto', () => {
  const radice = albero();
  const r = mappa(['src/main', 'src/non-ce'], { radice, cwd: radice });
  assert.notEqual(r.codice, 0);
  assert.deepEqual(r.uscita, []);
  assert.match(r.errori.join('\n'), /src\/non-ce/);
});

test('senza argomenti: una riga per cartella con file e KB; con --tutto ogni file', () => {
  const radice = albero();
  const r = mappa([], { radice, cwd: radice });
  assert.equal(r.codice, 0);
  assert.deepEqual(r.uscita.slice(0, -1).map((x) => x.replace(/ {2}\d+\.\d KB$/, '')), [
    'src  9 file', 'src/main  7 file', 'src/main/servizi  3 file',
  ], 'la cartella senza .js non compare');
  assert.ok(r.uscita.includes('src/main/servizi  3 file  3.0 KB'), r.uscita.join('\n'));
  assert.match(r.uscita.at(-1), /--tutto/, 'l’ultima riga dice come proseguire');

  const t = mappa(['--tutto'], { radice, cwd: radice });
  const tutti = righe(t.uscita).map((v) => v.percorso);
  assert.equal(tutti.length, 9);
  assert.deepEqual(tutti, [...tutti].sort());
  assert.deepEqual(tutti.slice(0, 1).concat(tutti.slice(-1)), ['src/alfa.js', 'src/zeta.js']);
  assert.ok(t.uscita.includes('src/zeta.js  2.0 KB  Ultimo per nome.'), t.uscita.join('\n'));
  assert.ok(t.uscita.includes('src/alfa.js  0.1 KB  Dopo use strict, la prima frase.'), '\'use strict\' non è l’intestazione');
});

test('la cartella si trova anche scritta da dentro src, con le barre di Windows o da un’altra cartella', () => {
  const radice = albero();
  const altrove = cartellaTemporanea('filo-mappa-altrove-');
  for (const arg of ['main/servizi', 'src\\main\\servizi', 'src/main/servizi/']) {
    const r = mappa([arg], { radice, cwd: altrove });
    assert.equal(r.codice, 0, `${arg}: ${r.errori.join('\n')}`);
    assert.equal(r.uscita.length, 3, arg);
  }
  const vuota = mappa(['src/stili'], { radice, cwd: radice });
  assert.equal(vuota.codice, 0);
  assert.deepEqual(vuota.uscita, ['nessun file .js in src/stili']);
  const opzione = mappa(['--tuto'], { radice, cwd: radice });
  assert.equal(opzione.codice, 2);
  assert.match(opzione.errori.join('\n'), /--tuto/);
});

test('dalla radice non si scende in node_modules né nelle cartelle col punto, e i caratteri di controllo non escono', () => {
  const radice = albero();
  const r = mappa(['.'], { radice, cwd: radice });
  const voci = righe(r.uscita);
  assert.equal(voci.length, 10, r.uscita.join('\n'));
  assert.ok(voci.every((v) => /^(src|altro)\//.test(v.percorso)), r.uscita.join('\n'));
  const controllo = voci.find((v) => v.percorso === 'altro/controllo.js').descrizione;
  assert.equal(controllo, 'Un [2Jcommento sbieco senza controlli.');
  assert.doesNotMatch(controllo, /[\u0000-\u001f\u202a-\u202e]/);
});

test('i percorsi escono con le barre normali anche su Windows', () => {
  assert.equal(percorsoMostrato('C:\\repo', 'C:\\repo\\src\\main\\a.js', path.win32), 'src/main/a.js');
  assert.equal(percorsoMostrato('C:\\repo', 'D:\\altro\\b.js', path.win32), 'D:/altro/b.js');
});

test('dal terminale, sul repo vero: una riga per ogni .js della cartella, e la cartella che manca è nominata', () => {
  const lancia = (...a) => spawnSync(process.execPath, ['scripts/mappa-moduli.mjs', ...a], { cwd: ROOT, encoding: 'utf8', timeout: TETTO_ATTESA_MS });
  const r = lancia('src/shared');
  assert.equal(r.status, 0, r.stderr);
  const attesi = readdirSync(join(ROOT, 'src', 'shared'), { recursive: true }).filter((f) => String(f).endsWith('.js')).length;
  const voci = righe(r.stdout.trim().split('\n'));
  assert.equal(voci.length, attesi);
  assert.ok(voci.every((v) => v.percorso.startsWith('src/shared/') && v.descrizione !== SENZA_INTESTAZIONE));

  const manca = lancia('src/non-esiste');
  assert.equal(manca.status, 1);
  assert.equal(manca.stdout, '');
  assert.match(manca.stderr, /cartella inesistente: src\/non-esiste/);
});

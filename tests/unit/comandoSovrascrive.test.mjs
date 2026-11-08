// #892.2 — un comando che sovrascrive o svuota un file che c'è già non si disfa: costo 3, chiede prima di partire,
// scritto a mano come proposto da Filo. Il disco lo guarda il main (`esiste` del perimetro); qui è un disco finto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'cmdClassify.js'));
const C = globalThis.SN_CMD_CLASSIFY;

// Il disco finto: percorso assoluto → 'file' | 'cartella'. Le chiamate restano scritte per chi vuole vederle.
function disco(voci, { win = false } = {}) {
  const chiesti = [];
  const norm = (p) => (win ? p.toLowerCase().replace(/\//g, '\\') : p);
  const mappa = new Map(Object.entries(voci).map(([k, v]) => [norm(k), v]));
  const esiste = (p) => { chiesti.push(p); return mappa.get(norm(p)) || null; };
  return { esiste, chiesti };
}

const casa = '/home/anna';
const linux = (voci, extra = {}) => {
  const d = disco(voci);
  return { ctx: { cwd: `${casa}/Documenti`, home: casa, win: false, shell: 'sh', esiste: d.esiste, ...extra }, chiesti: d.chiesti };
};
const SUO = {
  [`${casa}/Documenti`]: 'cartella',
  [`${casa}/Documenti/lettera.txt`]: 'file',
  [`${casa}/Documenti/bozza.txt`]: 'file',
  [`${casa}/Documenti/Vecchi`]: 'cartella',
  [`${casa}/Documenti/Vecchi/lettera.txt`]: 'file',
  [`${casa}/Documenti/Vuota`]: 'cartella',
  [`${casa}/Documenti/archivio.tar`]: 'file',
  [`${casa}/Documenti/foto.zip`]: 'file',
};

test('copia, spostamento e svuotamento sopra un file che c\'è già: 3, col motivo per il popup', () => {
  const { ctx } = linux(SUO);
  for (const cmd of [
    'cp bozza.txt lettera.txt', 'mv bozza.txt lettera.txt', 'cp /dev/null lettera.txt', 'cp lettera.txt Vecchi',
    'cp lettera.txt Vecchi/', 'cp -t Vecchi lettera.txt', 'cp --target-directory=Vecchi lettera.txt', 'cp -f bozza.txt lettera.txt',
    'cp -- bozza.txt lettera.txt', 'cp "bozza.txt" \'lettera.txt\'', 'mv ~/Documenti/bozza.txt ~/Documenti/lettera.txt',
    'cd Vecchi && cp ../bozza.txt lettera.txt', 'ln -sf bozza.txt lettera.txt', 'tar -czf archivio.tar Vecchi',
    'tar cf archivio.tar Vecchi', 'tar --create --file=archivio.tar Vecchi', 'zip foto.zip lettera.txt', 'zip foto lettera.txt',
  ]) {
    const d = C.classifyDetail(cmd, ctx);
    assert.equal(d.level, 3, `"${cmd}" sovrascrive un file e non chiede`);
    assert.match(d.motivo, /sovrascriv/, `"${cmd}": il popup deve dire perché chiede`);
  }
});

test('quando non si sa quali file scriverà, chiede lo stesso', () => {
  const { ctx } = linux(SUO);
  for (const cmd of ['cp *.txt Vecchi', 'cp $SORGENTE Vecchi', 'cp bozza.txt $META', 'tar -xf archivio.tar', 'tar xf archivio.tar',
    'unzip -o foto.zip', 'gzip -f bozza.txt', 'rename .txt .md *.txt', 'cp -r Vecchi Documenti/..']) {
    assert.equal(C.classify(cmd, ctx), 3, `"${cmd}" può sovrascrivere e non chiede`);
  }
});

test('su un file nuovo, o con l\'opzione che non sovrascrive, resta la modifica che si rimedia', () => {
  const { ctx } = linux(SUO);
  for (const cmd of [
    'cp bozza.txt nuova.txt', 'mv bozza.txt Vuota', 'cp lettera.txt Vuota/', 'cp -n bozza.txt lettera.txt', 'mv -n bozza.txt lettera.txt',
    'cp --no-clobber bozza.txt lettera.txt', 'ln -s bozza.txt lettera.txt', 'tar cf nuovo.tar Vecchi', 'tar -xkf archivio.tar',
    'unzip foto.zip', 'gzip bozza.txt', 'mkdir Nuova', 'touch lettera.txt', 'cp -r Vecchi Copia', 'rename -n .txt .md *.txt',
  ]) {
    assert.equal(C.classify(cmd, ctx), 2, `"${cmd}" non sovrascrive niente`);
  }
});

test('senza la sonda del disco il livello resta quello del programma, e un percorso di rete non si guarda', () => {
  assert.equal(C.classify('cp bozza.txt lettera.txt', { cwd: `${casa}/Documenti`, home: casa, win: false }), 2);
  const w = disco({ 'c:\\Users\\anna\\Documenti': 'cartella', 'c:\\Users\\anna\\Documenti\\lettera.txt': 'file' }, { win: true });
  const ctx = { cwd: 'C:\\Users\\anna\\Documenti', home: 'C:\\Users\\anna', win: true, maiuscole: true, shell: 'powershell', esiste: w.esiste };
  assert.equal(C.classify('cp \\\\server\\condivisa\\a.txt \\\\server\\condivisa\\b.txt', ctx), 3);
  assert.ok(w.chiesti.every((p) => !/^[\\/]{2}/.test(p)), `il disco è stato interrogato su un altro computer: ${w.chiesti}`);
  const mac = linux(SUO, { win: false });
  C.classify('cp bozza.txt /net/server/x.txt', mac.ctx);
  assert.ok(mac.chiesti.every((p) => !p.startsWith('/net/')), 'su macOS /net è un altro computer');
});

test('Windows: PowerShell (Copy-Item e Move-Item) e cmd leggono gli operandi a modo loro', () => {
  const w = disco({
    'c:\\Users\\anna\\Documenti': 'cartella', 'c:\\Users\\anna\\Documenti\\lettera.txt': 'file',
    'c:\\Users\\anna\\Documenti\\Vecchi': 'cartella', 'c:\\Users\\anna\\Documenti\\Vecchi\\lettera.txt': 'file',
    'c:\\Users\\anna\\Documenti\\Nuova': 'cartella',
  }, { win: true });
  const base = { cwd: 'C:\\Users\\anna\\Documenti', home: 'C:\\Users\\anna', win: true, maiuscole: true, esiste: w.esiste };
  const ps = { ...base, shell: 'powershell' };
  const cmd = { ...base, shell: 'cmd' };
  for (const c of ['cp bozza.txt lettera.txt', 'copy bozza.txt lettera.txt', 'mv bozza.txt LETTERA.TXT', 'cp -Path bozza.txt -Destination lettera.txt',
    'cp bozza.txt -Destination:lettera.txt', 'copy C:\\Temp\\lettera.txt', 'cp lettera.txt Vecchi', 'cp -Force bozza.txt lettera.txt',
    'cp -Filter *.txt C:\\Temp Vecchi']) {
    assert.equal(C.classify(c, ps), 3, `PowerShell: "${c}"`);
  }
  for (const c of ['cp bozza.txt nuova.txt', 'cp lettera.txt Nuova', 'cp -WhatIf bozza.txt lettera.txt']) assert.equal(C.classify(c, ps), 2, `PowerShell: "${c}"`);
  for (const c of ['copy /Y bozza.txt lettera.txt', 'copy bozza.txt lettera.txt /Y', 'move bozza.txt lettera.txt', 'copy a.txt+b.txt lettera.txt',
    'xcopy Vecchi Nuova', 'copy C:\\Temp\\lettera.txt']) {
    assert.equal(C.classify(c, cmd), 3, `cmd: "${c}"`);
  }
  for (const c of ['copy bozza.txt nuova.txt', 'copy /Y bozza.txt Nuova', 'ren lettera.txt vecchia.txt', 'rename lettera.txt vecchia.txt']) {
    assert.equal(C.classify(c, cmd), 2, `cmd: "${c}"`);
  }
  assert.equal(C.classify('robocopy C:\\Temp Vecchi', cmd), 3);
  assert.equal(C.classify('robocopy C:\\Temp Altra', cmd), 2);
});

test('#1994 — uniq, tree -o e file -C sopra un file che c\'è già valgono 3; su uno nuovo 2', () => {
  const { ctx } = linux({ ...SUO, [`${casa}/Documenti/magia.mgc`]: 'file' });
  for (const cmd of ['uniq bozza.txt lettera.txt', 'uniq -c bozza.txt ~/Documenti/lettera.txt', 'tree -o lettera.txt', 'tree -R -L 1 -H .',
    'file -C -m magia', 'file -C -m /usr/share/magia']) {
    const d = C.classifyDetail(cmd, ctx);
    assert.equal(d.level, 3, `"${cmd}" sovrascrive e non chiede`);
    assert.match(d.motivo, /sovrascrive/);
  }
  for (const cmd of ['uniq bozza.txt nuova.txt', 'tree -o nuova.txt', 'file -C -m altra']) assert.equal(C.classify(cmd, ctx), 2, cmd);
});

test('#1994 — il file magic e l\'opzione che forza valgono anche accorciati o raggruppati', () => {
  const { ctx } = linux({ ...SUO, [`${casa}/Documenti/magia.mgc`]: 'file' });
  for (const cmd of ['file -C --magic=magia', 'file -C --magic-file magia', 'file -Cm magia', 'file -Cmmagia', 'gzip --forc bozza.txt',
    'ln -s --forc bozza.txt lettera.txt']) {
    assert.equal(C.classify(cmd, ctx), 3, cmd);
  }
  for (const cmd of ['file -Cm altra', 'file -C --mag=altra', 'gzip --fast bozza.txt', 'ln -s bozza.txt lettera.txt']) assert.equal(C.classify(cmd, ctx), 2, cmd);
});

test('il main dà al classificatore la sonda del disco, per i comandi scritti a mano e per quelli di Filo', () => {
  const h = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers.js'), 'utf8');
  const i = h.indexOf('function perimetroLettura(');
  const corpo = h.slice(i, h.indexOf('\n}\n', i));
  assert.match(corpo, /defineProperty\(perimetro, 'esiste'/, 'senza la sonda una sovrascrittura resta a 2');
  // Una copia del perimetro con lo spread perderebbe la sonda, che non è enumerabile.
  assert.doesNotMatch(h, /\{\s*\.\.\.perimetroLettura\(/, 'il perimetro va passato intero, non ricopiato');
});

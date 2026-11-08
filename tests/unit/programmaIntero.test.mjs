// #2292 — su Windows un programma avviato per nome si cerca prima nella cartella di lavoro: un git.exe o un
// powershell.exe estratti da un archivio non devono partire al posto di quelli veri, né nel controllo di git né nelle shell.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve, posix, win32, delimiter } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const cp = require('node:child_process');
const SERVIZI = join(import.meta.dirname, '..', '..', 'src', 'main', 'services');
require(join(import.meta.dirname, '..', '..', 'src', 'shared', 'cmdClassify.js'));

// Ogni avvio di programma dei moduli del terminale, con la sua cartella di lavoro, mentre il sistema si dice Windows.
async function avviiSuWindows(fn) {
  const chiamate = [];
  const vero = { execFileSync: cp.execFileSync, spawn: cp.spawn, platform: Object.getOwnPropertyDescriptor(process, 'platform') };
  cp.execFileSync = (file, args, opts) => { chiamate.push({ file, cwd: opts && opts.cwd }); return ''; };
  cp.spawn = (file, args, opts) => { chiamate.push({ file, cwd: opts && opts.cwd }); throw new Error('finto'); };
  const moduli = ['terminal.js', 'shell.js', 'programmaIntero.js'].map((f) => require.resolve(join(SERVIZI, f)));
  for (const m of moduli) delete require.cache[m];
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    await fn(require(moduli[0]), require(moduli[1]));
  } finally {
    Object.defineProperty(process, 'platform', vero.platform);
    cp.execFileSync = vero.execFileSync;
    cp.spawn = vero.spawn;
    for (const m of moduli) delete require.cache[m];
  }
  return chiamate;
}

const assoluto = (f) => posix.isAbsolute(String(f)) || win32.isAbsolute(String(f));
const dallaCartella = (chiamate, cartella) => chiamate.filter(({ file, cwd }) =>
  !assoluto(file) && cwd && resolve(String(cwd)).startsWith(cartella));

test('nel controllo di git, nei comandi di Filo e nel terminale nessun programma parte per nome dalla cartella estratta', async () => {
  const base = cartellaTemporanea('filo-2292-prog-');
  const vecchioPath = process.env.PATH;
  try {
    const estratta = resolve(join(base, 'Downloads', 'progetto'));
    mkdirSync(estratta, { recursive: true });
    // Un PATH come quello di Windows, coi programmi veri fuori dalla cartella estratta.
    const bin = join(base, 'bin');
    mkdirSync(bin);
    for (const f of ['git.exe', 'where.exe', 'powershell.exe']) writeFileSync(join(bin, f), '');
    process.env.PATH = [bin, vecchioPath].join(delimiter);
    const chiamate = await avviiSuWindows(async (T, S) => {
      T.gitLanciaIn(estratta);
      await T.runCommand('Get-ChildItem', { cwd: estratta, shell: 'powershell' });
      S.createSession({ shell: 'powershell', cwd: estratta });
      await S.commandExists({ shell: 'powershell', command: 'node', cwd: estratta, attesaMs: 1000 }).catch(() => {});
    });
    assert.ok(chiamate.length >= 3, `le prove devono vedere gli avvii: ${JSON.stringify(chiamate)}`);
    assert.deepEqual(dallaCartella(chiamate, estratta), []);
  } finally {
    process.env.PATH = vecchioPath;
    togliCartella(base);
  }
});

test('il nome diventa il percorso preso dal PATH; fuori dal PATH, la cartella di sistema o niente', async () => {
  const base = cartellaTemporanea('filo-2292-path-');
  try {
    const bin = join(base, 'bin');
    const estratta = join(base, 'estratta');
    mkdirSync(bin);
    mkdirSync(estratta);
    writeFileSync(join(bin, 'git.exe'), '');
    writeFileSync(join(estratta, 'git.exe'), '');
    await avviiSuWindows(async () => {
      const { programmaIntero } = require(join(SERVIZI, 'programmaIntero.js'));
      const env = { PATH: ['', '.', estratta.replace(base, '.'), bin].join(delimiter), SystemRoot: 'C:\\Windows' };
      assert.equal(programmaIntero('git', { env }), join(bin, 'git.exe'), 'una voce vuota o relativa del PATH non conta');
      assert.equal(programmaIntero('git', { env: { PATH: '' } }), null);
      assert.ok(assoluto(programmaIntero('powershell.exe', { env: { PATH: '', SystemRoot: 'C:\\Windows' } })));
      assert.equal(programmaIntero('C:\\Programmi\\git.exe', { env }), 'C:\\Programmi\\git.exe');
    });
    const { programmaIntero } = require(join(SERVIZI, 'programmaIntero.js'));
    if (process.platform !== 'win32') assert.equal(programmaIntero('git'), 'git', 'fuori da Windows il nome resta com\'è');
  } finally {
    togliCartella(base);
  }
});

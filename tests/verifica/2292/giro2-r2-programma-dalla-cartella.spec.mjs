// #2292 giro 2 — su Windows un programma avviato per nome, con una cartella dell'utente come cartella di lavoro, si
// cerca prima in quella cartella: un git.exe o un powershell.exe arrivati con un archivio partirebbero al posto di quelli veri.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve, posix, win32 } from 'node:path';
import { mkdirSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const cp = require('node:child_process');

// Ogni avvio di programma che passa dal modulo del terminale, con la cartella di lavoro, mentre il sistema si dice Windows.
async function avviiSuWindows(fn) {
  const chiamate = [];
  const vero = { execFileSync: cp.execFileSync, spawn: cp.spawn, platform: Object.getOwnPropertyDescriptor(process, 'platform') };
  cp.execFileSync = (file, args, opts) => { chiamate.push({ file, cwd: opts && opts.cwd }); return ''; };
  cp.spawn = (file, args, opts) => { chiamate.push({ file, cwd: opts && opts.cwd }); throw new Error('finto'); };
  const percorso = require.resolve('../../../src/main/services/terminal.js');
  delete require.cache[percorso];
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    await fn(require(percorso));
  } finally {
    Object.defineProperty(process, 'platform', vero.platform);
    cp.execFileSync = vero.execFileSync;
    cp.spawn = vero.spawn;
    delete require.cache[percorso];
  }
  return chiamate;
}

const dallaCartella = (chiamate, cartella) => chiamate.filter(({ file, cwd }) =>
  !posix.isAbsolute(String(file)) && !win32.isAbsolute(String(file)) && cwd && resolve(String(cwd)).startsWith(cartella));

test('r2 il controllo di git e la shell dei comandi non si fanno cercare il programma nella cartella estratta', async () => {
  require('../../../src/shared/cmdClassify.js');
  const base = cartellaTemporanea('filo-2292-g2r2-');
  try {
    const estratta = resolve(join(base, 'Downloads', 'progetto'));
    mkdirSync(estratta, { recursive: true });
    const sonda = await avviiSuWindows((T) => { T.gitLanciaIn(estratta); });
    expect(dallaCartella(sonda, estratta), 'il controllo delle impostazioni git avvia git per nome da dentro la cartella').toEqual([]);
    const shell = await avviiSuWindows((T) => T.runCommand('Get-ChildItem', { cwd: estratta, shell: 'powershell' }));
    expect(dallaCartella(shell, estratta), 'la shell dei comandi parte per nome da dentro la cartella').toEqual([]);
  } finally {
    togliCartella(base);
  }
});

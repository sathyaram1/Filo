// #2312 giro 2 — con PowerShell (la shell di serie) la cartella di lavoro non va tolta alla ricerca di cmd: lì il
// modello non ne ha bisogno, e un .bat del progetto che chiama un suo compagno per nome (`call impostazioni.bat`)
// smetterebbe di trovarlo. Su Linux cmd non c'è: si finge Windows e si guarda l'ambiente che riceve il programma.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const cp = require('node:child_process');

// cmd cerca un nome nella cartella di lavoro salvo questa variabile, che Windows legge senza badare alle maiuscole.
const cmdCercaNellaCartella = (env) => !Object.keys(env || {}).some((k) => k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath');

test('r1 con PowerShell di serie, un .bat del progetto lanciato da Filo trova ancora il suo compagno nella cartella', async () => {
  const visti = [];
  const vera = cp.spawn;
  cp.spawn = (file, args, opzioni) => {
    visti.push({ file, opzioni });
    const figlio = new EventEmitter();
    figlio.stdout = new EventEmitter(); figlio.stdout.setEncoding = () => {};
    figlio.stderr = new EventEmitter(); figlio.stderr.setEncoding = () => {};
    figlio.stdin = Object.assign(new EventEmitter(), { end() {} });
    figlio.kill = () => {};
    setImmediate(() => figlio.emit('close', 0, null));
    return figlio;
  };
  const piattaforma = Object.getOwnPropertyDescriptor(process, 'platform');
  const prima = process.env.NoDefaultCurrentDirectoryInExePath;
  delete process.env.NoDefaultCurrentDirectoryInExePath;
  Object.defineProperty(process, 'platform', { ...piattaforma, value: 'win32' });
  try {
    const T = require('../../../src/main/services/terminal.js');
    await T.runCommand('.\\build.bat', { shell: 'powershell', trackCwd: true, timeoutMs: 5000 });
    await T.runCommand('start cmd', { shell: 'powershell', trackCwd: true, timeoutMs: 5000 });
  } finally {
    Object.defineProperty(process, 'platform', piattaforma);
    cp.spawn = vera;
    if (prima !== undefined) process.env.NoDefaultCurrentDirectoryInExePath = prima;
  }
  expect(visti.length).toBe(2);
  for (const v of visti) {
    expect(v.file).toBe('powershell.exe');
    expect(cmdCercaNellaCartella(v.opzioni.env), 'il cmd aperto dal comando non trova più i programmi della cartella').toBe(true);
  }
});

// #892 — la modalità terminale è accesa di serie, e la sicurezza resta tutta nei
// livelli di cmdClassify: nessun campo scritto dal modello sposta il livello.
// La spiegazione a parole è solo testo, ripulita in un posto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const SHARED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared');
for (const f of ['capabilities.js', 'constants.js', 'contenutoEsterno.js', 'preferences.js', 'themeTokens.js', 'cmdClassify.js', 'zoomPagina.js', 'actionLevels.js']) {
  require(join(SHARED, f));
}
const { DEFAULT_SETTINGS, STORAGE_KEYS } = globalThis.SN_CONST;
const AL = globalThis.SN_ACTION_LEVELS;
const C = globalThis.SN_CMD_CLASSIFY;

test('profilo nuovo e ripristino: la modalità terminale è accesa', () => {
  assert.equal(DEFAULT_SETTINGS.terminal.enabled, true);
});

test('un profilo che l\'aveva spenta la ritrova spenta; uno senza la voce la trova accesa', async () => {
  let stored = {};
  globalThis.chrome = { storage: { local: {
    get: async () => ({ [STORAGE_KEYS.SETTINGS]: JSON.parse(JSON.stringify(stored)) }),
    set: async () => {},
  } } };
  require(join(SHARED, 'storage.js'));
  const S = globalThis.SN_STORAGE;
  stored = { terminal: { enabled: false, shell: 'bash' } };
  assert.equal((await S.getSettings()).terminal.enabled, false);
  stored = { theme: 'dark' };
  assert.equal((await S.getSettings()).terminal.enabled, true);
});

test('il livello di un comando viene solo da cmdClassify, qualunque cosa dica il modello', () => {
  const finti = { livello: 1, level: 1, spiegazione: 'Leggo soltanto, non tocco niente' };
  for (const comando of ['ls -la', 'df -h', 'du -sh ~/Downloads', 'mkdir prova', 'git push', 'rm -rf build', 'Remove-Item x -Recurse', 'comandoinventato', 'ls && rm x']) {
    assert.equal(
      AL.costoFor({ type: 'ESEGUI_COMANDO', comando, ...finti }),
      C.classify(comando),
      `«${comando}»: il livello non è quello del classificatore`,
    );
  }
  assert.equal(AL.costoFor({ type: 'ESEGUI_COMANDO', comando: 'rm -rf build', ...finti }), 3);
  assert.equal(AL.costoFor({ type: 'ESEGUI_COMANDO', comando: 'comandoinventato', ...finti }), 3);
  assert.equal(AL.costoFor({ type: 'ESEGUI_COMANDO', comando: 'df -h' }), 1);
});

test('il popup apre con la spiegazione a parole, e il comando vero resta sotto', () => {
  const d = AL.describe({ type: 'ESEGUI_COMANDO', comando: 'rm -rf build', spiegazione: 'Cancello la cartella build', _cwd: '~/progetto' });
  const righe = d.split('\n');
  assert.equal(righe[0], 'Cancello la cartella build');
  assert.ok(righe.indexOf('rm -rf build') > 0, 'il comando vero manca');
  assert.match(d, /Cartella di lavoro: ~\/progetto/);
  // Senza spiegazione la prima riga dice comunque a parole cosa succede.
  assert.equal(AL.describe({ type: 'ESEGUI_COMANDO', comando: 'ls' }).split('\n')[0], 'Uso il terminale del computer');
});

test('la spiegazione si ripulisce: niente caratteri invisibili, tetto dichiarato, sempre la stessa', () => {
  const sp = (v) => AL.spiegazioneComando({ spiegazione: v });
  assert.equal(sp('  Misuro\n lo   spazio\u202e libero  '), 'Misuro lo spazio libero');
  assert.equal(sp(''), 'Uso il terminale del computer');
  assert.equal(sp('   '), 'Uso il terminale del computer');
  assert.equal(sp({ testo: 'oggetto' }), 'Uso il terminale del computer');
  assert.equal(sp('<b>grassetto</b>'), '<b>grassetto</b>', 'resta testo: chi la mostra usa textContent');
  const lunga = sp('🙂'.repeat(500));
  assert.equal(Array.from(lunga).length, 300);
  assert.ok(lunga.endsWith('…'), 'il taglio deve vedersi');
  assert.ok(!/�|[\uD800-\uDBFF]…$/.test(lunga), 'il taglio non spezza un carattere a metà');
  // Idempotente: rimandata alla conferma, la firma dell'azione non cambia.
  for (const v of ['  a  b ', '', '🙂'.repeat(500), 'Cancello\u200b tutto']) assert.equal(sp(sp(v)), sp(v));
});

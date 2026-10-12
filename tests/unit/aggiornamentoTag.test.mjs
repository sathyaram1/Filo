// L'aggiornamento automatico installa solo una release sotto il tag v<versione> (#1073): la regola sui tag di GitHub
// protegge solo i v*, e una release «più recente» sotto un altro tag, creata da un ramo, non deve arrivare a nessuno.
// Il controllo gira sul cammino vero di electron-updater, col suo prototipo, senza rete né Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = require(join(ROOT, 'src', 'main', 'aggiornamentoRegole.js'));
const U = require(join(ROOT, 'src', 'main', 'updater.js'));
const { AppUpdater } = require('electron-updater/out/AppUpdater');
// Il semver di electron-updater: una SemVer di un'altra copia non la riconosce.
const semver = createRequire(require.resolve('electron-updater'))('semver');

function aggiornatore(info) {
  const au = Object.create(AppUpdater.prototype);
  Object.assign(au, {
    currentVersion: semver.parse('0.2.233'),
    allowDowngrade: false,
    autoDownload: false,
    _logger: { info() {}, warn() {}, error() {} },
    isUpdateSupported: () => true,
    isUserWithinRollout: () => true,
    getUpdateInfoAndProvider: async () => ({ info, provider: {} }),
    checkForUpdates: async () => null,
  });
  const visti = [];
  for (const ev of ['update-available', 'update-not-available']) au.on(ev, () => visti.push(ev));
  return { au, visti };
}

test('la regola: tag uguale a v più la versione dichiarata, e niente tag solo fuori da GitHub', () => {
  assert.equal(R.tagAccettato({ version: '0.2.234', tag: 'v0.2.234' }), true);
  assert.equal(R.tagAccettato({ version: '99.0.0', tag: '99.0.0' }), false, 'senza la v la regola sui tag non lo protegge');
  assert.equal(R.tagAccettato({ version: '99.0.0', tag: 'x1' }), false);
  assert.equal(R.tagAccettato({ version: '99.0.0', tag: 'v0.2.234' }), false, 'una versione dichiarata diversa dal tag');
  assert.equal(R.tagAccettato({ version: '0.2.234' }), true);
});

test('una release sotto un tag senza v non si annuncia né si scarica, quella giusta sì', async () => {
  for (const tag of ['99.0.0', 'x1']) {
    const { au, visti } = aggiornatore({ version: '99.0.0', tag, files: [] });
    await U.avviaAggiornatore(au, { automatici: false });
    await assert.rejects(au.doCheckForUpdates(), /rifiutata/, `la release sotto il tag ${tag} passa il controllo`);
    assert.deepEqual(visti, [], `la release sotto il tag ${tag} è stata annunciata`);
  }

  const { au, visti } = aggiornatore({ version: '0.2.234', tag: 'v0.2.234', files: [] });
  await U.avviaAggiornatore(au, { automatici: false });
  const r = await au.doCheckForUpdates();
  assert.equal(r.isUpdateAvailable, true);
  assert.deepEqual(visti, ['update-available']);
});

test('collegato due volte, il cancello non si impila', async () => {
  const { au } = aggiornatore({ version: '0.2.234', tag: 'v0.2.234', files: [] });
  await U.avviaAggiornatore(au, { automatici: false });
  const primo = au.isUpdateAvailable;
  await U.avviaAggiornatore(au, { automatici: false });
  assert.equal(au.isUpdateAvailable, primo);
});

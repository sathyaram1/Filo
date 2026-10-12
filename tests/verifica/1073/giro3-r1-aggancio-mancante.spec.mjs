// #1073 giro 3 — il cancello dell'aggiornamento si aggancia a un metodo interno di electron-updater: se un
// aggiornamento della dipendenza lo rinomina, deve fermare gli aggiornamenti, non lasciar passare tutto in silenzio.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const U = require(join(ROOT, 'src', 'main', 'updater.js'));
const { AppUpdater } = require('electron-updater/out/AppUpdater');
const semver = createRequire(require.resolve('electron-updater'))('semver');

test('r1 con il metodo interno rinominato, una release sotto il tag x1 non viene annunciata', async () => {
  // La stessa classe, con il punto d'aggancio sotto un altro nome: come dopo un aggiornamento della dipendenza.
  class Rinominato extends AppUpdater {}
  const originale = AppUpdater.prototype.doCheckForUpdates.toString();
  expect(originale).toContain('this.getUpdateInfoAndProvider()');
  Rinominato.prototype.getUpdateInfoAndProvider = undefined;
  Rinominato.prototype.leggiReleaseENuovoProvider = async () => ({
    info: { version: '99.0.0', tag: 'x1', files: [] }, provider: {},
  });
  // Il corpo di doCheckForUpdates di electron-updater, con la sola chiamata rinominata.
  Rinominato.prototype.doCheckForUpdates = async function () {
    this.emit('checking-for-update');
    const result = await this.leggiReleaseENuovoProvider();
    const updateInfo = result.info;
    if (!(await this.isUpdateAvailable(updateInfo))) {
      this.emit('update-not-available', updateInfo);
      return { isUpdateAvailable: false, versionInfo: updateInfo, updateInfo };
    }
    this.updateInfoAndProvider = result;
    this.onUpdateAvailable(updateInfo);
    return { isUpdateAvailable: true, versionInfo: updateInfo, updateInfo, downloadPromise: null };
  };

  const au = Object.create(Rinominato.prototype);
  Object.assign(au, {
    currentVersion: semver.parse('0.2.237'), allowDowngrade: false, allowPrerelease: false, autoDownload: false,
    _logger: { info() {}, warn() {}, error() {} },
    isUpdateSupported: () => true, isUserWithinRollout: () => true, checkForUpdates: async () => null,
  });
  const annunciate = [];
  au.on('update-available', (i) => annunciate.push(i));

  let fermato = false;
  try { await U.avviaAggiornatore(au, { automatici: false }); } catch { fermato = true; }
  if (!fermato) await au.doCheckForUpdates().catch(() => { fermato = true; });
  // Oggi il cancello vede che il metodo manca, non si aggancia, e la release x1 viene annunciata.
  expect(annunciate.map((i) => i.tag)).toEqual([]);
});

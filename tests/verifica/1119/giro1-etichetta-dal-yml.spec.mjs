// #1119 giro 1 — l'etichetta confrontata col numero deve essere quella della release, non una scritta dentro latest.yml:
// GitHubProvider fa `{ tag, ...latest.yml }`, quindi un `tag:` nel file che si vuole controllare vince sull'etichetta vera.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const U = require(join(ROOT, 'src', 'main', 'updater.js'));
const { BaseUpdater } = require('electron-updater/out/BaseUpdater.js');
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider.js');

const IN_USO = '0.2.233';
const PUBBLICO = { provider: 'github', owner: 'sathyaram1', repo: 'Filo' };
const CONTENUTO = 'MZ installatore manomesso';
const SHA = createHash('sha512').update(CONTENUTO).digest('base64');

// La release vecchia v0.2.100 segnata «latest», col suo latest.yml riscritto: numero gonfiato, `tag:` uguale al
// numero, e il file preso dalla stessa release vecchia con un «../».
function github() {
  return {
    async request(opzioni) {
      const p = String(opzioni.path);
      if (p.endsWith('/releases/latest')) return JSON.stringify({ tag_name: 'v0.2.100' });
      if (p.endsWith('/releases.atom')) {
        return '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>'
          + '<link rel="alternate" type="text/html" href="https://github.com/sathyaram1/Filo/releases/tag/v0.2.100"/>'
          + '<title>v0.2.100</title><content type="html">note</content></entry></feed>';
      }
      if (p.startsWith('/sathyaram1/Filo/releases/download/v0.2.100/') && /latest[^/]*\.yml$/.test(p)) {
        return `version: 9.9.9\ntag: v9.9.9\nfiles:\n  - url: ../v0.2.100/Filo-Setup.exe\n    sha512: ${SHA}\n    size: ${CONTENUTO.length}\n`
          + `path: ../v0.2.100/Filo-Setup.exe\nsha512: ${SHA}\nreleaseDate: '2026-10-07T11:00:00.000Z'\n`;
      }
      throw new Error(`richiesta inattesa: ${p}`);
    },
  };
}

class Aggiornatore extends BaseUpdater {
  constructor(piattaforma) {
    const allaChiusura = [];
    super(null, { version: IN_USO, isPackaged: true, whenReady: async () => {}, onQuit: (f) => allaChiusura.push(f), quit() {} });
    this._logger = { info() {}, warn() {}, error() {}, debug() {} };
    this.allaChiusura = allaChiusura;
    this.scaricati = [];
    this.installazioni = 0;
    this.github = new GitHubProvider(PUBBLICO, this, { executor: github(), isUseMultipleRangeRequest: false, platform: piattaforma });
  }

  async getUpdateInfoAndProvider() {
    return { info: await this.github.getLatestVersion(), provider: this.github };
  }

  async doDownloadUpdate({ updateInfoAndProvider }) {
    const [voce] = updateInfoAndProvider.provider.resolveFiles(updateInfoAndProvider.info);
    this.scaricati.push(voce.url.href);
    const cache = cartellaTemporanea('filo-verifica-1119-');
    const file = join(cache, 'Filo-Setup.exe');
    writeFileSync(file, CONTENUTO);
    writeFileSync(join(cache, 'update-info.json'), JSON.stringify({ fileName: 'Filo-Setup.exe', sha512: SHA, isAdminRightsRequired: false }));
    this.dispatchUpdateDownloaded({ ...updateInfoAndProvider.info, downloadedFile: file });
    this.addQuitHandler();
    return [file];
  }

  install() { this.installazioni += 1; return true; }
  quitAndInstall() { this.installazioni += 1; }
  chiudi() { for (const f of this.allaChiusura) f(0); }
}

const calma = () => new Promise((r) => setImmediate(r));

for (const piattaforma of ['win32', 'linux']) {
  test(`una release vecchia con «tag:» scritto nel suo latest.yml non si scarica né si installa (${piattaforma})`, async () => {
    globalThis.SN_FILO_MEMORY = { listNotifications: async () => [], addNotification: async (n) => n, dismissNotification: async () => [] };
    const dati = cartellaTemporanea('filo-verifica-1119-dati-');
    const { registro } = U.perProva({ piattaforma, versione: IN_USO, cartella: dati, avvisoVero: false });
    const u = new Aggiornatore(piattaforma);
    await U.avviaAggiornatore(u, { automatici: true, chiesta: null, modo: 'avvio' });
    for (let i = 0; i < 5; i++) await calma();
    u.chiudi();
    await U.installaAllAvvioSeServe({ aggiornamenti: { automatici: true } }, { forza: true });
    expect(u.scaricati, 'scaricato dalla release v0.2.100 l\'installatore dichiarato 9.9.9').toEqual([]);
    expect(u.installazioni + registro.lanciati.length, 'installato').toBe(0);
  });
}

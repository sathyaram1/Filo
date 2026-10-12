// #1073 giro 2 — il tag che il cancello confronta deve essere quello della release vera, non uno scritto dentro il
// file di descrizione allegato: chi crea una release sotto «x1» non deve poter dichiarare «v99.0.0» e passare.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const U = require(join(ROOT, 'src', 'main', 'updater.js'));
const { AppUpdater } = require('electron-updater/out/AppUpdater');
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider');
const semver = createRequire(require.resolve('electron-updater'))('semver');

const FEED = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>1</id><link rel="alternate" type="text/html" href="https://github.com/sathyaram1/Filo/releases/tag/x1"/><title>x1</title><content>n</content><updated>2026-10-12T00:00:00Z</updated></entry>
</feed>`;
const YML = `version: 99.0.0
tag: v99.0.0
files:
  - url: ../x1/Filo-Setup.exe
    sha512: AAAA
    size: 1
path: ../x1/Filo-Setup.exe
sha512: AAAA
releaseDate: '2026-10-12T00:00:00.000Z'
`;

function provider(updater) {
  const chieste = [];
  const p = new GitHubProvider({ provider: 'github', owner: 'sathyaram1', repo: 'Filo' }, updater, {
    isUseMultipleRangeRequest: true, platform: 'win32', executor: { request: async (o) => { chieste.push(o); return YML; } },
  });
  p.httpRequest = async (url) => (String(url).endsWith('.atom') ? FEED : JSON.stringify({ tag_name: 'x1' }));
  return p;
}

test('r1 una release sotto il tag x1 che nel suo file si dichiara v99.0.0 non passa il cancello', async () => {
  const au = Object.create(AppUpdater.prototype);
  Object.assign(au, {
    currentVersion: semver.parse('0.2.237'), allowDowngrade: false, allowPrerelease: false, autoDownload: false,
    _logger: { info() {}, warn() {}, error() {} },
    isUpdateSupported: () => true, isUserWithinRollout: () => true, checkForUpdates: async () => null,
  });
  const gh = provider(au);
  au.getUpdateInfoAndProvider = async () => ({ info: await gh.getLatestVersion(), provider: gh });
  const annunciate = [];
  au.on('update-available', (i) => annunciate.push(i));
  await U.avviaAggiornatore(au, { automatici: false });

  await au.doCheckForUpdates().catch(() => null);
  // Oggi passa, e il file da scaricare risolve dentro la release «x1»: .../releases/download/x1/Filo-Setup.exe.
  const scarico = annunciate.flatMap((i) => gh.resolveFiles(i).map((f) => f.url.href));
  expect(scarico).toEqual([]);
});

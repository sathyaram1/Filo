// #905 — l'archivio esportato non porta le chiavi API e gli altri segreti, a meno che chi esporta lo chieda; e un
// archivio senza chiavi, o con chiavi vuote, importato non cancella quelle che ci sono già.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
require(join(ROOT, 'src', 'shared', 'constants.js'));
const { buildExportZip, readExportZip, mergeImportedData, proxyDaCompletare, unzip } = require(join(ROOT, 'src', 'main', 'services', 'exportData.js'));
const C = globalThis.SN_CONST;

const CHIAVE = 'sk-or-v1-0123456789abcdef0123456789abcdef';
const TAVILY = 'tvly-abcdefghijklmnop';
const SAFE = 'AIzaSyD-chiave-safe-browsing-1234';
const PROXY = 'socks5://utente-{country}:password-segreta@gate.example.com:7000';

function sorgente() {
  return {
    settings: {
      theme: 'dark',
      apiKeys: { openrouter: CHIAVE, tavily: TAVILY },
      proxy: { datacenter: PROXY, residential: 'http://gate2.example.com:8000', defaultCountry: 'fr' },
      security: { safeBrowse: { enabled: true, safeBrowsingKey: SAFE } },
    },
    clipboardHistory: [{ id: 'c1', type: 'text', text: `la mia chiave è ${CHIAVE}` }, { id: 'c2', type: 'text', text: 'ciao' }],
    filo_memory: { PROFILO: 'Mario' },
  };
}
const FILO = Buffer.from(`{"tipo":"messaggio","testo":"imposta la chiave openrouter ${CHIAVE}"}\n{"tipo":"messaggio","testo":"grazie"}\n`, 'utf8');

const voce = (zip, nome) => unzip(zip).voci.get(nome).toString('utf8');

test('di serie l\'archivio non contiene nessuna chiave, da nessuna parte', () => {
  const zip = buildExportZip(sorgente(), { filo: FILO });
  for (const segreto of [CHIAVE, TAVILY, SAFE, 'password-segreta']) {
    assert.equal(zip.includes(Buffer.from(segreto)), false, `«${segreto}» è finito nell'archivio`);
  }
  const { data, filo } = readExportZip(zip);
  assert.equal('apiKeys' in data.settings, false, 'il campo va via, non diventa vuoto');
  assert.equal(data.settings.proxy.datacenter, 'socks5://gate.example.com:7000', 'del proxy esce utente e password, l\'indirizzo resta');
  assert.equal(data.settings.proxy.residential, 'http://gate2.example.com:8000', 'un proxy senza credenziali non è un segreto');
  assert.equal(data.settings.proxy.defaultCountry, 'fr');
  assert.equal('safeBrowsingKey' in data.settings.security.safeBrowse, false);
  assert.equal(data.settings.security.safeBrowse.enabled, true);
  assert.equal(data.settings.theme, 'dark', 'il resto delle impostazioni c\'è');
  assert.equal(data.filo_memory.PROFILO, 'Mario');
  assert.match(data.clipboardHistory[0].text, /^la mia chiave è \[chiave tolta/, 'la chiave copiata negli appunti esce');
  assert.equal(data.clipboardHistory[1].text, 'ciao');
  assert.match(filo.toString('utf8'), /imposta la chiave openrouter \[chiave tolta/, 'la chiave scritta in chat esce');
  assert.equal(JSON.parse(voce(zip, 'manifest.json')).chiavi, false);
  assert.deepEqual(JSON.parse(voce(zip, 'manifest.json')).proxySenzaCredenziali, ['datacenter']);
});

test('il proxy senza utente e password torna dove non c\'era, e non cancella quello di qui che li ha (#905.1)', () => {
  const parsed = readExportZip(buildExportZip(sorgente()));
  assert.deepEqual(parsed.proxySenzaCredenziali, ['datacenter']);

  const altrove = mergeImportedData({ settings: {} }, parsed.data).merged;
  assert.equal(altrove.settings.proxy.datacenter, 'socks5://gate.example.com:7000');
  assert.deepEqual(proxyDaCompletare(altrove, parsed.proxySenzaCredenziali), ['datacenter'], 'la conferma deve dirlo');

  const qui = mergeImportedData({ settings: { proxy: { datacenter: PROXY } } }, parsed.data).merged;
  assert.equal(qui.settings.proxy.datacenter, PROXY, 'lo stesso proxy, qui con la password, resta com\'è');
  assert.deepEqual(proxyDaCompletare(qui, parsed.proxySenzaCredenziali), []);

  const diverso = mergeImportedData({ settings: { proxy: { datacenter: 'http://u:p@altro.example.com:1' } } }, parsed.data).merged;
  assert.equal(diverso.settings.proxy.datacenter, 'http://u:p@altro.example.com:1', 'senza la password il backup non cancella quella di qui');

  const senza = readExportZip(buildExportZip({ settings: { proxy: { residential: 'http://gate2.example.com:8000' } } }));
  assert.deepEqual(senza.proxySenzaCredenziali, [], 'un proxy che non aveva credenziali non va completato');
});

test('una chiave scritta in memoria dopo un portachiavi illeggibile (apiKeysEnc) non esce nemmeno cifrata', () => {
  const zip = buildExportZip({ settings: { theme: 'light', apiKeysEnc: 'safeStorage:v1:QUJDREVGRw==' } });
  assert.equal('apiKeysEnc' in readExportZip(zip).data.settings, false);
});

test('con «Includi le chiavi» l\'archivio le porta tutte, e le dichiara', () => {
  const zip = buildExportZip(sorgente(), { filo: FILO, chiavi: true });
  const { data, filo } = readExportZip(zip);
  assert.deepEqual(data, sorgente());
  assert.equal(filo.toString('utf8'), FILO.toString('utf8'));
  assert.equal(JSON.parse(voce(zip, 'manifest.json')).chiavi, true);
});

test('importare un archivio senza chiavi lascia quelle che ci sono già', () => {
  const qui = { settings: { theme: 'light', apiKeys: { openrouter: 'sk-or-v1-di-questo-computer' }, proxy: { datacenter: PROXY } } };
  const { data } = readExportZip(buildExportZip(sorgente()));
  const { merged } = mergeImportedData(qui, data);
  assert.deepEqual(merged.settings.apiKeys, { openrouter: 'sk-or-v1-di-questo-computer' });
  assert.equal(merged.settings.proxy.datacenter, PROXY);
  assert.equal(merged.settings.theme, 'dark', 'il resto del backup entra');
});

test('una chiave vuota o nulla nel backup non cancella quella di qui; una piena entra', () => {
  const qui = {
    settings: {
      apiKeys: { openrouter: CHIAVE },
      proxy: { datacenter: PROXY },
      security: { safeBrowse: { safeBrowsingKey: SAFE } },
    },
  };
  const vecchio = {
    settings: {
      apiKeys: { openrouter: '', tavily: TAVILY },
      proxy: { datacenter: '  ', residential: '' },
      security: { safeBrowse: { safeBrowsingKey: '' } },
    },
  };
  const { merged } = mergeImportedData(qui, vecchio);
  assert.deepEqual(merged.settings.apiKeys, { openrouter: CHIAVE, tavily: TAVILY });
  assert.equal(merged.settings.proxy.datacenter, PROXY);
  assert.equal(merged.settings.security.safeBrowse.safeBrowsingKey, SAFE);

  const nullo = mergeImportedData(qui, { settings: { apiKeys: null, theme: 'dark' } }).merged;
  assert.deepEqual(nullo.settings.apiKeys, { openrouter: CHIAVE });
  assert.equal(nullo.settings.theme, 'dark');
});

test('quando ci sono segreti da includere: chiavi piene, proxy con utente e password, chiave di Safe Browsing', () => {
  assert.equal(C.haSegreti(C.DEFAULT_SETTINGS), false, 'le impostazioni di serie non hanno segreti');
  assert.equal(C.haSegreti({ apiKeys: { openrouter: '  ' } }), false);
  assert.equal(C.haSegreti({ apiKeys: { tavily: TAVILY } }), true);
  assert.equal(C.haSegreti({ proxy: { datacenter: 'http://gate.example.com:7000' } }), false);
  assert.equal(C.haSegreti({ proxy: { residential: PROXY } }), true);
  assert.equal(C.haSegreti({ security: { safeBrowse: { safeBrowsingKey: SAFE } } }), true);
  assert.equal(C.haSegreti(null), false);
});

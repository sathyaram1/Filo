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

// La scheda accetta il proxy anche senza schema (proxyTab.endpointFor): utente e password lì sono segreti uguali.
test('un proxy «utente:password@host:porta», senza schema, esce col solo indirizzo', () => {
  const dati = sorgente();
  dati.settings.proxy.datacenter = 'utente-x:password-senza-schema@gate.example.com:7000';
  const zip = buildExportZip(dati);
  assert.equal(zip.includes(Buffer.from('password-senza-schema')), false);
  assert.equal(readExportZip(zip).data.settings.proxy.datacenter, 'gate.example.com:7000');
});

// Gli stessi valori che i segreti custoditi tengono fuori da uscite e modelli (#2134): la password scritta in chiaro
// altrove, anche se nell'indirizzo è codificata, e quella corta che l'utente si è scelto.
test('l\'archivio senza chiavi toglie ovunque la password del proxy, decodificata e corta (#2134)', () => {
  for (const [indirizzo, password] of [
    ['http://mario:S3gr%40tissima99@gate.example.com:7000', 'S3gr@tissima99'],
    ['http://mario.rossi:Kq7vRt2x@gate.example.com:7000', 'Kq7vRt2x'],
  ]) {
    const dati = sorgente();
    dati.settings.proxy.datacenter = indirizzo;
    dati.clipboardHistory.push({ id: 'c3', type: 'text', text: `la password del proxy è ${password}` });
    const zip = buildExportZip(dati);
    assert.equal(zip.includes(Buffer.from(password)), false, password);
    assert.equal(readExportZip(zip).data.settings.proxy.datacenter, 'http://gate.example.com:7000');
  }
});

test('un archivio col proxy senza schema e senza credenziali non cancella quello completo di qui (#905.1)', () => {
  const completo = 'mario:password-di-qui@gate.example.com:7000';
  const dati = sorgente();
  dati.settings.proxy.datacenter = completo;
  const parsed = readExportZip(buildExportZip(dati));
  assert.equal(parsed.data.settings.proxy.datacenter, 'gate.example.com:7000');
  assert.deepEqual(parsed.proxySenzaCredenziali, ['datacenter']);
  const qui = mergeImportedData({ settings: { proxy: { datacenter: completo } } }, parsed.data).merged;
  assert.equal(qui.settings.proxy.datacenter, completo);
  assert.deepEqual(proxyDaCompletare(qui, parsed.proxySenzaCredenziali), []);
  const altrove = mergeImportedData({ settings: {} }, parsed.data).merged;
  assert.deepEqual(proxyDaCompletare(altrove, parsed.proxySenzaCredenziali), ['datacenter'], 'la conferma deve dirlo');
});

// Molti fornitori danno il proxy come «utente:password@host:porta», senza schema: Filo lo usa, e la password resta un
// segreto come quella scritta con http:// davanti (#905.1).
test('il proxy scritto senza schema esce col solo indirizzo, e la password solo con la spunta', () => {
  const SENZA_SCHEMA = 'mario:passwordsegreta@gate.esempio.com:8080';
  const dati = { settings: { theme: 'dark', proxy: { datacenter: SENZA_SCHEMA } } };
  assert.equal(C.haSegreti(dati.settings), true, 'la casella «Includi le chiavi» deve comparire');
  const zip = buildExportZip(dati);
  assert.equal(zip.includes(Buffer.from('passwordsegreta')), false);
  const parsed = readExportZip(zip);
  assert.equal(parsed.data.settings.proxy.datacenter, 'gate.esempio.com:8080');
  assert.deepEqual(parsed.proxySenzaCredenziali, ['datacenter']);
  assert.equal(mergeImportedData({ settings: { proxy: { datacenter: SENZA_SCHEMA } } }, parsed.data).merged.settings.proxy.datacenter,
    SENZA_SCHEMA, 'importato qui non cancella la password di qui');
  assert.equal(readExportZip(buildExportZip(dati, { chiavi: true })).data.settings.proxy.datacenter, SENZA_SCHEMA);
});

test('le credenziali del proxy valgono fino all\'ultima @ prima dell\'host, come per chi lo usa', () => {
  assert.deepEqual(C.credenzialiProxy(' http://mario:pa@ss@gate.esempio.com:8080 '),
    { credenziali: 'mario:pa@ss', password: 'pa@ss', senza: 'http://gate.esempio.com:8080' });
  assert.equal(C.credenzialiProxy('mario@gate.esempio.com:8080').senza, 'gate.esempio.com:8080');
  assert.equal(C.credenzialiProxy('gate.esempio.com:8080'), null);
  assert.equal(C.credenzialiProxy('socks5://gate.esempio.com:1080/percorso@x'), null);
  assert.equal(C.credenzialiProxy(''), null);
  const zip = buildExportZip({ settings: { proxy: { datacenter: 'http://mario:pa@ss-lunghissima@gate.esempio.com:8080' } } });
  assert.equal(zip.includes(Buffer.from('ss-lunghissima')), false);
});

test('ogni proxy di cui Filo usa la password è un segreto: spazi, tabulazioni, caratteri codificati (#905.1)', () => {
  const { endpointFor } = require(join(ROOT, 'src', 'main', 'services', 'proxyTab.js'));
  for (const segno of [' ', '\t', '%20', '%2F', '@', '!', '[', '|', '{', ';']) {
    const proxy = `mario:pass${segno}word-segreta@gate.esempio.com:8080`;
    const usata = (endpointFor(proxy, 'it') || {}).auth;
    if (!usata || !usata.password) continue;
    assert.equal(C.haSegreti({ proxy: { datacenter: proxy } }), true, `${JSON.stringify(proxy)}: la casella deve comparire`);
    const zip = buildExportZip({ settings: { proxy: { datacenter: proxy } }, filo_notes: [{ id: 'n', text: `la password è ${usata.password}` }] });
    for (const forma of [`pass${segno}word-segreta`, usata.password]) {
      assert.equal(zip.includes(Buffer.from(forma)), false, `${JSON.stringify(proxy)}: «${forma}» è uscita senza la spunta`);
    }
  }
});

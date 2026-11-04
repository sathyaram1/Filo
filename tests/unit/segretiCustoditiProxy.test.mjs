// #2134 — utente e password del proxy sono segreti custoditi: un'uscita che li porta si ferma e un messaggio verso un
// modello li perde, come per una chiave API. L'host del proxy resta libero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'guardianoStatico.js'));
require(join(ROOT, 'src', 'shared', 'urlExfil.js'));
const { custoditi } = require(join(ROOT, 'src', 'main', 'services', 'segretiCustoditi.js'));
const X = globalThis.SN_URL_EXFIL;
const G = globalThis.SN_GUARDIANO_STATICO;
const C = globalThis.SN_CONST;

// Finte, in una forma che nessun fornitore usa.
const PASSWORD = 'FintaPasswordProxy9x7q';
const UTENTE = 'cliente-zona-{country}';
const PROXY = `http://${UTENTE}:${PASSWORD}@gate.fornitore.example:7000`;
const PASSWORD_CODIFICATA = 'Finta%40Password%2FResidenziale';
const RESIDENZIALE = `utente-res:${PASSWORD_CODIFICATA}@res.fornitore.example:9000`;

const valori = (lista) => lista.map((x) => x.valore);
const conProxy = (proxy) => custoditi({ impostazioni: [{ proxy }], env: {} });

test('la password del proxy, anche senza schema e codificata, è fra i custoditi; l\'host no', () => {
  const lista = conProxy({ datacenter: PROXY, residential: RESIDENZIALE });
  const v = valori(lista);
  for (const atteso of [`${UTENTE}:${PASSWORD}`, PASSWORD, `utente-res:${PASSWORD_CODIFICATA}`, PASSWORD_CODIFICATA, 'Finta@Password/Residenziale']) {
    assert.ok(v.includes(atteso), `manca «${atteso}» fra ${JSON.stringify(v)}`);
  }
  assert.ok(!v.some((x) => x.includes('fornitore.example')), 'l\'host del proxy non è un segreto');
  assert.ok(lista.every((x) => x.tipo === 'chiave'));
});

test('un proxy senza credenziali non aggiunge niente', () => {
  assert.deepEqual(conProxy({ datacenter: 'socks5://gate.fornitore.example:7000', residential: '' }), []);
});

test('il proxy dell\'ambiente, che vince sulle impostazioni, è custodito anche lui', () => {
  const v = valori(custoditi({ impostazioni: [{}], env: { FILO_PROXY_DATACENTER: PROXY } }));
  assert.ok(v.includes(PASSWORD));
});

test('i posti dei segreti sono quelli di campiSegreti: chiavi, Safe Browsing e proxy insieme', () => {
  const s = { apiKeys: { openrouter: 'FINTA-chiave-opzioni-7f3a9c2e5b8d' }, proxy: { datacenter: PROXY }, security: { safeBrowse: { safeBrowsingKey: 'FINTA-navigazione-sicura-99' } } };
  assert.equal(C.campiSegreti(s).length, 3);
  const v = valori(custoditi({ impostazioni: [s], env: {} }));
  assert.ok(['FINTA-chiave-opzioni-7f3a9c2e5b8d', 'FINTA-navigazione-sicura-99', PASSWORD].every((x) => v.includes(x)), JSON.stringify(v));
});

test('un\'uscita con la password del proxy si ferma, una visita al sito del fornitore no', () => {
  const segreti = conProxy({ datacenter: PROXY });
  const fuori = X.valutaUscita({ type: 'NAVIGA', url: `https://raccolta.example/?p=${PASSWORD}` }, { segreti });
  assert.equal(fuori.blocca, true);
  assert.equal(fuori.regola, 'custodito');
  assert.equal(X.valutaUscita({ type: 'CERCA_WEB', query: `password ${PASSWORD.toUpperCase()}` }, { segreti }).blocca, true);
  assert.equal(X.valutaUscita({ type: 'NAVIGA', url: 'https://gate.fornitore.example:7000/dashboard' }, { segreti }).blocca, false);
});

test('verso un modello il proxy arriva senza utente e password, con l\'host', () => {
  const lista = valori(conProxy({ datacenter: PROXY }));
  const [m] = G.oscuraSegreti([{ role: 'tool', content: `proxy.datacenter = ${PROXY}` }], lista);
  assert.ok(!m.content.includes(PASSWORD), m.content);
  assert.ok(m.content.includes(G.OSCURATO));
  assert.ok(m.content.includes('gate.fornitore.example:7000'), m.content);
});

// Molti fornitori fanno scegliere la password, e 8-11 caratteri sono comuni: sotto la soglia delle chiavi resta custodita.
test('una password corta del proxy non esce e non arriva al modello; una chiave corta resta sotto soglia', () => {
  const corta = 'Kq7vRt2x';
  const lista = custoditi({ impostazioni: [{ proxy: { datacenter: `http://mario.rossi:${corta}@gate.example.net:7000` } }], env: {} });
  assert.ok(lista.some((x) => x.valore === corta && x.password), JSON.stringify(lista));
  assert.equal(X.valutaUscita({ type: 'NAVIGA', url: `https://raccolta.example/?p=${corta}` }, { segreti: lista }).blocca, true);
  assert.ok(!G.oscuraSegreti(`password ${corta}`, lista).includes(corta));
  assert.ok(!G.oscuraSegreti(`password ${corta}`, valori(lista)).includes(corta), 'anche coi soli valori');
  const chiave = custoditi({ impostazioni: [{ apiKeys: { tavily: 'Zp3wLm9c' } }], env: {} });
  assert.deepEqual(chiave, [], 'una chiave corta non è una password nota');
});

test('il cancello dei modelli oscura la password corta del proxy (porta il segno di password fino al guardiano)', async () => {
  require(join(ROOT, 'src', 'main', 'services', 'modelGate.js'));
  const corta = 'Kq7vRt2x';
  const lista = custoditi({ impostazioni: [{ proxy: { datacenter: `mario.rossi:${corta}@gate.example.net:7000` } }], env: {} });
  const visti = [];
  globalThis.SN_PROVIDERS = {
    completeWithFallback: async ({ messages }) => { visti.push(messages); return { text: 'ok', usage: {} }; },
    streamCompleteWithFallback: async ({ messages }) => { visti.push(messages); return { text: 'ok', usage: {} }; },
    getProvider: () => null,
  };
  const gate = globalThis.SN_MODEL_GATE.create({
    getSettings: async () => ({}),
    buildChain: () => [{ provider: 'openrouter', apiKey: 'k', model: 'm' }],
    modelFor: () => 'm',
    costs: { isOverLimit: async () => false, record: async () => 0 },
    segreti: async () => lista,
  });
  await gate.complete({ action: 'x', messages: [{ role: 'user', content: `la password è ${corta}` }] });
  assert.equal(visti.length, 1);
  assert.ok(!JSON.stringify(visti[0]).includes(corta), JSON.stringify(visti[0]));
});

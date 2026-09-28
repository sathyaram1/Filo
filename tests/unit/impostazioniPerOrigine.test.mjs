// #589 — verso un sito le impostazioni viaggiano ritagliate su una lista di campi
// AMMESSI (le chiavi dei servizi e le credenziali del proxy restano a casa), sia
// nella spinta SETTINGS_UPDATED sia nelle letture; le pagine filo:// hanno tutto.
// Senza il fix è ROSSO: la spinta mandava l'oggetto intero a ogni frame.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
const { DEFAULT_SETTINGS } = globalThis.SN_CONST;
const W = require(join(ROOT, 'src', 'main', 'services', 'impostazioniPerOrigine.js'));

const CHIAVE = 'sk-or-v1-SEGRETO-589';
const PROXY = 'socks5://utente-{country}:parola@gate.provider.example:7000';

function impostazioniConSegreti() {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  s.apiKeys = { openrouter: CHIAVE, tavily: 'tvly-SEGRETO' };
  s.proxy = { ...s.proxy, datacenter: PROXY, residential: PROXY, bypass: '<local>' };
  s.theme = 'dark';
  s.themeTokens = { accent: '#c0662f' };
  s.blocklist = ['esempio.it'];
  s.featureFlags = { ...s.featureFlags, spellcheck: false };
  s.models = { ...s.models, transcribe_audio: 'whisper' };
  s.modelRegistry = {
    whisper: { provider: 'openrouter', model: 'openai/whisper', label: 'Whisper', inputs: ['audio'], outputs: ['text'], apiKey: 'sk-DENTRO-LA-VOCE', baseUrl: 'https://privato.example' },
  };
  return s;
}

const messaggio = (settings) => ({ type: 'settings_updated', settings });
const testo = (v) => JSON.stringify(v);

test('la spinta verso un sito https non porta chiavi dei servizi né credenziali del proxy; verso filo:// sì', () => {
  const s = impostazioniConSegreti();
  const web = W.messaggioPerDestinazione(messaggio(s), 'https://www.esempio.it/articolo');
  assert.equal(web.type, 'settings_updated');
  assert.ok(!testo(web).includes(CHIAVE), 'chiave OpenRouter arrivata al sito');
  assert.ok(!testo(web).includes('tvly-SEGRETO'), 'chiave Tavily arrivata al sito');
  assert.ok(!testo(web).includes('parola@gate'), 'credenziali del proxy arrivate al sito');
  assert.equal(web.settings.apiKeys, undefined);
  assert.equal(web.settings.proxy, undefined);

  const filo = W.messaggioPerDestinazione(messaggio(s), 'filo://options/options.html');
  assert.equal(filo.settings.apiKeys.openrouter, CHIAVE);
  assert.equal(filo.settings.proxy.datacenter, PROXY);
});

test('verso un sito arriva quello che i content script usano, con i valori veri', () => {
  const s = impostazioniConSegreti();
  const web = W.impostazioniPerOrigine(s, 'http://127.0.0.1:5555/pagina.html');
  assert.equal(web.theme, 'dark');
  assert.deepEqual(web.themeTokens, { accent: '#c0662f' });
  assert.deepEqual(web.blocklist, ['esempio.it']);
  assert.equal(web.featureFlags.spellcheck, false);
  assert.deepEqual(web.tts, s.tts);
  assert.deepEqual(web.tabColor, s.tabColor);
  assert.equal(web.models.transcribe_audio, 'whisper');
  assert.deepEqual(web.modelRegistry.whisper, {
    provider: 'openrouter', model: 'openai/whisper', label: 'Whisper', inputs: ['audio'], outputs: ['text'],
  }, 'di una voce del registro passano solo i campi del menu della dettatura');
});

test('un campo nuovo non elencato non raggiunge i siti (lista di ammessi, non di esclusi)', () => {
  const s = { ...impostazioniConSegreti(), nuovoServizio: { token: 'tok-NUOVO' }, terminal: { enabled: true, shell: 'bash' } };
  const web = W.impostazioniPerOrigine(s, 'https://sito.example');
  assert.equal(web.nuovoServizio, undefined);
  assert.equal(web.terminal, undefined);
  assert.ok(!testo(web).includes('tok-NUOVO'));
});

test('ogni destinazione che non è filo:// vale come sito, anche vuota o somigliante', () => {
  const s = impostazioniConSegreti();
  for (const url of ['', undefined, null, 'about:blank', 'data:text/html,x', 'file:///C:/x.html', 'https://filo.example/', 'http://x/?u=filo://options']) {
    const m = W.messaggioPerDestinazione(messaggio(s), url);
    assert.equal(m.settings.apiKeys, undefined, String(url));
  }
});

test('i messaggi senza impostazioni passano identici, a chiunque', () => {
  const m = { type: 'tts_stop' };
  assert.equal(W.messaggioPerDestinazione(m, 'https://sito.example'), m);
  assert.equal(W.messaggioPerDestinazione(null, 'https://sito.example'), null);
});

test('le letture dello storage grezzo seguono la stessa regola; le altre chiavi restano', () => {
  const s = impostazioniConSegreti();
  const valore = { settings: s, sn_personal_dict: ['ciao'] };
  const web = W.storagePerOrigine(valore, 'https://sito.example');
  assert.equal(web.settings.apiKeys, undefined);
  assert.equal(web.settings.proxy, undefined);
  assert.equal(web.settings.theme, 'dark');
  assert.deepEqual(web.sn_personal_dict, ['ciao']);
  assert.equal(W.storagePerOrigine(valore, 'filo://dashboard/dashboard.html').settings.apiKeys.openrouter, CHIAVE);
  assert.deepEqual(W.storagePerOrigine({ sn_personal_dict: [] }, 'https://sito.example'), { sn_personal_dict: [] });
});

test('impostazioni assenti o strane non rompono la proiezione', () => {
  assert.equal(W.impostazioniPerWeb(null), null);
  assert.equal(W.impostazioniPerWeb(undefined), undefined);
  assert.deepEqual(W.impostazioniPerWeb({}), {});
  const strana = JSON.parse('{"modelRegistry":{"__proto__":{"model":"x"},"ok":{"model":"m"}},"theme":"light"}');
  const web = W.impostazioniPerWeb(strana);
  assert.equal(Object.getPrototypeOf(web.modelRegistry), Object.prototype);
  assert.deepEqual(web.modelRegistry.ok, { model: 'm' });
  assert.deepEqual(W.impostazioniPerWeb({ modelRegistry: 'rotto' }), {});
});

test('sentinella: nessun segreto fra i campi ammessi, e ogni campo ammesso esiste davvero', () => {
  for (const k of ['apiKeys', 'proxy', 'terminal', 'pricing', 'monthlyLimitEur']) {
    assert.ok(!(k in W.CAMPI_WEB), `${k} non deve raggiungere i siti`);
  }
  for (const k of Object.keys(W.CAMPI_WEB)) {
    assert.ok(k in DEFAULT_SETTINGS, `campo ammesso inesistente nelle impostazioni: ${k}`);
  }
});

// Il verso opposto: un campo che un content script legge ma che manca dalla
// lista sparirebbe in silenzio sui siti (e solo lì). Si leggono gli script che
// page-preload.js carica davvero nelle pagine web.
test('sentinella: ogni impostazione letta dai content script dei siti è fra i campi ammessi', () => {
  const preload = readFileSync(join(ROOT, 'src', 'preload', 'page-preload.js'), 'utf8');
  const file = ['src/preload/page-preload.js'];
  for (const m of preload.matchAll(/require\(path\.join\((CONTENT_DIR|SHARED_DIR), '([\w.-]+\.js)'\)\)/g)) {
    file.push(`src/${m[1] === 'CONTENT_DIR' ? 'content' : 'shared'}/${m[2]}`);
  }
  assert.ok(file.some((f) => f.endsWith('content/content.js')) && file.length > 20, 'elenco degli script dei siti non trovato');
  const letture = new Set();
  const RE = /\bsettings\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g;
  for (const f of file) {
    const src = readFileSync(join(ROOT, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(RE)) if (m[1] in DEFAULT_SETTINGS) letture.add(`${m[1]} (${f})`);
  }
  assert.ok([...letture].some((l) => l.startsWith('theme ')), 'la sentinella non vede più le letture di content.js');
  const mancanti = [...letture].filter((l) => !(l.split(' ')[0] in W.CAMPI_WEB));
  assert.deepEqual(mancanti, [], 'impostazioni lette sui siti ma non ammesse in impostazioniPerOrigine.js');
});

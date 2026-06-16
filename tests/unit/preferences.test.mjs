// Unit test per src/shared/preferences.js — la mappa "linguaggio naturale →
// impostazione dell'app" che l'azione IMPOSTA_PREFERENZA usa (#146.5).
//
// Verifica il SUCCESSO della mappatura: ogni chiave produce il partial giusto
// (annidato dove serve) e il livello di sicurezza corretto (1 = applica
// subito, 2 = conferma). Logica pura: gira sotto node:test senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
// tabColor.js prima di preferences.js: il setter `colore_tab` usa SN_TAB_COLOR
// (defaultParams) per il preset "predefinito".
require(join(__dirname, '..', '..', 'src', 'shared', 'tabColor.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'preferences.js'));

const P = globalThis.SN_PREF;
const build = (k, v) => P.buildPreferencePartial(k, v);

test('preferenze estetiche/comportamentali → livello 1, partial giusto', () => {
  assert.deepEqual(build('tema', 'scuro'), { partial: { theme: 'dark' }, label: 'Tema → Scuro', level: 1 });
  assert.equal(build('correttore', 'off').level, 1);
  assert.deepEqual(build('correttore', 'off').partial, { featureFlags: { spellcheck: false } });
  assert.deepEqual(build('sidebar_aiuto', 'attiva').partial, { featureFlags: { help: true } });
  assert.deepEqual(build('categorizzazione', 'sì').partial, { featureFlags: { categorize: true } });
  assert.deepEqual(build('archivia_se_inattivo', 'no').partial, { autoArchive: { onIdle: false } });
});

test('sicurezza/privacy → livello 2, partial annidato corretto', () => {
  const cookie = build('gestione_cookie', 'privacy');
  assert.equal(cookie.level, 2);
  assert.deepEqual(cookie.partial, { security: { cookies: { mode: 'privacy' } } });

  assert.deepEqual(build('gestione_cookie', 'automatico').partial, { security: { cookies: { mode: 'default' } } });
  assert.deepEqual(build('gestione_cookie', 'manuale').partial, { security: { cookies: { mode: 'manual' } } });

  const fp = build('fingerprint', 'off');
  assert.equal(fp.level, 2);
  assert.deepEqual(fp.partial, { security: { fingerprint: { mode: 'off' } } });
  assert.deepEqual(build('fingerprint', 'privacy').partial, { security: { fingerprint: { mode: 'privacy' } } });

  assert.deepEqual(build('navigazione_sicura', 'disattiva').partial, { security: { safeBrowse: { enabled: false } } });
  assert.deepEqual(build('protezione_ip', 'off').partial, { security: { protectIpLeak: false } });
  assert.deepEqual(build('blocco_popup', 'on').partial, { security: { blockPopups: true } });
  assert.equal(build('blocco_popup', 'on').level, 2);
});

test('modelli / provider / chiavi / costi → livello 2', () => {
  assert.deepEqual(build('provider', 'gemini'), { partial: { provider: 'gemini' }, label: 'Provider → Google Gemini', level: 2 });
  assert.deepEqual(build('provider', 'openrouter').partial, { provider: 'openrouter' });
  assert.equal(build('modelli_predefiniti', 'off').level, 2);
  assert.deepEqual(build('modelli_predefiniti', 'off').partial, { useDefaultModels: false });

  const k = build('chiave_gemini', 'AIzaSEGRETO1234');
  assert.equal(k.level, 2);
  assert.deepEqual(k.partial, { apiKeys: { gemini: 'AIzaSEGRETO1234' } });
  // L'etichetta NON stampa l'intera chiave (solo testa/coda).
  assert.doesNotMatch(k.label, /AIzaSEGRETO1234/);
  assert.match(k.label, /AIza/);

  assert.deepEqual(build('chiave_openrouter', 'sk-or-v1-abcdEFGH').partial, { apiKeys: { openrouter: 'sk-or-v1-abcdEFGH' } });
  assert.deepEqual(build('chiave_tavily', 'tvly-abcd1234').partial, { apiKeys: { tavily: 'tvly-abcd1234' } });

  const limit = build('limite_spesa', '12 euro');
  assert.equal(limit.level, 2);
  assert.deepEqual(limit.partial, { monthlyLimitEur: 12 });
});

test('valori non validi → null (niente scrittura accidentale)', () => {
  assert.equal(build('provider', 'inesistente'), null);
  assert.equal(build('gestione_cookie', 'boh'), null);
  assert.equal(build('chiave_gemini', ''), null);       // chiave vuota: non azzera per sbaglio
  assert.equal(build('limite_spesa', 'tanto'), null);
  assert.equal(build('correttore', 'forse'), null);
  // 'apiKey' generico è ambiguo (quale provider?) → non mappato.
  assert.equal(build('apiKey', 'x'), null);
});

test('il livello di default è 1 quando il setter non lo dichiara', () => {
  // I setter estetici storici non hanno `level` esplicito.
  assert.equal(build('dimensione_testo', 'grande').level, 1);
  assert.equal(build('stile_agente', 'professionale').level, 1);
});

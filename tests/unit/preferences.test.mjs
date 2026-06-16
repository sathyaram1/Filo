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
  assert.deepEqual(build('tema', 'scuro'), { partial: { theme: 'dark' }, label: 'Tema → Scuro', level: 1, risk: '' });
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

// ── Colore identità delle tab (setter `colore_tab`) ─────────────────────────
// Il fix asserisce che una richiesta verbale produce un cambiamento CONCRETO
// dei parametri tabColor (non solo un messaggio): se rimuovessi il setter,
// questi assert diventerebbero rossi (build → null).
test('colore_tab: "più vivaci" alza saturazione/opacità, livello 1', () => {
  const r = build('colore_tab', 'voglio colori più vivaci');
  assert.equal(r.level, 1);
  assert.equal(r.partial.tabColor.saturazione_tab, 1);
  assert.ok(r.partial.tabColor.opacita_tab > 0.6, 'opacità alzata sopra il default');
});

test('colore_tab: "più neutre" abbassa saturazione/opacità', () => {
  const r = build('colore_tab', 'rendile più neutre');
  assert.ok(r.partial.tabColor.saturazione_tab < 1);
  assert.ok(r.partial.tabColor.opacita_tab < 0.6);
});

test('colore_tab: "nessun colore" azzera solo opacita_tab (gli altri restano)', () => {
  const r = build('colore_tab', 'niente colore nelle tab');
  assert.deepEqual(r.partial, { tabColor: { opacita_tab: 0 } });
});

test('colore_tab: "Poste è verde non gialla" → estrazione più selettiva', () => {
  const r = build('colore_tab', 'Poste sbaglia, è verde non gialla');
  assert.ok(r.partial.tabColor.soglia_saturazione > 0.3, 'soglia alzata');
  assert.ok(r.partial.tabColor.peso_centralita > 5, 'centralità alzata');
});

test('colore_tab: "predefinito" ripristina tutti e sei i parametri', () => {
  const r = build('colore_tab', 'rimetti i colori predefiniti');
  const TC = globalThis.SN_TAB_COLOR;
  assert.deepEqual(r.partial.tabColor, TC.defaultParams());
});

test('colore_tab: richiesta non riconosciuta → null (nessuna scrittura)', () => {
  assert.equal(build('colore_tab', 'boh fai tu qualcosa'), null);
});

// ── Parametri tabColor: default, range, clamp ───────────────────────────────
test('tabColor: defaultParams ha i sei parametri della spec', () => {
  const TC = globalThis.SN_TAB_COLOR;
  const d = TC.defaultParams();
  assert.deepEqual(Object.keys(d).sort(), [
    'bucket_tinta', 'luminosita_tab', 'opacita_tab',
    'peso_centralita', 'saturazione_tab', 'soglia_saturazione',
  ]);
  assert.equal(d.opacita_tab, 0.6);
});

test('tabColor: clampParams riporta i valori dentro i range e arrotonda i bucket', () => {
  const TC = globalThis.SN_TAB_COLOR;
  const c = TC.clampParams({ opacita_tab: 5, saturazione_tab: -2, bucket_tinta: 2.7, ignoto: 9 });
  assert.equal(c.opacita_tab, 1);      // clamp max
  assert.equal(c.saturazione_tab, 0);  // clamp min
  assert.equal(c.bucket_tinta, 3);     // arrotondato
  assert.equal('ignoto' in c, false);  // chiavi estranee scartate
  assert.equal(c.peso_centralita, 5);  // mancante → default
});

test('extractIdentityFromPixels rispetta saturazione_tab (param di estrazione)', () => {
  const TC = globalThis.SN_TAB_COLOR;
  const W = 32, H = 32;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { // logo rosso pieno
    px[i * 4] = 220; px[i * 4 + 1] = 20; px[i * 4 + 2] = 20; px[i * 4 + 3] = 255;
  }
  const full = TC.extractIdentityFromPixels(px, W, H, { saturazione_tab: 1 });
  const flat = TC.extractIdentityFromPixels(px, W, H, { saturazione_tab: 0 });
  const sat = (s) => { const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(s); const p = [+m[1], +m[2], +m[3]]; return Math.max(...p) - Math.min(...p); };
  assert.ok(sat(full) > sat(flat), `saturazione 1 (${full}) deve essere più satura di 0 (${flat})`);
  assert.equal(sat(flat), 0, 'saturazione 0 → grigio');
});

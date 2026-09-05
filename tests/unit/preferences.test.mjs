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
  const prov = build('provider', 'openrouter');
  assert.equal(prov.level, 2);
  assert.equal(prov.label, 'Provider → OpenRouter');
  assert.deepEqual(prov.partial, { provider: 'openrouter' });
  // Google non è più un fornitore di Filo: chiederlo a parole non deve
  // scrivere niente.
  assert.equal(build('provider', 'gemini'), null);
  assert.equal(build('chiave_gemini', 'AIzaSEGRETO1234'), null);
  assert.equal(build('modelli_predefiniti', 'off').level, 2);
  assert.deepEqual(build('modelli_predefiniti', 'off').partial, { useDefaultModels: false });

  const k = build('chiave_openrouter', 'sk-or-v1-SEGRETO1234');
  assert.equal(k.level, 2);
  assert.deepEqual(k.partial, { apiKeys: { openrouter: 'sk-or-v1-SEGRETO1234' } });
  // L'etichetta NON stampa l'intera chiave (solo testa/coda).
  assert.doesNotMatch(k.label, /SEGRETO1234/);
  assert.match(k.label, /sk-o/);

  assert.deepEqual(build('chiave_tavily', 'tvly-abcd1234').partial, { apiKeys: { tavily: 'tvly-abcd1234' } });

  const limit = build('limite_spesa', '12 euro');
  assert.equal(limit.level, 2);
  assert.deepEqual(limit.partial, { monthlyLimitEur: 12 });
});

// ── Numeri in formato italiano: il punto delle migliaia NON è un decimale ────
// Bug reale: "imposta il limite di spesa mensile a 2.500 euro" veniva letto come
// 2,50 € perché il punto (separatore delle migliaia in italiano) faceva da
// separatore decimale. Questi assert diventano ROSSI se si rimuove il fix:
// senza parseItalianNumber, "2.500 euro" → 2.5 e "1.000 euro" → 1.
test('limite_spesa: il punto delle migliaia (formato italiano) NON diventa decimale', () => {
  assert.deepEqual(build('limite_spesa', '2.500 euro').partial, { monthlyLimitEur: 2500 });
  assert.deepEqual(build('limite_spesa', '1.000').partial, { monthlyLimitEur: 1000 });
  assert.deepEqual(build('limite_spesa', '10.000 €').partial, { monthlyLimitEur: 10000 });
  // Migliaia + decimale insieme (formato italiano completo): 2.500,50 → 2500.50
  assert.deepEqual(build('limite_spesa', '2.500,50 euro').partial, { monthlyLimitEur: 2500.5 });
  // Solo virgola decimale resta un decimale: 2,50 → 2.5
  assert.deepEqual(build('limite_spesa', '2,50').partial, { monthlyLimitEur: 2.5 });
  // Punto decimale all'inglese con 1-2 cifre resta decimale: 12.50 → 12.5
  assert.deepEqual(build('limite_spesa', '12.50 euro').partial, { monthlyLimitEur: 12.5 });
});

test("velocità/tono di lettura: i decimali all'inglese restano decimali", () => {
  // Qui il punto è un decimale legittimo e NON deve diventare migliaia.
  assert.deepEqual(build('velocita_voce', '1.5').partial, { tts: { rate: 1.5 } });
  assert.deepEqual(build('tono_voce', '0.8').partial, { tts: { pitch: 0.8 } });
});

test('parseItalianNumber: disambigua migliaia vs decimale', () => {
  const p = P.parseItalianNumber;
  assert.equal(p('2.500'), 2500);
  assert.equal(p('1.000'), 1000);
  assert.equal(p('1.234.567'), 1234567);
  assert.equal(p('2.500,50'), 2500.5);
  assert.equal(p('2,50'), 2.5);
  assert.equal(p('1.5'), 1.5);      // decimale inglese (1 cifra dopo il punto)
  assert.equal(p('2.50'), 2.5);     // decimale inglese (2 cifre dopo il punto)
  assert.equal(p('42'), 42);
  assert.ok(Number.isNaN(p('tanto')));
  assert.ok(Number.isNaN(p('')));
});

test('valori non validi → null (niente scrittura accidentale)', () => {
  assert.equal(build('provider', 'inesistente'), null);
  assert.equal(build('gestione_cookie', 'boh'), null);
  assert.equal(build('chiave_openrouter', ''), null);   // chiave vuota: non azzera per sbaglio
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

// ── #183: il popup di livello 2 spiega cosa Filo fa E i rischi ───────────────
// Itera sul registro REALE: qualsiasi setter di livello 2 aggiunto in futuro
// senza `risk` fa diventare rosso questo test (è il guard-rail della regola).
test('REGOLA #183: ogni setter di livello 2 dichiara un messaggio di rischio non vuoto', () => {
  const senzaRischio = P.PREF_SETTERS
    .filter((s) => s.level === 2)
    .filter((s) => !s.risk || String(s.risk).trim().length < 20)
    .map((s) => s.keys[0]);
  assert.deepEqual(senzaRischio, [], `setter di livello 2 senza messaggio di rischio (#183): ${senzaRischio.join(', ')}`);
});

test('#183: il messaggio di rischio è esposto da buildPreferencePartial e parla del rischio', () => {
  const term = build('terminale', 'on');
  assert.equal(term.level, 2);
  assert.match(term.risk, /shell/i, 'la modalità terminale spiega l’accesso alla shell');

  const key = build('chiave_openrouter', 'sk-or-v1-SEGRETO1234');
  assert.match(key.risk, /credenzial|spes/i, 'la chiave API avvisa che autorizza spese');
  // Il rischio NON deve stampare il segreto.
  assert.doesNotMatch(key.risk, /SEGRETO1234/);

  // Livello 1 → nessun rischio (si applica subito, senza popup).
  assert.equal(build('tema', 'scuro').risk, '');
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

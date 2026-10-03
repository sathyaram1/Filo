// I cambi di stato come eventi del filo (#867): src/shared/cambi.js.
// La sentinella che conta: ogni impostazione che si può scrivere (default, chat, pagina Preferenze)
// ha una frase in parole per il suo evento, oppure un'esclusione col suo motivo. Una chiave nuova
// senza nessuna delle due fa diventare rosso questo file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/constants.js');
require('../../src/shared/contenutoEsterno.js');
require('../../src/shared/timeFormat.js');
require('../../src/shared/storage.js');
require('../../src/shared/themeTokens.js');
require('../../src/shared/tabColor.js');
require('../../src/shared/ttsVoices.js');
require('../../src/shared/filoMemory.js');
require('../../src/shared/preferences.js');
require('../../src/shared/cambi.js');
const K = globalThis.SN_CAMBI;
const C = globalThis.SN_CONST;
const S = globalThis.SN_STORAGE;
const P = globalThis.SN_PREF;
const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Le chiavi di un oggetto di impostazioni come le vede il registro: le mappe con la voce «.*»
// (token, modelli, chiavi) hanno per foglia la voce intera.
function foglie(o, base = '', out = []) {
  for (const k of Object.keys(o || {})) {
    const p = base ? `${base}.${k}` : k;
    const v = o[k];
    const jolly = K.VOCI[`${p}.*`] || K.ESCLUSIONI[`${p}.*`];
    if (jolly) { out.push(`${p}.qualcosa`); continue; }
    if (v && typeof v === 'object' && !Array.isArray(v)) foglie(v, p, out);
    else out.push(p);
  }
  return out;
}

function leggibile(frase, chiave) {
  assert.ok(frase && typeof frase === 'string', `${chiave}: nessuna frase`);
  assert.ok(!/\s=\s|=$/.test(frase), `${chiave}: la frase ha il segno di uguale: «${frase}»`);
  const nuda = chiave.split('.').pop();
  if (/[A-Z]/.test(nuda) || nuda.length > 4) {
    assert.ok(!frase.includes(nuda) || /^(apiKeys|models|modelRegistry|themeTokens|tabColor)$/.test(chiave.split('.')[0]),
      `${chiave}: la frase mostra la chiave interna: «${frase}»`);
  }
  assert.ok(!/\b[a-z]+[A-Z][a-zA-Z]+\b/.test(frase.replace(/«[^»]*»/g, '')), `${chiave}: c'è un nome da programmatore: «${frase}»`);
}

test('sentinella: ogni impostazione dei default ha una frase in parole, o un\'esclusione col motivo', () => {
  const senza = [];
  for (const chiave of foglie(C.DEFAULT_SETTINGS)) {
    if (K.esclusa(chiave)) continue;
    const v = K.voce(chiave);
    if (!v) { senza.push(chiave); continue; }
    if (v.segreto) {
      leggibile(K.fraseCambio({ chiave, segreto: true, vuotoPrima: true, vuotoDopo: false }), chiave);
      continue;
    }
    const def = chiave.split('.').reduce((o, k) => (o ? o[k] : undefined), C.DEFAULT_SETTINGS);
    const altro = typeof def === 'boolean' ? !def : (typeof def === 'number' ? def + 1 : (Array.isArray(def) ? ['esempio.it'] : 'altro'));
    leggibile(K.fraseCambio({ chiave, prima: def, dopo: altro }), chiave);
  }
  assert.deepEqual(senza, [], `impostazioni senza frase per il loro evento: ${senza.join(', ')} — aggiungile a VOCI (o a ESCLUSIONI col perché) in src/shared/cambi.js`);
});

test('sentinella: quello che la chat sa impostare ha una frase (e non è escluso)', () => {
  const campioni = ['scuro', 'grande', 'sì', 'no', 'attiva', '12', '1.5', 'privacy', 'automatico', 'off', 'openrouter',
    'sk-or-v1-abcdefgh1234', '20 euro', 'più vivaci', 'delicata', 'media', 'powershell', 'Rispondi breve.', 'nessuno'];
  const percorsi = new Set();
  for (const setter of P.PREF_SETTERS) {
    for (const v of campioni) {
      let r = null;
      try { r = setter.build(v); } catch (_) { r = null; }
      if (r && r.partial) for (const p of foglie(r.partial)) percorsi.add(p);
    }
  }
  assert.ok(percorsi.size > 20, 'troppo poche preferenze trovate: la sentinella non sta guardando');
  for (const chiave of percorsi) {
    assert.ok(!K.esclusa(chiave), `${chiave} si imposta dalla chat ma è esclusa dal registro dei cambi`);
    assert.ok(K.voce(chiave), `${chiave} si imposta dalla chat ma non ha una frase in src/shared/cambi.js`);
  }
});

test('sentinella: ogni campo della pagina Preferenze ha la sua frase', () => {
  const src = fs.readFileSync(path.join(radice, 'src/pages/preferences/preferences.js'), 'utf8');
  const campi = new Set([...src.matchAll(/case '([a-zA-Z.]+)': return \$\(/g)].map((m) => m[1]));
  assert.ok(campi.size >= 10, 'la pagina Preferenze non ha più i suoi campi dove la sentinella li cerca');
  for (const chiave of campi) assert.ok(K.voce(chiave), `il campo ${chiave} delle Preferenze non ha una frase`);
});

test('ogni token estetico ha il suo nome nella frase', () => {
  const T = globalThis.SN_THEME_TOKENS;
  for (const nome of T.names()) {
    const f = K.fraseCambio({ chiave: `themeTokens.${nome}`, prima: undefined, dopo: '#123456' });
    assert.ok(!f.includes('un dettaglio'), `il token ${nome} non ha un'etichetta`);
    leggibile(f, `themeTokens.${nome}`);
  }
});

test('ogni esclusione dice perché', () => {
  for (const [k, motivo] of Object.entries(K.ESCLUSIONI)) {
    assert.ok(typeof motivo === 'string' && motivo.trim().length > 20, `${k}: l'esclusione non dice perché`);
  }
});

test('criterio 1: «tema: chiaro → scuro», col nome della pagina Preferenze', () => {
  const cambi = K.cambiImpostazioni({ theme: 'light' }, { theme: 'dark' }, S.normalizza);
  assert.deepEqual(cambi, [{ chiave: 'theme', prima: 'light', dopo: 'dark' }]);
  assert.equal(K.frase({ cambi }), 'tema: chiaro → scuro');
  assert.equal(K.provenienza({ via: 'interfaccia', dove: 'preferences' }), 'dalle Preferenze');
  assert.equal(K.provenienza({ via: 'chat' }), 'dalla chat');
});

test('una chiave che manca nel salvato non sembra cambiata (i default si fondono prima del confronto)', () => {
  assert.deepEqual(K.cambiImpostazioni(undefined, { theme: 'system' }, S.normalizza), []);
  assert.deepEqual(K.cambiImpostazioni({}, { ...C.DEFAULT_SETTINGS }, S.normalizza), []);
});

test('i segreti non entrano nel registro: né il valore di prima né quello di dopo', () => {
  const cambi = K.cambiImpostazioni({ apiKeys: { openrouter: 'sk-vecchia' } }, { apiKeys: { openrouter: 'sk-nuova-123' } }, S.normalizza);
  assert.equal(cambi.length, 1);
  assert.ok(!JSON.stringify(cambi).includes('sk-'), 'una chiave è finita nel registro');
  assert.equal(K.fraseCambio(cambi[0]), 'chiave OpenRouter: cambiata');
  assert.equal(K.annullabile({ cambi }), false);
  for (const [k, prima, dopo] of [['proxy', { datacenter: 'http://u:p@a' }, { datacenter: 'http://u:q@b' }],
    ['security', { safeBrowse: { safeBrowsingKey: 'AIza1' } }, { safeBrowse: { safeBrowsingKey: 'AIza2' } }]]) {
    const c = K.cambiImpostazioni({ [k]: prima }, { [k]: dopo }, S.normalizza);
    assert.ok(c.length === 1 && c[0].segreto, `${k}: il valore non è trattato da segreto`);
  }
});

test('le scritture escluse non diventano un evento', () => {
  const cambi = K.cambiImpostazioni(
    { proxy: { lastCountry: 'us' }, security: { cookies: { bozza: 'a' } } },
    { proxy: { lastCountry: 'fr' }, security: { cookies: { bozza: 'ab' } } },
    S.normalizza,
  );
  assert.deepEqual(cambi, []);
});

test('criterio 4: i passi di un cursore si fondono in UN evento, e tornare all\'inizio non lascia niente', () => {
  const t0 = Date.parse('2026-10-01T10:00:00Z');
  const ev = (i, prima, dopo) => ({
    id: `c${i}`, ts: new Date(t0 + i * 300).toISOString(), tipo: 'impostazioni', via: 'interfaccia', dove: 'preferences',
    cambi: [{ chiave: 'textScale', prima, dopo }],
  });
  let ultimo = ev(0, 1, 1.1);
  for (let i = 1; i < 6; i++) {
    const n = ev(i, 1 + i * 0.1, 1 + (i + 1) * 0.1);
    assert.ok(K.fondibile(ultimo, n), `il passo ${i} non si fonde`);
    ultimo = K.fondi(ultimo, n);
  }
  assert.equal(ultimo.id, 'c0');
  assert.equal(K.frase(ultimo), 'dimensione del testo: 100% → 170%');
  assert.equal(K.fondi(ultimo, ev(9, 1.7, 1)), null);
  // La chat non si fonde mai: due richieste sono due eventi.
  assert.equal(K.fondibile({ ...ev(0, 1, 2), via: 'chat' }, { ...ev(1, 2, 3), via: 'chat' }), false);
  // Dopo una pausa lunga è un cambio nuovo.
  assert.equal(K.fondibile(ev(0, 1, 2), { ...ev(1, 2, 3), ts: new Date(t0 + K.FINESTRA_FUSIONE_MS + 1000).toISOString() }), false);
});

test('annullare rimette i valori di prima, anche dentro le mappe sostituite intere', () => {
  const evento = { cambi: [
    { chiave: 'theme', prima: 'light', dopo: 'dark' },
    { chiave: 'themeTokens.button.bg', prima: undefined, dopo: '#ff0000' },
    { chiave: 'security.cookies.mode', prima: 'default', dopo: 'privacy' },
  ] };
  const parziale = K.annulloImpostazioni(evento, { themeTokens: { 'button.bg': '#ff0000', accent: '#111111' } }, S.REPLACE_KEYS);
  assert.deepEqual(parziale, { theme: 'light', themeTokens: { accent: '#111111' }, security: { cookies: { mode: 'default' } } });
  assert.equal(K.livello(evento), 2, 'rimettere la gestione dei cookie chiede la conferma che chiede cambiarla');
  assert.equal(K.livello({ cambi: [evento.cambi[0]] }), 1);
});

test('un annullo annullato rimette in piedi il cambio di prima', () => {
  const lista = [{ id: 'c1' }, { id: 'c2', annulla: 'c1' }];
  assert.equal(K.annullati(lista).get('c1'), 'c2');
  const ancora = [...lista, { id: 'c3', annulla: 'c2' }];
  assert.equal(K.annullati(ancora).has('c1'), false);
  assert.equal(K.annullati(ancora).get('c2'), 'c3');
});

test('timer e sveglie: crearli, toglierli e spostarli sono cambi; suonare, fermarli e la pausa no', () => {
  const adesso = Date.parse('2026-10-01T10:00:00Z');
  const t = { id: 'a', label: 'pasta', startedAt: new Date(adesso).toISOString(), endsAt: new Date(adesso + 600000).toISOString(), paused: false };
  const nuovo = K.cambiTimer([], [t], adesso);
  assert.equal(K.fraseCambio(nuovo[0]), 'nuovo timer «pasta», 10 min');
  assert.equal(K.fraseCambio(K.cambiTimer([t], [], adesso)[0]), 'tolto il timer «pasta»');
  assert.deepEqual(K.cambiTimer([t], [{ ...t, ringing: true }], adesso), []);
  assert.deepEqual(K.cambiTimer([{ ...t, ringing: true }], [], adesso), []);
  assert.deepEqual(K.cambiTimer([t], [{ ...t, paused: true, remainingMs: 1000 }], adesso), []);
  const sv = { id: 's', kind: 'alarm', label: 'palestra', startedAt: '', endsAt: '2026-10-02T05:00:00Z', atTime: '07:00', repeat: ['lun'] };
  const spostata = K.cambiTimer([sv], [{ ...sv, atTime: '07:30', endsAt: '2026-10-02T05:30:00Z' }], adesso);
  assert.match(K.fraseCambio(spostata[0]), /sveglia «palestra» delle 07:00 .*→ 07:30/);
  // Annullare un timer creato lo toglie; annullare un timer tolto lo rimette, se non sarebbe già scaduto.
  assert.deepEqual(K.annulloTimer({ cambi: nuovo }, [t], adesso).lista, []);
  const tolto = K.cambiTimer([t], [], adesso);
  assert.equal(K.annulloTimer({ cambi: tolto }, [], adesso).lista[0].id, 'a');
  const tardi = K.annulloTimer({ cambi: tolto }, [], adesso + 3600000);
  assert.equal(tardi.lista.length, 0);
  assert.equal(tardi.saltati.length, 1);
});

test('regole del proxy: aggiunta, tolta, annullata', () => {
  const c = K.cambiRegoleProxy({}, { 'netflix.com': { country: 'us', tier: null, ts: 'x' } });
  assert.equal(K.fraseCambio(c[0]), 'netflix.com sempre da Stati Uniti');
  assert.deepEqual(K.cambiRegoleProxy({ 'a.it': { country: 'us', ts: '1' } }, { 'a.it': { country: 'us', ts: '2' } }), []);
  assert.deepEqual(K.annulloRegoleProxy({ cambi: c }, { 'netflix.com': { country: 'us' } }), {});
});

test('per il modello: righe con id, provenienza e stato, e il conto di quelle lasciate fuori', () => {
  const adesso = Date.parse('2026-10-01T10:00:00Z');
  const lista = [
    { id: 'c1', ts: new Date(adesso - 600000).toISOString(), tipo: 'impostazioni', via: 'interfaccia', dove: 'preferences', cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }] },
    { id: 'c2', ts: new Date(adesso - 60000).toISOString(), tipo: 'impostazioni', via: 'chat', annulla: 'c1', cambi: [{ chiave: 'theme', prima: 'dark', dopo: 'light' }] },
  ];
  const { righe, tolti } = K.righePerModello(lista, { adesso, max: 40 });
  assert.equal(tolti, 0);
  assert.match(righe[0], /c1: tema: chiaro → scuro \(annullato da c2\)/);
  assert.match(righe[0], /dalle Preferenze/);
  assert.match(righe[1], /annulla c1/);
  assert.equal(K.righePerModello(lista, { adesso, max: 1 }).tolti, 1);
});

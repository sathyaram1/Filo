// Unit test del CENSIMENTO dei punti in cui Filo usa un modello
// (src/shared/modelUsage.js).
//
// Il censimento serve a una cosa sola: che non esista un punto in cui Filo usa
// un modello scelto dal codice invece che dalla configurazione. Un elenco
// scritto a mano e mai verificato non lo garantisce — diventa vecchio al primo
// commit. Questi test lo incrociano col codice reale e diventano ROSSI se:
//
//   • una funzione dell'app non è nel censimento (o viceversa);
//   • uno slot dei modelli di supporto non è nel censimento (o viceversa);
//   • una funzione censita non ha un modello di default;
//   • la lista di funzioni impostabili dalle Opzioni non coincide col censimento
//     (cioè: esiste una funzione senza un posto dove impostarla);
//   • in `src/` ricompare il nome di un modello scritto nel codice, fuori dal
//     registro dei modelli configurabili.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SHARED = join(ROOT, 'src', 'shared');

require(join(SHARED, 'constants.js'));
require(join(SHARED, 'i18n.js'));
require(join(SHARED, 'modelCaps.js'));
require(join(SHARED, 'modelUsage.js'));
require(join(SHARED, 'modelChainEditor.js'));

const C = globalThis.SN_CONST;
const Usage = globalThis.SN_MODEL_USAGE;
const Chain = globalThis.SN_MODEL_CHAIN;
const SupportModels = require(join(ROOT, 'src', 'main', 'services', 'supportModelsStore.js'));

// ── Struttura ────────────────────────────────────────────────────────────────

test('il censimento è esposto e ogni voce è ben formata', () => {
  assert.ok(Usage && Array.isArray(Usage.ENTRIES) && Usage.ENTRIES.length > 0);
  const ids = new Set();
  for (const e of Usage.ENTRIES) {
    assert.ok(e.id && typeof e.id === 'string', 'ogni voce ha un id');
    assert.ok(!ids.has(e.id), `id duplicato nel censimento: ${e.id}`);
    ids.add(e.id);
    assert.ok(e.label && typeof e.label === 'string', `voce senza nome: ${e.id}`);
    assert.ok(e.area && typeof e.area === 'string', `voce senza area: ${e.id}`);
    assert.ok(['user', 'owner', 'none', 'code'].includes(e.from), `origine non valida: ${e.id}`);
    if (e.from === 'user' || e.from === 'owner') {
      assert.ok(e.ref, `voce impostabile senza riferimento: ${e.id}`);
      assert.ok(e.where, `voce impostabile senza "dove si imposta": ${e.id}`);
    }
  }
});

// ── L'invariante ─────────────────────────────────────────────────────────────

test('nessun punto prende il modello da un valore deciso nel codice', () => {
  assert.deepEqual(
    Usage.hardcoded(),
    [],
    'questi punti usano un modello che nessuno può cambiare: vanno resi impostabili',
  );
});

// ── Il censimento copre tutte le funzioni dell'app ───────────────────────────

test('ogni funzione dell\'app è censita, e il censimento non inventa funzioni', () => {
  const actions = new Set(Object.values(C.ACTIONS));
  const censused = new Set(Usage.userActions());

  const missing = [...actions].filter((a) => !censused.has(a));
  assert.deepEqual(missing, [], `funzioni che usano un modello ma non sono nel censimento: ${missing.join(', ')}`);

  const ghosts = [...censused].filter((a) => !actions.has(a));
  assert.deepEqual(ghosts, [], `il censimento cita funzioni che non esistono: ${ghosts.join(', ')}`);
});

test('ogni funzione censita ha un modello di default', () => {
  const senza = Usage.userActions().filter((a) => !C.DEFAULT_MODELS[a]);
  assert.deepEqual(senza, [], `funzioni senza modello di partenza: ${senza.join(', ')}`);
});

// ── Il censimento copre i punti che girano sui server di Filo ────────────────

test('ogni slot dei modelli di supporto è censito, e viceversa', () => {
  const slots = new Set(SupportModels.SLOTS);
  const censused = new Set(Usage.ownerSlots());

  const missing = [...slots].filter((s) => !censused.has(s));
  assert.deepEqual(missing, [], `slot di supporto non censiti: ${missing.join(', ')}`);

  const ghosts = [...censused].filter((s) => !slots.has(s));
  assert.deepEqual(ghosts, [], `il censimento cita slot che non esistono: ${ghosts.join(', ')}`);
});

// ── Ogni funzione censita ha davvero un posto dove impostarla ────────────────

test('la griglia delle Opzioni espone esattamente le funzioni del censimento', () => {
  const grid = Chain.actionLabels().map(([action]) => action);
  assert.deepEqual(
    grid,
    Usage.userActions(),
    'la lista di funzioni impostabili dalle Opzioni deve venire dal censimento, nello stesso ordine',
  );
});

test('ogni funzione della griglia ha un\'etichetta leggibile (non il codice interno)', () => {
  const I18n = globalThis.SN_I18N;
  const raw = [];
  for (const [action, key] of Chain.actionLabels()) {
    const label = I18n.t(key);
    if (!label || label === action) raw.push(action);
  }
  assert.deepEqual(raw, [], `funzioni che nelle Opzioni mostrerebbero il codice interno: ${raw.join(', ')}`);
});

// ── Il modello di indicizzazione è un modello di indicizzazione ──────────────

test('l\'indicizzazione dell\'archivio accetta solo modelli che producono vettori', () => {
  const Caps = globalThis.SN_MODEL_CAPS;
  const A = C.ACTIONS;
  const reg = C.DEFAULT_MODEL_REGISTRY;
  const embedRef = C.parseModelRefs(C.DEFAULT_MODELS[A.ARCHIVE_EMBED])[0];
  const embedEntry = reg[embedRef];
  assert.ok(embedEntry, `il modello di partenza dell'indicizzazione (${embedRef}) deve esistere nel registro`);

  // Il default è adatto…
  assert.equal(
    Caps.modelMatchesAction(embedEntry.provider, embedEntry.model, A.ARCHIVE_EMBED).ok,
    true,
  );
  // …e un modello di testo non lo è (altrimenti la ricerca semantica girerebbe
  // su un modello che non sa produrre vettori, fallendo a ogni scheda chiusa).
  // La voce del registro dichiara le sue modalità (testo → testo): con quelle
  // il controllo sa che non produce vettori. Senza dichiarazione un modello
  // del router resta "incerto" e non si blocca (vedi modelCaps).
  const textEntry = reg.deepseek;
  assert.equal(
    Caps.modelMatchesAction(textEntry.provider, textEntry.model, A.ARCHIVE_EMBED,
      C.entryModalities(textEntry, 'deepseek')).ok,
    false,
  );
  // Simmetrico: il modello di indicizzazione non può finire su una funzione di testo.
  assert.equal(
    Caps.modelMatchesAction(embedEntry.provider, embedEntry.model, A.EXPLAIN).ok,
    false,
  );
});

// ── Nessun nome di modello scritto nel codice ────────────────────────────────
//
// L'ultima rete: il censimento può restare completo solo se nessuno aggiunge
// una chiamata con un modello scritto a mano. Cerchiamo nomi di modello nelle
// stringhe di `src/`, saltando commenti e il file dove i modelli configurabili
// SONO i dati (il registro e il listino).

const ALLOWED_FILES = new Set([
  // Registro dei modelli configurabili, catene di default e listino prezzi: qui
  // i nomi dei modelli sono il DATO, e sono tutti sovrascrivibili (dall'utente
  // nelle Opzioni, da chi gestisce Filo nei modelli predefiniti).
  path.join('src', 'shared', 'constants.js'),
]);

const VENDOR_ID = /^(google|anthropic|openai|meta-llama|mistralai|deepseek|qwen|moonshotai|minimax|x-ai|z-ai)\/[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const BARE_ID = /^(gemini|gemma|claude|gpt|deepseek|qwen|kimi|llama|mistral|minimax|text-embedding)-[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function jsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(p, out);
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Toglie i commenti (blocco e riga) in modo grossolano ma sufficiente: i nomi di
// modello citati negli esempi dei commenti non sono usi reali.
//
// ⚠️ Il taglio va fatto su righe SENZA il ritorno a capo di Windows. In una
// regex JavaScript `.` non corrisponde a `\r` (è un terminatore di riga), quindi
// su un file con fine-riga CRLF — cioè quasi tutti, qui — `.*$` non arrivava mai
// in fondo e NESSUN commento veniva tolto. Il controllo sembrava funzionare solo
// perché era raro che un commento citasse un nome di modello.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

test('in src/ non ci sono nomi di modello scritti nel codice', () => {
  const found = [];
  for (const file of jsFiles(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file);
    if (ALLOWED_FILES.has(rel)) continue;
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    const literals = code.matchAll(/['"`]([^'"`\n]{3,80})['"`]/g);
    for (const m of literals) {
      const value = m[1];
      if (VENDOR_ID.test(value) || BARE_ID.test(value)) found.push(`${rel}: "${value}"`);
    }
  }
  assert.deepEqual(
    found,
    [],
    'un modello scelto dal codice non è impostabile da nessuno: prendilo dalla configurazione '
    + `(vedi src/shared/modelUsage.js). Trovati:\n${found.join('\n')}`,
  );
});

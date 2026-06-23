// Unit test per src/shared/capabilities.js — il manifesto delle capacità di
// Filo (F1). Verifica due cose:
//   1. integrità strutturale del manifesto e della sua API;
//   2. anti-stale: incrocia alcune voci col CODICE REALE (shortcut globali,
//      icone del menu, pagine filo://) così che, se una capacità sparisce o
//      cambia invocazione senza aggiornare il manifesto, il test diventi rosso.
// Pura logica → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'capabilities.js'));
const CAP = globalThis.SN_CAPABILITIES;

test('si registra su globalThis con la sua API', () => {
  assert.ok(CAP, 'SN_CAPABILITIES assente');
  for (const fn of ['index', 'get', 'byCategory', 'all']) {
    assert.equal(typeof CAP[fn], 'function', `manca ${fn}()`);
  }
  assert.ok(Array.isArray(CAP.CAPABILITIES) && CAP.CAPABILITIES.length > 0);
});

test('ogni voce ha i campi obbligatori e una categoria valida', () => {
  for (const c of CAP.CAPABILITIES) {
    for (const field of ['id', 'title', 'category', 'desc', 'invoke']) {
      assert.ok(c[field] && typeof c[field] === 'string', `voce ${c.id || c.title}: campo "${field}" mancante o non stringa`);
    }
    assert.ok(CAP.CATEGORIES[c.category], `voce ${c.id}: categoria sconosciuta "${c.category}"`);
    if (c.doesNot !== undefined) {
      assert.equal(typeof c.doesNot, 'string', `voce ${c.id}: doesNot deve essere stringa`);
    }
  }
});

test('gli id sono unici e stabili (kebab-case)', () => {
  const ids = CAP.CAPABILITIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'id duplicati nel manifesto');
  for (const id of ids) {
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `id non kebab-case: ${id}`);
  }
});

test('index() è compatto, get()/byCategory()/all() coerenti', () => {
  const idx = CAP.index();
  assert.equal(idx.length, CAP.CAPABILITIES.length);
  for (const e of idx) {
    assert.deepEqual(Object.keys(e).sort(), ['category', 'id', 'title']);
    assert.ok(CAP.get(e.id), `get(${e.id}) deve risolvere`);
  }
  assert.equal(CAP.get('id-inesistente'), undefined);
  assert.equal(CAP.all().length, CAP.CAPABILITIES.length);
  // all() torna una copia: mutarla non tocca l'originale.
  CAP.all().pop();
  assert.equal(CAP.all().length, CAP.CAPABILITIES.length);
});

// ── Anti-stale: incrocio col codice reale ────────────────────────────────────

test('ogni comando degli shortcut globali è coperto dal manifesto', () => {
  // shortcuts.js definisce i 4 comandi OS; ognuno deve esistere come capacità.
  const src = readFileSync(join(ROOT, 'src', 'main', 'shortcuts.js'), 'utf8');
  const commands = [...src.matchAll(/'(Alt\+[A-Z])':\s*'([a-z-]+)'/g)].map((m) => ({ accel: m[1], cmd: m[2] }));
  assert.ok(commands.length >= 4, 'mi aspetto almeno 4 shortcut globali');
  // Mappa comando-shortcut → id capacità che lo descrive.
  const cmdToCap = {
    'explain-selection': 'explain-selection',
    'translate-selection': 'translate-selection',
    'save-for-later': 'save-for-later',
    'open-help-sidebar': 'help-sidebar',
  };
  for (const { accel, cmd } of commands) {
    const capId = cmdToCap[cmd];
    assert.ok(capId, `shortcut ${accel} → comando "${cmd}" non mappato nel test: aggiorna manifesto+test`);
    const cap = CAP.get(capId);
    assert.ok(cap, `manca la capacità "${capId}" per lo shortcut ${accel} (${cmd})`);
    // l'invocazione deve citare lo shortcut, così il manifesto non mente su come si attiva.
    assert.ok(cap.invoke.includes(accel), `la capacità "${capId}" non cita lo shortcut ${accel} in invoke`);
  }
});

test('ogni pagina filo:// citata nel manifesto esiste davvero', () => {
  // Estrai i path filo://<area>/<file>.html dalle invocazioni/descrizioni.
  const refs = new Set();
  for (const c of CAP.CAPABILITIES) {
    for (const text of [c.invoke, c.desc]) {
      for (const m of text.matchAll(/filo:\/\/([a-z-]+)\/([a-z-]+\.html)/g)) {
        refs.add(`${m[1]}/${m[2]}`);
      }
    }
  }
  assert.ok(refs.size > 0, 'mi aspetto almeno una pagina filo:// citata');
  for (const ref of refs) {
    const [area, file] = ref.split('/');
    const p = join(ROOT, 'src', 'pages', area, file);
    assert.ok(existsSync(p), `il manifesto cita filo://${ref} ma ${p} non esiste`);
  }
});

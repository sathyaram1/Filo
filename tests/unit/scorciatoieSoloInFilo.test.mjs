// #838 — Nessuna combinazione Alt+lettera diventa scorciatoia di SISTEMA: su
// Windows e Linux Alt+lettera apre menu e schede negli altri programmi (Alt+H è
// la scheda Home di Word). Le scorciatoie di Filo valgono solo con Filo davanti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function senzaCommenti(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function fileJs(dir, acc = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) fileJs(p, acc);
    else if (/\.(c|m)?js$/.test(nome)) acc.push(p);
  }
  return acc;
}

// Un acceleratore con Alt (o Opzione) e una lettera come tasto finale.
function altLettera(accel) {
  const parti = accel.split('+').map((p) => p.trim().toLowerCase());
  return parti.length > 1 && /^[a-z]$/.test(parti[parti.length - 1])
    && parti.slice(0, -1).some((m) => /^(alt|option|opt)$/.test(m));
}

// Le registrazioni di scorciatoie di sistema di un sorgente che non passano la
// regola: Alt+lettera, o un tasto che da qui non si legge (una variabile).
function violazioni(src) {
  const s = senzaCommenti(src);
  if (!/\bglobalShortcut\b/.test(s)) return [];
  const out = [];
  if (/\{[^}]*\bregister(All)?\b[^}]*\}\s*=\s*(require\(\s*['"]electron['"]\s*\)\s*\.\s*)?globalShortcut\b/.test(s)) {
    out.push('register preso da globalShortcut con la destrutturazione: scrivi globalShortcut.register per esteso');
  }
  const nomi = new Set(['globalShortcut']);
  for (const m of s.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*(?:require\(\s*['"]electron['"]\s*\)\s*\.\s*)?globalShortcut\b/g)) nomi.add(m[1]);
  for (const m of s.matchAll(/\b(\w+)\s*\.\s*register(All)?\s*\(\s*([^,)]*)/g)) {
    if (!nomi.has(m[1])) continue;
    const arg = m[3].trim();
    const letterali = [...arg.matchAll(/'([^']*)'|"([^"]*)"|`([^`$]*)`/g)].map((x) => x[1] ?? x[2] ?? x[3]);
    const soloLetterali = arg.replace(/'[^']*'|"[^"]*"|`[^`$]*`|[\s,[\]]/g, '') === '';
    if (!letterali.length || !soloLetterali) out.push(`tasto non leggibile: ${m[0]}`);
    for (const a of letterali) if (altLettera(a)) out.push(`Alt+lettera di sistema: ${a}`);
  }
  return out;
}

test('la sentinella riconosce una scorciatoia di sistema Alt+lettera', () => {
  const electron = "const { globalShortcut } = require('electron');\n";
  assert.notDeepEqual(violazioni(`${electron}globalShortcut.register('Alt+E', () => {});`), []);
  assert.notDeepEqual(violazioni(`${electron}globalShortcut.register("Control+Alt+H", f);`), []);
  assert.notDeepEqual(violazioni(`${electron}globalShortcut.registerAll(['Alt+S'], f);`), []);
  assert.notDeepEqual(violazioni(`${electron}globalShortcut.register(reale, () => dispatch(c));`), []);
  assert.notDeepEqual(violazioni(`${electron}const gs = globalShortcut; gs.register('Option+T', f);`), []);
  assert.notDeepEqual(violazioni("const { register } = require('electron').globalShortcut;"), []);
  assert.deepEqual(violazioni(`${electron}globalShortcut.register('CommandOrControl+Shift+Space', f);`), []);
  assert.deepEqual(violazioni(`${electron}globalShortcut.register('Alt+F4', f);`), []);
  assert.deepEqual(violazioni("// globalShortcut.register('Alt+E')\nprotocol.register(x);"), []);
});

test('nessun sorgente registra Alt+lettera come scorciatoia di sistema', () => {
  const colpevoli = [];
  for (const f of fileJs(join(ROOT, 'src'))) {
    for (const v of violazioni(readFileSync(f, 'utf8'))) colpevoli.push(`${relative(ROOT, f)}: ${v}`);
  }
  assert.deepEqual(colpevoli, [],
    'una scorciatoia di sistema Alt+lettera la toglie agli altri programmi finché Filo è aperto:\n' + colpevoli.join('\n'));
});

test('le quattro scorciatoie scattano col tasto giusto su ogni sistema', () => {
  const { comandoDaTasto, COMMANDS } = require(join(ROOT, 'src', 'main', 'shortcuts.js'));
  const tasto = (key, mods = {}, altro = {}) => ({
    type: 'keyDown', key, code: `Key${key.toUpperCase()}`,
    alt: false, control: false, meta: false, shift: false, ...mods, ...altro,
  });
  for (const [accel, comando] of Object.entries(COMMANDS)) {
    const l = accel.split('+').pop().toLowerCase();
    assert.equal(comandoDaTasto(tasto(l, { alt: true }), 'win32'), comando, `${accel} su Windows`);
    assert.equal(comandoDaTasto(tasto(l, { alt: true }), 'linux'), comando, `${accel} su Linux`);
    assert.equal(comandoDaTasto(tasto(l, { alt: true, control: true }), 'darwin'), comando, `Ctrl+${accel} su Mac`);
    // Opzione+lettera su Mac scrive un accento: resta alla pagina.
    assert.equal(comandoDaTasto(tasto(l, { alt: true }), 'darwin'), null, `${accel} su Mac è un accento`);
    // AltGr su Windows è Ctrl+Alt: con la E scrive €.
    assert.equal(comandoDaTasto(tasto(l, { alt: true, control: true }), 'win32'), null, `AltGr+${l}`);
    assert.equal(comandoDaTasto(tasto(l, { alt: true, shift: true }), 'win32'), null, `Alt+Shift+${l}`);
    assert.equal(comandoDaTasto(tasto(l, { alt: true, meta: true }), 'darwin'), null, `Cmd+Opzione+${l}`);
    assert.equal(comandoDaTasto(tasto(l, { alt: true }, { type: 'keyUp' }), 'win32'), null, 'il rilascio non conta');
  }
  // Tastiera non latina o tasto morto: conta il tasto fisico.
  assert.equal(comandoDaTasto(tasto('у', { alt: true }, { code: 'KeyE' }), 'linux'), 'explain-selection');
  assert.equal(comandoDaTasto(tasto('Dead', { alt: true, control: true }, { code: 'KeyE' }), 'darwin'), 'explain-selection');
  assert.equal(comandoDaTasto(tasto('\u0005', { alt: true, control: true }, { code: 'KeyE' }), 'darwin'), 'explain-selection');
  // Layout diverso (Dvorak): il tasto fisico E scrive un punto, e Alt+. non è Spiega.
  assert.equal(comandoDaTasto(tasto('.', { alt: true }, { code: 'KeyE' }), 'win32'), null);
  assert.equal(comandoDaTasto(null, 'win32'), null);
});


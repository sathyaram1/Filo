// Sentinella per il riallineamento delle schede aperte dopo un import (#442).
//
// Ogni pagina interna si iscrive con
// `SN_PAGE_BOOTSTRAP.onDataImported(fn, [chiavi])`: le chiavi sono le sezioni di
// storage che quella pagina mostra, e servono a non ridisegnarla per un import
// che non la riguarda. Il guasto silenzioso è ovvio: se una chiave si scrive
// male (o viene rinominata in `constants.js`), il filtro non combacia più, la
// pagina smette di riallinearsi e NIENTE diventa rosso — torna esattamente il
// sintomo di #442, ma solo per quella pagina.
//
// Qui pretendiamo che ogni chiave scritta nelle pagine esista davvero: o è un
// valore di `SN_CONST.STORAGE_KEYS`, o è una delle chiavi dichiarate qui sotto
// con il motivo per cui non sta lì. E che il canale sia agganciato dove deve:
// il tipo del messaggio in `pageBootstrap.js` deve combaciare con
// `MSG.DATA_IMPORTED`, altrimenti l'iscrizione è muta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PAGES = join(ROOT, 'src', 'pages');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'messages.js'));
const STORAGE_KEYS = globalThis.SN_CONST.STORAGE_KEYS;
const MSG = globalThis.SN_MSG.MSG;

// Chiavi legittime che NON stanno in STORAGE_KEYS, con il perché.
const EXTRA_KEYS = new Set([
  // L'editor tiene la collezione e lo storico versioni sotto un nome suo,
  // rispecchiato su chrome.storage (e quindi dentro l'export). Vedi editor.js.
  'filo.editor.collection',
  'filo.editor.versions',
]);

const KNOWN = new Set([...Object.values(STORAGE_KEYS), ...EXTRA_KEYS]);

function pageScripts() {
  const out = [];
  for (const dir of readdirSync(PAGES)) {
    const full = join(PAGES, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const f of readdirSync(full)) {
      if (f.endsWith('.js')) out.push(join(full, f));
    }
  }
  return out;
}

// Estrae le liste di chiavi passate a onDataImported(fn, [...]) — anche quando
// la lista contiene identificatori (STORAGE_KEYS.X, COLLECTION_KEY), che qui
// vengono risolti al loro valore.
function keyListsIn(source) {
  const lists = [];
  const re = /onDataImported\s*\(/g;
  let m;
  while ((m = re.exec(source))) {
    // Ritaglia la chiamata bilanciando le parentesi.
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
    }
    const call = source.slice(m.index + m[0].length, i - 1);
    const arr = /\[([^\]]*)\]/.exec(call);
    if (!arr) continue;
    const items = arr[1]
      .split(',')
      .map((s) => s.replace(/\/\/.*$/m, '').trim())
      .filter(Boolean);
    lists.push(items);
  }
  return lists;
}

// Risolve un elemento della lista nel valore di chiave che avrà a runtime.
function resolveKey(item, source) {
  const literal = /^'([^']*)'$|^"([^"]*)"$/.exec(item);
  if (literal) return literal[1] ?? literal[2];
  const viaConst = /^STORAGE_KEYS\.([A-Z_0-9]+)$/.exec(item);
  if (viaConst) return STORAGE_KEYS[viaConst[1]];
  // Costante locale della pagina: `const NOME = 'valore';`
  const local = new RegExp(`const\\s+${item.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*=\\s*'([^']+)'`).exec(source);
  if (local) return local[1];
  return null;
}

test('#442 — le chiavi su cui le pagine filtrano l\'import esistono davvero', () => {
  let checked = 0;
  for (const file of pageScripts()) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('onDataImported')) continue;
    for (const list of keyListsIn(source)) {
      for (const item of list) {
        const key = resolveKey(item, source);
        assert.ok(
          key,
          `${file}: non riesco a risolvere la chiave \`${item}\` passata a onDataImported`);
        assert.ok(
          KNOWN.has(key),
          `${file}: onDataImported filtra su "${key}", che non è una sezione di storage nota. `
          + 'Una chiave sbagliata non dà errore: la pagina smette e basta di riallinearsi dopo un import.');
        checked++;
      }
    }
  }
  // Se il conteggio va a zero qualcuno ha smontato il meccanismo (o cambiato il
  // nome della funzione) e questo test sarebbe diventato verde per finta.
  assert.ok(checked >= 10, `troppo poche chiavi controllate (${checked}): il meccanismo di #442 è sparito?`);
});

test('#442 — almeno le superfici citate nel feedback si riallineano', () => {
  // Pagine salvate, cronologia AI e archivio: sono le tre liste che l'utente
  // aveva aperte quando ha segnalato. Se una perde l'iscrizione, torna il bug.
  for (const [page, key] of [
    ['home/home.js', STORAGE_KEYS.SAVED_PAGES],
    ['history/history.js', STORAGE_KEYS.HISTORY],
    ['archive/archive.js', STORAGE_KEYS.ARCHIVED_TABS],
  ]) {
    const source = readFileSync(join(PAGES, page), 'utf8');
    const keys = keyListsIn(source).flat().map((i) => resolveKey(i, source));
    assert.ok(
      keys.includes(key),
      `${page} non si riallinea più su "${key}" dopo un import (feedback #442)`);
  }
});

test('#442 — il tipo del messaggio in pageBootstrap combacia con MSG.DATA_IMPORTED', () => {
  // pageBootstrap.js è caricato prima di messages.js e scrive il tipo a mano:
  // se i due divergono l'iscrizione resta muta senza che nulla lo dica.
  const boot = readFileSync(join(ROOT, 'src', 'shared', 'pageBootstrap.js'), 'utf8');
  const m = /const\s+DATA_IMPORTED\s*=\s*'([^']+)'/.exec(boot);
  assert.ok(m, 'pageBootstrap.js non dichiara più il tipo del messaggio di import');
  assert.equal(m[1], MSG.DATA_IMPORTED);
});

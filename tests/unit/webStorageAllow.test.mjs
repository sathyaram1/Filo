// #592, giro 8 — cosa una pagina web può toccare nello storage di Filo.
//
// Il canale generico dello storage risponde sia alle pagine interne sia agli
// script che Filo fa girare dentro le pagine visitate, e difendeva UNA chiave
// sola: quella delle impostazioni. Tutto il resto passava, e lì dentro c'è la
// memoria di Filo (una riga scritta da fuori entra in ogni prompt, vale in ogni
// conversazione e sopravvive al riavvio), il registro delle azioni che finisce
// nel contesto di ogni messaggio, la cronologia delle conversazioni e quella di
// quello che l'utente ha copiato.
//
// Adesso l'elenco è di ciò che è LECITO, quindi una chiave nuova nasce vietata
// alle pagine web. Questa sentinella tiene due cose:
//   • l'elenco NON contiene niente della memoria, del contesto o delle
//     cronologie — se qualcuno ce lo rimette, qui diventa rosso;
//   • ogni chiave che gli script delle pagine visitate usano davvero STA
//     nell'elenco — se qualcuno ne aggiunge una lì, il correttore o il menu
//     smetterebbero di funzionare in silenzio, e qui invece si vede.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const radice = join(__dirname, '..', '..');
require(join(radice, 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;
const K = C.STORAGE_KEYS;

test('l\'elenco non contiene la memoria, il contesto del prompt né le cronologie', () => {
  const vietate = [
    K.FILO_MEMORY, K.FILO_LESSONS_BUFFER, K.FILO_RAW_LOG, K.FILO_DASHBOARD_CACHE,
    K.FILO_NOTIFICATIONS, K.FILO_TIMERS, K.FILO_NOTES, K.FILO_SESSION,
    K.HISTORY, K.CLIPBOARD_HISTORY, K.SAVED_PAGES, K.ARCHIVED_TABS,
    K.COSTS, K.CREDITS, K.FILO_ONBOARDING, K.FILO_TERMINAL_CWD, K.FILO_PROXY_RULES,
    K.AUTO_MODE, K.BLOCKLIST,
  ];
  for (const chiave of vietate) {
    assert.ok(chiave, 'chiave inesistente: la prova non sta provando niente');
    assert.equal(C.WEB_STORAGE_READABLE.has(chiave), false, `leggibile da una pagina web: ${chiave}`);
    assert.equal(C.WEB_STORAGE_WRITABLE.has(chiave), false, `scrivibile da una pagina web: ${chiave}`);
  }
});

test('le impostazioni si leggono ma non si scrivono da una pagina web', () => {
  assert.equal(C.WEB_STORAGE_READABLE.has(K.SETTINGS), true);
  assert.equal(C.WEB_STORAGE_WRITABLE.has(K.SETTINGS), false);
});

test('quello che gli script delle pagine visitate usano davvero sta nell\'elenco', () => {
  // Le chiavi si leggono dal CODICE degli script, non da una lista scritta a
  // mano qui: una lista a mano invecchia in silenzio, ed è esattamente il
  // difetto che questo elenco corregge.
  const dir = join(radice, 'src', 'content');
  const usate = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(dir, file), 'utf8');
    if (!/chrome\.storage\.local\.(get|set|remove)/.test(src)) continue;
    // Nomi di chiave scritti per esteso ('sn_feedback_draft_text').
    for (const m of src.matchAll(/['"](sn_[a-z0-9_]+|filo_[a-z0-9_]+)['"]/g)) usate.add(m[1]);
    // Chiavi prese da STORAGE_KEYS (STORAGE_KEYS.PERSONAL_DICT).
    for (const m of src.matchAll(/STORAGE_KEYS\.([A-Z0-9_]+)/g)) {
      if (K[m[1]]) usate.add(K[m[1]]);
    }
  }
  assert.ok(usate.size >= 5, `trovate solo ${usate.size} chiavi negli script: la prova non sta provando niente`);

  // `settings` la leggono in tanti e sta nell'elenco in sola lettura.
  const fuori = [...usate].filter((k) => !C.WEB_STORAGE_READABLE.has(k));
  assert.deepEqual(
    fuori, [],
    `chiavi usate dagli script delle pagine visitate ma non ammesse: ${fuori.join(', ')}`,
  );
});

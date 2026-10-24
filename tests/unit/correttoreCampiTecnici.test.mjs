// #1447 — le caselle di Filo che tengono elenchi di siti (un dominio per riga) dicono al correttore di non toccarle:
// la correzione automatica metterebbe la maiuscola ai marchi («facebook» → «Facebook»).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leggi = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('le caselle di siti della pagina Sicurezza hanno spellcheck="false"', () => {
  const html = leggi('src/pages/security/security.html');
  for (const id of ['sec-siteblock-blacklist', 'sec-dl-trusted', 'sec-delicate-sites']) {
    const tag = html.match(new RegExp(`<textarea[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `manca la casella ${id}`);
    assert.match(tag[0], /spellcheck="false"/, `${id} senza spellcheck="false"`);
  }
});

test('gli elenchi dei siti delicati in Gestione non si correggono', () => {
  assert.match(leggi('src/pages/manage/managePredefiniti.js'), /ta\.dataset\.categoria = k;\s*ta\.spellcheck = false;/);
});

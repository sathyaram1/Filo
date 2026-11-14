// Ogni capacità del manifesto ha lo strumento della chat che ci arriva (SPEC-CONTESTO § Gli strumenti: quello che
// l'utente fa in Filo lo fa anche Filo), e quello strumento esiste davvero. La mappa sta in src/shared/capabilities.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/capabilities.js');
require('../../src/shared/actionTools.js');
const Caps = globalThis.SN_CAPABILITIES;
const Tools = globalThis.SN_ACTION_TOOLS;

test('ogni capacità ha il suo strumento, e ogni strumento della mappa esiste', () => {
  const ids = Caps.CAPABILITIES.map((c) => c.id);
  for (const id of ids) {
    const s = Caps.STRUMENTO[id];
    assert.ok(s, `${id}: nessuno strumento ci arriva`);
    const m = /^([a-z_]+)\(([a-z_]+)\)$/.exec(s);
    assert.ok(m, `${id}: «${s}» non è strumento(azione)`);
    assert.ok(Tools.AZIONI[m[1]] && Tools.AZIONI[m[1]][m[2]], `${id}: ${s} non esiste`);
  }
  for (const id of Object.keys(Caps.STRUMENTO)) assert.ok(ids.includes(id), `la mappa nomina ${id}, che il manifesto non ha`);
});

test('il dettaglio di una capacità dice al modello con quale strumento ci arriva', () => {
  assert.match(Caps.renderDetailForPrompt(['page-zoom']), /Dalla chat: scheda\(zoom\)\./);
  assert.match(Caps.renderDetailForPrompt(['drag-tab']), /Dalla chat: nessuno strumento la comanda/);
});

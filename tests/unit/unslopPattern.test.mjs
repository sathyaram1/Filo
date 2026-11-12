// #1484: la skill unslop riconosce gli annunci di importanza («e la differenza conta») e numera i pattern senza buchi,
// così chi ne aggiunge uno in mezzo non lascia due «12.» o un salto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = readFileSync(join(ROOT, '.claude', 'skills', 'unslop', 'SKILL.md'), 'utf8');
const PATTERN = SKILL.slice(SKILL.indexOf('## Pattern da individuare'));
const voci = [...PATTERN.matchAll(/^(\d+)\. (.*)$/gm)];

test('i pattern di unslop sono numerati da 1 senza salti né doppioni', () => {
  assert.ok(voci.length > 20, `trovati solo ${voci.length} pattern: la sezione è cambiata nome?`);
  assert.deepEqual(voci.map((v) => Number(v[1])), voci.map((_, i) => i + 1));
});

test('gli annunci di importanza stanno accanto a «Enfasi vuota», con almeno tre esempi e la correzione', () => {
  const i = voci.findIndex((v) => /^Annunci di importanza\./.test(v[2]));
  assert.ok(i >= 0, 'manca il pattern degli annunci di importanza');
  assert.match(voci[i - 1]?.[2] ?? '', /^Enfasi vuota\./);
  const riga = voci[i][2];
  const esempi = ['e la differenza conta', 'ecco il punto', 'questo cambia tutto', 'non è un dettaglio'];
  assert.ok(esempi.filter((e) => riga.includes(`"${e}"`)).length >= 3, riga);
  assert.match(riga, /Tagliala, o scrivi in cosa consiste la differenza/);
});

// #1567: la descrizione della skill si richiama solo se la sessione lo decide; CLAUDE.md, caricato sempre, deve dire
// anche lui che unslop vale per ogni risposta in chat.
test('CLAUDE.md lega unslop anche alle risposte in chat, e «cosa tenere» viene prima dei pattern', () => {
  const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  const paragrafi = md.split(/\n\s*\n/).filter((p) => p.includes('skills/unslop/SKILL.md'));
  assert.ok(paragrafi.some((p) => /ogni risposta in chat/.test(p)), paragrafi.join('\n---\n'));
  const tenere = SKILL.indexOf('## Prima di tutto: cosa tenere');
  assert.ok(tenere > 0 && tenere < SKILL.indexOf('## Pattern da individuare'), 'manca la sezione «cosa tenere» prima dei pattern');
});

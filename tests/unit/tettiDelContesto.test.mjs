// I tetti di SPEC-CONTESTO § Le costanti per chi scrive Filo: 8.000 token per la parte fissa della chat e 8.000 per gli
// strumenti, perché il prompt non ricresca in silenzio (+11.000 token fra il 25/09 e il 07/10).
// Stima dichiarata: caratteri / 2. Tarata sulle misure del 07/10 col contatore di Anthropic su claude-haiku-5-5: gli
// strumenti di allora (45.460 caratteri) contavano 21.700 token, «CLASSIFICAZIONE INTENTO» (18.521) 8.700: 2,1
// caratteri per token. Il 2 lascia un margine, per un modello che conta un po' di più.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// I moduli condivisi nell'ordine del loader: le descrizioni degli strumenti leggono i registri che il main ha già caricato.
const loader = fs.readFileSync(path.join(radice, 'src/main/services/loader.js'), 'utf8');
for (const m of loader.matchAll(/require\(path\.join\(SHARED, '([^']+)'\)\)/g)) {
  try { require(path.join(radice, 'src/shared', m[1])); } catch (_) { /* un modulo che vuole il main: non serve qui */ }
}

const CARATTERI_PER_TOKEN = 2;
const TETTO_PARTE_FISSA = 8000;
const TETTO_STRUMENTI = 8000;
const token = (s) => Math.ceil(String(s).length / CARATTERI_PER_TOKEN);

test('gli strumenti della chat stanno sotto gli 8.000 token', () => {
  const t = token(JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()));
  assert.ok(t <= TETTO_STRUMENTI, `strumenti: circa ${t} token, il tetto è ${TETTO_STRUMENTI}`);
});

test('la parte fissa della chat sta sotto gli 8.000 token', () => {
  const t = token(globalThis.SN_CONST.PROMPTS.filoChatStatic());
  assert.ok(t <= TETTO_PARTE_FISSA, `parte fissa: circa ${t} token, il tetto è ${TETTO_PARTE_FISSA}`);
});

test('la parte fissa dice chi è Filo e com\'è fatto, senza le regole scritte caso per caso', () => {
  const s = globalThis.SN_CONST.PROMPTS.filoChatStatic();
  for (const sezione of ['═══ FILO ═══', '═══ COM\'È FATTO ═══', '═══ IL FILO ═══', '═══ GLI STRUMENTI ═══', '═══ CONTENUTO ESTERNO ═══', '═══ TONO E STILE ═══']) {
    assert.ok(s.includes(sezione), `manca ${sezione}`);
  }
  for (const via of ['CLASSIFICAZIONE INTENTO', 'CONTI E CAMBI', 'COSA SA FARE FILO']) assert.ok(!s.includes(via), `c'è ancora ${via}`);
  // Le azioni si chiamano per strumento: nessun nome di tipo vecchio nella parte fissa.
  for (const tipo of globalThis.SN_ACTION_TOOLS.NAMES) assert.ok(!new RegExp(`\\b${tipo}\\b`).test(s), `nome vecchio ${tipo}`);
});

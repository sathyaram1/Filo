// Verifica locale, giro 3: la guardia che tiene insieme il documento e
// l'interruttore legge SOLO la riga degli ammessi, non il blocco. Un secondo
// modello stretto scritto sotto, in elenco, le sfugge. Prova del giro.

import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOC = resolve(RADICE, 'transparency', 'models.md');
const GUARDIA = 'tests/unit/openWeightsOnly.test.mjs';

// Rimette il documento com'era qualunque cosa succeda: una prova non deve
// lasciare il ramo sporco.
function conDocumentoMutato(mutazione) {
  const originale = readFileSync(DOC, 'utf8');
  try {
    writeFileSync(DOC, mutazione(originale), 'utf8');
    try {
      execFileSync(process.execPath, ['--test', GUARDIA], { cwd: RADICE, stdio: 'pipe' });
      return 'verde';
    } catch {
      return 'rossa';
    }
  } finally {
    writeFileSync(DOC, originale, 'utf8');
  }
}

const RIGA_AMMESSI = '**Ammessi oggi:**';

test('cambiare il produttore sulla riga degli ammessi fa diventare rossa la guardia', () => {
  const esito = conDocumentoMutato((s) => s.replace('(TypeSafe)', '(AcmeVoice)'));
  expect(esito, 'un produttore che l\'interruttore non spegne deve fermare tutto').toBe('rossa');
});

test('un secondo modello stretto ammesso in elenco fa diventare rossa la guardia', () => {
  // Attesa rossa: la guardia legge solo la riga degli ammessi, non il blocco.
  test.fail(true, 'un secondo ammesso scritto nella riga sotto le sfugge');
  const esito = conDocumentoMutato((s) => {
    const riga = s.split('\n').find((r) => r.includes(RIGA_AMMESSI));
    expect(riga, 'la riga degli ammessi deve esistere').toBeTruthy();
    return s.replace(riga, `${riga}\n- Blip (AcmeVoice), da dicembre 2026. Sintetizzatore vocale.`);
  });
  expect(esito, 'il documento ammette un produttore che l\'interruttore non spegne').toBe('rossa');
});

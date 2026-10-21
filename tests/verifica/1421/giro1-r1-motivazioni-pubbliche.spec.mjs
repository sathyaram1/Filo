// Verifica #1421 giro 1: le motivazioni delle risposte OpenSSF si incollano così come sono e diventano pubbliche,
// quindi non portano promemoria per l'owner né affermazioni che valgono solo dopo un lavoro non ancora fatto.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const doc = readFileSync(join(process.cwd(), 'OPENSSF-BEST-PRACTICES.md'), 'utf8');
const motivazione = (criterio) => {
  const riga = doc.split('\n').find((r) => r.startsWith(`| ${criterio} |`));
  return riga ? riga.split('|')[4].trim() : '';
};

test('r1 static_analysis_fixed e no_leaked_credentials: motivazioni pubblicabili, senza note per chi invia', () => {
  for (const c of ['static_analysis_fixed', 'no_leaked_credentials']) {
    const m = motivazione(c);
    expect(m, c).not.toBe('');
    expect(m, `${c}: la motivazione pubblica contiene una nota per l'owner`).not.toMatch(/da ricontrollare|Vale quando/i);
  }
});

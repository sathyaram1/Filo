// Verifica #1867, giro 1, rilievo 2: Grep con le righe dentro la memoria o le abilità della cartella di Claude sporca il
// biglietto, mentre leggere gli stessi file con Read lo lascia pulito.
import { test, expect } from './../../fixtures/electron.mjs';
import { motivoLettura } from '../../../scripts/lib/letture-esterne.mjs';

const CASA = '/home/o';
const ctx = { cwd: '/casa/Filo', cartelle: ['/casa/Filo'], file: [], claude: [`${CASA}/.claude`], sessione: 'sess-1' };
const motivo = (tool_name, tool_input) => motivoLettura({ tool_name, tool_input }, ctx);

test('r2 cercare con le righe nella memoria del progetto lascia pulito il biglietto, come leggerla', () => {
  const memoria = `${CASA}/.claude/projects/-casa-Filo/memory`;
  expect(motivo('Read', { file_path: `${memoria}/MEMORY.md` })).toBe('');
  expect(motivo('Grep', { pattern: 'fiducia', path: memoria, output_mode: 'content' })).toBe('');
  expect(motivo('Grep', { pattern: 'fiducia', path: `${memoria}/`, output_mode: 'content', '-n': true })).toBe('');
});

test('r2 cercare con le righe nelle abilità e nei comandi dell’owner lascia pulito il biglietto, come leggerli', () => {
  for (const cartella of ['skills', 'commands']) {
    expect(motivo('Read', { file_path: `${CASA}/.claude/${cartella}/posta/SKILL.md` })).toBe('');
    expect(motivo('Grep', { pattern: 'x', path: `${CASA}/.claude/${cartella}`, output_mode: 'content' }), cartella).toBe('');
  }
});

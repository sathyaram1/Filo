// Verifica #1867, giro 3, rilievo 1: il testo di un'estensione di terzi entra senza sporcare quando la sessione ne
// richiama l'agente per nome, mentre l'abilità della stessa estensione sporca già. Nessun Electron.
import { test, expect } from './../../fixtures/electron.mjs';
import { motivoLettura } from '../../../scripts/lib/letture-esterne.mjs';

const CTX = { cwd: '/casa/u/Filo', casa: '/casa/u', cartelle: ['/casa/u/Filo'], file: [], claude: ['/casa/u/.claude'], sessione: 'S1' };

test('r1 l’agente di un’estensione di terzi richiamato per nome sporca come la sua abilità', () => {
  const abilita = motivoLettura({ tool_name: 'Skill', tool_input: { skill: 'estensione-terzi:revisore' } }, CTX);
  expect(abilita, 'premessa: l’abilità dell’estensione sporca').not.toBe('');
  const agente = motivoLettura({ tool_name: 'Agent', tool_input: { subagent_type: 'estensione-terzi:revisore', prompt: 'rivedi' } }, CTX);
  expect(agente, 'il prompt dell’agente lo scrive l’estensione: deve sporcare').not.toBe('');
  const proprio = motivoLettura({ tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'cerca' } }, CTX);
  expect(proprio, 'un agente di Claude Code resta pulito').toBe('');
});

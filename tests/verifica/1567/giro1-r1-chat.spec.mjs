// #1567 giro 1: la regola «unslop vale per ogni risposta in chat» deve stare nelle istruzioni che ogni sessione
// carica da sé, non solo nella descrizione della skill, che la sessione richiama solo se decide di farlo.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 le istruzioni sempre caricate legano unslop anche alle risposte in chat', () => {
  const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  const paragrafi = md.split(/\n\s*\n/).filter((p) => p.includes('skills/unslop/SKILL.md'));
  expect(paragrafi.length).toBeGreaterThan(0);
  expect(paragrafi.some((p) => /risposta in chat|risposte in chat|in chat/i.test(p)), paragrafi.join('\n---\n')).toBe(true);
});

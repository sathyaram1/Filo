// #1211.2 giro 1 — letture fuori dal repo che lasciano pulito il biglietto della sessione locale. Logica pura: non apre Filo.
import { test, expect } from '@playwright/test';
import { homedir } from 'node:os';
import path from 'node:path';
import * as L from '../../../scripts/lib/letture-esterne.mjs';

const REPO = path.resolve(import.meta.dirname, '../../..');
const ctx = () => L.contestoLettura({ cwd: REPO, env: { CLAUDE_PROJECT_DIR: REPO } });

test('r1 Grep col contenuto di un file fuori dal repo sporca come Read dello stesso file', () => {
  const fuori = path.join(homedir(), 'Downloads', 'pagina-scaricata.html');
  expect(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: fuori } }, ctx())).not.toBe('');
  const grep = { tool_name: 'Grep', tool_input: { pattern: '.', path: fuori, output_mode: 'content' } };
  expect(L.motivoLettura(grep, ctx())).not.toBe('');
});

test('r2 il resoconto di un\'altra sessione e i cataloghi di estensioni nella cartella di Claude sporcano', () => {
  const resoconto = path.join(homedir(), '.claude', 'projects', '-altro-progetto', 'sessione.jsonl');
  const catalogo = path.join(homedir(), '.claude', 'plugins', 'marketplaces', 'di-terzi', 'README.md');
  expect(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: resoconto } }, ctx())).not.toBe('');
  expect(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: catalogo } }, ctx())).not.toBe('');
});

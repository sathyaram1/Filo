// Verifica #1867, giro 2, rilievo 1: Read e Grep di Claude Code leggono «~/…» dalla cartella di casa, il gancio delle
// letture lo prende per un percorso dentro il repo e il biglietto resta pulito. Nessun Electron.
import { test, expect } from './../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import * as B from '../../../scripts/lib/biglietto-locale.mjs';
import * as L from '../../../scripts/lib/letture-esterne.mjs';

function sessione() {
  const dir = cartellaTemporanea('filo-1867-tilde-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  B.scriviFile(join(B.cartellaBiglietti(dir), 'sess.json'), { ticket: `t-${'a'.repeat(40)}`, fp: 'f'.repeat(64), natoIl: 1 });
  return dir;
}

const chiama = (dir, tool_name, tool_input) => L.gancio({
  input: { session_id: 'sess', cwd: dir, tool_name, tool_input },
  env: { CLAUDE_PROJECT_DIR: dir }, avvia: () => {}, nowMs: 5,
});

test('r1 Grep con le righe di una pagina nei Download scritta come ~/Downloads sporca il biglietto', () => {
  const r = chiama(sessione(), 'Grep', { pattern: 'prezzo', path: '~/Downloads/pagina.html', output_mode: 'content' });
  expect(r.esito, JSON.stringify(r)).toBe('annotato');
});

test('r1 Read della pagina nei Download scritta come ~/Downloads sporca il biglietto', () => {
  const r = chiama(sessione(), 'Read', { file_path: '~/Downloads/pagina.html' });
  expect(r.esito, JSON.stringify(r)).toBe('annotato');
});

test('r1 Read del resoconto di un\'altra sessione scritto come ~/.claude/projects sporca il biglietto', () => {
  const r = chiama(sessione(), 'Read', { file_path: '~/.claude/projects/-altro/altra-sessione.jsonl' });
  expect(r.esito, JSON.stringify(r)).toBe('annotato');
});

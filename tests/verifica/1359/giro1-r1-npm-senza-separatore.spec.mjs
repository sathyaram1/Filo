// Verifica #1359, giro 1: r1, un testo a elenco puntato passato da npm senza il separatore (come lo consegna una
// conchiglia che si mangia il `--`): npm lo toglie prima dello strumento, e il rifiuto non dice perché.

import '../../helpers/senzaSessione.mjs';
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

test('r1 da npm senza separatore, il testo a elenco puntato sparisce: chi scrive deve sapere perché e come passarlo', async () => {
  // Quello che npm consegna allo strumento quando il `--` non arriva.
  const casa = cartellaTemporanea('filo-npm-elenco-');
  let consegnati;
  try {
    writeFileSync(resolve(casa, 'argomenti.js'), 'console.log(JSON.stringify(process.argv.slice(2)))\n', 'utf8');
    writeFileSync(resolve(casa, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', scripts: { 'feedback:apri': 'node argomenti.js' } }), 'utf8');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const out = execFileSync(npm, ['run', '-s', 'feedback:apri', 'Titolo', '- primo punto', '--non-locale'], { cwd: casa, encoding: 'utf8', shell: process.platform === 'win32' });
    consegnati = JSON.parse(out.trim().split('\n').pop());
  } finally { togliCartella(casa); }
  expect(consegnati).toEqual(['Titolo']);

  const SCRIPT = await import('../../../scripts/claude-feedback.mjs');
  SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-test' });
  SCRIPT.ambiente.routine = () => false;
  const FB = globalThis.SN_FEEDBACK;
  const orig = FB.submit;
  FB.submit = async () => ({ id: 'd', seq: 9 });
  const err = console.error;
  const righe = [];
  console.error = (...a) => righe.push(a.join(' '));
  process.env.npm_lifecycle_event = 'feedback:apri';
  try {
    await SCRIPT.main([...consegnati, '--non-locale']);
  } finally { FB.submit = orig; console.error = err; delete process.env.npm_lifecycle_event; }
  const detto = righe.join('\n');
  // Oggi risponde solo «testo mancante»: chi ha scritto il testo non sa che npm se l'è preso per via del trattino.
  expect(detto).toMatch(/trattin/i);
});

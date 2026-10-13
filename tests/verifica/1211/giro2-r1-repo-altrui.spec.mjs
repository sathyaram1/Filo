// #1211 giro 2 — la sessione spostata in un altro repo git (non il progetto) che ne legge un file deve sporcare il
// biglietto: è una lettura fuori dal repo del progetto.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gancio } from '../../../scripts/lib/letture-esterne.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const SESSIONE = 'verifica1211g2';

function repo(prefisso) {
  const r = cartellaTemporanea(prefisso);
  execFileSync('git', ['init', '-q'], { cwd: r });
  return r;
}

test('r1 un file di un altro repo letto con la cartella corrente dentro quel repo sporca il biglietto', () => {
  const progetto = repo('v1211g2-progetto-');
  mkdirSync(join(progetto, '.claude', 'biglietti'), { recursive: true });
  writeFileSync(join(progetto, '.claude', 'biglietti', `${SESSIONE}.json`), JSON.stringify({ ticket: 'a'.repeat(40), fp: 'b'.repeat(64), natoIl: 1 }));
  const altrui = repo('v1211g2-altrui-');
  writeFileSync(join(altrui, 'README.md'), 'testo scritto da altri\n');
  const env = { ...process.env, CLAUDE_PROJECT_DIR: progetto, FILO_FUNCTIONS_BASE: 'http://127.0.0.1:9' };
  for (const k of ['FILO_ROUTINE', 'FILO_BIGLIETTO_FILE', 'CLAUDE_CODE_SESSION_ID']) delete env[k];
  const r = gancio({
    input: { session_id: SESSIONE, cwd: altrui, tool_name: 'Read', tool_input: { file_path: join(altrui, 'README.md') } },
    env,
    avvia: () => {},
  });
  expect(r.esito, JSON.stringify(r)).toBe('annotato');
  let annotate = [];
  try { annotate = readdirSync(join(progetto, '.claude', 'biglietti', 'sporchi', 'b'.repeat(64))).filter((n) => n.endsWith('.json')); } catch (_) { /* nessuna */ }
  expect(annotate.length).toBe(1);
});

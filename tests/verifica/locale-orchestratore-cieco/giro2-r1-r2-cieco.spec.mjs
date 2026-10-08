// Verifica locale, giro 2: l'orchestratore di un giro non deve ricevere il testo dei worker.
// r1: un worker ostile toglie o riscrive il segnale nella cartella del progetto e il testo torna a passare.
// r2: un lancio senza dire primo piano o sottofondo non viene fermato ne portato in primo piano.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const RADICE = resolve(import.meta.dirname, '..', '..', '..');
const impostazioni = JSON.parse(readFileSync(join(RADICE, '.claude', 'settings.local.json'), 'utf8'));
const comando = (evento) => impostazioni.hooks[evento].find((h) => h.matcher === 'Agent|Task').hooks[0].command;
const SESSIONE = 'sessione-orchestratore';

function gancio(evento, root, input) {
  const out = execFileSync('bash', ['-c', comando(evento)], {
    input: JSON.stringify({ hook_event_name: evento, session_id: SESSIONE, cwd: root, ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SESSIONE },
    encoding: 'utf8',
  });
  return out.trim() ? JSON.parse(out) : null;
}

// Il segnale come lo scrive oggi la prontezza del giro: se la cura lo sposta, si sposta questa riga.
function apriGiro(root) {
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'routine-orchestratore.json'), JSON.stringify({ sessione: SESSIONE, creato: Date.now() }));
}

const fine = { tool_name: 'Agent', tool_input: { subagent_type: 'routine-worker', prompt: 'p' }, tool_response: 'TESTO OSTILE DEL WORKER' };
const testoPassa = (o) => !o || !JSON.stringify(o).includes('updatedToolOutput');

let root;
test.beforeEach(() => { root = cartellaTemporanea('cieco-'); apriGiro(root); });
test.afterEach(() => togliCartella(root));

test('controllo: a giro aperto il testo del worker non passa', () => {
  expect(testoPassa(gancio('PostToolUse', root, fine))).toBe(false);
});

test('r1 il worker cancella il segnale prima di finire: il testo resta fuori', () => {
  rmSync(join(root, '.claude', 'routine-orchestratore.json'), { force: true });
  expect(existsSync(join(root, '.claude', 'routine-orchestratore.json'))).toBe(false);
  expect(testoPassa(gancio('PostToolUse', root, fine))).toBe(false);
});

test('r1 il worker riscrive il segnale con un altra sessione: il testo resta fuori', () => {
  writeFileSync(join(root, '.claude', 'routine-orchestratore.json'), JSON.stringify({ sessione: 'altra', creato: Date.now() }));
  expect(testoPassa(gancio('PostToolUse', root, fine))).toBe(false);
});

test('r2 lancio senza indicare primo piano: fermato o portato in primo piano', () => {
  const o = gancio('PreToolUse', root, { tool_name: 'Agent', tool_input: { subagent_type: 'routine-worker', prompt: 'p' } });
  const h = o?.hookSpecificOutput || {};
  const fermato = h.permissionDecision === 'deny';
  const primoPiano = h.updatedInput && h.updatedInput.run_in_background === false;
  expect(fermato || primoPiano).toBe(true);
});

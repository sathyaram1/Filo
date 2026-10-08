// Orchestratore cieco: nel thread principale di un giro di routine il testo di
// ritorno di un worker non entra nel contesto, e un worker in sottofondo non parte.
// Inerte fuori da un giro (niente marcatore) e dentro i sotto-agenti (agent_id). Regole: tests/unit/orchestratoreCieco.test.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARCATORE = join('.claude', 'routine-orchestratore.json');
// Un marcatore lasciato da un preflight lanciato a mano non deve accecare per sempre le sessioni locali.
export const VALIDITA_MS = 24 * 60 * 60 * 1000;
export const AL_POSTO_DEL_TESTO = 'Worker finito. Il suo testo di ritorno non ti arriva: sei cieco per design. Il passo dopo lo decidi solo dal canale, come dice il tuo ruolo.';

export function decidi(input, { root, adesso = Date.now(), env = process.env } = {}) {
  const strumento = input && input.tool_name;
  if (strumento !== 'Agent' && strumento !== 'Task') return null;
  if (input.agent_id) return null;
  const file = join(root || input.cwd || '.', MARCATORE);
  if (!existsSync(file)) return null;
  let m;
  try { m = JSON.parse(readFileSync(file, 'utf8')); } catch (_) { m = {}; }
  if (!(adesso - Number(m.creato) < VALIDITA_MS)) return null;
  const sessione = String(input.session_id || env.CLAUDE_CODE_SESSION_ID || '');
  if (m.sessione && sessione && m.sessione !== sessione) return null;

  if (input.hook_event_name === 'PreToolUse') {
    const ti = input.tool_input || {};
    if (ti.run_in_background !== true) return null;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Il worker si lancia in primo piano (senza run_in_background): in sottofondo il suo testo ti arriverebbe nella notifica.' } };
  }
  if (input.hook_event_name === 'PostToolUse') {
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: AL_POSTO_DEL_TESTO } };
  }
  return null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let s = '';
  process.stdin.on('data', (d) => { s += d; });
  process.stdin.on('end', () => {
    let input = {};
    try { input = JSON.parse(s || '{}'); } catch (_) { return; }
    const out = decidi(input, { root: process.env.CLAUDE_PROJECT_DIR || input.cwd });
    if (out) process.stdout.write(JSON.stringify(out));
  });
}

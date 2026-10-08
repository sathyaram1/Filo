// Orchestratore cieco: nel thread principale di un giro il testo di ritorno di un worker non entra nel contesto,
// e un worker in sottofondo non parte. Gira come COMANDO scritto per intero nelle impostazioni, mai da questo file:
// a worker finito la cartella è sul ramo del worker, che può non averlo o averlo cambiato. Regole: tests/unit/orchestratoreCieco.test.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MARCATORE = join('.claude', 'routine-orchestratore.json');
// Un marcatore lasciato da un preflight lanciato a mano non deve accecare per sempre le sessioni locali.
export const VALIDITA_MS = 24 * 60 * 60 * 1000;
export const AL_POSTO_DEL_TESTO = 'Worker finito. Il suo testo di ritorno non ti arriva: sei cieco per design. Il passo dopo lo decidi solo dal canale, come dice il tuo ruolo.';
export const MOTIVO_SOTTOFONDO = 'Il worker si lancia in primo piano (senza run_in_background): in sottofondo il suo testo ti arriverebbe nella notifica.';

// Il corpo finisce fra apici singoli nella shell del gancio: solo virgolette doppie, niente apostrofi nemmeno nei commenti.
export function decidi(input, { root, adesso = Date.now(), env = process.env } = {}) {
  const strumento = input && input.tool_name;
  if (strumento !== "Agent" && strumento !== "Task") return null;
  if (input.agent_id) return null;
  const file = join(root || input.cwd || ".", MARCATORE);
  if (!existsSync(file)) return null;
  let m;
  try { m = JSON.parse(readFileSync(file, "utf8")); } catch (_) { m = {}; }
  if (!(adesso - Number(m.creato) < VALIDITA_MS)) return null;
  const sessione = String(input.session_id || env.CLAUDE_CODE_SESSION_ID || "");
  if (m.sessione && sessione && m.sessione !== sessione) return null;

  if (input.hook_event_name === "PreToolUse") {
    const ti = input.tool_input || {};
    if (ti.run_in_background !== true) return null;
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: MOTIVO_SOTTOFONDO } };
  }
  if (input.hook_event_name === "PostToolUse") {
    return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: AL_POSTO_DEL_TESTO } };
  }
  return null;
}

const PRELUDIO = 'const {existsSync,readFileSync}=require("fs"),{join}=require("path");'
  + `const MARCATORE=${JSON.stringify(MARCATORE)},VALIDITA_MS=${VALIDITA_MS},`
  + `AL_POSTO_DEL_TESTO=${JSON.stringify(AL_POSTO_DEL_TESTO)},MOTIVO_SOTTOFONDO=${JSON.stringify(MOTIVO_SOTTOFONDO)};`;
const AVVIO = 'let s="";process.stdin.on("data",(d)=>{s+=d});process.stdin.on("end",()=>{let i;try{i=JSON.parse(s||"{}")}catch(_){return}'
  + 'const o=decidi(i,{root:process.env.CLAUDE_PROJECT_DIR||i.cwd});if(o)process.stdout.write(JSON.stringify(o))});';

// Quello che sta in .claude/settings.local.json, prima e dopo Agent|Task: la sentinella lo vuole identico.
export const COMANDO = `node -e '${PRELUDIO}const decidi=${decidi};${AVVIO}'`;

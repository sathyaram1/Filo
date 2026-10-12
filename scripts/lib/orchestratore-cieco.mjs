// Orchestratore cieco: nella sessione di un giro il testo dei worker non entra nel suo contesto. Il gancio sta nelle
// impostazioni dell'UTENTE, mai nel progetto, e per tutto il giro tiene ferme impostazioni e skill che un worker riscrive
// da shell. Regole: tests/unit/orchestratoreCieco.test.mjs. Copioni dei ganci e programmi restano aperti (#1182).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ETICHETTA = 'filo-orchestratore-cieco';
// Un preflight lanciato a mano non deve accecare per sempre le sessioni di questa macchina.
export const VALIDITA_MS = 24 * 60 * 60 * 1000;
export const AL_POSTO_DEL_TESTO = 'Worker finito. Il suo testo di ritorno non ti arriva: sei cieco per design. Il passo dopo lo decidi solo dal canale, come dice il tuo ruolo.';
export const MOTIVO_SOTTOFONDO = 'Il worker si lancia in primo piano (senza run_in_background): in sottofondo il suo testo ti arriverebbe nella notifica.';
export const MOTIVO_PRIMO_PIANO = 'Worker portato in primo piano: in sottofondo il suo testo ti arriverebbe nella notifica.';
export const MOTIVO_IMPOSTAZIONI = 'Durante il giro impostazioni e skill restano quelle di partenza: un worker non deve poter spegnere o affiancare il gancio che rende cieco chi guida il giro.';
// Worker sempre su Opus, qualunque modello chieda il lancio; niente copie in sottofondo dell'orchestratore su Haiku.
export const AMBIENTE = Object.freeze({
  CLAUDE_CODE_SUBAGENT_MODEL: 'opus',
  CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1',
  CLAUDE_CODE_FORK_SUBAGENT: '0',
});

// Il corpo finisce fra apici singoli nella shell del gancio: solo virgolette doppie, niente apostrofi nemmeno nei
// commenti, niente barre rovesciate (la riga di comando di Windows le mangia). Si ferma ogni fonte di configurazione,
// anche ignota: il progetto vince sull'utente, e un disableAllHooks scritto lì spegnerebbe il gancio (#1182).
export function decidi(input, { sessione = "", creato = 0, adesso = Date.now() } = {}) {
  if (!input || !(adesso - Number(creato) < VALIDITA_MS)) return null;
  if (sessione && input.session_id && input.session_id !== sessione) return null;
  if (input.hook_event_name === "ConfigChange") {
    if (!sessione || input.source === "policy_settings") return null;
    return { decision: "block", reason: MOTIVO_IMPOSTAZIONI };
  }
  const strumento = input.tool_name;
  if (strumento !== "Agent" && strumento !== "Task") return null;
  if (input.agent_id) return null;
  const ti = input.tool_input || {};
  if (input.hook_event_name === "PreToolUse") {
    if (ti.run_in_background === true) {
      return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: MOTIVO_SOTTOFONDO } };
    }
    if (ti.run_in_background === false) return null;
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: MOTIVO_PRIMO_PIANO, updatedInput: { ...ti, run_in_background: false } } };
  }
  if (input.hook_event_name === "PostToolUse") {
    return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: AL_POSTO_DEL_TESTO } };
  }
  return null;
}

const PRELUDIO = `/*${ETICHETTA}*/const VALIDITA_MS=${VALIDITA_MS},AL_POSTO_DEL_TESTO=${JSON.stringify(AL_POSTO_DEL_TESTO)},`
  + `MOTIVO_SOTTOFONDO=${JSON.stringify(MOTIVO_SOTTOFONDO)},MOTIVO_PRIMO_PIANO=${JSON.stringify(MOTIVO_PRIMO_PIANO)},`
  + `MOTIVO_IMPOSTAZIONI=${JSON.stringify(MOTIVO_IMPOSTAZIONI)};`;

export function comando({ sessione = '', creato }) {
  const opz = JSON.stringify({ sessione: String(sessione).replace(/[^A-Za-z0-9-]/g, ''), creato: Number(creato) || 0 });
  const avvio = 'let s="";process.stdin.on("data",(d)=>{s+=d});process.stdin.on("end",()=>{let i;try{i=JSON.parse(s||"{}")}catch(_){return}'
    + `const o=decidi(i,${opz});if(o)process.stdout.write(JSON.stringify(o))});`;
  return `node -e '${PRELUDIO}const decidi=${decidi};${avvio}'`;
}

export function dirImpostazioniUtente(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

const nostro = (gruppo) => (gruppo?.hooks || []).some((h) => String(h?.command || '').includes(ETICHETTA));

// Unisce senza toccare il resto delle impostazioni dell'utente; un file illeggibile non si riscrive.
export function installa({ dir = dirImpostazioniUtente(), sessione = '', creato = Date.now() } = {}) {
  const file = join(dir, 'settings.json');
  let s = {};
  if (existsSync(file)) {
    try { s = JSON.parse(readFileSync(file, 'utf8') || '{}'); } catch (e) { return { ok: false, file, why: `impostazioni utente illeggibili: ${e.message}` }; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, file, why: 'impostazioni utente non sono un oggetto' };
  }
  const cmd = comando({ sessione, creato });
  const hooks = { ...(s.hooks || {}) };
  // ConfigChange senza matcher: ogni fonte arriva a decidi, che sceglie cosa fermare.
  const voci = { PreToolUse: 'Agent|Task', PostToolUse: 'Agent|Task', ConfigChange: '' };
  for (const [ev, matcher] of Object.entries(voci)) {
    const gruppo = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: cmd }] };
    hooks[ev] = [...(hooks[ev] || []).filter((g) => !nostro(g)), gruppo];
  }
  const nuovo = { ...s, env: { ...(s.env || {}), ...AMBIENTE }, hooks };
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(nuovo, null, 2)}\n`);
    renameSync(tmp, file);
  } catch (e) { return { ok: false, file, why: e.message }; }
  return { ok: true, file };
}

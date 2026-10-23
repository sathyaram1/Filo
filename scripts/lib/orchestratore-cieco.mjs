// Orchestratore cieco: nella sessione di un giro il testo dei worker non entra nel suo contesto, modello e sforzo del worker
// li mette il gancio come li ha decisi il server, e nessuno (worker compresi) manda notifiche all'owner. Gancio, registro e
// permessi git del riallineamento stanno nelle impostazioni dell'UTENTE, mai nel progetto. Regole: tests/unit/orchestratoreCieco.test.mjs.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ETICHETTA = 'filo-orchestratore-cieco';
// Un preflight lanciato a mano non deve accecare per sempre le sessioni di questa macchina.
export const VALIDITA_MS = 24 * 60 * 60 * 1000;
// Un biglietto vive un giro: un giorno lo copre con margine, e il registro non cresce.
export const DURATA_VOCE_MS = 24 * 60 * 60 * 1000;
export const FILE_REGISTRO = 'filo-decisioni-worker.json';
// Gli alias che lo strumento Agent accetta e che seguono da soli l'ultima versione.
export const MODELLI = Object.freeze(['opus', 'sonnet', 'haiku', 'fable']);
export const SFORZI = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
export const AL_POSTO_DEL_TESTO = 'Worker finito. Il suo testo di ritorno non ti arriva: sei cieco per design. Il passo dopo lo decidi solo dal canale, come dice il tuo ruolo.';
// Claude Code sposta in sottofondo un sotto-agente che dura troppo (CLAUDE_AUTO_BACKGROUND_TASKS, circa due minuti) e
// lo strumento torna con status async_launched: il worker lavora ancora (#1480, D-90).
export const AL_POSTO_VIVO = 'Worker ANCORA VIVO: Claude Code lo ha spostato in sottofondo mentre lavorava, non è finito. Non rilasciare il suo biglietto, non toccare la cartella, non chiedere biglietti e non lanciare altri worker: chiudi il turno senza fare altro e aspetta la notifica di fine del worker. Quando arriva, riparti dal passo 0 del tuo ruolo, come dopo un worker finito.';
export const MOTIVO_SOTTOFONDO = 'Il worker si lancia in primo piano (senza run_in_background): in sottofondo il suo testo ti arriverebbe nella notifica.';
export const MOTIVO_LANCIO = 'Worker in primo piano, con modello e sforzo decisi dal server (quelli della sua definizione se il server non ne ha detti).';
export const MOTIVO_IMPOSTAZIONI = 'Durante il giro le impostazioni utente non cambiano: portano il gancio che rende cieco chi guida il giro.';
export const MOTIVO_SENZA_BIGLIETTO = 'Lancio rifiutato: nel prompt del worker manca il biglietto (--ticket <biglietto>), e senza non so modello e sforzo decisi dal server.';
export const MOTIVO_DUE_BIGLIETTI = 'Lancio rifiutato: nel prompt ci sono biglietti diversi e non so di quale seguire la decisione del server. Lascia solo il --ticket del worker che lanci.';
export const MOTIVO_REGISTRO = 'Lancio rifiutato: non leggo il registro delle decisioni del server, che scrive il comando ticket. Rilascia il biglietto (release <biglietto> --role orchestrator) e chiudi il giro.';
export const MOTIVO_SCONOSCIUTO = 'Lancio rifiutato: il biglietto non risulta fra quelli chiesti al server nelle ultime 24 ore, quindi non so modello e sforzo decisi. Il biglietto si chiede col comando ticket; se lo hai, rilascialo e chiudi il giro.';
export const MOTIVO_IGNOTO = 'Lancio rifiutato: il server ha deciso un modello o uno sforzo che questo gancio non conosce. Rilascia il biglietto (release <biglietto> --role orchestrator) e chiudi il giro.';
// Un giro chiuso per guasto è avanzamento normale e l'owner non si chiama (#1496): ciò che gli chiede un intervento è una
// domanda in Gestione. SendUserFile conta solo con status proactive, l'unico che arriva al telefono.
export const MOTIVO_NOTIFICA = 'Notifica rifiutata: le routine non mandano notifiche. Un giro chiuso per un guasto è avanzamento normale: lo riaccende il pacemaker, e il motivo sta nei log del run. Una decisione che serve davvero si chiede con una domanda in Gestione, se il tuo ruolo la prevede.';
export const MATCHER_PRIMA = 'Agent|Task|PushNotification|SendUserFile';
// Il server sceglie il modello e il gancio lo mette; opus resta il default di chi lancia senza dirlo, perché senza un
// sotto-agente girerebbe sul modello della sessione principale. Profondità fissata: Claude Code l'ha già cambiata tre volte.
export const AMBIENTE = Object.freeze({
  CLAUDE_CODE_SUBAGENT_MODEL: 'opus',
  CLAUDE_CODE_FORK_SUBAGENT: '0',
  CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '3',
});
// Con FORCE acceso Claude Code ignora il modello del lancio e della definizione: un'installazione vecchia la lascerebbe.
export const AMBIENTE_TOLTO = Object.freeze(['CLAUDE_CODE_SUBAGENT_MODEL_FORCE']);

// Il corpo finisce fra apici singoli nella shell del gancio: solo virgolette doppie, niente apostrofi nemmeno nei
// commenti, niente barre rovesciate (la riga di comando di Windows le mangia), nella regex solo classi di caratteri.
// registro = { testo } del file o { errore }; impronta = sha256 esadecimale.
export function decidi(input, { sessione = "", creato = 0, adesso = Date.now(), registro = null, impronta = null } = {}) {
  if (!input || !(adesso - Number(creato) < VALIDITA_MS)) return null;
  if (sessione && input.session_id && input.session_id !== sessione) return null;
  if (input.hook_event_name === "ConfigChange") {
    if (!sessione || (input.source && input.source !== "user_settings")) return null;
    return { decision: "block", reason: MOTIVO_IMPOSTAZIONI };
  }
  const strumento = input.tool_name;
  const ti = input.tool_input || {};
  const nega = (motivo) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: motivo } });
  const notifica = strumento === "PushNotification" || (strumento === "SendUserFile" && ti.status === "proactive");
  if (notifica && input.hook_event_name === "PreToolUse") return nega(MOTIVO_NOTIFICA);
  if (strumento !== "Agent" && strumento !== "Task") return null;
  if (input.agent_id) return null;
  if (input.hook_event_name === "PreToolUse") {
    if (ti.run_in_background === true) return nega(MOTIVO_SOTTOFONDO);
    const visti = [...new Set([...String(ti.prompt || "").matchAll(/--ticket[^A-Za-z0-9_-]{1,3}([A-Za-z0-9_-]{32,})/g)].map((m) => m[1]))];
    if (visti.length !== 1) return nega(visti.length ? MOTIVO_DUE_BIGLIETTI : MOTIVO_SENZA_BIGLIETTO);
    const letto = registro || {};
    let voci = null;
    try { voci = JSON.parse(letto.testo).voci; } catch (_) { voci = null; }
    if (!Array.isArray(voci)) return nega(MOTIVO_REGISTRO + " Dettaglio: " + (letto.errore || "contenuto non valido") + ".");
    const mia = typeof impronta === "function" ? impronta(visti[0]) : "";
    const voce = voci.find((v) => v && mia && v.impronta === mia && adesso - Date.parse(v.ora) < DURATA_VOCE_MS);
    if (!voce) return nega(MOTIVO_SCONOSCIUTO);
    if ((voce.model && !MODELLI.includes(voce.model)) || (voce.effort && !SFORZI.includes(voce.effort))) return nega(MOTIVO_IGNOTO);
    const nuovo = { ...ti, run_in_background: false };
    delete nuovo.model;
    delete nuovo.effort;
    if (voce.model) nuovo.model = voce.model;
    if (voce.effort) nuovo.effort = voce.effort;
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: MOTIVO_LANCIO, updatedInput: nuovo } };
  }
  if (input.hook_event_name === "PostToolUse") {
    const r = input.tool_response;
    const stato = r && typeof r === "object" && typeof r.status === "string" ? r.status : "";
    const finito = stato ? stato === "completed" : !/async_launched|background|sottofondo|outputFile/i.test(typeof r === "string" ? r : JSON.stringify(r || ""));
    return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: finito ? AL_POSTO_DEL_TESTO : AL_POSTO_VIVO } };
  }
  return null;
}

const PRELUDIO = `/*${ETICHETTA}*/const VALIDITA_MS=${VALIDITA_MS},DURATA_VOCE_MS=${DURATA_VOCE_MS},`
  + `MODELLI=${JSON.stringify(MODELLI)},SFORZI=${JSON.stringify(SFORZI)},AL_POSTO_DEL_TESTO=${JSON.stringify(AL_POSTO_DEL_TESTO)},`
  + `AL_POSTO_VIVO=${JSON.stringify(AL_POSTO_VIVO)},`
  + `MOTIVO_SOTTOFONDO=${JSON.stringify(MOTIVO_SOTTOFONDO)},MOTIVO_LANCIO=${JSON.stringify(MOTIVO_LANCIO)},`
  + `MOTIVO_IMPOSTAZIONI=${JSON.stringify(MOTIVO_IMPOSTAZIONI)},MOTIVO_SENZA_BIGLIETTO=${JSON.stringify(MOTIVO_SENZA_BIGLIETTO)},`
  + `MOTIVO_DUE_BIGLIETTI=${JSON.stringify(MOTIVO_DUE_BIGLIETTI)},MOTIVO_REGISTRO=${JSON.stringify(MOTIVO_REGISTRO)},`
  + `MOTIVO_SCONOSCIUTO=${JSON.stringify(MOTIVO_SCONOSCIUTO)},MOTIVO_IGNOTO=${JSON.stringify(MOTIVO_IGNOTO)},`
  + `MOTIVO_NOTIFICA=${JSON.stringify(MOTIVO_NOTIFICA)};`;

// Le barre di Windows diventano normali (Node le accetta), così il corpo resta senza barre rovesciate.
export function comando({ sessione = '', creato, registro = '' }) {
  const opz = JSON.stringify({
    sessione: String(sessione).replace(/[^A-Za-z0-9-]/g, ''),
    creato: Number(creato) || 0,
    fileRegistro: String(registro).split('\\').join('/'),
  });
  const avvio = 'let s="";process.stdin.on("data",(d)=>{s+=d});process.stdin.on("end",()=>{let i;try{i=JSON.parse(s||"{}")}catch(_){return}'
    + `const k=${opz};let r;try{r={testo:require("fs").readFileSync(k.fileRegistro,"utf8")}}catch(e){r={errore:String((e&&e.code)||e)}}`
    + 'const imp=(t)=>require("crypto").createHash("sha256").update(t).digest("hex");'
    + 'const o=decidi(i,{...k,registro:r,impronta:imp});if(o)process.stdout.write(JSON.stringify(o))});';
  return `node -e '${PRELUDIO}const decidi=${decidi};${avvio}'`;
}

export function dirImpostazioniUtente(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

export function impronta(biglietto) {
  return createHash('sha256').update(String(biglietto ?? '').trim()).digest('hex');
}

/**
 * La decisione del server per un biglietto, dove la legge il gancio: l'impronta, mai il biglietto in chiaro. Le voci
 * scadute si buttano; un registro rotto si riparte da vuoto (lo riscrive solo questo comando).
 * @returns {{ ok: boolean, file: string, why?: string }}
 */
export function registraDecisione({ ticket, role = '', model = '', effort = '' }, { dir = dirImpostazioniUtente(), adesso = Date.now() } = {}) {
  const file = join(dir, FILE_REGISTRO);
  let voci = [];
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')).voci;
    if (Array.isArray(v)) voci = v;
  } catch (_) { /* assente o rotto */ }
  const mia = impronta(ticket);
  const tenute = voci.filter((v) => v && typeof v.impronta === 'string' && v.impronta !== mia && adesso - Date.parse(v.ora) < DURATA_VOCE_MS);
  const voce = { impronta: mia, ruolo: String(role || ''), ora: new Date(adesso).toISOString() };
  if (model) voce.model = String(model);
  if (effort) voce.effort = String(effort);
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ voci: [...tenute, voce] }, null, 2)}\n`);
    renameSync(tmp, file);
  } catch (e) { return { ok: false, file, why: e.message }; }
  return { ok: true, file };
}

const nostro = (gruppo) => (gruppo?.hooks || []).some((h) => String(h?.command || '').includes(ETICHETTA));

// Unisce senza toccare il resto delle impostazioni dell'utente; un file illeggibile non si riscrive. I permessi entrano nella
// STESSA scrittura del gancio: il ConfigChange appena installato blocca ogni scrittura successiva. Solo regole esatte (#1454).
export function installa({ dir = dirImpostazioniUtente(), sessione = '', creato = Date.now(), permessi = [] } = {}) {
  const file = join(dir, 'settings.json');
  let s = {};
  if (existsSync(file)) {
    try { s = JSON.parse(readFileSync(file, 'utf8') || '{}'); } catch (e) { return { ok: false, file, why: `impostazioni utente illeggibili: ${e.message}` }; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, file, why: 'impostazioni utente non sono un oggetto' };
  }
  const cmd = comando({ sessione, creato, registro: join(dir, FILE_REGISTRO) });
  const hooks = { ...(s.hooks || {}) };
  const voci = { PreToolUse: MATCHER_PRIMA, PostToolUse: 'Agent|Task', ConfigChange: 'user_settings' };
  for (const [ev, matcher] of Object.entries(voci)) {
    hooks[ev] = [...(hooks[ev] || []).filter((g) => !nostro(g)), { matcher, hooks: [{ type: 'command', command: cmd }] }];
  }
  const env = { ...(s.env || {}), ...AMBIENTE };
  for (const k of AMBIENTE_TOLTO) delete env[k];
  const nuovo = { ...s, env, hooks };
  if (permessi.length) {
    const storta = permessi.find((r) => typeof r !== 'string' || !/^Bash\(.+\)$/.test(r) || r.includes('*'));
    if (storta !== undefined) return { ok: false, file, why: `permesso non esatto: ${String(storta)}` };
    const p = s.permissions && typeof s.permissions === 'object' && !Array.isArray(s.permissions) ? s.permissions : {};
    nuovo.permissions = { ...p, allow: [...new Set([...(Array.isArray(p.allow) ? p.allow : []), ...permessi])] };
  }
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(nuovo, null, 2)}\n`);
    renameSync(tmp, file);
  } catch (e) { return { ok: false, file, why: e.message }; }
  return { ok: true, file };
}

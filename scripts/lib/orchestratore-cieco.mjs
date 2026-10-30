// Orchestratore cieco: nella sessione di un giro il testo dei worker non entra nel suo contesto, modello e sforzo del worker
// li mette il gancio come li ha decisi il server, e nessuno (worker compresi) manda notifiche all'owner. Gancio, registro e
// permessi git stanno nelle impostazioni dell'UTENTE, mai nel progetto; per tutto il giro impostazioni e skill restano quelle
// di partenza. Regole: tests/unit/orchestratoreCieco.test.mjs.

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
// lo strumento torna con status async_launched: il worker lavora ancora (#1480, D-90). Un worker fermo su un permesso
// non manda mai la notifica di fine: decide la veglia (#1797).
export const AL_POSTO_VIVO = 'Worker ANCORA VIVO: Claude Code lo ha spostato in sottofondo mentre lavorava, non è finito. Non rilasciare il suo biglietto, non toccare la cartella, non chiedere biglietti e non lanciare altri worker: veglialo col comando veglia del tuo ruolo, in primo piano, e rilancialo finché esce con 5. Con 0 il worker ha finito: riparti dal passo 0 del tuo ruolo. Con 3 era fermo e la veglia ha già rilasciato il biglietto col guasto: chiudi il giro. La notifica di fine del worker non decide niente.';
export const MOTIVO_SOTTOFONDO = 'Il worker si lancia in primo piano (senza run_in_background): in sottofondo il suo testo ti arriverebbe nella notifica.';
export const MOTIVO_LANCIO = 'Worker in primo piano, con modello e sforzo decisi dal server (quelli della sua definizione se il server non ne ha detti).';
export const MOTIVO_IMPOSTAZIONI = 'Durante il giro impostazioni e skill restano quelle di partenza: un worker non deve poter spegnere o affiancare il gancio che rende cieco chi guida il giro.';
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
// Le stesse di .claude/settings.json: lì le perde ogni ramo nato prima, qui reggono al cambio di ramo. Una regola a
// prefisso non vede `git -C`, quindi il clone del server ha le sue, col percorso vero.
export const REGOLE_GIT = Object.freeze(['Bash(git fetch:*)', 'Bash(git rebase:*)', 'Bash(git merge:*)']);
export function regoleGit(clone = '') {
  const p = String(clone || '').trim().split('\\').join('/');
  if (!p) return [...REGOLE_GIT];
  const conClone = ['fetch', 'rebase', 'merge'].flatMap((v) => [`Bash(git -C "${p}" ${v}:*)`, `Bash(git -C ${p} ${v}:*)`]);
  return [...REGOLE_GIT, ...conClone];
}

// Il corpo finisce fra apici singoli nella shell del gancio: solo virgolette doppie, niente apostrofi nemmeno nei
// commenti, niente barre rovesciate (la riga di comando di Windows le mangia), nella regex solo classi di caratteri.
// Si ferma ogni fonte di configurazione, anche ignota: il progetto vince sull'utente, e un disableAllHooks scritto lì
// spegnerebbe il gancio (#1182).
// registro = { testo } del file o { errore }; impronta = sha256 esadecimale; strumenti = la copia fissata, già ripulita.
export function decidi(input, { sessione = "", creato = 0, adesso = Date.now(), registro = null, impronta = null, strumenti = "" } = {}) {
  if (!input || !(adesso - Number(creato) < VALIDITA_MS)) return null;
  if (sessione && input.session_id && input.session_id !== sessione) return null;
  if (input.hook_event_name === "ConfigChange") {
    if (!sessione || input.source === "policy_settings") return null;
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
    const oggetto = !!r && typeof r === "object" && !Array.isArray(r);
    const stato = oggetto && typeof r.status === "string" ? r.status : "";
    const finito = stato ? stato === "completed" : !/async_launched|background|sottofondo|outputFile/i.test(typeof r === "string" ? r : JSON.stringify(r || ""));
    // Claude Code scarta un updatedToolOutput che non ha la forma del ritorno di Agent (una stringa, al posto di un
    // oggetto) e tiene il suo: il testo si sostituisce dentro la forma, e il lancio in sottofondo, che di testo non ne
    // porta, riceve la riga come contesto in più (#1797).
    if (!finito) {
      const visti = [...new Set([...String(ti.prompt || "").matchAll(/--ticket[^A-Za-z0-9_-]{1,3}([A-Za-z0-9_-]{32,})/g)].map((m) => m[1]))];
      const veglia = strumenti && visti.length === 1 ? " Comando: node " + strumenti + "/scripts/routine-channel.mjs veglia " + visti[0] : "";
      return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: AL_POSTO_VIVO + veglia } };
    }
    const sostituto = oggetto ? { ...r, content: [{ type: "text", text: AL_POSTO_DEL_TESTO }] } : AL_POSTO_DEL_TESTO;
    return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: sostituto } };
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

// Unisce senza toccare il resto delle impostazioni dell'utente; un file illeggibile non si riscrive.
export function installa({ dir = dirImpostazioniUtente(), sessione = '', creato = Date.now(), clone = '' } = {}) {
  const file = join(dir, 'settings.json');
  let s = {};
  if (existsSync(file)) {
    try { s = JSON.parse(readFileSync(file, 'utf8') || '{}'); } catch (e) { return { ok: false, file, why: `impostazioni utente illeggibili: ${e.message}` }; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, file, why: 'impostazioni utente non sono un oggetto' };
  }
  const cmd = comando({ sessione, creato, registro: join(dir, FILE_REGISTRO) });
  const hooks = { ...(s.hooks || {}) };
  // ConfigChange senza matcher: ogni fonte arriva a decidi, che sceglie cosa fermare.
  const voci = { PreToolUse: MATCHER_PRIMA, PostToolUse: 'Agent|Task', ConfigChange: '' };
  for (const [ev, matcher] of Object.entries(voci)) {
    const gruppo = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: cmd }] };
    hooks[ev] = [...(hooks[ev] || []).filter((g) => !nostro(g)), gruppo];
  }
  const env = { ...(s.env || {}), ...AMBIENTE };
  for (const k of AMBIENTE_TOLTO) delete env[k];
  const vecchie = Array.isArray(s.permissions?.allow) ? s.permissions.allow : [];
  const permissions = { ...(s.permissions || {}), allow: [...new Set([...vecchie, ...regoleGit(clone)])] };
  const nuovo = { ...s, env, hooks, permissions };
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(nuovo, null, 2)}\n`);
    renameSync(tmp, file);
  } catch (e) { return { ok: false, file, why: e.message }; }
  return { ok: true, file };
}

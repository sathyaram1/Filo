// Le letture esterne che sporcano da sole il biglietto della sessione locale (#1211, SPEC-DOMANDE.md §1.2): quali
// strumenti portano dentro testo che il server non vede, e il gancio PostToolUse che lo annota. Non decide la fiducia
// (la tiene il server) e non blocca mai uno strumento. Prove: tests/unit/lettureEsterne.test.mjs.

import { realpathSync } from 'node:fs';
import { spawn as avviaProcesso } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as B from './biglietto-locale.mjs';
import { cartellaDelServer } from './ramo-server.mjs';

// Gli strumenti di Claude Code che non portano dentro niente da fuori. Elenco chiuso: uno che non c'è, anche nuovo o
// sconosciuto, sporca (#1211.2). Read, Artifact, Agent e ToolSearch li decide motivoLettura dai parametri.
export const STRUMENTI_SENZA_LETTURA = Object.freeze([
  // La shell: quello che scarica lo dichiara la sessione (SPEC-DOMANDE.md §1.2).
  'Bash', 'PowerShell', 'BashOutput', 'KillShell', 'Monitor',
  'Grep', 'Glob', 'LS',
  'Edit', 'MultiEdit', 'Write', 'NotebookEdit',
  'TodoWrite', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TaskStop', 'CronCreate', 'CronDelete', 'CronList',
  'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree', 'AskUserQuestion',
  // Le abilità le installa l'owner, e stanno dove Read non sporca: il progetto e la cartella di Claude.
  'Skill', 'SlashCommand',
  'PushNotification', 'SendUserFile', 'SubagentHandback',
]);
// Artifact non porta dentro niente solo con queste azioni. Pubblicare sì: un rifiuto restituisce la pagina con le
// modifiche di chi l'ha aperta, e la sessione resta in ascolto dei commenti.
const ARTIFACT_SENZA_LETTURA = Object.freeze(['open', 'pin', 'unpin', 'delete']);
// Gli strumenti MCP che agiscono e rispondono con un esito, mai con testo scritto da altri. Elenco chiuso: un mcp__ che
// non c'è sporca.
export const MCP_SENZA_LETTURA = Object.freeze([
  'mcp__ide__getDiagnostics',
  'mcp__Claude_Code_Remote__set_session_title',
  'mcp__Claude_Code_Remote__set_session_tags',
  'mcp__Claude_Code_Remote__archive_session',
  'mcp__Claude_Code_Remote__unarchive_session',
  'mcp__Claude_Code_Remote__interrupt_session',
  'mcp__Claude_Code_Remote__unwatch_url',
  // L'app desktop: la lista dei passi e il riassunto del turno vanno all'app, e torna solo la sua conferma (#1252).
  'mcp__ccd_turn__update_plan',
  'mcp__ccd_turn__wrap_up',
]);
// Strumenti dell'app desktop noti per nome ma non per server: valgono sotto un server ccd_ qualsiasi. Le sue letture
// (eventi di altre sessioni, widget, browser) non ci stanno e sporcano.
const CCD_SENZA_LETTURA =Object.freeze(['mark_chapter']);
const RE_CCD_SENZA_LETTURA = new RegExp(`^mcp__ccd(?:_[A-Za-z0-9-]+)+__(?:${CCD_SENZA_LETTURA.join('|')})$`);
const mcpSenzaLettura = (nome) => MCP_SENZA_LETTURA.includes(nome) || RE_CCD_SENZA_LETTURA.test(nome);

const pulisci = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/** Lo strumento può portare dentro testo esterno? Senza guardare i parametri. PURA. */
export function puoLeggereFuori(nome) {
  const n = String(nome || '');
  return !!n && !STRUMENTI_SENZA_LETTURA.includes(n);
}

/** Il matcher del gancio nelle impostazioni: ogni strumento fuori da STRUMENTI_SENZA_LETTURA. PURA. */
export function matcherDelGancio() {
  // `.*` in coda: vale sia come RegExp non ancorata sia ancorata ai due capi.
  return `^(?!(?:${STRUMENTI_SENZA_LETTURA.join('|')})$).*`;
}

// ToolSearch porta le descrizioni scritte da chi fa i server MCP: non sporca solo quando chiede per nome strumenti di
// Claude, o MCP fra i puliti (la descrizione la scrive chi è già fidato per la risposta).
function cercaSoloStrumentiDiClaude(query) {
  const m = /^\s*select:([\s\S]*)$/.exec(String(query || ''));
  const nomi = m ? m[1].split(',').map((s) => s.trim()) : [];
  return nomi.length > 0 && nomi.every((n) => mcpSenzaLettura(n) || (/^[A-Za-z][A-Za-z0-9_]*$/.test(n) && !/^mcp/i.test(n)));
}

function dentro(file, cartella, P, win) {
  if (!cartella) return false;
  const rel = win ? P.relative(cartella.toLowerCase(), file.toLowerCase()) : P.relative(cartella, file);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${P.sep}`) && !P.isAbsolute(rel));
}

/**
 * Il motivo con cui la chiamata sporca il biglietto, '' se non porta dentro testo esterno. `input` = lo stdin del
 * gancio; `ctx` = contestoLettura (cartelle e file fidati, `win`, `canonico`). PURA con un `canonico` puro.
 */
export function motivoLettura(input, ctx = {}) {
  const nome = String((input && input.tool_name) || '');
  const dati = (input && input.tool_input) || {};
  if (nome === 'WebFetch') {
    let host = '';
    try { host = new URL(String(dati.url || '')).hostname; } catch (_) { /* resta senza */ }
    return host ? `WebFetch (${pulisci(host, 120)})` : 'WebFetch';
  }
  if (nome === 'Artifact') {
    const azione = String(dati.action || 'publish');
    return ARTIFACT_SENZA_LETTURA.includes(azione) ? '' : `Artifact (${pulisci(azione, 40)})`;
  }
  // Un sotto-agente locale passa da questo gancio con le sue chiamate. Uno che gira altrove no, e il suo rapporto
  // arriva senza strumento: sporca alla partenza.
  if (nome === 'Agent' || nome === 'Task') {
    const dove = String(dati.isolation || '');
    return dove === '' || dove === 'worktree' ? '' : `${nome} (${pulisci(dove, 40)})`;
  }
  if (nome === 'ToolSearch') return cercaSoloStrumentiDiClaude(dati.query) ? '' : 'ToolSearch';
  if (nome.startsWith('mcp__')) return mcpSenzaLettura(nome) ? '' : pulisci(nome, 160);
  if (nome !== 'Read') return puoLeggereFuori(nome) ? pulisci(nome, 160) : '';
  const grezzo = String(dati.file_path || '').trim();
  if (!grezzo) return '';
  const win = !!ctx.win;
  const P = win ? path.win32 : path.posix;
  const canonico = typeof ctx.canonico === 'function' ? ctx.canonico : (p) => p;
  const file = canonico(P.resolve(String(ctx.cwd || P.sep), grezzo));
  if ((ctx.cartelle || []).some((c) => dentro(file, c, P, win))) return '';
  const uguale = (a) => (win ? a.toLowerCase() === file.toLowerCase() : a === file);
  if ((ctx.file || []).some(uguale)) return '';
  return `Read fuori dal repo (${pulisci(P.basename(file), 80)})`;
}

// Il percorso vero, collegamenti e nomi corti di Windows risolti, anche di un file che non c'è più: vale la cartella
// esistente più vicina.
function canonicoVero(p) {
  const coda = [];
  let d = p;
  for (;;) {
    try { return path.join(realpathSync.native(d), ...coda); } catch (_) { /* si sale */ }
    const su = path.dirname(d);
    if (su === d) return p;
    coda.unshift(path.basename(d));
    d = su;
  }
}

/**
 * Le cartelle temporanee di Claude Code per i progetti `radici` (`<tmp>/claude[-uid]/<progetto>`): ci tiene le uscite
 * dei comandi in sottofondo e gli appunti, e leggerle è leggere la shell, che non sporca. PURA.
 */
export function cartelleTemporaneeDiClaude(radici, { env = {}, tmp = [], uid = null, win = false } = {}) {
  const P = win ? path.win32 : path.posix;
  const basi = [String(env.CLAUDE_CODE_TMPDIR || '').trim(), ...tmp].filter(Boolean);
  const nomi = Number.isInteger(uid) ? [`claude-${uid}`, 'claude'] : ['claude'];
  // Il nome della cartella del progetto è il suo percorso con ogni carattere che non è lettera o cifra cambiato in «-».
  const progetti = [...new Set(radici.filter(Boolean).map((r) => P.resolve(r).replace(/[^A-Za-z0-9]/g, '-')))];
  return [...new Set(basi.flatMap((b) => nomi.flatMap((n) => progetti.map((p) => P.join(P.resolve(b), n, p)))))];
}

/**
 * Dove si legge senza sporcarsi: il repo (anche da una sua worktree, e la cartella del progetto), il checkout del
 * server accanto, la cartella di Claude dell'utente e quella temporanea del progetto; e LOCAL.md sopra il repo, che la
 * sessione locale deve leggere.
 */
export function contestoLettura({ cwd = process.cwd(), env = process.env, sistema = process.platform, biglietti = [] } = {}) {
  const win = sistema === 'win32';
  const P = win ? path.win32 : path.posix;
  // Il repo della cartella corrente vale solo se è il progetto, una sua worktree o il repo che tiene il biglietto della
  // sessione: un repo clonato da fuori in cui la sessione si è spostata resta testo altrui (#1211 giro 2).
  const progetto = String(env.CLAUDE_PROJECT_DIR || '').trim();
  const comuneProgetto = progetto ? B.radiceCondivisa(progetto) : '';
  const delBiglietto = biglietti.map((b) => P.dirname(P.resolve(String((b && b.path) || ''))))
    .filter((d) => P.basename(d) === 'biglietti' && P.basename(P.dirname(d)) === '.claude').map((d) => P.dirname(P.dirname(d)));
  const casa = [comuneProgetto, ...delBiglietto].filter(Boolean);
  const daQui = B.radiceCondivisa(cwd);
  const chiave = (c) => { const k = canonicoVero(P.resolve(c)); return win ? k.toLowerCase() : k; };
  const suo = !!daQui && (!progetto || casa.some((c) => chiave(c) === chiave(daQui)));
  const comune = suo ? daQui : comuneProgetto;
  const radici = [suo ? B.radiceRepo(cwd) : '', comune, progetto].filter(Boolean);
  const server = comune ? cartellaDelServer(comune) : '';
  const claude = [P.join(homedir(), '.claude'), String(env.CLAUDE_CONFIG_DIR || '').trim()].filter(Boolean);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const tmp = [...new Set([tmpdir(), ...(win ? [] : ['/tmp'])])];
  const temporanee = cartelleTemporaneeDiClaude(radici, { env, tmp, uid, win });
  const cartelle = [...radici, ...(server ? [P.dirname(server)] : []), ...claude, ...temporanee].map((c) => canonicoVero(P.resolve(c)));
  const file = radici.map((r) => canonicoVero(P.join(P.dirname(P.resolve(r)), 'LOCAL.md')));
  return { cwd, win, cartelle: [...new Set(cartelle)], file: [...new Set(file)], canonico: canonicoVero };
}

/** Lancia in sottofondo la consegna dello sporco annotato accanto al biglietto `percorso` (più `motivo`, se annotarlo
 * non è riuscito): chi chiama non aspetta. */
export function avviaConsegna(percorso, { env = process.env, motivo = '' } = {}) {
  const script = fileURLToPath(new URL('../biglietto.mjs', import.meta.url));
  const figlio = avviaProcesso(process.execPath, [script, 'consegna', ...(motivo ? [motivo] : [])], {
    detached: true, stdio: 'ignore', windowsHide: true, env: { ...env, [B.ENV_FILE]: percorso },
  });
  figlio.on('error', () => {});
  figlio.unref();
}

/**
 * Il gancio PostToolUse: se la chiamata ha portato dentro testo esterno annota lo sporco accanto al biglietto della
 * sessione (session_id dallo stdin) e ne lancia la consegna in sottofondo. Mai un'eccezione, mai un'attesa sul server.
 * @returns {{ esito: string, motivo?: string }}
 */
export function gancio({ input = {}, env = process.env, nowMs = Date.now(), avvia = avviaConsegna, contesto = contestoLettura } = {}) {
  try {
    if (env.FILO_ROUTINE) return { esito: 'routine' };
    if (!input || typeof input !== 'object' || !puoLeggereFuori(input.tool_name)) return { esito: 'nessuna lettura esterna' };
    // Le cartelle fidate (altre chiamate a git) servono solo a Read: per il resto il motivo si sa subito.
    const subito = input.tool_name === 'Read' ? null : motivoLettura(input);
    if (subito === '') return { esito: 'nessuna lettura esterna' };
    const cwd = String(input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd());
    const sessione = String(input.session_id || '').trim();
    const envSessione = sessione ? { ...env, [B.ENV_SESSIONE]: sessione } : env;
    // La cartella corrente può stare fuori dal progetto (un'altra cartella di lavoro): il biglietto resta nel progetto
    // da cui la sessione è partita.
    let biglietti = B.trovaBiglietti({ env: envSessione, cwd });
    const progetto = String(env.CLAUDE_PROJECT_DIR || '').trim();
    if (!biglietti.length && progetto && progetto !== cwd) biglietti = B.trovaBiglietti({ env: envSessione, cwd: progetto });
    if (!biglietti.length) return { esito: 'senza biglietto' };
    const motivo = subito ?? motivoLettura(input, contesto({ cwd, env, biglietti }));
    if (!motivo) return { esito: 'nessuna lettura esterna' };
    for (const b of biglietti) {
      let annotato = true;
      try { B.annotaSporco(b, motivo, nowMs); } catch (_) { annotato = false; }
      // Già sporco sul server la consegna aspetta la prossima occasione: niente processi per ogni lettura. L'annotazione
      // resta, e da sola tiene sporco il biglietto anche se il segno l'ha scritto chi non doveva.
      if (annotato && B.sporcoSulServer(b)) continue;
      avvia(b.path, { env, motivo: annotato ? '' : motivo });
    }
    return { esito: 'annotato', motivo };
  } catch (e) {
    return { esito: 'guasto', motivo: String((e && e.message) || e) };
  }
}

// Le letture esterne che sporcano da sole il biglietto della sessione locale (#1211, SPEC-DOMANDE.md §1.2): quali
// strumenti portano dentro testo che il server non vede, e il gancio PostToolUse che lo annota. Non decide la fiducia
// (la tiene il server) e non blocca mai uno strumento. Prove: tests/unit/lettureEsterne.test.mjs.

import { realpathSync } from 'node:fs';
import { spawn as avviaProcesso } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as B from './biglietto-locale.mjs';
import { cartellaDelServer } from './ramo-server.mjs';

// Sempre esterni: la rete, e le risorse dei server MCP lette senza passare da un mcp__.
export const STRUMENTI_ESTERNI = Object.freeze(['WebFetch', 'WebSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool']);
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
]);

const pulisci = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/** Questo strumento può portare dentro testo esterno? Senza guardare dove legge: serve a uscire prima di chiedere a git. PURA. */
export function puoLeggereFuori(nome) {
  const n = String(nome || '');
  return n === 'Read' || STRUMENTI_ESTERNI.includes(n) || n.startsWith('mcp__');
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
  if (STRUMENTI_ESTERNI.includes(nome)) return nome;
  if (nome.startsWith('mcp__')) return MCP_SENZA_LETTURA.includes(nome) ? '' : pulisci(nome, 160);
  if (nome !== 'Read') return '';
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

function canonicoVero(p) {
  try { return realpathSync.native(p); } catch (_) { return p; }
}

/**
 * Dove si legge senza sporcarsi: il repo (anche da una sua worktree, e la cartella del progetto), il checkout del
 * server accanto, la cartella di Claude dell'utente; e LOCAL.md sopra il repo, che la sessione locale deve leggere.
 */
export function contestoLettura({ cwd = process.cwd(), env = process.env, sistema = process.platform } = {}) {
  const win = sistema === 'win32';
  const P = win ? path.win32 : path.posix;
  const comune = B.radiceCondivisa(cwd);
  const radici = [B.radiceRepo(cwd), comune, String(env.CLAUDE_PROJECT_DIR || '').trim()].filter(Boolean);
  const server = comune ? cartellaDelServer(comune) : '';
  const claude = [P.join(homedir(), '.claude'), String(env.CLAUDE_CONFIG_DIR || '').trim()].filter(Boolean);
  const cartelle = [...radici, ...(server ? [P.dirname(server)] : []), ...claude].map((c) => canonicoVero(P.resolve(c)));
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
    const cwd = String(input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd());
    const sessione = String(input.session_id || '').trim();
    const biglietti = B.trovaBiglietti({ env: sessione ? { ...env, [B.ENV_SESSIONE]: sessione } : env, cwd });
    if (!biglietti.length) return { esito: 'senza biglietto' };
    const motivo = motivoLettura(input, contesto({ cwd, env }));
    if (!motivo) return { esito: 'nessuna lettura esterna' };
    for (const b of biglietti) {
      // Già sporco sul server: da sporco non si torna, e una chiamata in più non cambia niente.
      if (B.sporcoSulServer(b)) continue;
      let annotato = true;
      try { B.annotaSporco(b, motivo, nowMs); } catch (_) { annotato = false; }
      avvia(b.path, { env, motivo: annotato ? '' : motivo });
    }
    return { esito: 'annotato', motivo };
  } catch (e) {
    return { esito: 'guasto', motivo: String((e && e.message) || e) };
  }
}

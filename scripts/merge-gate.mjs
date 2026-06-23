// Cancello di merge per le routine cloud (R2).
//
// PERCHÉ ESISTE
//   L'hook di auto-commit (`.claude/hooks/auto-commit-merge.sh`) fonde da solo
//   ogni branch su `main` a ogni Edit. Per le routine questo è pericoloso: c'è
//   l'auto-update periodico, quindi tutto ciò che tocca `main` raggiunge TUTTI
//   gli utenti. Una correzione non ancora verificata — o un branch compromesso
//   da una prompt-injection nel testo di un feedback — non deve MAI arrivare su
//   `main` senza un cancello.
//
//   Per questo l'hook NON auto-fonde più i branch `worker/*` e `feature/*`
//   (vedi auto-commit-merge.sh): restano sul loro branch finché l'orchestratore,
//   dopo la verifica avversariale (PASS), chiama QUESTO script per fonderli.
//
//   Topologia (Modello B, vedi TASKS.md):
//     - feedback standalone: `worker/<id>`  → gate → `main`
//     - feature spezzata:    `worker/<N.M>` → gate → `feature/N`   (per-pezzo)
//                            `feature/N`    → gate → `main`         (#N.final)
//   Il target di default è `main`; per i pezzi di una feature si passa
//   `--into feature/N`.
//
// USO:
//   node scripts/merge-gate.mjs <sourceBranch> [--into <targetBranch>] [--dry-run]
//
//   Exit code:
//     0  → fuso e pushato su <target>
//     10 → BLOCCATO dal cancello di sicurezza (L4/L5, vedi R6): il feedback va
//          messo in stato `blocked`, decide l'utente. Nessuna fusione.
//     20 → conflitto di merge: serve risoluzione manuale. Nessuna fusione.
//     1  → errore (argomenti, git, ecc.)

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// FILO_REPO_ROOT: override della root del repo (cwd di git). Esiste SOLO per i
// test, che simulano l'ambiente delle routine su cloni temporanei di un origin
// finto, senza toccare il repo/origin reale (stesso pattern di claim-feedback).
const ROOT = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : resolve(__dirname, '..');

// ─── logica pura (testabile) ────────────────────────────────────────────────

// Un nome di branch valido e non pericoloso da passare a git.
export function isValidBranch(name) {
  return typeof name === 'string'
    && name.length > 0
    && !name.startsWith('-')
    && /^[A-Za-z0-9._\/-]+$/.test(name)
    && !name.includes('..');
}

// Parsing degli argomenti CLI: <source> [--into <target>] [--dry-run].
export function parseArgs(argv) {
  const out = { source: '', target: 'main', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--into') { out.target = argv[++i] || ''; }
    else if (a === '--dry-run') { out.dryRun = true; }
    else if (!out.source) { out.source = a; }
  }
  return out;
}

// ─── git ────────────────────────────────────────────────────────────────────

function tryGit(args) {
  try { return { ok: true, out: execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message }; }
}

// ─── cancello di sicurezza (R6: L4/L5) ───────────────────────────────────────
//
// SEAM PER R6. Qui R6 collega:
//   - L5 (deterministico): se il diff tocca file sensibili (firestore.rules,
//     .claude/hooks/*, script di deploy/triage, chiavi/config, auth…) →
//     { ok:false } → il chiamante esce 10 e mette il feedback in `blocked`.
//   - L4 (LLM cieco al prompt): un sotto-agente che vede SOLO il diff (mai il
//     testo del feedback → un'injection nel feedback non può convincerlo) e lo
//     giudica per problemi di sicurezza; verdetto FAIL → { ok:false }.
// Finché R6 non è implementato, il cancello è un no-op che lascia passare: R2
// fornisce solo la TOPOLOGIA dei branch (l'hook non auto-fonde, il merge passa
// di qui), non i controlli di sicurezza.
export function runSecurityGate(_diff, _ctx) {
  return { ok: true };
}

// Fonde `source` in `target` e pusha `target` su origin, con retry sui push
// concorrenti (i 2 account possono pushare nello stesso istante).
function mergeAndPush(source, target, { dryRun } = {}) {
  // 1) Allinea il working tree a origin: serve il target aggiornato e il source.
  tryGit(['fetch', 'origin']);

  // 2) Assicurati che `target` esista in locale e punti a origin/target.
  const haveTarget = tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${target}`]).ok;
  if (haveTarget) {
    if (!tryGit(['checkout', target]).ok) return { code: 1, msg: `checkout ${target} fallito` };
    tryGit(['reset', '--hard', `origin/${target}`]); // parti dallo stato remoto
  } else {
    if (!tryGit(['checkout', '-B', target, `origin/${target}`]).ok) {
      return { code: 1, msg: `impossibile creare ${target} da origin/${target}` };
    }
  }

  // 3) Risolvi il source: branch locale, oppure tracking di origin/source.
  let sourceRef = source;
  if (!tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${source}`]).ok) {
    if (tryGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${source}`]).ok) {
      sourceRef = `origin/${source}`;
    } else {
      return { code: 1, msg: `branch sorgente non trovato: ${source}` };
    }
  }

  // 4) Cancello di sicurezza (R6) sul diff target..source PRIMA di fondere.
  const diff = tryGit(['diff', `${target}...${sourceRef}`]).out;
  const verdict = runSecurityGate(diff, { source, target });
  if (!verdict.ok) return { code: 10, msg: `bloccato dal cancello di sicurezza: ${verdict.reason || ''}` };

  // 5) Merge. Conflitto → abort, niente fusione (esito 20).
  const merge = tryGit(['merge', '--no-edit', sourceRef]);
  if (!merge.ok) {
    tryGit(['merge', '--abort']);
    return { code: 20, msg: `conflitto fondendo ${source} in ${target}: ${merge.out.slice(0, 200)}` };
  }

  if (dryRun) return { code: 0, msg: `(dry-run) ${source} fonderebbe in ${target}; nessun push` };

  // 6) Push con retry: se origin/target è avanzato nel frattempo, rebase e ritenta.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (tryGit(['push', 'origin', `${target}:${target}`]).ok) {
      return { code: 0, msg: `${source} fuso in ${target} e pushato` };
    }
    // Push rifiutato: riconcilia il mio merge sopra il nuovo origin/target.
    const reb = tryGit(['pull', '--rebase', 'origin', target]);
    if (!reb.ok) {
      tryGit(['rebase', '--abort']);
      return { code: 20, msg: `conflitto in rebase su origin/${target} dopo push concorrente` };
    }
  }
  return { code: 1, msg: `push di ${target} rifiutato dopo i retry` };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const { source, target, dryRun } = parseArgs(process.argv.slice(2));
  if (!source) { console.error('uso: node scripts/merge-gate.mjs <sourceBranch> [--into <target>] [--dry-run]'); process.exit(1); }
  if (!isValidBranch(source)) { console.error(`branch sorgente non valido: "${source}"`); process.exit(1); }
  if (!isValidBranch(target)) { console.error(`branch target non valido: "${target}"`); process.exit(1); }
  if (source === target) { console.error('source e target coincidono'); process.exit(1); }

  const { code, msg } = mergeAndPush(source, target, { dryRun });
  if (code === 0) console.log(`[merge-gate] OK: ${msg}`);
  else if (code === 10) console.error(`[merge-gate] BLOCKED: ${msg}`);
  else if (code === 20) console.error(`[merge-gate] CONFLICT: ${msg}`);
  else console.error(`[merge-gate] ERROR: ${msg}`);
  process.exit(code);
}

// Esegui solo se invocato come script (non quando importato dai test).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}

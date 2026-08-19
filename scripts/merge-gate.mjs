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
//   Topologia: `worker/<...>` → gate → `main`. Il target è SEMPRE la linea
//   principale: il supporto `--into feature/N` era il "Modello B" delle feature
//   spezzate in sotto-feedback, abolito col ridisegno (SPEC-RIDISEGNO-MAX.md §1).
//
// USO:
//   node scripts/merge-gate.mjs <sourceBranch> [--dry-run]
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
// finto, senza toccare il repo/origin reale (stesso pattern degli altri script
// delle routine).
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

// Parsing degli argomenti CLI: <source> [--dry-run]. Il target è SEMPRE main:
// un flag sconosciuto (compreso il vecchio `--into`) finisce in `unknown` e il
// CLI si rifiuta di partire — meglio un errore chiaro che fondere su un target
// che non esiste più come concetto.
export function parseArgs(argv) {
  const out = { source: '', target: 'main', dryRun: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { out.dryRun = true; }
    else if (typeof a === 'string' && a.startsWith('-')) { out.unknown.push(a); }
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
// Protegge `main` (e quindi gli utenti, via auto-update) dal caso di una routine
// pilotata da un feedback con prompt-injection che committa codice cattivo.
//
//   - L5 (deterministico, gira SEMPRE qui): se il diff tocca file sensibili →
//     blocco. È il muro con i denti: nessun LLM da convincere, una regola fissa.
//   - L4 (giudizio LLM, cieco al prompt): un sotto-agente che vede SOLO il diff
//     (mai il testo del feedback → un'injection nel feedback non può
//     convincerlo). Il verdetto è prodotto FUORI da questo script — un node
//     script non può usare l'abbonamento per spawnare un Agent — dall'orchestratore
//     (vedi R3), e passato qui come `ctx.l4Verdict` (`pass`|`fail`). Qui si APPLICA
//     soltanto: `fail` → blocco. L'isolamento è strutturale: questa funzione
//     riceve SOLO il diff + i metadati di branch + il verdetto, MAI il corpo del
//     feedback.
//
// In entrambi i casi { ok:false }: il chiamante esce 10 e l'orchestratore mette
// il feedback in `blocked` (attende revisione umana).

// Path (relativi alla root del repo) il cui cambiamento richiede sempre revisione
// umana: regole/config di sicurezza, infrastruttura delle routine, deploy,
// auth, segreti. La lista è volutamente conservativa: meglio un blocco di troppo
// (l'utente sblocca) che un file sensibile fuso senza occhi umani.
export const SENSITIVE_PATTERNS = [
  /^firestore\.rules$/,                  // regole d'accesso al DB feedback
  /^storage\.rules$/,                    // regole d'accesso agli screenshot
  /^firebase\.json$/,                    // config deploy Firebase
  /^\.firebaserc$/,                      // progetto Firebase di default
  /^\.claude\/hooks\//,                  // l'auto-commit/merge su cui girano le routine
  /^\.github\/workflows\//,              // i workflow (build e release verso gli utenti)
  /^scripts\/(merge-gate|admin-login|routine-channel|owner-feedback)\.mjs$/,
  /^scripts\/lib\//,                     // firestore-auth e le altre librerie d'accesso
  /^src\/main\/services\/handlers\/auth\.js$/, // flusso di login/admin
  /^src\/shared\/feedback\.js$/,         // client Firestore (porta API key + scritture)
  /(^|\/)\.env($|\.)/,                   // segreti d'ambiente
  /\.(pem|key)$/,                        // chiavi private
  /(service[-_]?account|credentials)[^/]*\.json$/i, // chiavi service-account
];

// Estrae i path dei file toccati da un diff unificato di git. Robusto su
// add/delete/rename: legge sia le righe `diff --git a/X b/Y` sia `+++`/`---`.
export function changedPaths(diff) {
  if (typeof diff !== 'string' || !diff) return [];
  const paths = new Set();
  for (const line of diff.split('\n')) {
    let m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) { paths.add(m[1]); paths.add(m[2]); continue; }
    m = line.match(/^\+\+\+ b\/(.+)$/);
    if (m && m[1] !== '/dev/null') { paths.add(m[1]); continue; }
    m = line.match(/^--- a\/(.+)$/);
    if (m && m[1] !== '/dev/null') { paths.add(m[1]); continue; }
  }
  return [...paths];
}

// L5: i path sensibili toccati dal diff (vuoto = nessuno → L5 passa).
export function l5SensitiveHits(diff) {
  return changedPaths(diff).filter((p) => SENSITIVE_PATTERNS.some((re) => re.test(p)));
}

export function runSecurityGate(diff, ctx = {}) {
  // L5 — deterministico, con i denti: file sensibili non passano senza occhi umani.
  const hits = l5SensitiveHits(diff);
  if (hits.length) {
    return { ok: false, level: 'L5', reason: `tocca file sensibili: ${hits.join(', ')}` };
  }
  // L4 — applica il verdetto del sotto-agente cieco (prodotto dall'orchestratore).
  if (ctx.l4Verdict === 'fail') {
    return { ok: false, level: 'L4', reason: ctx.l4Reason || 'revisione di sicurezza LLM: FAIL' };
  }
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
  const verdict = runSecurityGate(diff, {
    source, target,
    // Verdetto L4 prodotto dall'orchestratore (sotto-agente cieco) e passato via
    // env: il diff lo calcola il gate, il giudizio LLM no (un node script non può
    // spawnare un Agent sull'abbonamento). Assente = L4 non pone veto.
    l4Verdict: process.env.FILO_L4_VERDICT,
    l4Reason: process.env.FILO_L4_REASON,
  });
  if (!verdict.ok) return { code: 10, msg: `bloccato dal cancello di sicurezza [${verdict.level}]: ${verdict.reason || ''}` };

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
  const { source, target, dryRun, unknown } = parseArgs(process.argv.slice(2));
  if (unknown.length) { console.error(`opzioni sconosciute: ${unknown.join(' ')} (il target è sempre main: --into non esiste più)`); process.exit(1); }
  if (!source) { console.error('uso: node scripts/merge-gate.mjs <sourceBranch> [--dry-run]'); process.exit(1); }
  if (!isValidBranch(source)) { console.error(`branch sorgente non valido: "${source}"`); process.exit(1); }
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

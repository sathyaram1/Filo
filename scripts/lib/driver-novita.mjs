// Il driver di git per il registro delle novità (#2224): nel rebase le righe dei due lati si tengono tutte, con la regola
// del cancello (src/shared/novitaFusione.js); fuori dal rebase, o se la regola non basta, è la fusione di testo di git.
// Si imposta dove nasce la copia di lavoro, accanto al carattere di commento. Sentinella: tests/unit/driverNovita.test.mjs.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

createRequire(import.meta.url)(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared', 'novitaFusione.js'));
const { uniscaNovita } = globalThis.SN_NOVITA_FUSIONE;

export const NOME = 'novita';
export const SCRIPT = 'scripts/novita-driver.mjs';
// Git lancia il driver dalla radice dell'albero. Un albero a metà rebase senza lo script fa la fusione di testo coi
// marcatori: un driver che manca non deve mai lasciare il lato «ours» muto, come se fosse risolto.
export const COMANDO = `if [ -f ${SCRIPT} ]; then node ${SCRIPT} %O %A %B %L; else git merge-file --marker-size=%L %A %O %B; fi`;
const VOCI = Object.freeze({ [`merge.${NOME}.name`]: 'registro delle novità: le righe dei due lati (#2224)', [`merge.${NOME}.driver`]: COMANDO });

function gitIn(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, status: r.status, out: String(r.stdout || ''), err: String(r.stderr || (r.error && r.error.message) || '').trim() };
}

/** Il driver nella config del repo (comune a tutte le sue worktree). Idempotente e best-effort: non lancia mai. */
export function ensureDriverNovita(root) {
  let cambiato = false;
  for (const [chiave, valore] of Object.entries(VOCI)) {
    const letto = gitIn(root, ['config', '--local', '--get-all', chiave]);
    if (letto.ok && letto.out.replace(/\n$/, '') === valore) continue;
    // 1 = nessuna voce; ogni altro esito è una config che non si legge, e non si scrive.
    if (!letto.ok && letto.status !== 1) return { ok: false, cambiato, why: letto.err };
    const s = gitIn(root, ['config', '--local', '--replace-all', chiave, valore]);
    if (!s.ok) return { ok: false, cambiato, why: s.err };
    cambiato = true;
  }
  return { ok: true, cambiato };
}

function percorsoGit(cwd, nome) {
  const p = gitIn(cwd, ['rev-parse', '--git-path', nome]);
  if (!p.ok) return '';
  const percorso = p.out.trim();
  return isAbsolute(percorso) ? percorso : join(cwd, percorso);
}

/** Un rebase in corso nell'albero `cwd`: solo lì «ours» è la base nuova e «theirs» il commit del ramo. */
export function inRebase(cwd) {
  return ['rebase-merge', 'rebase-apply'].some((d) => {
    const p = percorsoGit(cwd, d);
    return Boolean(p) && existsSync(p);
  });
}

/** Il nome del commit in corso nel rebase, come lo scrive git nei marcatori («abc1234 (titolo)»). PURA. */
export function etichettaDaFatti(fatti) {
  const righe = String(fatti || '').split(/\r?\n/).filter((r) => /^\s*(p|pick|r|reword|e|edit|s|squash|f|fixup)\s+[0-9a-f]{4,}/.test(r));
  const m = righe.length ? /^\s*\S+\s+([0-9a-f]+)\s*(?:#\s*)?(.*)$/.exec(righe[righe.length - 1]) : null;
  if (!m) return 'theirs';
  return m[2] ? `${m[1]} (${m[2].trim()})` : m[1];
}

// Git 2.43 non passa i nomi dei lati al driver (%X e %Y restano letterali): li ricostruisce chi fa la fusione di testo.
function etichette(cwd) {
  let fatti = '';
  try { fatti = readFileSync(join(percorsoGit(cwd, 'rebase-merge'), 'done'), 'utf8'); } catch (_) { /* fusione, o rebase senza elenco */ }
  return ['HEAD', 'base', etichettaDaFatti(fatti)];
}

/**
 * I tre lati del registro nel rebase: le righe che il commit del ramo aggiunge rispetto al suo genitore, in fondo al
 * blocco in cima della base nuova. PURA. → { ok: true, src } | { ok: false, motivo }
 */
export function unisciNelRebase({ base, ours, theirs, manifesto, oggi }) {
  const r = uniscaNovita({ base, main: ours, ramo: theirs, manifesto, oggi });
  return r.ok ? { ok: true, src: r.src } : { ok: false, motivo: r.motivo };
}

/** Quello che fa il driver lanciato da git, nella cartella `cwd`. → il codice d'uscita: 0 risolto, altro in conflitto. */
export function driver({ base, ours, theirs, marcatori = '7', cwd = process.cwd(), oggi = new Date().toISOString().slice(0, 10) }) {
  if (inRebase(cwd)) {
    const pkg = gitIn(cwd, ['show', 'HEAD:package.json']);
    let manifesto = null;
    try { manifesto = pkg.ok ? JSON.parse(pkg.out) : null; } catch (_) { manifesto = null; }
    if (manifesto) {
      let r = { ok: false };
      try {
        r = unisciNelRebase({ base: readFileSync(base, 'utf8'), ours: readFileSync(ours, 'utf8'), theirs: readFileSync(theirs, 'utf8'), manifesto, oggi });
      } catch (_) { /* un lato che non si legge: resta la fusione di testo */ }
      if (r.ok) {
        writeFileSync(ours, r.src, 'utf8');
        return 0;
      }
    }
  }
  const [lA, lO, lB] = etichette(cwd);
  const misura = /^\d+$/.test(String(marcatori)) ? marcatori : '7';
  const m = gitIn(cwd, ['merge-file', `--marker-size=${misura}`, '-L', lA, '-L', lO, '-L', lB, ours, base, theirs]);
  return m.status === 0 ? 0 : 1;
}

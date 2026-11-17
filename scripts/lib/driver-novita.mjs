// Il driver di git per il registro delle novità (#2224): nel rebase le righe dei due lati si tengono tutte, con la regola
// del cancello (src/shared/novitaFusione.js); fuori dal rebase, o se la regola non basta, è la fusione di testo di git.
// Si imposta dove nasce la copia di lavoro (scripts/lib/prepara-copia.mjs). Sentinella: tests/unit/driverNovita.test.mjs.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Solo quando git lancia il driver: chi imposta la config (preparazione del clone, hook) non lo carica.
const novitaFusione = () => {
  if (!globalThis.SN_NOVITA_FUSIONE) createRequire(import.meta.url)(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared', 'novitaFusione.js'));
  return globalThis.SN_NOVITA_FUSIONE;
};

export const NOME = 'novita';
export const SCRIPT = 'scripts/novita-driver.mjs';
// L'uscita del driver per «conflitto, marcatori già scritti»: ogni altra (node che non parte, script rotto) è un driver
// che non ha scritto niente.
export const CONFLITTO = 37;
// Git lancia il driver dalla radice dell'albero. Uno script che manca o non arriva in fondo lascia la fusione di testo coi
// marcatori: il lato «ours» non deve mai restare muto, come se fosse risolto.
export const COMANDO = `if [ -f ${SCRIPT} ]; then node ${SCRIPT} %O %A %B %L; r=$?; if [ $r -eq 0 ]; then exit 0; fi; if [ $r -eq ${CONFLITTO} ]; then exit 1; fi; fi; git merge-file --marker-size=%L %A %O %B`;
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
export function etichettaDaFatti(fatti, corto = (sha) => sha) {
  const righe = String(fatti || '').split(/\r?\n/).filter((r) => /^\s*(p|pick|r|reword|e|edit|s|squash|f|fixup)\s+[0-9a-f]{4,}/.test(r));
  const m = righe.length ? /^\s*\S+\s+([0-9a-f]+)\s*(?:#\s*)?(.*)$/.exec(righe[righe.length - 1]) : null;
  if (!m) return 'theirs';
  return m[2] ? `${corto(m[1])} (${m[2].trim()})` : corto(m[1]);
}

// Git 2.43 non passa i nomi dei lati al driver (%X e %Y restano letterali): li ricostruisce chi fa la fusione di testo.
function etichette(cwd) {
  let fatti = '';
  try { fatti = readFileSync(join(percorsoGit(cwd, 'rebase-merge'), 'done'), 'utf8'); } catch (_) { /* fusione, o rebase senza elenco */ }
  const corto = (sha) => { const r = gitIn(cwd, ['rev-parse', '--short', sha]); return r.ok ? r.out.trim() : sha; };
  return ['HEAD', 'base', etichettaDaFatti(fatti, corto)];
}

/**
 * I tre lati del registro nel rebase, più `forcella` (il registro dove il ramo si era staccato da main) e `onto` (quello
 * di main su cui si riporta). Il ramo intero, fino a questo commit, si unisce a `onto` con la regola del cancello: così
 * una riga scritta e poi ritoccata, o spostata in cima, conta come una riga aggiunta. Vale solo se «ours» è esattamente
 * quella regola applicata al commit prima (nessuna mano è passata sul registro); altrimenti le righe che questo commit
 * aggiunge al suo genitore, in fondo al blocco in cima di «ours». PURA. → { ok: true, src } | { ok: false, motivo }
 */
export function unisciNelRebase({ base, ours, theirs, manifesto, oggi, forcella = null, onto = null, manifestoOnto = null }) {
  const { uniscaNovita } = novitaFusione();
  if (forcella !== null && onto !== null && manifestoOnto) {
    const prima = uniscaNovita({ base: forcella, main: onto, ramo: base, manifesto: manifestoOnto, oggi });
    if (prima.ok && prima.src === ours) {
      const tutto = uniscaNovita({ base: forcella, main: onto, ramo: theirs, manifesto: manifestoOnto, oggi });
      if (tutto.ok) return { ok: true, src: tutto.src };
    }
  }
  const r = uniscaNovita({ base, main: ours, ramo: theirs, manifesto, oggi });
  return r.ok ? { ok: true, src: r.src } : { ok: false, motivo: r.motivo };
}

const json = (r) => { try { return r.ok ? JSON.parse(r.out) : null; } catch (_) { return null; } };

/** Il main su cui il rebase riporta il ramo e il punto dove il ramo se n'era staccato, dai file del rebase in corso. */
function capiDelRebase(cwd) {
  for (const d of ['rebase-merge', 'rebase-apply']) {
    const dir = percorsoGit(cwd, d);
    let onto = '';
    let testa = '';
    try {
      onto = readFileSync(join(dir, 'onto'), 'utf8').trim();
      testa = readFileSync(join(dir, 'orig-head'), 'utf8').trim();
    } catch (_) { continue; }
    const mb = gitIn(cwd, ['merge-base', onto, testa]);
    if (mb.ok && mb.out.trim()) return { onto, forcella: mb.out.trim() };
  }
  return null;
}

/** Quello che fa il driver lanciato da git, nella cartella `cwd`. → 0 risolto, CONFLITTO coi marcatori scritti. */
export function driver({ base, ours, theirs, marcatori = '7', cwd = process.cwd(), oggi = new Date().toISOString().slice(0, 10) }) {
  if (inRebase(cwd)) {
    const manifesto = json(gitIn(cwd, ['show', 'HEAD:package.json']));
    if (manifesto) {
      let r = { ok: false };
      try {
        const capi = capiDelRebase(cwd);
        const FILE = novitaFusione().FILE;
        const forcella = capi ? gitIn(cwd, ['show', `${capi.forcella}:${FILE}`]) : null;
        const onto = capi ? gitIn(cwd, ['show', `${capi.onto}:${FILE}`]) : null;
        const lati = forcella && forcella.ok && onto && onto.ok
          ? { forcella: forcella.out, onto: onto.out, manifestoOnto: json(gitIn(cwd, ['show', `${capi.onto}:package.json`])) }
          : {};
        r = unisciNelRebase({ base: readFileSync(base, 'utf8'), ours: readFileSync(ours, 'utf8'), theirs: readFileSync(theirs, 'utf8'), manifesto, oggi, ...lati });
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
  if (m.status === 0) return 0;
  // Da 1 a 127 sono i conflitti contati, coi marcatori scritti; un errore di merge-file non ha scritto niente.
  return m.status > 0 && m.status < 128 ? CONFLITTO : 2;
}

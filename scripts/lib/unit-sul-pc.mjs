// Quali unit girano sul PC dell'owner (#1497.3, D-185): solo i file di tests/unit che il suo ramo cambia. Gli altri sono
// arrivati da main anche senza il suo sì e girano su GitHub (prova-remota.mjs), lontano dalle sue credenziali.
// Sentinella: tests/unit/unitSulPc.test.mjs.

import { spawnSync } from 'node:child_process';
import { basename, dirname, relative, sep } from 'node:path';
import { isRoutineInstance } from './routine-role.mjs';
import { gitIn, refspecMain } from './unit-sulla-fusione.mjs';

/**
 * `1` forza la regola del PC dell'owner (il finish la passa al lanciatore); `0` la toglie a chi sceglie i file da sé,
 * come la prova sulla fusione, che sul PC dell'owner non gira più.
 */
export const VAR_LONTANE = 'FILO_UNIT_LONTANE';
const DIR = 'tests/unit';
const primaRiga = (s) => String(s || '').split(/\r?\n/).find((r) => r.trim()) || '';

/**
 * Un segno di routine su disco vale solo se git non lo traccia: uno tracciato l'ha portato il repo, magari da main
 * senza il sì dell'owner, e farebbe credere al suo PC di essere una routine (#1737 giro 3).
 */
export function nonTracciato(file) {
  const r = spawnSync('git', ['ls-files', '--error-unmatch', '--', basename(file)], { cwd: dirname(file), stdio: 'ignore', windowsHide: true });
  return r.status !== 0;
}

/** Siamo sul PC dell'owner? Una routine e GitHub Actions no: lì non ci sono le sue credenziali. */
export function unitLontane(root, { env = process.env, routine = isRoutineInstance, conta = nonTracciato } = {}) {
  const forzata = String(env[VAR_LONTANE] || '');
  if (forzata === '1') return true;
  if (forzata === '0') return false;
  if (String(env.GITHUB_ACTIONS || '') === 'true') return false;
  return !routine(root, { env, conta });
}

/** I file di `tutti` (assoluti) che stanno fra `cambiati` (relativi alla radice, barre normali). PURA. */
export function soloDelRamo({ tutti = [], cambiati = [], root }) {
  const set = new Set(cambiati.map((f) => String(f).replace(/\\/g, '/')));
  return tutti.filter((f) => set.has(relative(root, f).split(sep).join('/')));
}

/**
 * I file di unit che il ramo cambia rispetto a origin/main appena scaricato, modifiche non ancora committate e file
 * nuovi compresi. Senza main fresco si ferma: con una copia vecchia i file arrivati da main sembrerebbero del ramo.
 * → { file, base } | { errore }.
 */
export function cambiatiDelRamo(root, dir, { git = gitIn(root) } = {}) {
  const f = git(['fetch', '--quiet', 'origin', refspecMain()]);
  if (!f.ok) return { errore: `non riesco a scaricare main da origin (${primaRiga(f.out)})` };
  const mb = git(['merge-base', 'refs/remotes/origin/main', 'HEAD']);
  if (!mb.ok) return { errore: `non trovo la base comune con origin/main (${primaRiga(mb.out)})` };
  const base = mb.out.trim();
  const d = git(['-c', 'core.quotepath=false', 'diff', '--name-only', '--no-renames', base, '--', dir]);
  const n = git(['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard', '--', dir]);
  if (!d.ok || !n.ok) return { errore: `non riesco a leggere i file cambiati dal ramo (${primaRiga(d.ok ? n.out : d.out)})` };
  return { cambiati: [...d.out.split(/\r?\n/), ...n.out.split(/\r?\n/)].filter(Boolean), base };
}

/** Gli unit di `tutti` che il ramo cambia (cambiatiDelRamo su tests/unit). → { file, base } | { errore }. */
export function unitDelRamo(root, tutti, { git = gitIn(root) } = {}) {
  const c = cambiatiDelRamo(root, DIR, { git });
  if (c.errore) return c;
  return { file: soloDelRamo({ tutti, cambiati: c.cambiati, root }), base: c.base };
}

/**
 * Gli spec scelti per area (`tests/<nome>`, senza estensione): sul PC solo quelli che il ramo cambia, gli altri li prova
 * GitHub nella corsa degli unit (#1737 giro 1). `cambiati` null = non si sa cosa cambia il ramo: niente qui. PURA.
 */
export function specSulPc({ specs = [], cambiati = null }) {
  if (!Array.isArray(cambiati)) return { qui: [], lontani: [...specs] };
  const set = new Set(cambiati.map((f) => String(f).replace(/\\/g, '/')));
  const qui = specs.filter((s) => set.has(`${s}.spec.mjs`));
  return { qui, lontani: specs.filter((s) => !qui.includes(s)) };
}

/** Cosa dice il lanciatore sul PC dell'owner. PURA. */
export function testoSulPc(scelta, totale) {
  if (scelta.errore) {
    return `[test:unit] Sul tuo PC giro solo gli unit che il ramo cambia, e non so quali sono: ${scelta.errore}.\n`
      + '[test:unit] Non ne lancio nessuno. Per lanciarne alcuni: npm run test:unit -- --solo <file>';
  }
  const quanti = scelta.file.length;
  const resto = `gli altri ${totale - quanti}, arrivati da main, girano su GitHub quando chiudi il lavoro (npm run finish)`;
  return quanti
    ? `[test:unit] Sul tuo PC giro solo gli unit che il ramo cambia (${quanti} di ${totale}): ${resto}.`
    : `[test:unit] Il ramo non cambia nessun file di unit: qui non ne giro, ${resto}.`;
}

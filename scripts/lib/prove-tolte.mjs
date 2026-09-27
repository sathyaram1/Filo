// Le prove del giro che chi corregge ha cancellato o cambiato si rilanciano com'erano, sul codice nuovo:
// una ancora rossa ferma la consegna. Lo usano verify-local (corretto) e dispatch (--record-fixed).
// Regola: patterns/le-prove-di-un-giro-stanno-nel-ramo-e-la-cartella-si-svuota.md.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { preparaLancioElectron } from './schermo-virtuale.mjs';

const PROVE_GIRO = 'tests/verifica/';
// Stessa profondità della cartella d'origine, così gli import `../../fixtures/…` risolvono uguali.
// Gitignorata: il salvataggio automatico non deve mai committarla.
export const PREFISSO_RIPRISTINO = '_tolte-';

/** Dai file cancellati, le prove che Playwright raccoglierebbe dentro tests/verifica/<cartella>/. PURA. */
export function proveTolte(cancellati) {
  return (Array.isArray(cancellati) ? cancellati : [])
    .map((f) => String(f || '').replace(/\\/g, '/'))
    .filter((f) => f.startsWith(PROVE_GIRO) && f.split('/').length >= 4 && /\.spec\.m?js$/.test(f)
      && !f.split('/').includes('..') && !f.split('/')[2].startsWith(PREFISSO_RIPRISTINO));
}

/** Dove una prova tolta torna a vivere per il rilancio. PURA. */
export function percorsoRipristino(prova, etichetta) {
  const parti = String(prova).split('/');
  parti[2] = `${PREFISSO_RIPRISTINO}${parti[2]}-${etichetta}`;
  return parti.join('/');
}

/**
 * Cosa fare dopo il rilancio. PURA. Le prove dei rilievi messi da parte se ne sono andate prima, nel
 * commit della pulizia, che è la base del confronto: qui ogni rossa riproduce un rilievo da chiudere.
 */
export function esitoProveTolte({ rosse = [], shaPrima = '' } = {}) {
  if (!rosse.length) return { ferma: false, testo: '' };
  return {
    ferma: true,
    testo: [
      'Consegna respinta: hai cancellato o cambiato prove del giro che, com\'erano, sul codice nuovo sono ancora rosse.',
      rosse.map((f) => `  · ${f}`).join('\n'),
      'Le prove dei rilievi messi da parte sono uscite prima, nel commit della pulizia: ognuna di queste riproduce',
      `un rilievo da chiudere, e la porta è ancora aperta. Rimetti la prova (git checkout ${String(shaPrima).slice(0, 12) || '<commit della critica>'} -- <file>),`,
      'correggi finché è verde, e consegna di nuovo. Una prova, o un suo caso, si toglie solo verde, insieme',
      'alla prova durevole che la sostituisce.',
    ].join('\n'),
  };
}

/**
 * La base del confronto: il commit della pulizia se discende da quello della critica, altrimenti la
 * critica. Uno sha di pulizia rimasto da un giro vecchio non deve spostare la base di quello nuovo.
 */
export function baseDelConfronto(shaCritica, shaPulizia, root) {
  const critica = String(shaCritica || '');
  const pulizia = String(shaPulizia || '');
  if (!SHA.test(pulizia) || !SHA.test(critica)) return critica;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', critica, pulizia], { cwd: root, stdio: 'ignore' });
    return pulizia;
  } catch (_) { return critica; }
}

/**
 * Il commit della pulizia, fra la critica e HEAD: solo prove o casi TOLTI, tutti da una cartella del
 * giro (`cartella`, o una sola se non la si sa). Stessa regola di «dopo un verdetto si può solo togliere».
 * `{ ok, motivo, sha, files }`: `motivo` è già la frase per chi l'ha lanciata.
 */
export function controllaPulizia({ shaCritica, root, cartella = '' } = {}) {
  const critica = String(shaCritica || '');
  if (!SHA.test(critica)) return { ok: false, motivo: 'non so su che commit è stata registrata la critica: senza, non so cosa hai tolto.' };
  let head = '';
  try { head = gitOut(['rev-parse', 'HEAD'], root).trim(); } catch (_) { /* resta vuoto */ }
  if (!head) return { ok: false, motivo: 'git non mi dice su che commit sei.' };
  if (head === critica || head.startsWith(critica) || critica.startsWith(head)) {
    return { ok: false, motivo: 'nessun commit dopo la critica. Togli le prove dei rilievi messi da parte, `git add -A && git commit`, poi rilancia.' };
  }
  const tol = soloProveTolte(diffDopoLaVerifica(critica, head, root));
  if (!tol.ok) return { ok: false, motivo: `il commit della pulizia deve solo togliere prove del giro, e qui ${tol.motivo}.` };
  if (!tol.files.length) return { ok: false, motivo: 'dopo la critica non è stata tolta nessuna prova del giro.' };
  const cartelle = [...new Set(tol.files.map((f) => f.replace(/\\/g, '/').split('/').slice(0, 3).join('/')))];
  const attesa = String(cartella || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const fuori = attesa ? cartelle.filter((c) => c !== attesa) : (cartelle.length > 1 ? cartelle : []);
  if (fuori.length) {
    return { ok: false, motivo: `le prove tolte stanno in più cartelle, o fuori da quella del giro${attesa ? ` (${attesa})` : ''}: ${cartelle.join(', ')}.` };
  }
  return { ok: true, motivo: '', sha: head, files: tol.files };
}

function gitOut(args, root) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
}

// Le prove del giro cancellate o cambiate fra `shaPrima` e HEAD (null se git non risponde): togliere il
// caso rosso e tenere il file è la stessa porta aperta che cancellarlo.
export function proveTolteDal(shaPrima, root, principale = riferimentoPrincipale(root)) {
  try {
    const out = gitOut(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=DM', shaPrima, 'HEAD', '--', PROVE_GIRO], root);
    return toccateDalRamo(proveTolte(out.split('\0').filter(Boolean)), shaPrima, root, principale);
  } catch (_) { return null; }
}

export function riferimentoPrincipale(root) {
  for (const r of ['origin/main', 'main']) {
    try { gitOut(['rev-parse', '--verify', '-q', `${r}^{commit}`], root); return r; } catch (_) { continue; }
  }
  return '';
}

function oggetto(rev, f, root) {
  try { return gitOut(['rev-parse', '-q', '--verify', `${rev}:${f}`], root).trim(); } catch (_) { return ''; }
}

// Dopo un riallineamento il commit della critica sta sulla vecchia base: il diff da lì porta dentro le prove di altri
// lavori che main ha cambiato nel frattempo. Resta solo ciò che il ramo ha toccato, prima o dopo la critica.
export function toccateDalRamo(prove, shaPrima, root, principale = riferimentoPrincipale(root)) {
  if (!principale || !prove.length) return prove;
  let vecchia = '';
  let nuova = '';
  try {
    vecchia = gitOut(['merge-base', shaPrima, principale], root).trim();
    nuova = gitOut(['merge-base', 'HEAD', principale], root).trim();
  } catch (_) { return prove; }
  if (!vecchia || !nuova || vecchia === nuova) return prove;
  return prove.filter((f) => oggetto(shaPrima, f, root) !== oggetto(vecchia, f, root)
    || oggetto('HEAD', f, root) !== oggetto(nuova, f, root));
}

/**
 * Rilancia le prove tolte, ciascuna nella sua cartella com'era a `shaPrima` e col codice di adesso.
 * `{ rosse, motivo }`: `motivo` non vuoto = non si è potuto rilanciare, e non è un via libera.
 */
export function rilanciaProveTolte(prove, shaPrima, root, { lancia = spawnSync, log = console.log, prepara = preparaLancioElectron } = {}) {
  const schermo = prepara('npx', []);
  if (!schermo.ok) return { rosse: [], motivo: schermo.motivo };
  const etichetta = `${process.pid}`;
  const cartelle = [...new Set(prove.map((p) => p.split('/').slice(0, 3).join('/')))];
  const rosse = [];
  try {
    for (const c of cartelle) {
      const files = gitOut(['ls-tree', '-r', '-z', '--name-only', shaPrima, '--', `${c}/`], root).split('\0').filter(Boolean);
      for (const f of files) {
        const dest = resolve(root, percorsoRipristino(f, etichetta));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, execFileSync('git', ['show', `${shaPrima}:${f}`], { cwd: root, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }));
      }
    }
    log(`Rilancio com'${prove.length === 1 ? 'era' : 'erano'} ${prove.length} ${prove.length === 1 ? 'prova' : 'prove'} del giro cancellate o cambiate in questa correzione, sul codice nuovo:`);
    for (const p of prove) {
      const l = prepara('npx', ['playwright', 'test', percorsoRipristino(p, etichetta), '--retries=1']);
      const r = lancia(l.cmd, l.args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...(l.env ? { env: l.env } : {}) });
      if (!r || r.status !== 0) rosse.push(p);
    }
    return { rosse, motivo: '' };
  } catch (e) {
    return { rosse, motivo: `non sono riuscito a rimettere le prove tolte com'erano a ${String(shaPrima).slice(0, 8)}: ${e.message}` };
  } finally {
    for (const c of cartelle) rmSync(resolve(root, percorsoRipristino(`${c}/x`, etichetta), '..'), { recursive: true, force: true });
  }
}

/**
 * Tutto il controllo, per chi consegna: `{ ferma, testo }`. Senza il commit della critica non si
 * sa cosa è stato tolto: lo si dice e non si ferma (l'altra verifica rilancia comunque la cartella).
 */
export function controllaProveTolte({ shaPrima, root, messiDaParte = 0, log = console.log, lancia, prepara } = {}) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(shaPrima || ''))) {
    return { ferma: false, testo: 'Non so da che commit è partita la correzione: le prove del giro cancellate o cambiate non le rilancio.' };
  }
  const prove = proveTolteDal(shaPrima, root);
  if (prove === null) return { ferma: false, testo: 'Git non mi dice quali prove del giro sono state cancellate o cambiate: non le rilancio.' };
  if (!prove.length) return { ferma: false, testo: '' };
  const r = rilanciaProveTolte(prove, shaPrima, root, { log, ...(lancia ? { lancia } : {}), ...(prepara ? { prepara } : {}) });
  if (r.motivo) return { ferma: true, testo: `Consegna respinta: ${r.motivo}` };
  return esitoProveTolte({ rosse: r.rosse, messiDaParte, shaPrima });
}

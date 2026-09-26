// Le prove del giro che chi corregge ha cancellato si rilanciano sul codice nuovo, una volta: una
// ancora rossa ferma la consegna. Lo usano verify-local (corretto) e dispatch (--record-fixed).
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
 * Cosa fare dopo il rilancio. PURA. `messiDaParte` = rilievi usciti dal giro (esterni o interni
 * lasciati fuori): la loro prova si cancella ancora rossa di diritto, e da qui non si sa quale
 * prova sia di quale rilievo. Allora le rosse si elencano e non fermano.
 */
export function esitoProveTolte({ rosse = [], messiDaParte = 0, shaPrima = '' } = {}) {
  if (!rosse.length) return { ferma: false, testo: '' };
  const elenco = rosse.map((f) => `  · ${f}`).join('\n');
  if (Number(messiDaParte) > 0) {
    return {
      ferma: false,
      testo: [
        'Queste prove del giro sono state cancellate e sul codice nuovo sono ancora rosse:',
        elenco,
        `Il giro ha messo da parte ${messiDaParte} rilievi, e la loro prova si cancella rossa: se una di queste`,
        'riproduce invece un rilievo che hai corretto, la porta è ancora aperta. Rimettila e correggi.',
      ].join('\n'),
    };
  }
  return {
    ferma: true,
    testo: [
      'Consegna respinta: hai cancellato prove del giro che sul codice nuovo sono ancora rosse.',
      elenco,
      'Nessun rilievo di questo giro è stato messo da parte, quindi ognuna riproduce un rilievo che dovevi',
      `chiudere: la porta è ancora aperta. Rimetti la prova (git checkout ${String(shaPrima).slice(0, 12) || '<commit della critica>'} -- <file>),`,
      'correggi finché è verde, e consegna di nuovo. Una prova si cancella solo verde, insieme alla prova',
      'durevole che la sostituisce.',
    ].join('\n'),
  };
}

function gitOut(args, root) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Le prove del giro cancellate fra `shaPrima` e HEAD. null se git non risponde. */
export function proveTolteDal(shaPrima, root) {
  try {
    const out = gitOut(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=D', shaPrima, 'HEAD', '--', PROVE_GIRO], root);
    return proveTolte(out.split('\0').filter(Boolean));
  } catch (_) { return null; }
}

/**
 * Rilancia le prove tolte, ciascuna nella sua cartella com'era a `shaPrima` e col codice di adesso.
 * `{ rosse, motivo }`: `motivo` non vuoto = non si è potuto rilanciare, e non è un via libera.
 */
export function rilanciaProveTolte(prove, shaPrima, root, { lancia = spawnSync, log = console.log } = {}) {
  const schermo = preparaLancioElectron('npx', []);
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
    log(`Rilancio ${prove.length} ${prove.length === 1 ? 'prova' : 'prove'} del giro cancellate in questa correzione, sul codice nuovo:`);
    for (const p of prove) {
      const l = preparaLancioElectron('npx', ['playwright', 'test', percorsoRipristino(p, etichetta), '--retries=1']);
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
export function controllaProveTolte({ shaPrima, root, messiDaParte = 0, log = console.log, lancia } = {}) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(shaPrima || ''))) {
    return { ferma: false, testo: 'Non so da che commit è partita la correzione: le prove del giro cancellate non le rilancio.' };
  }
  const prove = proveTolteDal(shaPrima, root);
  if (prove === null) return { ferma: false, testo: 'Git non mi dice quali prove del giro sono state cancellate: non le rilancio.' };
  if (!prove.length) return { ferma: false, testo: '' };
  const r = rilanciaProveTolte(prove, shaPrima, root, { log, ...(lancia ? { lancia } : {}) });
  if (r.motivo) return { ferma: true, testo: `Consegna respinta: ${r.motivo}` };
  return esitoProveTolte({ rosse: r.rosse, messiDaParte, shaPrima });
}

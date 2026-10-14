// Le automazioni (.github/workflows) le spinge solo l'owner, a mano (#1140): quali commit da spedire le cambiano, e
// come si riconosce il rifiuto di GitHub. Non spinge e non toglie niente. La regola e il perché:
// patterns/le-automazioni-le-spinge-solo-l-owner-a-mano.md (gemello in bash: .claude/hooks/auto-commit-merge.sh).

import { execFileSync } from 'node:child_process';

export const CARTELLA_AUTOMAZIONI = '.github/workflows/';

/**
 * I file di automazione cambiati dai commit di `ref` che origin non ha ancora. `-c`: una fusione conta solo per ciò
 * che cambia rispetto a TUTTI i genitori, così riallinearsi a main non ferma il ramo.
 */
export function automazioniDaSpedire(root, ref = 'HEAD', { exec = execFileSync } = {}) {
  let out = '';
  try {
    out = String(exec('git', ['log', '--format=', '--name-only', '--no-renames', '-c', '-z', ref, '--not', '--remotes=origin'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }) || '');
  } catch (_) { return []; }
  const visti = new Set();
  for (const nome of out.split('\0')) {
    const f = nome.replace(/^\n/, '');
    if (f.startsWith(CARTELLA_AUTOMAZIONI)) visti.add(f);
  }
  return [...visti];
}

/** Il rifiuto di GitHub a una credenziale senza il permesso sulle automazioni (OAuth, App o token personale). */
export function rifiutoPerAutomazioni(testo) {
  return /refusing to allow[\s\S]*workflow/i.test(String(testo || ''));
}

export function cosaFareConUnAutomazione({ routine = true } = {}) {
  return routine
    ? 'Da una routine non parte: togli quel cambiamento dalla storia del ramo e, se il lavoro ne ha bisogno, consegnalo ai lavori locali (--reason locale) scrivendo nelle note cosa cambiare.'
    : 'La spinge l\'owner a mano, con la credenziale per le automazioni (patterns/le-automazioni-le-spinge-solo-l-owner-a-mano.md).';
}

export function avvisoAutomazioni(file, { routine = true } = {}) {
  return `i commit da spedire cambiano un'automazione (${file.join(', ')}), e le automazioni le spinge solo l'owner (#1140). ${cosaFareConUnAutomazione({ routine })}`;
}

export function avvisoRifiutoAutomazioni(motivo, { routine = true } = {}) {
  return `GitHub ha rifiutato il push: porta un cambiamento a un'automazione, anche solo arrivato da main, e le automazioni le spinge solo l'owner (#1140). ${cosaFareConUnAutomazione({ routine })} Il motivo di GitHub: ${motivo}`;
}

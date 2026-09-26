// Una critica vale per il codice che la verifica ha trovato all'avvio: fuori dalle prove del giro il ramo
// non deve essersi mosso. Lo usano verify-local (critica) e dispatch (--record-verifier).
// Unit test: tests/unit/codiceFermo.test.mjs.

import { execFileSync } from 'node:child_process';

const PROVE_GIRO = 'tests/verifica/';

/** I file cambiati che non sono prove dei giri. PURA. */
export function fuoriDalleProve(files) {
  return (Array.isArray(files) ? files : [])
    .map((f) => String(f || '').replace(/\\/g, '/'))
    .filter((f) => f && !f.startsWith(PROVE_GIRO));
}

/** `{ cambiati, motivo }`: i file cambiati da `shaAvvio` a HEAD fuori dalle prove. Senza sha, niente. */
export function codiceCambiatoDallAvvio(shaAvvio, root) {
  const sha = String(shaAvvio || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return { cambiati: [], motivo: 'nessun commit d\'avvio registrato' };
  try {
    const out = execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', sha, 'HEAD'],
      { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
    return { cambiati: fuoriDalleProve(out.split('\0').filter(Boolean)), motivo: '' };
  } catch (_) {
    return { cambiati: [], motivo: `git non confronta ${sha.slice(0, 8)} con la punta` };
  }
}

/** Il rifiuto, con l'elenco e il rimedio. PURA. */
export function testoCodiceCambiato(cambiati, shaAvvio) {
  const sha = String(shaAvvio || '').slice(0, 12);
  const elenco = cambiati.slice(0, 30).map((f) => `  ${f}`).join('\n');
  const altri = cambiati.length > 30 ? `\n  … e altri ${cambiati.length - 30}` : '';
  return [
    `critica non registrata: dall'avvio della verifica (${sha}) il ramo è cambiato fuori dalle prove del giro, quindi`,
    'la critica parlerebbe di un codice diverso da quello da verificare. Di solito è il salvataggio automatico che',
    'ha committato i file rimessi a mano per provare una prova senza la correzione.',
    elenco + altri,
    `Rimettili com'erano all'avvio (git checkout ${sha} -- <file>; un file che all'avvio non c'era si toglie con`,
    'git rm), porta la directory a un commit e registra di nuovo la stessa critica. Se hai provato qualcosa mentre',
    'il codice era diverso, ricontrolla quella prova prima di registrare.',
  ].join('\n');
}

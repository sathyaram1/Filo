// strumenti-vecchi.mjs — gli strumenti fissati di questa sessione sono indietro rispetto a main?
// Guarda soltanto (scarica main, non tocca la cartella): decide chi chiama. Una sessione vecchia non prende lavoro
// nuovo, e un ruolo che non conosce non è un guasto da dichiarare (#1796). Prove: tests/unit/strumentiVecchi.test.mjs.

import { execFileSync } from 'node:child_process';
import { TOOLS_ROOT, pinnedCommit, lavoroGiaPreso } from './tools-pin.mjs';

// Il contratto fra server e strumenti sta qui: un cambio altrove (l'app, le note di versione) non fa vecchia una sessione.
export const CARTELLE_DEL_CONTRATTO = ['scripts', 'routines'];

const primaRiga = (s) => String(s || '').split(/\r?\n/).find((r) => r.trim()) || '';
const corto = (sha) => String(sha || '').slice(0, 9);

/**
 * @returns {{ indietro: boolean, verificato: boolean, motivo: string, pin?: string, main?: string, scaricato?: boolean }}
 *   `verificato` false: non si è potuto guardare (niente pin, main assente, pin fuori da main), e non vale come «indietro».
 */
export function strumentiIndietro(repoRoot, { toolsRoot = TOOLS_ROOT, main = 'main', scarica = true } = {}) {
  const pin = pinnedCommit(toolsRoot);
  if (!pin) return { indietro: false, verificato: false, motivo: 'strumenti non fissati da un commit noto' };
  const git = (args) => {
    try {
      return { ok: true, code: 0, out: execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 }).trim() };
    } catch (e) {
      return { ok: false, code: typeof e.status === 'number' ? e.status : -1, out: `${e.stderr || ''}`.trim() || String(e.message || e) };
    }
  };
  const ref = `refs/remotes/origin/${main}`;
  // Refspec esplicito: in un clone a ramo singolo `fetch origin main` non aggiorna origin/main.
  const f = scarica ? git(['fetch', '--quiet', 'origin', `+refs/heads/${main}:${ref}`]) : { ok: true };
  const punta = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (!punta.ok) {
    return { indietro: false, verificato: false, pin, motivo: `origin/${main} non c'è${f.ok ? '' : `, e non si scarica (${primaRiga(f.out)})`}` };
  }
  const base = { pin, main: punta.out, scaricato: f.ok };
  if (punta.out === pin) return { ...base, indietro: false, verificato: true, motivo: '' };
  const antenato = git(['merge-base', '--is-ancestor', pin, punta.out]);
  if (!antenato.ok) {
    return {
      ...base, indietro: false, verificato: false,
      motivo: antenato.code === 1 ? `gli strumenti (${corto(pin)}) non vengono da origin/${main}` : `il commit degli strumenti ${corto(pin)} non si legge (${primaRiga(antenato.out)})`,
    };
  }
  const diff = git(['diff', '--quiet', pin, punta.out, '--', ...CARTELLE_DEL_CONTRATTO]);
  if (diff.ok) return { ...base, indietro: false, verificato: true, motivo: '' };
  if (diff.code !== 1) return { ...base, indietro: false, verificato: false, motivo: `il confronto con origin/${main} non riesce (${primaRiga(diff.out)})` };
  return {
    ...base, indietro: true, verificato: true,
    motivo: `gli strumenti di questa sessione vengono da ${corto(pin)}, e su ${main} (${corto(punta.out)}) ${CARTELLE_DEL_CONTRATTO.map((c) => `${c}/`).join(' o ')} sono cambiati`,
  };
}

/**
 * Prima di chiedere un biglietto: '' se si può chiedere, altrimenti il testo con cui la sessione chiude.
 * Il primo biglietto non si nega: gli strumenti li ha appena fissati il preflight da main, e una sessione accesa che
 * chiude prima del suo primo biglietto per il pacemaker è nata morta, e lo frena.
 */
export function sessioneDaChiudere(repoRoot, { toolsRoot = TOOLS_ROOT, main = 'main', scarica = true } = {}) {
  if (!pinnedCommit(toolsRoot) || !lavoroGiaPreso(toolsRoot)) return { chiudi: false, testo: '' };
  const v = strumentiIndietro(repoRoot, { toolsRoot, main, scarica });
  if (!v.indietro) return { chiudi: false, testo: '', ...(v.verificato ? {} : { avviso: `strumenti non confrontati con ${main}: ${v.motivo}` }) };
  return {
    chiudi: true,
    testo: `niente da fare (strumenti_vecchi): ${v.motivo}. Una sessione con gli strumenti vecchi non prende lavoro nuovo: `
      + 'chiudi il giro, il pacemaker ne accende una con quelli aggiornati. Il server non è stato chiamato.',
  };
}

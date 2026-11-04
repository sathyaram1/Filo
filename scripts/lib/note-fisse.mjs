// Le note di servizio che gli strumenti compongono da sé (#1428.1): un elenco chiuso di modelli, coi parametri
// controllati. Solo una nota nata qui passa senza biglietto pulito (owner-feedback, scrivi); un testo scelto dalla
// sessione no, e da riga di comando una nota fissa non si chiede. Prove: tests/unit/noteFisse.test.mjs.

import { NOME_PARTE, ramoValido } from './parti-lavoro.mjs';

const NATE = new WeakSet();
function nota(testo) {
  const n = Object.freeze({ testo });
  NATE.add(n);
  return n;
}

/** È una nota composta da un modello di qui? Un oggetto con la stessa forma, fatto altrove, no. */
export function notaFissa(n) {
  return Boolean(n && typeof n === 'object' && NATE.has(n));
}

// I parametri non portano testo: ognuno ha la sua forma, e una forma diversa ferma lo strumento invece di finire in nota.
function no(cosa, v) {
  throw new TypeError(`nota fissa: ${cosa} non valido (${JSON.stringify(v)?.slice(0, 80)})`);
}
const numero = (v) => (Number.isFinite(v) ? String(v) : no('numero', v));
const intero = (v) => (Number.isInteger(v) ? String(v) : no('numero intero', v));
const versione = (v) => (!v ? 'n/d' : /^\d+(\.\d+){1,3}([-+][0-9A-Za-z.-]{1,40})?$/.test(String(v)) ? String(v) : no('versione', v));
const ramo = (v) => (ramoValido(v) && String(v).length <= 200 ? String(v) : no('ramo', v));
const sha = (v) => (/^[0-9a-f]{0,40}$/.test(String(v || '')) ? String(v || '') : no('sha', v));
const pratica = (v) => (/^[A-Za-z0-9._-]{1,40}$/.test(String(v || '')) ? String(v) : no('numero della pratica', v));
const parte = (v) => (Object.prototype.hasOwnProperty.call(NOME_PARTE, v) ? NOME_PARTE[v] : no('parte', v));
function quando(v) {
  const t = typeof v === 'number' ? v : Date.parse(String(v || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : no('data', v);
}
// I rami dell'app legati alla pratica vengono dai checkout locali: un nome di ramo git, senza spazi né virgolette.
const ramoGit = (v) => (/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(String(v)) && !/\.\./.test(v) && String(v).length <= 200 ? String(v) : no('ramo', v));
const rami = (v) => (Array.isArray(v) ? v.map(ramoGit) : no('elenco di rami', v));

// ── Le frasi di server:fondi, che lo strumento stampa anche sul terminale ──────────────────────────────────────────

export const testoFine = (r, s, daGitHub = false) => `Fuso su main di filo-security: ${ramo(r)}${sha(s) ? ` a ${sha(s).slice(0, 9)}` : ''}. ${daGitHub
  ? 'In produzione lo porta GitHub (deploy.yml).'
  : 'In produzione va col deploy, npm run server:pubblica.'}`;

export const chiudeApp = ({ ramiApp = [], numero: n }) => `la chiude la fusione di ${rami(ramiApp).length ? rami(ramiApp).join(', ') : 'quella parte'} (npm run finish -- --feedback ${pratica(n)})`;

export const comandoSoloServer = ({ ramo: r, numero: n }) => `npm run server:fondi -- ${ramo(r)} --feedback ${pratica(n)} --solo-server`;

export const percheRiaperta = ({ chiusaDa = 'app', quando: q, ramiApp }) => `l'aveva chiusa la fusione della parte ${parte(chiusaDa)} (${quando(q)}), ma ${rami(ramiApp).join(', ')} dell'app è legato a questa pratica e non è su main. Le parti già su main ripartono da zero.`;

/** L'elenco chiuso. Un modello nuovo si aggiunge qui, coi suoi parametri controllati: mai un testo passato da fuori. */
export const NOTE_FISSE = Object.freeze({
  autoArchivio: ({ punteggio, versione: v }) => nota(`auto-archiviato (DC3): punteggio ${numero(punteggio)} dopo 24h+ dalla messa in produzione (${versione(v)}).`),
  serverInizio: ({ ramo: r }) => nota(`Lavoro sul server: porto ${ramo(r)} su main di filo-security (npm run server:fondi).`),
  serverRiaperta: (p) => nota(`Riaperta da server:fondi su ${ramo(p.ramo)}: ${percheRiaperta(p)}`),
  serverFermo: ({ ramo: r, uscita }) => nota(`server:fondi si è fermato (uscita ${intero(uscita)}) su ${ramo(r)}: main del server non si è mosso.`),
  serverFineTardiva: ({ ramo: r, sha: s, daGitHub, quando: q }) => nota(`${testoFine(r, s, !!daGitHub)} Era l'ultima parte: la pratica l'aveva chiusa la fusione della parte ${NOME_PARTE.app} dello stesso lavoro (${quando(q)}), e resta chiusa.`),
  serverFineAperta: ({ ramo: r, sha: s, daGitHub, ramiApp = [], numero: n }) => nota(`${testoFine(r, s, !!daGitHub)} La pratica resta aperta: manca la parte ${NOME_PARTE.app}, non ancora su main, e ${chiudeApp({ ramiApp, numero: n })}.${rami(ramiApp).length ? '' : ` Se il lavoro stava solo sul server: ${comandoSoloServer({ ramo: r, numero: n })}.`}`),
  serverFineChiusa: ({ ramo: r, sha: s, daGitHub, solo = false }) => nota(solo
    ? `${testoFine(r, s, !!daGitHub)} Il lavoro stava solo sul server (--solo-server).`
    : testoFine(r, s, !!daGitHub)),
});

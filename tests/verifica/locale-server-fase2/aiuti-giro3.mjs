// Aiuti delle prove del giro 3 sul lavoro server fase 2: scenari con le dipendenze finte del cancello del server e del
// «Salta il controllo». File di supporto, non una prova: se una cura chiede una dipendenza nuova, si aggiunge qui.

import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import {
  richiediServer, sha, mainDiFilo, scriviAlbero, refDiFilo, alberoVisto, bakeIn, statoPassato, registro, gitHubFinto,
} from './aiuti-giro2.mjs';

export const ORA = (hhmm) => Date.parse(`2026-10-14T${hhmm}:00Z`);

/**
 * Un lavoro misto delle routine: transizioni cambiate nell'app, generati del server rifatti dal ramo dell'app com'era
 * alla spinta del server (09:59, A1); la suite parte lì. `appDopo`: una correzione cambia di nuovo le transizioni nell'app
 * (10:30, A2) senza toccare il server. Poi verifica e sicurezza passano sulla punta e il cancello del server gira (11:00).
 * → { suite, risposta, serverAvanzato, appFusa, pubblicazione() → file che il bake da main di Filo cambia }.
 */
export async function scenarioMisto({ appDopo, tmp = [] }) {
  const T = cartellaTemporanea('filo-giro3-misto-');
  tmp.push(T);
  const fonti = ['src/shared/feedbackTransitions.js', 'src/shared/verifierRound.js', 'src/shared/domande.js', 'filo_filosofia.txt'];
  const daMain = Object.fromEntries(fonti.map((f) => [f, mainDiFilo(f)]));
  const tr = daMain['src/shared/feedbackTransitions.js'];
  const a1 = tr.replace(/const CIPHER_PAD = \d+;/, 'const CIPHER_PAD = 40;');
  const a2 = tr.replace(/const CIPHER_PAD = \d+;/, 'const CIPHER_PAD = 48;');
  if (a1 === tr || a2 === a1) throw new Error('le transizioni non si lasciano cambiare: aggiorna lo scenario');
  const main = scriviAlbero(join(T, 'filo-main'), daMain);
  const ramoAllaSuite = scriviAlbero(join(T, 'filo-ramo-a1'), { ...daMain, 'src/shared/feedbackTransitions.js': a1 });
  const ramoFinale = appDopo ? scriviAlbero(join(T, 'filo-ramo-a2'), { ...daMain, 'src/shared/feedbackTransitions.js': a2 }) : ramoAllaSuite;

  const generati = join(T, 'generati-del-ramo');
  bakeIn(ramoAllaSuite, generati);
  const cambiaCon = (filo, nome) => {
    const copia = join(T, nome);
    cpSync(generati, copia, { recursive: true });
    return bakeIn(filo, copia);
  };
  const suite = cambiaCon(alberoVisto(refDiFilo('suite.yml'), { suRamo: true, main, ramo: ramoAllaSuite }), 'suite').length ? 'failure' : 'success';

  const S = { main: sha('1'), punta: sha('2'), diff: 'diff --git a/functions/src/x.js b/functions/src/x.js\n' };
  const A = { main: sha('3'), punta: appDopo ? sha('5') : sha('4'), diff: 'diff --git a/src/shared/feedbackTransitions.js b/src/shared/feedbackTransitions.js\n' };
  const github = gitHubFinto({ server: S, app: A, suite });
  const corse = github.workflowRuns;
  github.workflowRuns = async (file, n, o = {}) => {
    const r = await corse(file, n, o);
    for (const c of r.runs) Object.assign(c, { createdAt: new Date(ORA('09:59')).toISOString(), event: 'push', id: 7, headSha: o.headSha || '' });
    return r;
  };
  github.isAncestor = async () => ({ ok: true, ancestor: true });
  const registri = {
    server: registro([['lavoratore', S.punta, ORA('09:59')]]),
    app: registro(appDopo ? [['lavoratore', sha('4'), ORA('09:58')], ['correttore', A.punta, ORA('10:30')]] : [['lavoratore', A.punta, ORA('09:58')]]),
  };
  const stato = statoPassato({ app: A.punta, server: S.punta, ramo: 'claude/lavoro-misto' });
  const scritto = { stato: [], feedback: [], rimandi: [], owner: [] };
  const { cancelloServer } = richiediServer('src/routine/fusioneServer.js');
  const doc = { _id: 'fb-g3', localOnly: { by: 'owner', at: 1 }, fiducia: 'fidato', branch: 'claude/lavoro-misto', status: 'revision_security' };
  const out = await cancelloServer({
    feedbackId: 'fb-g3', doc, ramo: 'claude/lavoro-misto',
    deps: {
      github, nowMs: ORA('11:00'), gates: () => ({ passed: true }),
      fondiApp: async () => { github.chiamate.push(['fondiApp']); return { ok: true, result: 'merged', sha: A.punta }; },
      leggiPubblica: async () => ({ cancelloAvanza: { at: 1, via: 'pc' } }),
      scriviPubblica: async () => {},
      readState: async () => stato,
      writeState: async (id, patch) => { scritto.stato.push(patch); },
      scriviFeedback: async (id, campi) => { scritto.feedback.push(campi); },
      readRamo: async (repo) => registri[repo === 'server' ? 'server' : 'app'],
      registraSulRamo: async () => {},
      annota: async () => {},
      realign: async (id, b, ms, x) => { scritto.rimandi.push(x); return true; },
      portaAllOwner: async (id, d, b, nota) => { scritto.owner.push(nota); return { ok: true }; },
    },
  });
  return {
    suite,
    risposta: out && out.risposta,
    serverAvanzato: github.chiamate.some((c) => c[0] === 'avanzaMain' && c[2] === 'server'),
    appFusa: github.chiamate.some((c) => c[0] === 'fondiApp'),
    pubblicazione: () => cambiaCon(ramoFinale, 'pubblicazione'),
    scritto,
  };
}

/**
 * «Salta il controllo» dell'owner su un lavoro server delle routine: verifica passata su app e server, controllo di
 * sicurezza bocciato, pratica in `design`. → { esito, appFusa, serverAvanzato, chiusa, stato }.
 */
export async function saltaSuLavoroServer() {
  const { runSkipSecaudit } = richiediServer('src/routine/skipSecaudit.js');
  const S = { main: sha('1'), punta: sha('2'), diff: 'diff --git a/functions/src/x.js b/functions/src/x.js\n' };
  const A = { main: sha('3'), punta: sha('4'), diff: 'diff --git a/src/pages/x.js b/src/pages/x.js\n+x\n' };
  const github = gitHubFinto({ server: S, app: A });
  github.isAncestor = async () => ({ ok: true, ancestor: true });
  github.mergeSha = async (s, msg, o = {}) => { github.chiamate.push(['mergeSha', s, o.repo || 'app']); return { ok: true, status: 'merged', sha: sha('5') }; };
  github.mergeDryRun = async () => ({ ok: true, status: 'clean' });
  const ramo = 'worker/lavoro-server-1';
  let stato = {
    branch: ramo, lavoroServer: true, verifierVerdict: 'pass', verifiedSha: A.punta, verifiedShaServer: S.punta,
    secauditDone: true, secauditVerdict: 'fail', secauditSha: A.punta, secauditShaServer: S.punta,
  };
  const doc = {
    _id: 'fb-salta', seq: 9, status: 'design', statusReason: 'secaudit', localOnly: { by: 'owner', at: 1 }, fiducia: 'fidato',
    branch: ramo, livelli: { l4: { esito: 'fail', testo: 'bocciato' } },
  };
  const chiusa = [];
  const registri = { server: registro([['lavoratore', S.punta, ORA('09:59')]]), app: registro([['lavoratore', A.punta, ORA('09:58')]]) };
  const esito = await runSkipSecaudit({
    admin: true, who: 'owner', feedbackId: doc._id, nowMs: ORA('11:00'),
    store: { readState: async () => stato, writeState: async (id, s) => { stato = Object.assign({}, stato, s); } },
    github, gates: () => ({ passed: true }),
    readFeedback: async () => doc, applyStatus: async () => ({ ok: true }), openApproval: async () => 'richiesta',
    close: async (id, b, s) => { chiusa.push({ id, ramo: b, sha: s }); },
    realign: async () => true, discardFailed: async () => {},
    readRamo: async (repo) => registri[repo === 'server' ? 'server' : 'app'],
    recordSkipped: async () => {},
  });
  return {
    esito,
    appFusa: github.chiamate.some((c) => (c[0] === 'mergeSha' || c[0] === 'avanzaMain') && c[2] !== 'server'),
    serverAvanzato: github.chiamate.some((c) => (c[0] === 'avanzaMain' || c[0] === 'mergeSha') && c[2] === 'server'),
    chiusa,
    stato,
  };
}

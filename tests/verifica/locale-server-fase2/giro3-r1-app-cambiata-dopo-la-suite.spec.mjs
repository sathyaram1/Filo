// Giro 3, rilievo 1: in un lavoro misto la suite del server prova il ramo omonimo di Filo com'era alla spinta del server.
// Se poi cambia solo la parte dell'app (una correzione), il cancello non deve portare su main una coppia che la suite non
// ha mai visto e che la pubblicazione non regge. Corse di GitHub simulate dai workflow veri; non apre Filo.

import { test, expect } from '@playwright/test';
import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import {
  SERVER, richiediServer, sha, mainDiFilo, scriviAlbero, refDiFilo, alberoVisto, bakeIn, statoPassato, registro, gitHubFinto,
} from './aiuti-giro2.mjs';

const RAMO = 'claude/lavoro-misto';
const ORA = (hhmm) => Date.parse(`2026-10-14T${hhmm}:00Z`);
const tmp = [];
test.afterAll(() => { for (const d of tmp) try { rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ } });

/**
 * Il lavoro misto: transizioni cambiate nell'app e generati del server rifatti dal ramo dell'app com'era alla spinta del
 * server (A1). `appDopo`: una correzione cambia ancora le transizioni nell'app (A2) dopo la suite, senza toccare il server.
 */
async function scenario({ appDopo }) {
  const T = cartellaTemporanea('filo-giro3-r1-');
  tmp.push(T);
  const fonti = ['src/shared/feedbackTransitions.js', 'src/shared/verifierRound.js', 'src/shared/domande.js', 'filo_filosofia.txt'];
  const daMain = Object.fromEntries(fonti.map((f) => [f, mainDiFilo(f)]));
  const tr = daMain['src/shared/feedbackTransitions.js'];
  const a1 = tr.replace(/const CIPHER_PAD = \d+;/, 'const CIPHER_PAD = 40;');
  const a2 = tr.replace(/const CIPHER_PAD = \d+;/, 'const CIPHER_PAD = 48;');
  expect(a1).not.toBe(tr);
  expect(a2).not.toBe(a1);
  const main = scriviAlbero(join(T, 'filo-main'), daMain);
  const ramoAllaSuite = scriviAlbero(join(T, 'filo-ramo-a1'), { ...daMain, 'src/shared/feedbackTransitions.js': a1 });
  const ramoFinale = appDopo ? scriviAlbero(join(T, 'filo-ramo-a2'), { ...daMain, 'src/shared/feedbackTransitions.js': a2 }) : ramoAllaSuite;

  // Il ramo del server porta i generati rifatti dal ramo dell'app com'era quando il server è stato spinto.
  const generati = join(T, 'generati-del-ramo');
  bakeIn(ramoAllaSuite, generati);
  const cambiaCon = (filo, nome) => {
    const copia = join(T, nome);
    cpSync(generati, copia, { recursive: true });
    return bakeIn(filo, copia);
  };
  // La suite parte alla spinta del server (09:59) e prende il ramo omonimo di Filo com'è in quel momento.
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
  const stato = statoPassato({ app: A.punta, server: S.punta, ramo: RAMO });
  const scritto = { stato: [], feedback: [], rimandi: [], owner: [] };
  const { cancelloServer } = richiediServer('src/routine/fusioneServer.js');
  const doc = { _id: 'fb-g3', localOnly: { by: 'owner', at: 1 }, fiducia: 'fidato', branch: RAMO, status: 'revision_security' };
  const out = await cancelloServer({
    feedbackId: 'fb-g3', doc, ramo: RAMO,
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
  const serverAvanzato = github.chiamate.some((c) => c[0] === 'avanzaMain' && c[2] === 'server');
  const appFusa = github.chiamate.some((c) => c[0] === 'fondiApp');
  // Fuse le due parti, GitHub pubblica: bake da main di Filo, che adesso è il ramo finale dell'app.
  const pubblicazione = () => cambiaCon(ramoFinale, 'pubblicazione');
  return { suite, risposta: out && out.risposta, serverAvanzato, appFusa, pubblicazione, scritto };
}

test.describe('r1 lavoro misto: la parte dell’app cambiata dopo la suite del server', () => {
  test.skip(!SERVER, 'il worktree di filo-security accanto a questo non c’è');

  test('r1 controllo: con l’app ferma dalla spinta del server la coppia va su main e la pubblicazione la regge', async () => {
    const s = await scenario({ appDopo: false });
    expect(s.suite).toBe('success');
    expect(s.serverAvanzato, `il cancello non porta il server su main: ${JSON.stringify(s.risposta)}`).toBe(true);
    expect(s.appFusa).toBe(true);
    expect(s.pubblicazione()).toEqual([]);
  });

  test('r1 una correzione solo nell’app dopo la suite non porta su main una coppia che la pubblicazione ferma alla guardia', async () => {
    const s = await scenario({ appDopo: true });
    expect(s.suite, 'la suite del ramo del server, partita prima della correzione, è verde').toBe('success');
    if (s.serverAvanzato || s.appFusa) {
      expect(s.pubblicazione(), 'app e server fusi con una suite che ha provato la parte dell’app di prima: GitHub ferma la pubblicazione dopo il bake e accende l’allarme').toEqual([]);
    }
  });
});

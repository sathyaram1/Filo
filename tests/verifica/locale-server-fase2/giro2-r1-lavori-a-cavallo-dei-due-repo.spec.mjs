// Giro 2, rilievo 1: un lavoro server la cui parte dell'app è legata al server (lista dei fornitori esclusi confrontata
// dalle prove del server, fonti che il server incorpora) deve arrivare su main e in produzione senza tornare in loop alle
// routine. Le corse di GitHub si simulano dai workflow veri; non apre Filo.

import { test, expect } from '@playwright/test';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import {
  ROOT, SERVER, FUNZIONI, richiediServer, sha, mainDiFilo, scriviAlbero, refDiFilo, alberoVisto, bakeIn, statoPassato,
  registro, gitHubFinto, depsCancello,
} from './aiuti-giro2.mjs';

const RAMO = 'claude/lavoro-a-cavallo';
const tmp = [];
test.afterAll(() => { for (const d of tmp) try { rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ } });

/** Il cancello davanti a un ramo del server fidato, verificato e controllato sulla punta, con la suite di GitHub data. */
async function cancello(suite) {
  const { cancelloServer } = richiediServer('src/routine/fusioneServer.js');
  const S = { main: sha('1'), punta: sha('2'), diff: 'diff --git a/functions/src/x.js b/functions/src/x.js\n' };
  const A = { main: sha('3'), punta: sha('4'), diff: 'diff --git a/src/shared/x.js b/src/shared/x.js\n' };
  const github = gitHubFinto({ server: S, app: A, suite });
  const { deps, scritto } = depsCancello({
    github,
    stato: statoPassato({ app: A.punta, server: S.punta, ramo: RAMO }),
    reg: registro([['lavoratore', S.punta, 5_000]]),
  });
  const doc = { _id: 'fb-r1', localOnly: { by: 'owner', at: 1 }, fiducia: 'fidato', branch: RAMO, status: 'revision_security' };
  const out = await cancelloServer({ feedbackId: 'fb-r1', doc, ramo: RAMO, deps });
  return { risposta: out && out.risposta, scritto };
}

const ESITI_BUONI = ['merged', 'attesa_deploy', 'attesa_pc'];
const esitoDi = (r) => (r && r.result === 'server' ? r.esito : r && r.result) || JSON.stringify(r);

test.describe('r1 lavoro server con la parte dell’app legata al server', () => {
  test.skip(!SERVER, 'il worktree di filo-security accanto a questo non c’è');

  test('r1 la lista dei fornitori esclusi cambiata dalle due parti va su main del server senza tornare alle routine', async () => {
    const T = cartellaTemporanea('filo-giro2-r1-contratto-');
    tmp.push(T);
    const costanti = mainDiFilo('src/shared/constants.js');
    const conNuovo = (testo, re) => {
      const fuori = testo.replace(re, (m) => `${m}\n    'NuovoLab',`);
      expect(fuori, 'la lista non si trova').not.toBe(testo);
      return fuori;
    };
    const main = scriviAlbero(join(T, 'filo-main'), { 'src/shared/constants.js': costanti });
    const ramo = scriviAlbero(join(T, 'filo-ramo'), {
      'src/shared/constants.js': conNuovo(costanti, /const DEFAULT_EXCLUDED_PROVIDERS = \[/),
    });
    // La parte del server dello stesso lavoro: la sua copia della lista, con lo stesso fornitore in più.
    const srv = join(T, 'server', 'functions');
    cpSync(join(FUNZIONI, 'src'), join(srv, 'src'), { recursive: true });
    mkdirSync(join(srv, 'test'), { recursive: true });
    cpSync(join(FUNZIONI, 'test', 'modelPolicy.test.js'), join(srv, 'test', 'modelPolicy.test.js'));
    const mp = join(srv, 'src', 'modelPolicy.js');
    scriviAlbero(srv, { 'src/modelPolicy.js': conNuovo(readFileSync(mp, 'utf8'), /const DEFAULT_EXCLUDED_PROVIDERS = \[/) });

    const prova = (filo) => spawnSync(process.execPath, ['--test', '--test-name-pattern=repo pubblico', join(srv, 'test', 'modelPolicy.test.js')], {
      encoding: 'utf8', env: { ...process.env, FILO_PUBLIC_REPO: filo, NODE_PATH: join(FUNZIONI, 'node_modules') },
    });
    const coerente = prova(ramo);
    expect(coerente.status, `il lavoro è coerente: chi lavora e chi verifica vedono verde\n${coerente.stdout.slice(-1500)}`).toBe(0);

    const suite = prova(alberoVisto(refDiFilo('suite.yml'), { suRamo: true, main, ramo })).status === 0 ? 'success' : 'failure';
    const { risposta, scritto } = await cancello(suite);
    expect(scritto.rimandi, `suite di GitHub sul ramo del server: ${suite}; il lavoro torna alle routine per una correzione che col checkout del lavoro non trova rossi`).toEqual([]);
    expect(ESITI_BUONI).toContain(esitoDi(risposta));
  });

  test('r1 le transizioni cambiate dalle due parti arrivano in produzione: suite e pubblicazione vedono la parte dell’app', async () => {
    const T = cartellaTemporanea('filo-giro2-r1-incorporate-');
    tmp.push(T);
    const fonti = ['src/shared/feedbackTransitions.js', 'src/shared/verifierRound.js', 'src/shared/domande.js', 'filo_filosofia.txt'];
    const daMain = Object.fromEntries(fonti.map((f) => [f, mainDiFilo(f)]));
    const transizioni = daMain['src/shared/feedbackTransitions.js'];
    const nuove = transizioni.replace(/const CIPHER_PAD = \d+;/, 'const CIPHER_PAD = 40;');
    expect(nuove).not.toBe(transizioni);
    const main = scriviAlbero(join(T, 'filo-main'), daMain);
    const ramo = scriviAlbero(join(T, 'filo-ramo'), { ...daMain, 'src/shared/feedbackTransitions.js': nuove });

    // I generati che il ramo del server porta: rigenerati dal checkout del lavoro, come chiedono le prove del server.
    const generati = join(T, 'generati-del-ramo');
    bakeIn(ramo, generati);
    const cambiaCon = (filo, nome) => {
      const copia = join(T, nome);
      cpSync(generati, copia, { recursive: true });
      return bakeIn(filo, copia);
    };

    const suite = cambiaCon(alberoVisto(refDiFilo('suite.yml'), { suRamo: true, main, ramo }), 'suite').length ? 'failure' : 'success';
    const { risposta, scritto } = await cancello(suite);
    expect(scritto.rimandi, `suite di GitHub sul ramo del server: ${suite} sul controllo dei generati`).toEqual([]);
    const esito = esitoDi(risposta);
    expect(ESITI_BUONI).toContain(esito);
    if (esito === 'attesa_deploy') {
      // La parte dell'app aspetta una pubblicazione verde: quella che parte alla fusione vede main di Filo senza l'app.
      const cambiati = cambiaCon(alberoVisto(refDiFilo('deploy.yml'), { suRamo: false, main, ramo }), 'pubblicazione');
      expect(cambiati, 'la pubblicazione si ferma alla guardia dopo il bake: i generati del server non sono quelli di main di Filo').toEqual([]);
    }
  });

  test('r1 dal PC il server si ripubblica dopo l’app per ogni fonte che il server incorpora', async () => {
    const fonti = richiediServer('tools/bake-shared.js').FONTI_PUBBLICHE;
    expect(Array.isArray(fonti), 'elenco delle fonti del bake, quello che la guardia controlla').toBe(true);
    expect(fonti.length).toBeGreaterThan(0);
    const { INCORPORATI_DAL_SERVER } = await import(new URL(`file:///${join(ROOT, 'scripts', 'lib', 'orchestratore.mjs').replace(/\\/g, '/')}`).href);
    expect(fonti.filter((f) => !INCORPORATI_DAL_SERVER.includes(f)), 'fonti incorporate che il PC lascia pubblicare a GitHub col main di Filo di prima').toEqual([]);
  });
});

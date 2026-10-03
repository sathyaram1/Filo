// Prove del giro 1 (verifica locale) sul lavoro «feedback aperti dalle routine e dalle sessioni».
// Percorrono la pipeline vera del server (repo filo-security, worktree omonimo accanto a questo) alla nascita di un
// feedback, con dipendenze finte: nessun Firestore, nessun giudice a pagamento (la rete dei giudici è una funzione
// che registra i messaggi e risponde «aligned»). Nei contenitori delle routine il server non c'è: le prove si saltano.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DESKTOP_FILO = resolve(ROOT, '..', '..', '..', '..');
const FUNZIONI = [
  resolve(DESKTOP_FILO, 'filo-security', '.claude', 'worktrees', basename(ROOT), 'functions'),
  resolve(ROOT, '..', 'filo-security', 'functions'),
  resolve(DESKTOP_FILO, 'filo-security', 'functions'),
].find((d) => existsSync(resolve(d, 'src', 'runner.js'))) || '';

const require = createRequire(import.meta.url);
const server = FUNZIONI ? {
  runner: require(resolve(FUNZIONI, 'src', 'runner.js')),
  judges: require(resolve(FUNZIONI, 'src', 'l2', 'judges.js')),
} : null;

/** Un feedback appena nato, passato dalla pipeline come lo passa il trigger di creazione. */
async function nasce(fb, { cfg = { enabled: true } } = {}) {
  const visto = { status: undefined, priorita: null, messaggiAiGiudici: [] };
  const fetchFinta = async (_url, init) => {
    visto.messaggiAiGiudici.push(JSON.parse(init.body).messages);
    return {
      ok: true, status: 200,
      json: async () => ({ provider: 'Fireworks', choices: [{ message: { content: '{"class":"aligned","reasoning":"ok"}' } }] }),
      text: async () => '',
    };
  };
  const deps = {
    atCreation: true,
    decryptFeedbackFields: async (f) => f,
    identities: {
      countArrival: async () => ({ over: null }),
      collectSignals: async () => ({}),
      flagDangerous: async () => {},
    },
    corpus: { record: async () => {} },
    feedbackState: {
      recordDecision: async (_id, o) => { visto.status = o.status; },
      recordPriority: async (_id, p) => { visto.priorita = p; },
    },
    buildJudges: (_env, opts) => server.judges.buildJudges({ JUDGE_OPENROUTER_KEY: 'chiave-finta' }, { ...opts, fetchImpl: fetchFinta }),
    loadModelConfigDocs: async () => ({ supportModels: null, modelsConfig: null }),
    getAutomationConfig: async () => cfg,
    attachFeedbackImages: async (f) => f,
    augmentFeedbackWithDocuments: async (f) => f,
    buildPriorityJudge: () => ({ run: async () => 2 }),
  };
  await server.runner.runFeedbackPipeline('fb-prova', Object.assign({
    status: 'unlabeled', text: 'testo', files: [], images: [], createdAt: '2026-10-03T10:00:00Z',
  }, fb), deps);
  return visto;
}

test.describe('nascita dei feedback delle routine e delle sessioni', () => {
  test.skip(!server, 'il repo del server non è accanto a questo checkout');

  test('r1: una sessione che apre per le routine senza --priorita entra in coda con una priorità decisa, come ogni altro', async () => {
    // Senza priorità la coda la legge 0 e la mette dietro a tutto: il giudice di priorità è quello che la dà
    // a ogni feedback che entra in coda (è così per i giudicati e per le routine con la coda accesa).
    const v = await nasce({ clientId: 'local:claude', senderProof: 'admin' });
    expect(v.status).toBe('todo');
    expect(v.messaggiAiGiudici).toHaveLength(0);
    expect(v.priorita, 'nessuna priorità decisa per il feedback della sessione entrato in coda').not.toBeNull();
  });

  test('r2: il feedback dell’owner dall’app non arriva a giudici a cui si dice che chi scrive tecnico è sospetto', async () => {
    // L'owner che usa Filo e segnala con parole tecniche: i giudici non sanno che è lui, e la regola nuova
    // («a te arriva solo chi usa Filo», «linguaggio tecnico = sospetto») vale anche per lui. Un voto «attack»
    // basta a fermarlo nei Ricevuti da ri-giudicare, e la ri-valutazione ripete lo stesso giudizio.
    const testo = 'Nella dashboard la routine verifier non rilascia il biglietto: dispatch.mjs stampa fault, il ramo claude/x resta fermo; rilancia il deploy delle functions.';
    const v = await nasce({ clientId: 'owner:me', senderProof: 'admin', text: testo });
    const regolaTecnica = (m) => m.some((x) => x.role === 'system' && /linguaggio molto tecnico/i.test(String(x.content)));
    const sannoCheEOwner = (m) => m.some((x) => x.role !== 'system' && /owner|proprietario/i.test(JSON.stringify(x.content)));
    const sviati = v.messaggiAiGiudici.filter((m) => regolaTecnica(m) && !sannoCheEOwner(m));
    expect(sviati.length, 'giudici istruiti a sospettare del linguaggio tecnico, senza sapere che scrive l’owner').toBe(0);
  });
});

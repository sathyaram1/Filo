// La riapertura dall'app (Riapri e Ripristina, in Gestione e nella pagina dei feedback) svuota il registro delle parti
// di un lavoro locale (#938): lo stato di partenza lo chiede il main al documento. La regola e la scrittura vera stanno
// in tests/unit/praticaRiaperta.test.mjs; qui il pezzo che le lega, il canale del triage.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA_DI_FILO = { url: 'filo://manage/manage.html' };

// Sessione dell'owner finta (un token admin vero in uno spec non esiste) e Firestore finto: il documento com'è adesso
// lo dà `globalThis.__doc`, le scritture finiscono in `__scritture`, le letture in `__letture`.
async function bancoDiProva(app) {
  await app.evaluate(async () => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const ga = req('./auth/google-auth');
    ga.isAdmin = () => true;
    ga.getIdToken = async () => 'tok-di-prova';
    const FB = globalThis.SN_FEEDBACK;
    globalThis.__scritture = [];
    globalThis.__letture = [];
    FB.updateStatus = async (id, campi) => { globalThis.__scritture.push({ id, ...campi, haLocalMerges: 'localMerges' in campi }); return true; };
    FB.getMany = async (ids, opts = {}) => {
      globalThis.__letture.push({ ids, fields: opts.fields || null, idToken: opts.idToken || '' });
      return ids.includes('pratica') && globalThis.__doc ? [globalThis.__doc] : [];
    };
    FB.list = async () => [];
    FB.listPublic = async () => [];
    FB.getPublic = async () => null;
    FB.maxSeq = async () => null;
    FB.ensureSeqCounter = async () => 0;
    FB.publishPublicCard = async () => true;
    FB.unpublishPublicCard = async () => true;
  });
}

async function triage(app, doc, campi) {
  return app.evaluate(async (_e, { doc, campi, mittente }) => {
    globalThis.__doc = doc;
    globalThis.__scritture = [];
    globalThis.__letture = [];
    const MSG = globalThis.SN_MSG.MSG;
    const r = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.FEEDBACK_UPDATE, id: 'pratica', ...campi }, mittente);
    return { r, scritture: globalThis.__scritture, letture: globalThis.__letture };
  }, { doc, campi, mittente: PAGINA_DI_FILO });
}

const PARTI = { app: Date.parse('2026-10-01T10:00:00Z'), server: Date.parse('2026-10-01T11:00:00Z'), ramo: 'claude/lavoro' };

test('Riapri e Ripristina su una pratica chiusa col registro delle parti lo tolgono; gli altri passaggi no', async ({ app, shell }) => {
  void shell;
  await bancoDiProva(app);

  for (const [status, statusPublic] of [['done', 'closed'], ['archived', 'closed']]) {
    const out = await triage(app, { _id: 'pratica', status, statusPublic, localMerges: PARTI }, { status: 'todo', notes: 'manca il caso Y' });
    expect(out.r.ok, `${status} → todo: ${out.r.error || ''}`).toBe(true);
    expect(out.letture, 'lo stato di partenza si chiede al documento, col token dell’owner').toEqual([
      { ids: ['pratica'], fields: ['statusPublic', 'localMerges'], idToken: 'tok-di-prova' },
    ]);
    expect(out.scritture).toHaveLength(1);
    expect(out.scritture[0].status).toBe('todo');
    expect(out.scritture[0].localMerges, `${status} → todo: il registro del giro chiuso resta e chiuderebbe il giro nuovo`).toBeNull();
  }

  // Una pratica aperta che torna in coda (risposta a un chiarimento, approvazione) tiene le sue parti.
  const aperta = await triage(app, { _id: 'pratica', status: 'design', statusPublic: 'open', localMerges: PARTI }, { status: 'todo' });
  expect(aperta.r.ok).toBe(true);
  expect(aperta.scritture[0].localMerges).toBeUndefined();

  // Riaperta senza registro: niente da togliere.
  const senza = await triage(app, { _id: 'pratica', status: 'done', statusPublic: 'closed' }, { status: 'todo' });
  expect(senza.r.ok).toBe(true);
  expect(senza.scritture[0].localMerges).toBeUndefined();

  // Archiviare, o una scrittura senza stato, non riapre: nessuna lettura in più.
  for (const campi of [{ status: 'archived' }, { userNote: 'sistemato' }]) {
    const out = await triage(app, { _id: 'pratica', status: 'done', statusPublic: 'closed', localMerges: PARTI }, campi);
    expect(out.r.ok).toBe(true);
    expect(out.letture.filter((l) => l.fields), JSON.stringify(campi)).toEqual([]);
    expect(out.scritture[0].localMerges).toBeUndefined();
  }
});

// #953 giro 1, rilievo 1: la segnalazione che l'Aiuto scrive su un sito (dopo averne letto la pagina) e l'owner
// conferma non deve partire col suo nome di owner, che la renderebbe fidata e senza giudici. Contro: la chat di Filo.
import { test, expect } from '../../fixtures/electron.mjs';

const TOKEN = 'tok-owner-953';

async function owner(app) {
  await app.evaluate((_e, token) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    ga.isAdmin = () => true;
    ga.isSignedIn = () => true;
    ga.getIdToken = async () => token;
    globalThis.__inviati = [];
    globalThis.SN_FEEDBACK.submit = async (payload, opts) => {
      globalThis.__inviati.push({ clientId: payload.clientId, idToken: !!(opts && opts.idToken) });
      return { id: `doc-${globalThis.__inviati.length}`, seq: 953, failed: [] };
    };
  }, TOKEN);
}

// Come l'Aiuto: la proposta (che apre il popup e lascia il permesso di confermare), poi l'OK dell'owner.
const conferma = (app, url) => app.evaluate(async (_e, url) => {
  const { MSG } = globalThis.SN_MSG;
  const action = () => ({ type: 'INVIA_FEEDBACK', testo: 'Testo scritto dall’Aiuto dopo aver letto la pagina', titolo: 'Dal sito' });
  const sender = { url };
  const prima = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.FILO_RUN_ACTION, assistente: true, action: action() }, sender);
  if (!prima.needsConfirm) return { prima };
  return globalThis.SN_HANDLE_MESSAGE({ type: MSG.FILO_CONFIRM_ACTION, assistente: true, action: action() }, sender);
}, url);

test('r1 dall’Aiuto di un sito la segnalazione confermata dall’owner non parte col suo nome di owner', async ({ app }) => {
  await owner(app);
  const r = await conferma(app, 'https://esempio.invalid/articolo');
  expect(r.executed, JSON.stringify(r)).toBe(true);
  const [inviato] = await app.evaluate(() => globalThis.__inviati);
  expect(inviato.clientId).not.toMatch(/^owner:/);
});

test('contro: dalla chat di Filo parte col nome dell’owner', async ({ app }) => {
  await owner(app);
  const r = await conferma(app, 'filo://newtab/');
  expect(r.executed, JSON.stringify(r)).toBe(true);
  const [inviato] = await app.evaluate(() => globalThis.__inviati);
  expect(inviato.clientId).toBe('owner:filo:chat');
});

// #953 giro 2, rilievo 2: la segnalazione automatica dell'owner con l'accesso scaduto si perde, mentre quella della
// chat aspetta il suo rientro. Deve partire firmata quando l'owner rientra, come quella della chat.
import { test, expect } from '../../fixtures/electron.mjs';

const TOKEN = 'tok-owner-953';

async function accesso(app, { admin, token }) {
  await app.evaluate((_e, { admin, token }) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    globalThis.__accesso = { admin, token };
    ga.isAdmin = () => globalThis.__accesso.admin;
    ga.isSignedIn = () => globalThis.__accesso.admin || !!globalThis.__accesso.token;
    ga.getUid = async () => 'uid-owner';
    ga.getIdToken = async () => globalThis.__accesso.token;
    globalThis.__inviati = [];
    let n = 953;
    globalThis.SN_FEEDBACK.submit = async (payload, opts) => {
      globalThis.__inviati.push({ clientId: payload.clientId, idToken: !!(opts && opts.idToken) });
      return { id: `doc-${n}`, seq: n++, failed: [], ...(opts && opts.idToken ? { senderProof: 'admin' } : {}) };
    };
  }, { admin, token });
}

test('r2 la segnalazione automatica dell’owner con l’accesso scaduto parte firmata quando rientra', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await accesso(app, { admin: true, token: '' });
  const page = await openTab('filo://newtab/');
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = JSON.stringify({ text: 'Questo non lo so fare.', actions: [] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    const AF = globalThis.SN_AUTO_FEEDBACK;
    AF.analyzeReply = () => ({ kind: 'complaint', genericDesc: 'Problema riscontrato durante l’uso di Filo' });
    AF.composeProposal = () => null;
  });
  await page.locator('#input').fill('fammi una cosa che non sai fare');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('non lo so fare', { timeout: 20_000 });
  await page.waitForTimeout(2000);

  const rientro = await app.evaluate(async (_e, t) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    M._cache[k].exports.signIn = async () => { globalThis.__accesso.token = t; return { email: 'owner@example.invalid', name: 'Owner' }; };
    return globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.AUTH_SIGNIN }, { url: 'filo://newtab/' });
  }, TOKEN);
  expect(rientro.ok, JSON.stringify(rientro)).toBe(true);
  await expect.poll(() => app.evaluate(() => globalThis.__inviati), { timeout: 15_000 })
    .toEqual([{ clientId: 'auto:complaint', idToken: true }]);
});

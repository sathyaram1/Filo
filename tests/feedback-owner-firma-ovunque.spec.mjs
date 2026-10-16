// #953 — quello che parte dalla copia dell'owner porta la sua prova anche quando non lo scrive nel riquadro: la
// segnalazione che Filo scrive in chat e lui conferma parte col suo nome (owner:filo:chat), quella automatica col nome
// di Filo e la sua prova, la riapertura dalla bacheca come la sua. Mai col ripiego anonimo. Per gli altri non cambia.
// Finti: l'accesso Google e la rete; coda, conferma, chat e bacheca sono quelle vere.

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm } from './helpers/confirm.mjs';

const TOKEN = 'tok-owner-953';

// L'accesso finto, sul modulo che leggono tutti; `token` vuoto = nessun accesso valido.
async function accesso(app, { admin, token = admin ? TOKEN : '' }) {
  await app.evaluate((_e, { admin, token }) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    globalThis.__accesso = { admin, token, tokenChiesti: 0 };
    ga.isAdmin = () => globalThis.__accesso.admin;
    ga.isSignedIn = () => globalThis.__accesso.admin || !!globalThis.__accesso.token;
    ga.getUid = async () => 'uid-owner';
    ga.getIdToken = async () => { globalThis.__accesso.tokenChiesti += 1; return globalThis.__accesso.token; };
    globalThis.__inviati = [];
    let n = 953;
    globalThis.SN_FEEDBACK.submit = async (payload, opts) => {
      globalThis.__inviati.push({ clientId: payload.clientId, name: payload.name || '', opts: opts || null });
      const id = `doc-${n}`;
      return { id, seq: n++, failed: [], ...(opts && opts.idToken ? { senderProof: 'admin' } : {}) };
    };
  }, { admin, token });
}

const inviati = (app) => app.evaluate(() => globalThis.__inviati);

async function confermaDallaChat(openTab, testo) {
  const home = await openTab('filo://newtab/');
  await home.evaluate(() => window.SN_SIDEBAR.open());
  await home.evaluate((t) => {
    window.__filoSidebarTest.runFiloAction({ type: 'INVIA_FEEDBACK', testo: t, titolo: 'Schermo intero' });
  }, testo);
  await expect(home.locator(CONFIRM_HOST)).toBeVisible();
  await clickConfirm(home, 'ok');
  return home;
}

const mie = (app) => app.evaluate(async () => (await globalThis.SN_SEGNALAZIONI_MIE.elenco()) || []);

test('la segnalazione confermata in chat dall’owner parte col suo nome e la sua prova', async ({ app, openTab }) => {
  await accesso(app, { admin: true });
  await confermaDallaChat(openTab, 'A schermo intero resta la barra in alto');
  await expect.poll(() => inviati(app)).toEqual([
    { clientId: 'owner:filo:chat', name: 'Schermo intero', opts: { idToken: TOKEN, soloAdmin: true } },
  ]);
  const voci = await mie(app);
  expect(voci.map((v) => [v.stato, v.num, v.titolo])).toEqual([['inviata', '953', 'Schermo intero']]);
});

test('per chi non è l’owner la segnalazione dalla chat resta di Filo per conto di un utente, anonima', async ({ app, openTab }) => {
  await accesso(app, { admin: false });
  await confermaDallaChat(openTab, 'A schermo intero resta la barra in alto');
  await expect.poll(() => inviati(app)).toEqual([{ clientId: 'filo:chat', name: 'Schermo intero', opts: null }]);
  expect((await app.evaluate(() => globalThis.__accesso)).tokenChiesti).toBe(0);
});

// Come dal riquadro (#912): l'owner senza accesso valido non parte da utente; aspetta, lo sa, e parte quando rientra.
test('l’owner senza accesso: la segnalazione dalla chat aspetta il suo rientro e parte firmata', async ({ app, shell, openTab, avvisi }) => {
  await shell.waitForLoadState('load');
  await accesso(app, { admin: true, token: '' });
  await confermaDallaChat(openTab, 'A schermo intero resta la barra in alto');
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif-msg', { hasText: 'aspetta il tuo accesso' }).first()).toBeVisible({ timeout: 0 });
  expect(await inviati(app)).toEqual([]);
  expect((await mie(app)).map((v) => v.stato)).toEqual(['in partenza']);

  const rientro = await app.evaluate(async (_e, t) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    M._cache[k].exports.signIn = async () => { globalThis.__accesso.token = t; return { email: 'owner@example.invalid', name: 'Owner' }; };
    return globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.AUTH_SIGNIN }, { url: 'filo://newtab/' });
  }, TOKEN);
  expect(rientro.ok, JSON.stringify(rientro)).toBe(true);
  await expect.poll(() => inviati(app)).toEqual([
    { clientId: 'owner:filo:chat', name: 'Schermo intero', opts: { idToken: TOKEN, soloAdmin: true } },
  ]);
  await expect.poll(async () => (await mie(app)).map((v) => [v.stato, v.num, v.titolo])).toEqual([['inviata', '953', 'Schermo intero']]);
});

// La segnalazione automatica: un turno in cui Filo ammette un buco, senza proposta in chat.
async function turnoConUnBuco(app, page) {
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
}

for (const [chi, opzioni, atteso] of [
  ['dall’owner parte col nome di Filo e la sua prova', { admin: true }, [{ clientId: 'auto:complaint', name: 'Problema segnalato automaticamente', opts: { idToken: TOKEN, soloAdmin: true } }]],
  ['dall’owner senza accesso valido non parte da anonima', { admin: true, token: '' }, []],
  ['da chi non è l’owner parte anonima come prima', { admin: false }, [{ clientId: 'auto:complaint', name: 'Problema segnalato automaticamente', opts: null }]],
]) {
  test(`segnalazione automatica: ${chi}`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    await accesso(app, opzioni);
    const page = await openTab('filo://newtab/');
    await expect(page.locator('#input')).toBeVisible();
    await turnoConUnBuco(app, page);
    if (atteso.length) await expect.poll(() => inviati(app), { timeout: 15_000 }).toEqual(atteso);
    else {
      await expect.poll(() => app.evaluate(() => globalThis.__accesso.tokenChiesti), { timeout: 15_000 }).toBeGreaterThan(0);
      expect(await inviati(app)).toEqual([]);
    }
  });
}

test('la riapertura dalla bacheca dell’owner parte col suo nome e la sua prova', async ({ app, openTab }) => {
  await accesso(app, { admin: true });
  await app.evaluate(() => {
    globalThis.SN_FEEDBACK.getPublic = async (id) => ({ _id: id, name: 'Condividi non risponde', status: 'done', seq: 91 });
    globalThis.SN_FEEDBACK.castReopenRequest = async () => ({});
    globalThis.SN_MANAGE_REVIEW.canReopen = () => true;
    globalThis.SN_CREDITS.spendIfAffordable = async () => ({ ok: true, balance: 90 });
  });
  const bacheca = await openTab('filo://board/board.html');
  const r = await bacheca.evaluate((m) => window.filo.message(m), { type: 'board_reopen', id: 'fb-91', text: 'Condividi non si apre ancora.' });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(await inviati(app)).toEqual([{ clientId: 'owner:uid:uid-owner', name: '', opts: { idToken: TOKEN, soloAdmin: true } }]);
});

// Sonda esplorativa del giro 4 — NON è una prova da tenere.
import { test } from './../../fixtures/electron.mjs';

const SITO = { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' };

test('sonda: cosa risponde il canale a un sito visitato', async ({ app, shell }) => {
  void shell;
  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    const bussa = (m) => globalThis.SN_HANDLE_MESSAGE(m, S);
    const res = {};
    res.authStatus = await bussa({ type: MSG.AUTH_STATUS });
    res.authSignout = await bussa({ type: MSG.AUTH_SIGNOUT });
    res.boardVote = await bussa({ type: MSG.BOARD_CAST_VOTE, id: 'fb-uno', vote: 'works' });
    res.boardClear = await bussa({ type: MSG.BOARD_CLEAR_VOTE, id: 'fb-uno' });
    res.boardReopen = await bussa({ type: MSG.BOARD_REOPEN, id: 'fb-uno', text: 'ancora rotto' });
    res.chiavi = Object.keys(MSG).filter((k) => /BOARD|WALLET|AUTH|FEEDBACK/.test(k));
    return res;
  }, SITO);
  console.log('SONDA', JSON.stringify(out, null, 1));
});

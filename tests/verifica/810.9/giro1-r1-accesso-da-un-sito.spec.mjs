// Verifica #810.9, giro 1, rilievo 1: un sito visitato che chiede di accedere riceve
// nella risposta l'indirizzo email di chi usa Filo, quando l'accesso si completa.

import { test, expect } from '../../fixtures/electron.mjs';

const SITO = { url: 'https://evil.example/pagina' };
const SITO_CON_SCHEDA = { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' };

test('chiedere l\'accesso da un sito non consegna al sito l\'identità di chi usa Filo', async ({ app, shell }) => {
  void shell;
  const out = await app.evaluate(async (_electron, mittenti) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    ga.signIn = async () => ({ email: 'chi-usa-filo@example.com', name: 'Chi Usa Filo' });
    ga.isSignedIn = () => true;
    ga.isRemembered = () => true;
    ga.getProfile = () => ({ email: 'chi-usa-filo@example.com', name: 'Chi Usa Filo' });
    const MSG = globalThis.SN_MSG.MSG;
    const accedi = (m) => globalThis.SN_HANDLE_MESSAGE({ type: MSG.AUTH_SIGNIN }, m);
    return { sito: await accedi(mittenti.sito), sitoConScheda: await accedi(mittenti.sitoConScheda) };
  }, { sito: SITO, sitoConScheda: SITO_CON_SCHEDA });

  for (const provenienza of ['sito', 'sitoConScheda']) {
    expect(JSON.stringify(out[provenienza] || {}), `${provenienza}: l'email di chi usa Filo è arrivata al sito`).not.toContain('chi-usa-filo@example.com');
  }
});

// #784 giro 2, rilievo 1: SECURITY.md (§3) promette che le funzioni di amministrazione
// rispondono solo alle pagine di Filo. Finché lo promette, ogni porta del proprietario
// deve rifiutare un sito visitato per provenienza ('forbidden'), non per permesso mancante.
import { readFileSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

const SITO = { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' };

test('r1 la promessa del §3 sulle funzioni di amministrazione regge su ogni porta del proprietario', async ({ app, shell }) => {
  void shell;
  const sec = readFileSync(new URL('../../../SECURITY.md', import.meta.url), 'utf8');
  const promette = /funzioni di amministrazione\s+rispondono solo alle pagine di Filo/.test(sec);
  test.skip(!promette, 'il documento non fa più questa promessa');

  const out = await app.evaluate(async (_electron, mittente) => {
    const MSG = globalThis.SN_MSG.MSG;
    const porte = {
      generaCodiciRedTeam: { type: MSG.REDTEAM_GEN_CODES, count: 1 },
      elencoCodiciRedTeam: { type: MSG.REDTEAM_LIST_CODES },
      revocaCodiceRedTeam: { type: MSG.REDTEAM_REVOKE_CODE, code: 'X' },
      provaModelloArbitrario: { type: MSG.TEST_DEFAULT_MODEL, model: 'qualunque/modello' },
      elencoModelliPredefiniti: { type: MSG.DEFAULT_MODELS_LIST },
      elencoFornitori: { type: MSG.DEFAULT_PROVIDERS_LIST },
    };
    const res = {};
    for (const [nome, msg] of Object.entries(porte)) {
      res[nome] = await globalThis.SN_HANDLE_MESSAGE(msg, mittente);
    }
    return res;
  }, SITO);

  const aperte = Object.entries(out)
    .filter(([, r]) => String(r?.code || '') !== 'forbidden')
    .map(([porta, r]) => `${porta}: ${JSON.stringify(r).slice(0, 120)}`);
  expect(aperte, 'porte del proprietario che da un sito non rifiutano per provenienza').toEqual([]);
});

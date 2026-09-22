// Verifica #591 — giro 7. Col mese esaurito Filo smette di consultare l'elenco
// dei siti di truffa, che non costa niente.
//
// Il tetto di spesa serve a non far pagare all'owner chiamate che nessuno ha
// chiesto. La ricerca dell'indirizzo nell'elenco dei siti di truffa non gli
// costa niente (il costo registrato per quella chiamata è zero), ed è il
// segnale più affidabile che Filo ha: legarla al tetto non risparmia un
// centesimo e spegne la protezione proprio nel mese in cui l'utente ha già
// usato tutto.
//
// Le due domande sull'età del dominio, che stanno nello stesso stadio e sono
// anche loro gratuite, continuano a partire: è la simmetria che manca.

import { test, expect } from '../../fixtures/electron.mjs';

async function giro(app, { mesePieno }) {
  return await app.evaluate(async ({}, { mesePieno: pieno }) => {
    const Defaults = globalThis.__filoDefaults;
    const handlers = globalThis.__filoHandlers;
    const SB = globalThis.SN_SAFEBROWSE;
    const Costs = globalThis.SN_COSTS;
    const origGet = Defaults.get;
    const origLookup = SB.net.safeBrowsingLookup;
    const origRdap = SB.net.rdapAgeDays;
    const origCt = SB.net.ctFirstSeenDays;
    const origOver = Costs.isOverLimit;
    let elenco = 0;
    let eta = 0;
    try {
      Defaults.get = () => ({ ...origGet(), safeBrowsingKey: 'CHIAVE-DI-PROVA-591-G7' });
      SB.net.safeBrowsingLookup = async () => { elenco += 1; return { listed: false }; };
      SB.net.rdapAgeDays = async () => { eta += 1; return 400; };
      SB.net.ctFirstSeenDays = async () => null;
      Costs.isOverLimit = async () => pieno;
      await handlers.wireSafebrowse();
      for (const c of Object.values(SB._caches)) c.clear();
      for (const v of Object.values(SB._inFlight)) v.clear();
      SB.analyze(`http://sito-mai-visto-${pieno ? 'pieno' : 'libero'}-591g7.com/pagina`, {});
      await new Promise((r) => setTimeout(r, 600));
      return { elenco, eta };
    } finally {
      Defaults.get = origGet;
      SB.net.safeBrowsingLookup = origLookup;
      SB.net.rdapAgeDays = origRdap;
      SB.net.ctFirstSeenDays = origCt;
      Costs.isOverLimit = origOver;
      await handlers.wireSafebrowse().catch(() => {});
    }
  }, { mesePieno });
}

test('caso di riscontro: sotto il tetto l\'elenco dei siti di truffa viene consultato', async ({ app }) => {
  const r = await giro(app, { mesePieno: false });
  expect(r.elenco, 'una pagina mai vista fa partire la ricerca nell\'elenco').toBe(1);
});

test('col mese esaurito l\'elenco dei siti di truffa non viene più consultato', async ({ app }) => {
  const r = await giro(app, { mesePieno: true });
  expect(
    r.eta,
    'le domande sull\'età del dominio, gratuite, continuano a partire: è la prova che lo stadio parte',
  ).toBe(1);
  expect(
    r.elenco,
    'la ricerca nell\'elenco dei siti di truffa non costa niente all\'owner e non deve spegnersi col mese esaurito',
  ).toBe(1);
});

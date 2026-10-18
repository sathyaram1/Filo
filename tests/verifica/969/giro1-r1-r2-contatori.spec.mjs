// #969 giro 1 — r1: una spiegazione anticipata che nessuno apre non è un uso di «Spiega»;
// r2: un giorno rifiutato dal server non ferma l'invio dei giorni dopo.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<p id="p1">Il teorema di Pitagora vale per tutti i triangoli rettangoli del piano.</p>
<p id="p2">La fotosintesi clorofilliana trasforma la luce in energia chimica dentro le foglie.</p>
</body>`;

async function fornitoreFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__spiegazioni = 0;
    const finto = async ({ messages }) => {
      if (JSON.stringify(messages).includes('ha selezionato un testo')) globalThis.__spiegazioni += 1;
      return { text: 'Spiegazione di prova', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}

function puntoDellaParola(page, id, parola) {
  return page.evaluate(([i, w]) => {
    const nodo = document.getElementById(i).firstChild;
    const da = nodo.textContent.indexOf(w);
    const r = document.createRange();
    r.setStart(nodo, da);
    r.setEnd(nodo, da + w.length);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, [id, parola]);
}

const usiDiSpiegaOggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = s.giorni[globalThis.SN_CONTATORI.giornoDi(Date.now())];
  return (g && g.uso && g.uso.explain && g.uso.explain.n) || 0;
});

test('r1 selezionare tre parole senza mai aprire Spiega non conta tre usi di Spiega', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });

  for (const [id, parola] of [['p1', 'Pitagora'], ['p1', 'triangoli'], ['p2', 'fotosintesi']]) {
    const p = await puntoDellaParola(page, id, parola);
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(900);
  }
  // Le spiegazioni anticipate sono partite davvero (la funzione resta giusta: l'attesa è attrito)...
  await expect.poll(() => app.evaluate(() => globalThis.__spiegazioni), { timeout: 5000 }).toBe(3);
  await page.waitForTimeout(3500);
  // ...ma la persona non ha mai chiesto una spiegazione: per i contatori Spiega oggi non è stata usata.
  expect(await usiDiSpiegaOggi(app), 'le spiegazioni anticipate e mai aperte non sono usi di Spiega').toBe(0);
});

test('r2 un giorno che il server rifiuta non ferma la spedizione dei giorni dopo', async ({ app }) => {
  test.setTimeout(60_000);
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_CONTATORI;
    const oggi = C.giornoDi(Date.now());
    const ieri = C.giornoPrima(oggi);
    const altroieri = C.giornoPrima(ieri);
    const app = '0.2.243';
    // L'altroieri porta una funzione che le regole pubblicate non conoscono ancora (uscita prima della pubblicazione).
    await globalThis.SN_STORAGE.setRaw('contatoriGiornalieri', {
      giorni: {
        [altroieri]: { uso: { 'explain-deep': { n: 2, fasce: { s1: 2 } } }, errori: {}, app },
        [ieri]: { uso: { explain: { n: 1, fasce: { s1: 1 } } }, errori: {}, app },
      },
      pseudonimi: {}, fallitoIl: '', ultimo: null, errore: '',
    });
    const spediti = [];
    const tentati = [];
    const vero = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (!u.includes('contatori-giornalieri')) return vero(url, init);
      const corpo = String((init && init.body) || '');
      const giorno = (/documentId=[0-9a-f]+_(\d{4}-\d\d-\d\d)/.exec(u) || [])[1];
      tentati.push(giorno);
      if (corpo.includes('explain-deep')) return new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 });
      spediti.push(giorno);
      return new Response('{}', { status: 200 });
    };
    const R = globalThis.SN_FEEDBACK && globalThis.SN_FEEDBACK.rest;
    if (R && (!R.FIRESTORE_BASE || !R.API_KEY)) { R.FIRESTORE_BASE = R.FIRESTORE_BASE || 'https://firestore.test/v1/x'; R.API_KEY = R.API_KEY || 'k'; }
    try {
      await globalThis.SN_CONTATORI_MAIN.controlla();
    } finally { globalThis.fetch = vero; }
    return { spediti, tentati, ieri, altroieri };
  });
  expect(esito.tentati[0], 'l’altroieri si prova per primo, e il server lo rifiuta').toBe(esito.altroieri);
  expect(esito.spediti, 'il giorno di ieri, che le regole accettano, deve partire anche se l’altroieri è stato rifiutato').toContain(esito.ieri);
});

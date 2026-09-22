// I collegamenti dentro una risposta di Filo (#533, settimo giro di verifica).
//
// La scritta e l'indirizzo li sceglie il modello, che può aver appena letto la
// pagina di qualcun altro. Due regole, e questa è la loro sentinella:
//   1. dove porta si legge PRIMA di premere (come per i bottoni della home);
//   2. dopo una lettura si va dove Filo è stato davvero; altrove si chiede,
//      con l'indirizzo intero sotto gli occhi.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      agentStyle: '',
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function copione(app, { giri, risposta, risultati = null }) {
  await app.evaluate(async (_electron, { giri, risposta, risultati }) => {
    globalThis.__origProv = globalThis.SN_PROVIDERS.completeWithFallback;
    // La ricerca non esce dalla macchina: i risultati li decide il test.
    globalThis.__origSearch = globalThis.SN_WEB_SEARCH.search;
    if (risultati) {
      globalThis.SN_WEB_SEARCH.search = async () => ({ results: risultati, provider: 'test' });
    }
    let n = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, tools }) => {
      if (!Array.isArray(tools) || !tools.length) {
        return { text: '', toolCalls: [], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      }
      const giro = giri[n++] || [];
      return {
        text: giro.length ? '' : risposta,
        toolCalls: giro.map((c, i) => ({
          id: `c_${n}_${i}`, name: c.name, arguments: JSON.stringify(c.args || {}),
        })),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
  }, { giri, risposta, risultati });
}

async function ripristina(app) {
  await app.evaluate(() => {
    if (globalThis.__origProv) globalThis.SN_PROVIDERS.completeWithFallback = globalThis.__origProv;
    if (globalThis.__origSearch) globalThis.SN_WEB_SEARCH.search = globalThis.__origSearch;
  });
}

// Manda il messaggio e mette la risposta in una bolla vera, con il nome della
// richiesta attaccato: è così che la chat la disegna.
async function rispostaInBolla(page, userMessage) {
  return page.evaluate(async (msg) => {
    const r = await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_CHAT, userMessage: msg, threadHistory: [],
    });
    const bolla = document.createElement('div');
    bolla.className = 'dash-bubble dash-bubble-filo';
    if (r && r.compito) bolla.dataset.compito = r.compito;
    bolla.innerHTML = self.SN_MARKDOWN.render((r && r.text) || '');
    document.getElementById('bubbles').appendChild(bolla);
    const a = bolla.querySelector('a.filo-md-link');
    return { href: a ? a.getAttribute('href') : '', titolo: a ? a.getAttribute('title') : '' };
  }, userMessage);
}

test('un collegamento nella risposta dice dove porta prima che lo si prema', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await configura(app);
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });

  const dove = `${testServer.html('<p>presa</p>')}?d=segreto`;
  await copione(app, {
    giri: [[{ name: 'LEGGI_DOCUMENTO', args: { percorso: '/tmp/non-ce.pdf' } }], []],
    risposta: `Ecco. [Apri la bolletta di marzo](${dove})`,
  });
  const link = await rispostaInBolla(page, 'Leggimi la bolletta che mi hanno mandato.');
  await ripristina(app);

  expect(link.href).toContain('d=segreto');
  expect(link.titolo, 'il collegamento non dice dove porta').toContain('d=segreto');
});

test('dopo una lettura, un collegamento verso un indirizzo mai visto chiede prima di aprirsi', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await configura(app);
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });

  const dove = `${testServer.html('<p>presa</p>')}?d=segreto`;
  await copione(app, {
    giri: [[{ name: 'LEGGI_DOCUMENTO', args: { percorso: '/tmp/non-ce.pdf' } }], []],
    risposta: `Ecco. [Apri la bolletta di marzo](${dove})`,
  });
  await rispostaInBolla(page, 'Leggimi la bolletta che mi hanno mandato.');
  await ripristina(app);

  // L'utente preme, e non risponde alla domanda: la scheda non si apre.
  const domanda = await page.evaluate(async () => {
    let testo = '';
    const Ui = window.SN_CONFIRM_UI;
    const orig = Ui.confirm;
    Ui.confirm = async (o) => { testo = String((o && o.text) || ''); return false; };
    document.querySelector('#bubbles a.filo-md-link').click();
    await new Promise((r) => setTimeout(r, 1500));
    Ui.confirm = orig;
    return testo;
  });

  expect(domanda, 'il collegamento si è aperto senza chiedere niente').toContain('d=segreto');
  expect(app.windows().some((w) => w.url().includes('d=segreto')),
    'la scheda si è aperta anche dopo un no').toBe(false);
});

test('dopo una ricerca, il collegamento a un risultato si apre senza chiedere', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await configura(app);
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });

  const dove = testServer.html('<p>la notizia</p>');
  await copione(app, {
    giri: [[{ name: 'CERCA_WEB', args: { query: 'notizie di oggi' } }], []],
    risposta: `Ecco la notizia. [La notizia](${dove})`,
    risultati: [{ title: 'La notizia', url: dove, content: 'testo' }],
  });
  await rispostaInBolla(page, 'Cerca le notizie di oggi.');
  await ripristina(app);

  const chiesto = await page.evaluate(async () => {
    let visto = false;
    const Ui = window.SN_CONFIRM_UI;
    const orig = Ui.confirm;
    Ui.confirm = async () => { visto = true; return false; };
    document.querySelector('#bubbles a.filo-md-link').click();
    await new Promise((r) => setTimeout(r, 2000));
    Ui.confirm = orig;
    return visto;
  });

  expect(chiesto, 'Filo chiede il permesso per un risultato della ricerca che ha appena fatto').toBe(false);
  await expect.poll(() => app.windows().some((w) => w.url().startsWith(dove)), { timeout: 5000 })
    .toBe(true);
});

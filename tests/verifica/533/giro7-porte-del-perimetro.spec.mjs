// #533 — verifica giro 7: la risposta come ultima uscita rimasta.
//
// I giri 1-5 hanno chiuso le strade per cui il testo di un sito tornava davanti
// a una richiesta nuova che aveva ancora tutti gli strumenti in mano. Il giro 6
// ha aperto l'altra metà — cosa resta in mano a una richiesta che ha letto — e
// ha chiuso il bottone «apri un file», che era una proposta con dentro una
// destinazione scelta dal modello.
//
// Qui si guarda la cosa che a una richiesta che ha letto resta sempre, per
// definizione: RISPONDERE. Il testo della risposta non è testo semplice: la
// sorgente unica del rendering lo trasforma in collegamenti cliccabili, con la
// scritta scelta dal modello e l'indirizzo pure. Vale per la chat della home,
// per il riquadro «Spiega» e per la sidebar dentro le pagine.
//
// Stesso metodo dei giri prima: un modello finto che casca in pieno
// nell'istruzione ostile.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const SCRITTA = 'Apri la bolletta di marzo';

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

// Il copione del modello finto, giro per giro. L'ultimo giro senza azioni è la
// risposta per l'utente: è quella che ci interessa.
async function copione(app, { giri, risposta }) {
  await app.evaluate(async (_electron, { giri, risposta }) => {
    globalThis.__origProv = globalThis.SN_PROVIDERS.completeWithFallback;
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
  }, { giri, risposta });
}

async function ripristina(app) {
  await app.evaluate(() => {
    if (globalThis.__origProv) globalThis.SN_PROVIDERS.completeWithFallback = globalThis.__origProv;
  });
}

test.describe('#533 giro 7 — la risposta come ultima uscita rimasta', () => {
  test('un collegamento che Filo mette in chat dice dove porta prima che lo si prema', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await configura(app);
    const page = await openTab(NEWTAB);
    await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });

    const destinazione = `${testServer.url}/e?d=segreto`;
    // L'utente fa leggere a Filo un documento che gli hanno mandato: da lì in
    // poi il compito è contaminato e le uscite non dichiarate spariscono. La
    // risposta resta, e dentro la risposta ci sta un collegamento.
    await copione(app, {
      giri: [[{ name: 'LEGGI_DOCUMENTO', args: { percorso: '/tmp/bolletta-che-non-ce.pdf' } }], []],
      risposta: `Ecco quello che ho trovato. [${SCRITTA}](${destinazione})`,
    });

    const r = await page.evaluate(async () => {
      const res = await chrome.runtime.sendMessage({
        type: window.SN_MSG.MSG.FILO_CHAT,
        userMessage: 'Leggimi la bolletta che mi hanno mandato.',
        threadHistory: [],
      });
      return { testo: (res && res.text) || '' };
    });
    await ripristina(app);

    // La risposta la scrive il modello dopo aver letto: è quella che l'utente
    // legge in chat, resa con la sorgente unica del rendering (la stessa del
    // riquadro «Spiega» e della sidebar dentro le pagine).
    const link = await page.evaluate((testo) => {
      const box = document.createElement('div');
      box.innerHTML = self.SN_MARKDOWN.render(testo);
      return [...box.querySelectorAll('a.filo-md-link')].map((a) => ({
        href: a.getAttribute('href') || '',
        scritta: (a.textContent || '').trim(),
        titolo: a.getAttribute('title') || '',
        ariaLabel: a.getAttribute('aria-label') || '',
      }));
    }, r.testo);

    // Se non è cliccabile va benissimo: quello che non deve succedere è un
    // collegamento cliccabile la cui destinazione l'utente non può leggere
    // prima di premerlo. È la stessa regola che il giro 4 ha fissato per i
    // bottoni della schermata iniziale e il giro 6 per il bottone del file.
    for (const a of link) {
      const mostra = [a.scritta, a.titolo, a.ariaLabel].join(' ');
      expect(mostra.includes(new URL(a.href).host),
        `il collegamento dice «${a.scritta}» e porta a ${a.href}: chi clicca ha letto solo la scritta`)
        .toBe(true);
    }
  });

  test('dove il motore ha detto di no, il collegamento nella risposta passa lo stesso', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await configura(app);
    const page = await openTab(NEWTAB);
    await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });

    const destinazione = `${testServer.url}/e?d=segreto`;
    // Due strade per la stessa cosa — aprire un indirizzo — nello stesso turno
    // contaminato: la prima passa dal motore, la seconda no.
    await copione(app, {
      giri: [
        [{ name: 'LEGGI_DOCUMENTO', args: { percorso: '/tmp/bolletta-che-non-ce.pdf' } }],
        [{ name: 'NAVIGA', args: { url: destinazione } }],
        [],
      ],
      risposta: `Ecco quello che ho trovato. [${SCRITTA}](${destinazione})`,
    });

    const r = await page.evaluate(async () => {
      const res = await chrome.runtime.sendMessage({
        type: window.SN_MSG.MSG.FILO_CHAT,
        userMessage: 'Leggimi la bolletta che mi hanno mandato.',
        threadHistory: [],
      });
      return { testo: (res && res.text) || '', azioni: (res && res.actions) || [] };
    });
    await ripristina(app);

    // Sanità: la strada che passa dal motore è chiusa, come deve essere.
    const naviga = r.azioni.find((a) => String(a.type).toUpperCase() === 'NAVIGA');
    expect(!naviga || naviga._executed !== true,
      'il motore ha aperto l\'indirizzo chiesto da una richiesta che aveva letto').toBe(true);

    // L'altra strada: il collegamento nella bolla della risposta, cliccato
    // dall'utente. Il riquadro va DENTRO le bolle, dove sta il vero ascoltatore
    // dei clic della chat: non una riscrittura, proprio quello.
    const aperto = await page.evaluate(async (testo) => {
      const bolle = document.getElementById('bubbles');
      const box = document.createElement('div');
      box.innerHTML = self.SN_MARKDOWN.render(testo);
      bolle.appendChild(box);
      const a = box.querySelector('a.filo-md-link');
      if (!a) return { cliccabile: false, schede: [] };
      a.click();
      await new Promise((res) => setTimeout(res, 1500));
      const tabs = await chrome.tabs.query({});
      return { cliccabile: true, schede: tabs.map((t) => t.url || '') };
    }, r.testo);

    expect(aperto.schede.some((u) => u.includes('d=segreto')),
      'un clic sul collegamento apre l\'indirizzo scelto dopo la lettura, che il motore aveva appena rifiutato')
      .toBe(false);
  });
});

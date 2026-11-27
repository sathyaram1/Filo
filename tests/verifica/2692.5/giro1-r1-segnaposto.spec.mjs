// Verifica #2692.5 giro 1: il PUK dato in risposta sotto la domanda non deve partire nemmeno con la ricerca di un
// segnaposto scritto nella stessa frase (la lettura delle fonti riceve la frase intera). Modello e ricerca finti.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = (domanda) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:40px 20px;font:16px sans-serif">
<main>
  <div class="msg">${domanda}</div>
  <textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea>
</main>
</body>`;

async function apri(app, openTab, testServer, domanda, ragionato) {
  await app.evaluate(async (_e, ragionato) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: true },
    });
    Object.assign(globalThis, { __tutti: [], __estrazioni: [], __webChieste: [], __ragionato: ragionato });
    const finto = async ({ messages }) => {
      const sistema = String(messages[0].content);
      const t = String(messages[messages.length - 1].content);
      globalThis.__tutti.push(`${sistema}\n${t}`);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Chi scrive ha messo delle x')) {
        globalThis.__estrazioni.push(t);
        return fine('[0800 123 456][Numero dell\'assistenza][1][]');
      }
      if (sistema.includes('Sei il controllo rapido')) return fine('NIENTE');
      if (sistema.includes('proponi SUGGERIMENTI')) {
        const out = Object.entries(globalThis.__ragionato).filter(([p]) => t.includes(p)).flatMap(([, righe]) => righe);
        return fine(out.join('\n') || '[][][][nessuno]');
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    F.wikipedia = async () => [];
    F.web = async (q) => {
      globalThis.__webChieste.push(q);
      return [{ titolo: 'Assistenza', sito: 'assistenza.example', url: 'https://assistenza.example/', data: '', testo: 'Numero assistenza: 0800 123 456' }];
    };
  }, ragionato);
  const page = await testServer.openReady(openTab, PAGINA(domanda), { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const casi = [
  ['il PUK', 'Marco: mi dici il puk?', '12345678, e il numero dell\'assistenza è xx. ', '12345678'],
  ['la password', 'Marco: mi dici la password del wifi?', 'gattoNero77, e il numero del tecnico è xx. ', 'gattoNero77'],
];

for (const [nome, domanda, risposta, segreto] of casi) {
  test(`r1 ${nome} dato in risposta sotto la domanda non parte con la ricerca del segnaposto nella stessa frase`, async ({ app, openTab, testServer }) => {
    const page = await apri(app, openTab, testServer, domanda, { 'è xx': ['[è xx][][numero assistenza][cerca][web]'] });
    await page.locator('#ta').click();
    await page.keyboard.type(risposta);
    // La ricerca del segnaposto è partita: la frase è arrivata a chi legge le fonti.
    await expect.poll(() => app.evaluate(() => globalThis.__estrazioni.length), { timeout: 15000 }).toBeGreaterThan(0);
    const tutti = await app.evaluate(() => globalThis.__tutti);
    expect(tutti.some((t) => t.includes('è xx')), 'il controllo ha letto la frase').toBe(true);
    for (const t of tutti) expect(t, 'nessuna richiesta del correttore porta il dato riservato').not.toContain(segreto);
    for (const q of await app.evaluate(() => globalThis.__webChieste)) expect(q).not.toContain(segreto);
  });
}

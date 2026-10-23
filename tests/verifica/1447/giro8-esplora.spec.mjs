// Esplorazione del giro 8 di verifica #1447: stampa cosa diventa ogni frase scritta, non asserisce.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
</body>`;

async function apri(app, openTab, testServer, pagina = PAGINA) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, ripetizioni: true, automatica: true },
    });
    const finto = async () => ({ text: 'NIENTE', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, pagina, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

const FRASI = [
  'Perchè no ', 'PERCHÈ no ', 'E\' vero ', 'Ok c\'e\' tempo ', 'Non si puo\' fare ', 'Gia\' fatto ', 'Cioe\' boh ',
  'Ho visto marco ', 'Ho visto Marco e luca ', 'Mi piace la Nutella e internet ', 'Costa dieci euro ',
  'Oggi è natale ', 'Sono andato su internet ', 'Domani esco con anna ', 'Il mio wifi va ', 'Vado al bar ',
  'Ci vediamo lunedì ', 'Parlo italiano ', 'Una cosa vera ', 'Questo è il primo ', 'Ho preso un ok ',
  'Grazie dio ', 'Tipo boh ', 'Uso spotify e netflix ', 'Il papa ha parlato ', 'Vado a messa ',
  'Il sole e la luna ', 'Vado in chiesa ', 'Ok lol ', 'Il marco tedesco ', 'Ho scritto a gmail ',
  'Ho visto #marco ', 'Lo dice anche lei, ad esempio ', 'Ecco: marco ', 'Era (marco) ', 'Scrivo "marco" ',
  'Io e Marco andiamo da giulia ', 'Ciao a tutti! oggi vado da marco ', 'Il mio nome è Pietro.\nmarco ',
  'Usa javascript e python ', 'Un post su facebook ', 'Il comune di roma ', 'Lo stato italiano ',
  'Vado in america ', 'Cosa ne pensi di claude? ', 'Mi chiamo paolo ', 'Una rosa per maria ',
  'Lavoro con excel e word ', 'Ho un iphone ', 'Sono su linkedin ', 'Il bitcoin sale ', 'Guardo la tv ',
];

test('esplora: frasi scritte e cosa diventano', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await apri(app, openTab, testServer);
  const out = [];
  for (const f of FRASI) {
    await page.locator('#ta').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);
    for (const riga of f.split('\n')) {
      if (riga !== f.split('\n')[0]) await page.keyboard.press('Enter');
      await page.keyboard.type(riga);
    }
    await page.waitForTimeout(200);
    const v = await page.locator('#ta').inputValue();
    out.push(`${JSON.stringify(f)} -> ${JSON.stringify(v)}${v === f ? '' : '   CAMBIATA'}`);
  }
  console.log('\n' + out.join('\n'));
});

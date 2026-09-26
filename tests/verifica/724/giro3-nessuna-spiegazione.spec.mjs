// #724 terzo giro — «3000 rupie» in una frase italiana: il modello non ha
// niente da SPIEGARE (sono parole comuni) ma una conversione da fare sì. Il
// prompt gli chiede tutte e due le cose; Filo butta via la risposta intera.
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <p id="p">Il biglietto costa 3000 rupie.</p>
</body></html>`;

async function modelloFinto(app, risposta) {
  await app.evaluate(async (_e, testo) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__o724 = globalThis.__o724 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__o724,
      complete: async () => ({ text: testo, toolCalls: [], reasoningDetails: [], usage: {} }),
    };
  }, risposta);
}

async function tastoDestroSullaSelezione(page) {
  await page.evaluate(() => {
    const p = document.querySelector('#p');
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#p').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 20_000 });
}

test('niente da spiegare ma una conversione da fare: la conversione si legge lo stesso', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  // Il modello obbedisce a tutte e due le righe del prompt: dice che non c'è
  // niente da spiegare E mette accanto la conversione che gli è stata chiesta.
  await modelloFinto(app, 'NESSUNA SPIEGAZIONE (3000 rupie = circa [[calc: 3000/92 | eur]] €)');
  const page = await testServer.openReady(openTab, HTML);
  await tastoDestroSullaSelezione(page);
  // SUCCESSO: chi ha selezionato legge quanto fanno in euro.
  await expect(page.locator('.sn-menu')).toContainText('32,61 €', { timeout: 30_000 });
});

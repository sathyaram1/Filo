// Verifica #810.7, giro 1: la password e il numero di carta scritti in un modulo non partono verso un modello.

import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash',
        [C.ACTIONS.EXPLAIN]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function modelloFinto(app, testo) {
  await app.evaluate((_electron, testo) => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: testo };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
  }, testo);
}

async function arrivato(app, page) {
  const testo = await app.evaluate(() => JSON.stringify(globalThis.__visti || []));
  return testo.split(new URL(page.url()).origin).join('').replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '');
}

async function superaAvviso(page) {
  const continua = page.getByRole('button', { name: 'Continua' });
  if (await continua.isVisible({ timeout: 6_000 }).catch(() => false)) {
    await continua.click();
    await expect(continua).toHaveCount(0, { timeout: 6_000 });
  }
}

async function chiediAiuto(shell, page, testo) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await page.fill('.sn-sidebar-input textarea', testo);
  await page.press('.sn-sidebar-input textarea', 'Enter');
}

const modulo = (campo) => `<!doctype html><html><head><title>Pagamento</title></head><body><h1>Pagamento</h1>
  <form>${campo}<button type="button">Paga</button></form></body></html>`;

const CARTA = '4111 1111 1111 1111';
const CASI = [
  { nome: 'numero di carta con nome cc-number e scritta accanto non legata', campo: '<div>Numero della carta</div><input id="cc-number" name="cc-number" inputmode="numeric">' },
  { nome: 'numero di carta dentro un riquadro «Carta di credito» con etichetta «Numero»', campo: '<fieldset><legend>Carta di credito</legend><label for="n">Numero</label> <input id="n" name="number" inputmode="numeric"></fieldset>' },
];

for (const caso of CASI) {
  test(`assistente: ${caso.nome}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, modulo(caso.campo));
    await superaAvviso(page);
    await page.locator('input').first().fill(CARTA);
    await preparaModelli(app);
    await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
    await chiediAiuto(shell, page, 'aiutami a pagare');
    await expect(page.locator('.sn-sidebar', { hasText: 'Premi «Paga».' })).toBeVisible({ timeout: 20_000 });
    const testo = await arrivato(app, page);
    expect(testo, 'il numero della carta è arrivato al modello').not.toContain('4111 1111');
  });
}

test('tasto destro sulla password selezionata: la spiegazione non la manda al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo('<label for="c">Password</label> <input id="c" type="password">'));
  await superaAvviso(page);
  await page.fill('#c', 'Gatto.Rosso.77');
  await preparaModelli(app);
  await modelloFinto(app, 'Una parola.');
  await page.locator('#c').click();
  await page.keyboard.press('Control+a');
  await page.locator('#c').click({ button: 'right', position: { x: 12, y: 8 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.waitForTimeout(3000);
  expect(await arrivato(app, page), 'la password selezionata è partita verso il modello').not.toContain('Gatto.Rosso');
});

// Verifica #2681.1, giro 1: un campo del CVV chiamato in un'altra lingua è segreto anche coi nomi comuni oltre
// a quelli della segnalazione (la variante «di verifica», che in italiano e in inglese è già segreta, e le lingue
// che Filo conosce per la password). Rossa finché il valore arriva al modello.

import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash', [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function modelloFinto(app, risposta) {
  await app.evaluate((_electron, risposta) => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: risposta };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
  }, risposta);
}

async function apriAiuto(app, shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await expect(aiuto.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  return aiuto;
}

async function arrivato(app, page) {
  const testo = await app.evaluate(() => JSON.stringify(globalThis.__visti || []));
  return testo.split(new URL(page.url()).origin).join('').replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '');
}

// L'avviso del sito sospetto compare solo se la pagina sembra chiedere la carta: qui si supera se c'è.
async function superaAvvisoSeC(app) {
  const coperta = async () => (await copertura(app).catch(() => null))?.coperta === true;
  const fine = Date.now() + 4_000;
  while (!(await coperta())) {
    if (Date.now() > fine) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  const avviso = await vistaAvviso(app);
  await avviso.getByRole('button', { name: 'Continua' }).click();
  await expect.poll(coperta, { timeout: 6_000 }).toBe(false);
}

const modulo = (etichetta) => `<!doctype html><html><head><title>Pagamento</title></head><body><h1>Pagamento</h1>
  <form><div><label for="t">Titolare</label> <input id="t"></div>
  <div><label for="c">${etichetta}</label> <input id="c" inputmode="numeric" maxlength="4"></div>
  <button type="button">Paga</button></form></body></html>`;

const NOMI = [
  'Código de verificación',
  'Code de vérification',
  'Kod zabezpieczający',
  'セキュリティコード',
  'Güvenlik kodu',
];

for (const nome of NOMI) {
  test(`r1 il CVV scritto sotto «${nome}» non arriva al modello`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, modulo(nome));
    await superaAvvisoSeC(app);
    await page.fill('#t', 'Mario Bianchi');
    await page.fill('#c', '8264');
    await expect(page.locator('#c')).toHaveValue('8264');
    await preparaModelli(app);
    await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
    const aiuto = await apriAiuto(app, shell, page);
    await aiuto.fill('.sn-sidebar-input textarea', 'aiutami a pagare');
    await aiuto.press('.sn-sidebar-input textarea', 'Enter');
    await expect(aiuto.locator('.sn-sidebar', { hasText: 'Premi «Paga».' })).toBeVisible({ timeout: 20_000 });
    const testo = await arrivato(app, page);
    console.log('RIGHE', nome, testo.split('\\n').filter((r) => r.includes('#c') || r.includes('#t')).join(' || ').slice(0, 600));
    expect(testo, 'il modello deve aver ricevuto la pagina col campo').toContain(':: #c');
    expect(testo, `il CVV scritto sotto «${nome}» è arrivato al modello`).not.toContain('8264');
  });
}

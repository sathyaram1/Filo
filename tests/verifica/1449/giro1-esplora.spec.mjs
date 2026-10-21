// Verifica #1449 giro 1: «Valuta» sui casi fuori dal cammino felice (riscrittura intera, campi formattati, siti che
// ascoltano il campo, selezione, testo con markup).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

async function prepara(app, risposta) {
  await app.evaluate(async (_e, risposta) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: false, spellcheckContext: false },
    });
    globalThis.__chiamate = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__chiamate.push({ model: attempts[0].model, messages: JSON.parse(JSON.stringify(messages)) });
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: risposta };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, risposta);
}

const PAGINA = `<!doctype html><meta charset="utf-8"><title>Messaggio</title>
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" style="display:block;width:520px;height:90px;font:16px sans-serif"></textarea>
  <div id="ce" contenteditable="true" style="width:520px;min-height:60px;border:1px solid #999;margin-top:12px"><div>Ciao Marco,</div><div>ci vediamo domani con i mei amici.</div></div>
  <div id="cb" contenteditable="true" style="width:520px;min-height:30px;border:1px solid #999;margin-top:12px">Porto i <b>mei</b> amici al mare.</div>
  <input id="cerca" type="search" style="margin-top:12px;width:300px">
  <script>
    window.__visto = '';
    document.getElementById('ta').addEventListener('input', (e) => { window.__visto = e.target.value; });
  </script>
</body>`;

async function valutaSu(page, selettore) {
  await page.locator(selettore).click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
  await menu.voce('Valuta').click();
}

const risposta = (correzioni) => JSON.stringify({ text: 'Ecco il parere.', correzioni, status: 'done' });

test('riscrittura intera di un campo su più righe: il clic la scrive nel campo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, risposta([{ prima: 'Ciao Marco,\nci vediamo domani con i mei amici.', dopo: 'Caro Marco,\nci vediamo domani con i miei amici.', perche: 'tono' }]));
  const page = await testServer.openReady(openTab, PAGINA);
  await valutaSu(page, '#ce');
  const c = page.locator('.sn-sidebar-correzione');
  await expect(c).toHaveCount(1, { timeout: 20_000 });
  await c.click();
  await expect(page.locator('#ce')).toHaveText(/Caro Marco,\s*ci vediamo domani con i miei amici\./, { timeout: 5000 });
});

test('correzione su una parola in grassetto di un campo modificabile', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, risposta([{ prima: 'i mei amici', dopo: 'i miei amici', perche: 'refuso' }]));
  const page = await testServer.openReady(openTab, PAGINA);
  await valutaSu(page, '#cb');
  const c = page.locator('.sn-sidebar-correzione');
  await expect(c).toHaveCount(1, { timeout: 20_000 });
  await c.click();
  await expect(page.locator('#cb')).toHaveText(/Porto i miei amici al mare\./, { timeout: 5000 });
});

test('il sito che ascolta il campo vede la correzione applicata', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, risposta([{ prima: 'i mei amici', dopo: 'i miei amici', perche: 'refuso' }]));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.fill('#ta', 'Vado con i mei amici.');
  await valutaSu(page, '#ta');
  await page.locator('.sn-sidebar-correzione').click({ timeout: 20_000 });
  await expect(page.locator('#ta')).toHaveValue('Vado con i miei amici.');
  expect(await page.evaluate(() => window.__visto)).toBe('Vado con i miei amici.');
});

test('con del testo selezionato nel campo «Valuta» c’è e manda il testo intero', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, risposta([]));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.fill('#ta', 'Prima frase. Seconda frase.');
  await page.evaluate(() => { const t = document.getElementById('ta'); t.focus(); t.setSelectionRange(0, 5); });
  await valutaSu(page, '#ta');
  await expect(page.locator('.sn-sidebar-msg-assistant')).toContainText('Ecco il parere.', { timeout: 20_000 });
  const ch = await app.evaluate(() => globalThis.__chiamate);
  expect(JSON.stringify(ch[0].messages[ch[0].messages.length - 1])).toContain('Prima frase. Seconda frase.');
});

test('casella di ricerca a una riga: «Valuta» c’è e la correzione si scrive', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, risposta([{ prima: 'ristornte', dopo: 'ristorante', perche: 'refuso' }]));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.fill('#cerca', 'ristornte a Roma');
  await valutaSu(page, '#cerca');
  await page.locator('.sn-sidebar-correzione').click({ timeout: 20_000 });
  await expect(page.locator('#cerca')).toHaveValue('ristorante a Roma');
});

test('testo con markup ed emoji: si vede com’è scritto e non diventa pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, JSON.stringify({ text: 'Ok.', correzioni: [{ prima: '<img src=x onerror="window.__xss=1">', dopo: '<b onmouseover="window.__xss=2">x</b> 😀', perche: '<i>no</i>' }], status: 'done' }));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.fill('#ta', 'Ciao 😀 <img src=x onerror="window.__xss=1"> fine');
  await valutaSu(page, '#ta');
  await expect(page.locator('.sn-sidebar-msg-user')).toContainText('<img src=x', { timeout: 8000 });
  const c = page.locator('.sn-sidebar-correzione');
  await expect(c).toHaveCount(1, { timeout: 20_000 });
  await c.hover();
  await c.click();
  await expect(page.locator('#ta')).toHaveValue('Ciao 😀 <b onmouseover="window.__xss=2">x</b> 😀 fine');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('Valuta due volte di fila in fretta: un solo parere per richiesta, il campo giusto', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, risposta([{ prima: 'i mei amici', dopo: 'i miei amici', perche: 'refuso' }]));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.fill('#ta', 'Vado con i mei amici.');
  await valutaSu(page, '#ta');
  await valutaSu(page, '#ce');
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(2, { timeout: 20_000 });
  await page.screenshot({ path: 'tests/.shots/1449-v-doppio.png' }).catch(() => {});
  await page.locator('.sn-sidebar-correzione').nth(1).click();
  await expect(page.locator('#ce')).toContainText('i miei amici');
  await expect(page.locator('#ta')).toHaveValue('Vado con i mei amici.');
});

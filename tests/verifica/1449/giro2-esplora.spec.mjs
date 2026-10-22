// Verifica #1449 giro 2: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

async function prepara(app, risposte, ritardo = 0) {
  await app.evaluate(async (_e, { risposte, ritardo }) => {
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
      const ultimo = JSON.stringify(messages[messages.length - 1]);
      globalThis.__chiamate.push(ultimo);
      const scelta = risposte.find(([p]) => ultimo.includes(p)) || risposte[risposte.length - 1];
      if (ritardo) await new Promise((r) => setTimeout(r, ritardo));
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: scelta[1] };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, { risposte, ritardo });
}

const J = (o) => JSON.stringify({ status: 'done', ...o });

async function valuta(page, sel, scheda = page) {
  await scheda.locator(sel).click({ button: 'right' });
  const menu = menuDi(scheda);
  await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
  await menu.voce('Valuta').click();
}

test('A riscrivi tutto in un contenteditable a paragrafi', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, [['', J({ text: 'Riscritto.', correzioni: [{ prima: 'Ciao Marco,\nti scrivo per il preventivo.\nA presto', dopo: 'Gentile Marco,\nLe scrivo per il preventivo.\nCordiali saluti', perche: 'più formale' }] })]]);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><div id="ce" contenteditable="true" style="width:500px;min-height:80px"><p>Ciao Marco,</p><p>ti scrivo per il preventivo.</p><p>A presto</p></div>');
  await valuta(page, '#ce');
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 15000 });
  const inviato = (await app.evaluate(() => globalThis.__chiamate)).at(-1);
  console.log('INVIATO', inviato.slice(0, 600));
  await page.locator('.sn-sidebar-correzione').click();
  await page.waitForTimeout(500);
  console.log('DOPO', JSON.stringify(await page.locator('#ce').innerHTML()));
  console.log('LOG', await page.locator('.sn-sidebar-log').allInnerTexts());
  await expect(page.locator('#ce')).toContainText('Gentile Marco');
  await expect(page.locator('#ce')).toContainText('Cordiali saluti');
  await expect(page.locator('#ce')).not.toContainText('A presto');
});

test('B campo controllato riceve input; HTML resta testo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, [['', J({ text: '<b>grassetto</b>', correzioni: [{ prima: 'erore', dopo: '<img src=x onerror="window.__x=1">', perche: '<i>x</i>' }] })]]);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><textarea id="ta" style="width:500px;height:80px"></textarea><script>window.__ev=0;ta.addEventListener("input",()=>window.__ev++)</script>');
  await page.fill('#ta', '<b>ciao</b> un erore 😀');
  await page.evaluate(() => { window.__ev = 0; });
  await valuta(page, '#ta');
  await expect(page.locator('.sn-sidebar-msg-user')).toContainText('<b>ciao</b>', { timeout: 8000 });
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 15000 });
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#ta')).toHaveValue('<b>ciao</b> un <img src=x onerror="window.__x=1"> 😀');
  expect(await page.evaluate(() => window.__ev)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
});

test('C campo dentro shadow DOM', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, [['', J({ text: 'ok', correzioni: [{ prima: 'erore', dopo: 'errore', perche: 'r' }] })]]);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><div id="h"></div><script>const s=h.attachShadow({mode:"open"});s.innerHTML="<textarea id=ta style=width:400px;height:60px>Un erore qui.</textarea>"</script>');
  await page.locator('#h textarea').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  console.log('VOCI SHADOW', await menu.voci.allInnerTexts());
  await expect(menu.voce('Valuta')).toHaveCount(1);
});

test('D due Valuta di fila su campi diversi', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, [
    ['Primo', J({ text: 'uno', correzioni: [{ prima: 'mei', dopo: 'miei', perche: 'r' }] })],
    ['', J({ text: 'due', correzioni: [{ prima: 'erore', dopo: 'errore', perche: 'r' }] })],
  ], 2500);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><textarea id="a" style="width:400px;height:60px">Primo coi mei amici.</textarea><textarea id="b" style="width:400px;height:60px">Secondo coi mei amici e un erore.</textarea>');
  await valuta(page, '#a');
  await page.waitForTimeout(300);
  await valuta(page, '#b');
  await page.waitForTimeout(7000);
  console.log('MSG', await page.locator('.sn-sidebar-msg-user, .sn-sidebar-msg-assistant, .sn-sidebar-correzione, .sn-sidebar-log').allInnerTexts());
  const corr = page.locator('.sn-sidebar-correzione', { hasText: 'miei' });
  if (await corr.count()) {
    await corr.first().click();
    console.log('A', await page.locator('#a').inputValue(), '| B', await page.locator('#b').inputValue());
    await expect(page.locator('#a')).toHaveValue('Primo coi miei amici.');
    await expect(page.locator('#b')).toHaveValue('Secondo coi mei amici e un erore.');
  }
});

test('E solo spazi e input text', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, [['', J({ text: 'ok', correzioni: [{ prima: 'Ogetto', dopo: 'Oggetto', perche: 'r' }] })]]);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><textarea id="sp" style="width:400px;height:60px">     </textarea><input id="in" style="width:300px" value="Ogetto della mail">');
  await page.locator('#sp').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  await expect(menu.voce('Valuta')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await valuta(page, '#in');
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 15000 });
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#in')).toHaveValue('Oggetto della mail');
});

test('F con una parola selezionata nel campo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, [['', J({ text: 'ok' })]]);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><textarea id="ta" style="width:400px;height:60px">Una frase da valutare.</textarea>');
  await page.locator('#ta').click();
  await page.evaluate(() => { const t = document.getElementById('ta'); t.setSelectionRange(4, 9); });
  await page.locator('#ta').click({ button: 'right', position: { x: 50, y: 10 } });
  const menu = menuDi(page);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  console.log('VOCI SEL', await menu.voci.allInnerTexts());
  await expect(menu.voce('Valuta')).toHaveCount(1);
});

test('G chiudi l’Aiuto, riapri dal menu Aiuto e scrivi: niente correzioni sul campo vecchio, modello?', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, [['', J({ text: 'ok', correzioni: [{ prima: 'erore', dopo: 'errore', perche: 'r' }] })]]);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><textarea id="ta" style="width:400px;height:60px">Un erore.</textarea>');
  await valuta(page, '#ta');
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 15000 });
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#ta')).toHaveValue('Un errore.');
  // Valuta di nuovo lo stesso campo: nuova conversazione o accodata?
  await valuta(page, '#ta');
  await page.waitForTimeout(3000);
  console.log('MSG2', await page.locator('.sn-sidebar-msg-user').allInnerTexts());
});

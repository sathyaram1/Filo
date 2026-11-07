// Verifica #2096 giro 2: esplorazione. Il modello è finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { confirmState, CONFIRM_HOST } from '../../helpers/confirm.mjs';

async function preparaModello(app, copione) {
  await app.evaluate(async (_e, copione) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__copione = copione.slice();
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = !!messages[0] && messages[0].role === 'system' && String(messages[0].content || '').startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic());
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      const r = globalThis.__copione.shift() || { text: 'ok' };
      if (r.attendi) await new Promise((ok) => { globalThis.__sblocca = ok; });
      try { onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, copione);
}

const geometria = (home) => home.evaluate(() => {
  const el = document.getElementById('bubbles');
  return { top: el.scrollTop, h: el.clientHeight, w: el.clientWidth, bolle: [...el.querySelectorAll(':scope > .dash-bubble')].map((b) => Math.round(b.getBoundingClientRect().height * 10) / 10) };
});

test('home: il messaggio lungo dell\'utente, la barra non copre la risposta sotto', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: 'Ricevuto.' }]);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill('riga uno\nriga due\nriga tre');
  await home.locator('#input').press('Enter');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Ricevuto.' })).toBeVisible({ timeout: 20_000 });
  const mia = home.locator('#bubbles > .dash-bubble-user').last();
  await home.mouse.move(2, 2);
  const ferma = await geometria(home);
  await mia.hover();
  const barra = mia.locator('.dash-msg-azioni');
  await expect(barra).toBeVisible();
  expect(await geometria(home)).toEqual(ferma);
  const r = await barra.boundingBox();
  const sotto = await home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Ricevuto.' }).boundingBox();
  console.log('barra', JSON.stringify(r), 'risposta', JSON.stringify(sotto));
  await home.screenshot({ path: 'tests/.shots/2096-g2-utente-lungo.png' });
  expect(r.y + r.height).toBeLessThanOrEqual(sotto.y + 1);
});

test('home: il proprio messaggio mentre Filo lavora, la barra non muove niente', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: 'Prima.' }, { text: 'Dopo.', attendi: true }]);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill('uno');
  await home.locator('#input').press('Enter');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Prima.' })).toBeVisible({ timeout: 20_000 });
  await home.locator('#input').fill('due');
  await home.locator('#input').press('Enter');
  const mia = home.locator('#bubbles > .dash-bubble-user', { hasText: 'due' });
  await expect(mia).toBeVisible();
  await home.waitForTimeout(800);
  await home.mouse.move(2, 2);
  const ferma = await geometria(home);
  await mia.hover();
  await home.waitForTimeout(300);
  const vis = await mia.locator('.dash-msg-azioni').isVisible().catch(() => false);
  const dopo = await geometria(home);
  console.log('barra visibile', vis, JSON.stringify(ferma), JSON.stringify(dopo));
  await home.screenshot({ path: 'tests/.shots/2096-g2-utente-in-attesa.png' });
  expect(dopo).toEqual(ferma);
  await app.evaluate(() => globalThis.__sblocca && globalThis.__sblocca());
});

test('home: Modifica con una bozza nel campo non la perde', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: 'Ok.' }]);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill('ciao Filo');
  await home.locator('#input').press('Enter');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Ok.' })).toBeVisible({ timeout: 20_000 });
  await home.locator('#input').fill('bozza importante');
  const mia = home.locator('#bubbles > .dash-bubble-user', { hasText: 'ciao Filo' });
  await mia.hover();
  await mia.locator('.dash-msg-azioni').getByRole('button', { name: 'Modifica' }).click();
  const v = await home.locator('#input').inputValue();
  console.log('campo dopo Modifica:', JSON.stringify(v));
  expect(v).toContain('bozza importante');
  expect(v).toContain('ciao Filo');
});

test('Preferenze: Rimetti di serie sul tema scelto non chiede di un testo scritto', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  const page = await openTab('filo://preferences/preferences.html');
  const sel = page.locator('#theme');
  await expect(sel).toHaveValue('dark', { timeout: 10_000 });
  await sel.click({ button: 'right' });
  await menuDi(page).voce('Rimetti di serie').first().click();
  await page.waitForTimeout(800);
  const s = await confirmState(page);
  console.log('conferma sul tema:', JSON.stringify(s));
  await page.screenshot({ path: 'tests/.shots/2096-g2-tema-conferma.png' });
  expect(s).toBeNull();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme)).toBe('system');
});

test('Modelli: la chiave della ricerca web chiede prima di togliersi', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => { const s = await globalThis.SN_STORAGE.getSettings(); await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { ...s.apiKeys, tavily: 'tvly-mia' } }); });
  const page = await openTab('filo://options/options.html');
  const campo = page.locator('#apiKeyTavily');
  await expect(campo).toBeAttached({ timeout: 10_000 });
  await campo.scrollIntoViewIfNeeded().catch(() => {});
  await campo.click({ button: 'right', force: true });
  const voci = await menuDi(page).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim()));
  console.log('voci tavily', voci);
  await menuDi(page).voce('Togli la chiave').first().click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
});

test('Altro: Rimetti di serie sull\'elenco scritto a mano chiede', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://options/altro.html');
  const campo = page.locator('#blocklist');
  await expect(campo).toBeAttached({ timeout: 10_000 });
  await campo.fill('pubblicita.example\ntracker.example');
  await campo.blur();
  await page.waitForTimeout(1200);
  await campo.click({ button: 'right', force: true });
  const voci = await menuDi(page).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim()));
  console.log('voci altro', voci);
  await menuDi(page).voce('Rimetti di serie').first().click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  console.log('conferma altro', JSON.stringify(await confirmState(page)));
});

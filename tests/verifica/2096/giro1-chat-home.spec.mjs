// Verifica #2096 giro 1: nella home le azioni sui messaggi (di Filo e dell'utente) non muovono la chat, e quelle
// dell'utente fanno quello che dicono, dai tasti e dal tasto destro. Il modello è finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

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
      try { onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, copione);
}

async function apriHome(openTab) {
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  return home;
}
async function scrivi(home, cosa) {
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill(cosa);
  await home.locator('#input').press('Enter');
}

const foto = (home) => home.evaluate(() => {
  const b = document.querySelector('#bubbles');
  return {
    alte: [...b.children].filter((n) => n.matches('.dash-bubble')).map((n) => Math.round(n.getBoundingClientRect().height * 100) / 100),
    larga: b.clientWidth,
    scrollTop: b.scrollTop,
    scrollHeight: b.scrollHeight,
  };
});

const RISPOSTE = [
  'Ecco un primo paragrafo.\n\nE un secondo paragrafo che chiude la risposta.',
  'Seconda risposta, una riga sola.',
  'Terza risposta.\n\nAncora un paragrafo in fondo.',
];

test('hover su ogni messaggio, di Filo e dell\'utente, non cambia altezze, larghezza né scorrimento', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaModello(app, RISPOSTE.map((text) => ({ text })));
  const home = await apriHome(openTab);
  for (const [i, d] of ['prima domanda', 'seconda domanda', 'terza domanda'].entries()) {
    await scrivi(home, d);
    await expect(home.locator('#bubbles > .dash-bubble-filo').nth(i)).toContainText(RISPOSTE[i].split('\n')[0].slice(0, 12), { timeout: 20_000 });
  }
  await expect(home.locator('#bubbles > .dash-bubble-filo').last()).toHaveAttribute('data-key', /^m:/, { timeout: 10_000 });
  // Il mouse lontano, poi la foto di partenza.
  await home.mouse.move(2, 2);
  await home.waitForTimeout(400);
  const base = await foto(home);
  const bolle = home.locator('#bubbles > .dash-bubble-filo, #bubbles > .dash-bubble-user');
  const n = await bolle.count();
  expect(n).toBeGreaterThanOrEqual(6);
  for (let i = n - 1; i >= 0; i -= 1) {
    await bolle.nth(i).hover();
    await home.waitForTimeout(300);
    const ora = await foto(home);
    expect(ora, `hover sulla bolla ${i}`).toEqual(base);
  }
  await home.screenshot({ path: 'tests/.shots/verifica-2096-hover.png' });
});

test('Copia, Modifica e Cita sotto il messaggio dell\'utente, allineati a destra, e le stesse voci al tasto destro', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: 'Risposta.' }]);
  const home = await apriHome(openTab);
  const MIO = 'scrivimi <b>una</b> poesia & due rime';
  await scrivi(home, MIO);
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Risposta.' })).toBeVisible({ timeout: 20_000 });
  const mia = home.locator('#bubbles > .dash-bubble-user', { hasText: 'poesia' });
  await mia.hover();
  const barra = mia.locator('.dash-msg-azioni');
  await expect(barra).toBeVisible();
  for (const nome of ['Copia', 'Modifica', 'Cita']) await expect(barra.getByRole('button', { name: nome })).toBeVisible();
  const bb = await mia.boundingBox();
  const sb = await barra.boundingBox();
  expect(Math.abs((sb.x + sb.width) - (bb.x + bb.width))).toBeLessThanOrEqual(8);
  expect(sb.y).toBeGreaterThanOrEqual(bb.y + bb.height - 1);
  await home.screenshot({ path: 'tests/.shots/verifica-2096-utente.png' });

  await barra.getByRole('button', { name: 'Copia' }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(MIO);

  await mia.hover();
  await barra.getByRole('button', { name: 'Modifica' }).click();
  await expect(home.locator('#input')).toHaveValue(MIO);
  await expect(home.locator('#input')).toBeFocused();

  // Il tasto destro sulla bolla ha le stesse tre voci.
  await home.locator('#input').fill('');
  await mia.click({ button: 'right' });
  const menu = menuDi(home);
  await expect(menu.voce('Copia')).toBeVisible();
  await expect(menu.voce('Modifica')).toBeVisible();
  await expect(menu.voce('Cita')).toBeVisible();
  await menu.voce('Cita').click();
  await expect(home.locator('#citazione')).toBeVisible();
  await expect(home.locator('#citazione')).toContainText('Tu');
  await expect(home.locator('#citazione')).toContainText('poesia');
});

test('Modifica premuto due volte non raddoppia il testo nel campo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: 'Risposta.' }]);
  const home = await apriHome(openTab);
  await scrivi(home, 'ciao Filo');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Risposta.' })).toBeVisible({ timeout: 20_000 });
  const mia = home.locator('#bubbles > .dash-bubble-user', { hasText: 'ciao Filo' });
  for (let k = 0; k < 2; k += 1) {
    await mia.hover();
    await mia.locator('.dash-msg-azioni').getByRole('button', { name: 'Modifica' }).click();
  }
  await expect(home.locator('#input')).toHaveValue('ciao Filo');
});

test('riaperta la home, il messaggio dell\'utente ha ancora Copia, Modifica e Cita', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: 'Risposta.' }]);
  let home = await apriHome(openTab);
  await scrivi(home, 'messaggio da ritrovare');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Risposta.' })).toBeVisible({ timeout: 20_000 });
  await home.reload();
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  const mia = home.locator('#bubbles > .dash-bubble-user', { hasText: 'messaggio da ritrovare' });
  await expect(mia).toBeVisible({ timeout: 15_000 });
  await mia.hover();
  const barra = mia.locator('.dash-msg-azioni');
  for (const nome of ['Copia', 'Modifica', 'Cita']) await expect(barra.getByRole('button', { name: nome })).toBeVisible();
  await barra.getByRole('button', { name: 'Modifica' }).click();
  await expect(home.locator('#input')).toHaveValue('messaggio da ritrovare');
});

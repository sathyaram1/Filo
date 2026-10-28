// Esplorazione della verifica #1620: screenshot e stress di Copia e Rispondi.
import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app, copione, tema) {
  await app.evaluate(async (_e, { copione, tema }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      theme: tema,
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages)));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      if (r.parziale) {
        try { onDelta && onDelta(r.parziale); } catch (_) {}
        await new Promise((ok) => { globalThis.__sblocca = ok; });
      }
      try { onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { copione, tema });
}

async function scrivi(home, cosa) {
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill(cosa);
  await home.locator('#input').press('Enter');
}

const LUNGO = 'Ecco una risposta molto lunga. '.repeat(80) + 'FINE.';
const HTML = 'Prova <img src=x onerror="window.__xss=1"> e <b>grassetto</b> 😀🍕';

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, openTab }) => {
    test.setTimeout(120_000);
    await preparaModello(app, [{ text: '**Tre idee** per cena:\n\n1. Pasta\n2. Risotto\n3. Zuppa' }, { text: LUNGO }, { text: 'Bene.' }], tema);
    const home = await openTab('filo://newtab/');
    await scrivi(home, 'cosa cucino?');
    const r1 = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Risotto' });
    await expect(r1).toBeVisible({ timeout: 20_000 });
    await scrivi(home, 'dimmi di più');
    const r2 = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'FINE.' });
    await expect(r2).toBeVisible({ timeout: 20_000 });
    await r1.hover();
    await home.waitForTimeout(400);
    await home.screenshot({ path: `tests/.shots/v1620-${tema}-hover-r1.png` });
    await r2.hover();
    await home.waitForTimeout(400);
    await home.screenshot({ path: `tests/.shots/v1620-${tema}-hover-ultima.png` });
    const barra = r2.locator('.dash-msg-azioni');
    const bb = await barra.boundingBox();
    const comp = await home.locator('#input').boundingBox();
    console.log('BARRA ultima', JSON.stringify(bb), 'INPUT', JSON.stringify(comp));
    // il punto al centro del tasto Rispondi è davvero il tasto?
    const rb = await barra.getByRole('button', { name: 'Rispondi' }).boundingBox();
    const sopra = await home.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return el && (el.closest('button')?.textContent || el.className || el.tagName); }, { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 });
    console.log('ELEMENTO SOTTO RISPONDI ultima', sopra);
    await barra.getByRole('button', { name: 'Rispondi' }).click();
    await home.waitForTimeout(300);
    await home.screenshot({ path: `tests/.shots/v1620-${tema}-citazione-lunga.png` });
    console.log('CITAZIONE box', JSON.stringify(await home.locator('#citazione').boundingBox()));
    await home.locator('#input').fill('ok');
    await home.locator('#input').press('Enter');
    await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Bene.' })).toBeVisible({ timeout: 20_000 });
    await home.waitForTimeout(300);
    await home.screenshot({ path: `tests/.shots/v1620-${tema}-bolla-lunga.png` });
    console.log('BOLLA box', JSON.stringify(await home.locator('#bubbles > .dash-bubble-user').last().boundingBox()));
  });
}

test('stress: html, emoji, streaming, sostituzione, invio vuoto', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: HTML }, { text: 'Seconda risposta completa.', parziale: 'Seconda risp' }, { text: 'Terza.' }, { text: 'Quarta.' }], 'light');
  const home = await openTab('filo://newtab/');
  await scrivi(home, 'prova');
  const r1 = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'grassetto' });
  await expect(r1).toBeVisible({ timeout: 20_000 });
  await r1.hover();
  await r1.getByRole('button', { name: 'Copia' }).click();
  console.log('APPUNTI html', JSON.stringify(await app.evaluate(({ clipboard }) => clipboard.readText())));
  await r1.getByRole('button', { name: 'Rispondi' }).click();
  console.log('CITAZIONE html', JSON.stringify(await home.locator('#citazione').innerText()));
  console.log('XSS', await home.evaluate(() => window.__xss));

  // Invio con sola citazione e campo vuoto
  await home.locator('#input').fill('');
  await home.locator('#input').press('Enter');
  await home.waitForTimeout(800);
  console.log('DOPO INVIO VUOTO citazione visibile', await home.locator('#citazione').isVisible(), 'bolle utente', await home.locator('#bubbles > .dash-bubble-user').count());

  // Solo spazi
  await home.locator('#input').fill('   ');
  await home.locator('#input').press('Enter');
  await home.waitForTimeout(800);
  console.log('DOPO SPAZI citazione visibile', await home.locator('#citazione').isVisible(), 'bolle utente', await home.locator('#bubbles > .dash-bubble-user').count());

  await home.locator('#input').fill('seconda domanda');
  await home.locator('#input').press('Enter');
  await expect.poll(() => app.evaluate(() => typeof globalThis.__sblocca === 'function'), { timeout: 15_000 }).toBe(true);
  // Rispondi su una risposta ancora in scrittura
  const inScrittura = home.locator('#bubbles > .dash-bubble-filo').last();
  await home.waitForTimeout(500);
  console.log('IN SCRITTURA testo', JSON.stringify(await inScrittura.innerText()), 'key', await inScrittura.getAttribute('data-key'));
  await inScrittura.hover();
  await home.waitForTimeout(300);
  console.log('IN SCRITTURA tasti visibili', await inScrittura.locator('.dash-msg-azioni').isVisible().catch(() => 'n/a'));
  await home.screenshot({ path: 'tests/.shots/v1620-in-scrittura.png' });
  const rispIn = inScrittura.getByRole('button', { name: 'Rispondi' });
  if (await rispIn.isVisible().catch(() => false)) {
    await rispIn.click();
    console.log('CITAZIONE in scrittura', JSON.stringify(await home.locator('#citazione').innerText()));
  }
  await app.evaluate(() => globalThis.__sblocca());
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Seconda risposta completa.' })).toBeVisible({ timeout: 20_000 });
  await home.waitForTimeout(500);
  console.log('CITAZIONE dopo fine scrittura', JSON.stringify(await home.locator('#citazione').isVisible() ? await home.locator('#citazione').innerText() : null));

  // Sostituzione: Rispondi su r1 poi su r2
  const r2 = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Seconda risposta completa.' });
  await r1.hover();
  await r1.getByRole('button', { name: 'Rispondi' }).click();
  await r2.hover();
  await r2.getByRole('button', { name: 'Rispondi' }).click();
  console.log('CITAZIONE sostituita', JSON.stringify(await home.locator('#citazione').innerText()));
  await home.locator('#input').fill('terza');
  await home.locator('#input').press('Enter');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Terza.' })).toBeVisible({ timeout: 20_000 });
  const mia = home.locator('#bubbles > .dash-bubble-user').last();
  console.log('BOLLA terza citata', await mia.locator('.dash-citata').getAttribute('data-testo'));

  // tastiera: Tab sulle risposte arriva ai tasti?
  await home.locator('#input').focus();
  const raggiunti = [];
  for (let k = 0; k < 25; k++) {
    await home.keyboard.press('Shift+Tab');
    raggiunti.push(await home.evaluate(() => { const a = document.activeElement; return (a.getAttribute('aria-label') || a.textContent || a.id || a.tagName).trim().slice(0, 25); }));
  }
  console.log('SHIFT+TAB', JSON.stringify(raggiunti));
  await home.screenshot({ path: 'tests/.shots/v1620-tastiera.png' });

  // tasto destro sulla bolla utente: Rispondi?
  await mia.click({ button: 'right' });
  await home.waitForTimeout(600);
  await home.screenshot({ path: 'tests/.shots/v1620-destro-utente.png' });
});

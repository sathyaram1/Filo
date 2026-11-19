// Verifica #2346 giro 1: le altre strade per rispondere a un passo (Mazzi, scambio di un'app nella home) e una
// selezione rimasta su un'altra risposta. I modelli sono finti.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__n = 0;
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], finishReason: 'stop' });
      const tutto = JSON.stringify(messages);
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (tutto.includes('preparare la dashboard')) return fatto('{"message":"","suggestions":[]}');
      if (sistema.includes('deck builder per Magic')) return fatto(JSON.stringify({ reply: 'Per questo mazzo servono più pescate. Togli due terre.' }));
      if (sistema.startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic())) {
        globalThis.__n += 1;
        return fatto(globalThis.__n === 1 ? 'Prima risposta: mele rosse e pere.' : globalThis.__n === 2 ? 'Seconda risposta: kiwi verdi e uva.' : 'Va bene.');
      }
      return fatto('{}');
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => {
      const r = risposta(o);
      try { o.onDelta && o.onDelta(r.text); } catch (_) {}
      return r;
    };
  });
}

function seleziona(el, cosa) {
  return el.evaluate((nodo, cosa) => {
    const nodi = [];
    const w = document.createTreeWalker(nodo, NodeFilter.SHOW_TEXT);
    for (let x = w.nextNode(); x; x = w.nextNode()) nodi.push(x);
    const tutto = nodi.map((x) => x.data).join('');
    const k = tutto.indexOf(cosa);
    if (k < 0) throw new Error(`non c'è: ${cosa}`);
    const dove = (p) => { let f = 0; for (const x of nodi) { if (p <= f + x.data.length) return [x, p - f]; f += x.data.length; } return null; };
    const r = document.createRange();
    r.setStart(...dove(k)); r.setEnd(...dove(k + cosa.length));
    getSelection().removeAllRanges(); getSelection().addRange(r);
  }, cosa);
}

test('Mazzi e scambio nella home: Rispondi con un passo selezionato cita solo il passo', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app);
  const casa = await home(app);
  const mazzi = await openTab('filo://decks/decks.html');
  await mazzi.waitForLoadState('domcontentloaded');
  await mazzi.click('#newDeck');
  await mazzi.fill('#chatInput', 'che ne pensi del mazzo?');
  await mazzi.press('#chatInput', 'Enter');
  const bot = mazzi.locator('.dk-msg-bot.sn-con-azioni-msg').last();
  await expect(bot).toContainText('Togli due terre', { timeout: 15_000 });
  await mazzi.fill('#chatInput', '');
  await seleziona(bot, 'Togli due terre');
  await bot.hover();
  await bot.getByRole('button', { name: 'Rispondi' }).click();
  const nelMazzo = await mazzi.locator('#chatInput').inputValue();
  test.info().annotations.push({ type: 'mazzi', description: nelMazzo });
  expect.soft(nelMazzo, 'Mazzi').not.toContain('servono più pescate');

  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => String(x.url || '').startsWith('filo://newtab'));
    if (t) await window.filoShell.tabs.activate(t.id);
  });
  const riga = casa.locator('#bubbles .dash-riga-app');
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await riga.locator('.dash-riga-app-testa').click();
  const risposta = riga.locator('.dash-riga-app-msg-filo');
  await expect(risposta).toContainText('Togli due terre');
  await seleziona(risposta, 'Togli due terre');
  await risposta.hover();
  await risposta.getByRole('button', { name: 'Rispondi' }).click();
  const citata = await casa.locator('#citazione').innerText();
  test.info().annotations.push({ type: 'scambio', description: citata });
  await casa.screenshot({ path: 'tests/.shots/v2346-scambio.png' });
  expect.soft(citata, 'scambio nella home').not.toContain('servono più pescate');
});

test('una selezione su una risposta e Rispondi su un\'altra: cita l\'altra intera', async ({ app }) => {
  test.setTimeout(120_000);
  await prepara(app);
  const casa = await home(app);
  const input = casa.locator('#input');
  await input.fill('frutta?'); await input.press('Enter');
  const prima = casa.locator('#bubbles > .dash-bubble-filo', { hasText: 'Prima risposta' });
  await expect(prima).toHaveAttribute('data-key', /^m:/, { timeout: 20_000 });
  await input.fill('altra?'); await input.press('Enter');
  const seconda = casa.locator('#bubbles > .dash-bubble-filo', { hasText: 'Seconda risposta' });
  await expect(seconda).toHaveAttribute('data-key', /^m:/, { timeout: 20_000 });
  await seleziona(prima, 'mele rosse');
  await seconda.hover();
  await seconda.getByRole('button', { name: 'Rispondi' }).click();
  const citata = await casa.locator('#citazione .dash-citazione-testo').allTextContents();
  test.info().annotations.push({ type: 'altra', description: JSON.stringify(citata) });
  expect(citata.join(' ')).toContain('kiwi verdi');
  expect(citata.join(' ')).not.toContain('mele rosse');
});

// Verifica #872 giro 2: esplorazione (salto a un messaggio lontano, due quaderni aperti, aspetto con righe lunghe).

import { test, expect } from '../../fixtures/electron.mjs';

const QUADERNO = 'filo://quaderno/quaderno.html';

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash', [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__q_prompt = [];
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      if (joined.includes('analizzare l\'ultima interazione')) {
        return { ...base, text: /UTENTE: [^\n]*vegetarian/i.test(joined) ? 'LEZIONE: L’utente è vegetariano.' : 'NULLA DA IMPARARE' };
      }
      if (joined.includes('integrare le nuove lezioni')) return { ...base, text: 'PREFERENZE:\nÈ vegetariano (fonti: L1)' };
      if (joined.includes('Classifichi le conversazioni')) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Varie' }) };
      globalThis.__q_prompt.push(joined);
      return { ...base, text: 'Va bene.' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  });
}

const turno = (app, chatId, userMessage) => app.evaluate(
  (_e, a) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: a.userMessage, threadHistory: [], chatId: a.chatId }),
  { chatId, userMessage },
);
const esatto = (t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const riga = (page, testo) => page.locator('.qd-riga').filter({ has: page.locator('.qd-testo', { hasText: esatto(testo) }) });

async function finestraCon(app, prova) {
  let w = null;
  await expect.poll(() => Boolean(w = app.windows().find((x) => { try { return prova(x.url()); } catch (_) { return false; } })), { timeout: 10_000 }).toBe(true);
  await w.waitForLoadState('domcontentloaded');
  return w;
}

test('salto a un messaggio lontano nel filo', async ({ app, shell, openTab }) => {
  test.setTimeout(240_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  await turno(app, 'chat-cibo', 'Ti dico una cosa: sono vegetariano');
  await expect.poll(async () => (await app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer())).length, { timeout: 10_000 }).toBe(1);
  for (let i = 0; i < 90; i++) await turno(app, `chat-${i}`, `domanda numero ${i} sul meteo`);
  const page = await openTab(QUADERNO);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_compact_memory' }));
  const nota = riga(page, 'È vegetariano');
  await expect(nota).toHaveCount(1, { timeout: 8_000 });
  await nota.locator('.qd-salto').click();
  const home = await finestraCon(app, (u) => u.includes('evento='));
  const bolla = home.locator('.dash-trovato');
  await expect(bolla).toHaveCount(1, { timeout: 15_000 });
  await expect(bolla).toContainText('sono vegetariano');
  await expect(bolla).toBeInViewport();
  await home.screenshot({ path: 'tests/.shots/v872-salto-lontano.png' });
});

test('due quaderni aperti: la correzione in uno si vede nell\'altro', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta', PREFERENZE: 'Ama il tè' }));
  const a = await openTab(QUADERNO);
  const b = await openTab(QUADERNO);
  await expect(riga(b, 'Ama il tè')).toHaveCount(1, { timeout: 8_000 });
  await expect(riga(a, 'Ama il tè')).toHaveCount(1, { timeout: 8_000 });
  await riga(b, 'Ama il tè').locator('.qd-testo').dblclick();
  await b.locator('.qd-campo').fill('Ama il caffè');
  await b.locator('.qd-campo').press('Enter');
  await expect(riga(a, 'Ama il caffè')).toHaveCount(1, { timeout: 8_000 });
  await riga(a, 'Ama il caffè').hover();
  await riga(a, 'Ama il caffè').locator('.qd-tasto[title="Togli dalla memoria"]').click();
  await expect(riga(b, 'Ama il caffè')).toHaveCount(1, { timeout: 8_000 });
  await expect(b.locator('.qd-gruppo[data-gruppo="nascoste"]')).toHaveCount(1, { timeout: 8_000 });
});

test('aspetto: tante righe, righe lunghe, nascoste aperte, chiaro e scuro', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const lunga = 'Preferisce risposte che partano dal punto, senza preamboli, ' + 'con esempi concreti e numeri veri '.repeat(8) + 'e un emoji 🍝 ogni tanto';
  await app.evaluate(async (_e, l) => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.setMemory({
      PROFILO: 'Si chiama Marta\nVive a Lisbona\nLavora come architetta\nHa due gatti',
      PREFERENZE: `Risposte brevi\n${l}\nNiente emoji nei titoli\nUnaparolalunghissimasenzaspazi${'x'.repeat(120)}`,
      PROGETTO_ORTO: 'Coltiva pomodori\nIl basilico va annaffiato la sera',
      VIAGGI: 'Va in Norvegia ad agosto',
    });
    await M.addKeepOpen('web.whatsapp.com');
    await M.appendLesson('Quando chiede una ricetta, niente carne', { fonti: [] });
  }, lunga);
  const page = await openTab(QUADERNO);
  await expect(riga(page, 'Risposte brevi')).toHaveCount(1, { timeout: 8_000 });
  await riga(page, 'Ha due gatti').hover();
  await riga(page, 'Ha due gatti').locator('.qd-tasto[title="Togli dalla memoria"]').click();
  await expect(page.locator('#esito')).toContainText('Tolta');
  await page.locator('.qd-nascoste').evaluate((d) => { d.open = true; });
  for (const tema of ['light', 'dark']) {
    await app.evaluate((_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    await page.reload();
    await expect(riga(page, 'Risposte brevi')).toHaveCount(1, { timeout: 8_000 });
    await page.locator('.qd-nascoste').evaluate((d) => { d.open = true; });
    await riga(page, 'Vive a Lisbona').hover();
    await page.screenshot({ path: `tests/.shots/v872-quaderno-${tema}.png`, fullPage: true });
    await page.setViewportSize({ width: 420, height: 800 }).catch(() => {});
  }
  const scorre = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(scorre).toBe(false);
});

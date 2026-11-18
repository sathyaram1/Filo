// Verifica #2536, giro 2: nell'intervista rifatta la memoria resta di Filo anche se il modello non la vede. Chi chiede
// di togliere una cosa che nomina lui la vede tolta; chi chiede cosa Filo ricorda non si sente dire che la memoria è
// vuota. Filo vero, modello vero (DeepSeek V4 Flash via OpenRouter): senza chiave si salta.

import { test, expect } from '../../fixtures/electron.mjs';

const KEY = process.env.OPENROUTER_API_KEY || '';
const NEGA = /non (ho|c'è|ricordo|mi ricordo) (ancora )?(niente|nulla)|(è|era|sono) (ancora )?vuot[aoie]|non so (ancora )?(niente|nulla)|nessun ricordo|non c'è (nessuna )?traccia/i;

function newtabWindows(app) {
  return app.windows().filter((w) => w.url().startsWith('filo://newtab'));
}
async function newtabPage(app, index = 0) {
  await expect.poll(() => newtabWindows(app).length, { timeout: 15_000 }).toBeGreaterThan(index);
  const win = newtabWindows(app)[index];
  await win.waitForLoadState('domcontentloaded');
  return win;
}

// La risposta è finita quando le bolle di Filo sono `n` e il testo della pagina resta fermo per qualche secondo.
async function attendiRisposta(page, n) {
  await expect(page.locator('.dash-bubble-filo')).toHaveCount(n, { timeout: 120_000 });
  let prima = '';
  await expect.poll(async () => {
    const ora = await page.locator('body').innerText();
    const fermo = ora === prima;
    prima = ora;
    return fermo;
  }, { timeout: 120_000, intervals: [4_000] }).toBe(true);
}

async function intervistaRifatta(app, openTab) {
  await newtabPage(app);
  await app.evaluate(async (_e, key) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: key },
      models: Object.fromEntries([C.ACTIONS.FILO_CHAT, C.ACTIONS.FILO_LESSON, C.ACTIONS.FILO_COMPACT, C.ACTIONS.FILO_COMPATTAZIONE, C.ACTIONS.FILO_DASHBOARD].map((a) => [a, 'deepseek-flash'])),
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Fa il geometra in uno studio tecnico.\nHa un gatto che si chiama Pepe.\nHa prenotato un volo per Lisbona a dicembre.',
      PREFERENZE: 'Preferisce risposte brevi.',
    });
  }, KEY);
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.locator('#restartOnboarding').click();
  const intervista = await newtabPage(app, 1);
  await expect(intervista.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  return intervista;
}

async function chiedi(intervista, testo) {
  const n = await intervista.locator('.dash-bubble-filo').count();
  await intervista.locator('#input').fill(testo);
  await intervista.locator('#sendBtn').click();
  await attendiRisposta(intervista, n + 1);
  await intervista.waitForTimeout(5_000);
  return intervista.locator('.dash-bubble-filo').last().innerText();
}

const profilo = (app) => app.evaluate(async () => {
  const M = globalThis.SN_FILO_MEMORY;
  return M.renderMemoryForPrompt(await M.getMemory()).profilo || '';
});

for (const volta of [1, 2]) {
  test(`r1 «il gatto Pepe non c'è più, toglilo dalla memoria» nell'intervista rifatta lo toglie davvero (${volta})`, async ({ app, shell, openTab }) => {
    test.skip(!KEY, 'serve una chiave OpenRouter');
    test.setTimeout(300_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
    const intervista = await intervistaRifatta(app, openTab);
    const risposta = await chiedi(intervista, 'sono luca. ah il mio gatto pepe purtroppo non c\'è più, toglilo dalla memoria');
    const dopo = await profilo(app);
    expect(dopo, `Filo ha risposto: ${risposta}`).not.toMatch(/pepe/i);
    expect(dopo).toMatch(/geometra/i);
    expect(risposta).not.toMatch(NEGA);
  });

  test(`r1 «cosa ti ricordi già di me?» nell'intervista rifatta non si sente dire che la memoria è vuota (${volta})`, async ({ app, shell, openTab }) => {
    test.skip(!KEY, 'serve una chiave OpenRouter');
    test.setTimeout(300_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
    const intervista = await intervistaRifatta(app, openTab);
    const risposta = await chiedi(intervista, 'sono luca. prima di andare avanti: cosa ti ricordi già di me?');
    expect(risposta).not.toMatch(NEGA);
  });
}

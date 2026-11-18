// Verifica #2536, giro 2: nell'intervista rifatta, con la memoria che il modello non vede, l'utente chiede di togliere
// una riga che nomina lui («il gatto Pepe non c'è più»): la riga deve sparire dalla memoria. Modello vero; senza chiave si salta.

import { test, expect } from '../../fixtures/electron.mjs';

const KEY = process.env.OPENROUTER_API_KEY || '';

function newtabWindows(app) {
  return app.windows().filter((w) => w.url().startsWith('filo://newtab'));
}
async function newtabPage(app, index = 0) {
  await expect.poll(() => newtabWindows(app).length, { timeout: 15_000 }).toBeGreaterThan(index);
  const win = newtabWindows(app)[index];
  await win.waitForLoadState('domcontentloaded');
  return win;
}

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

const CASI = [
  ...[1, 2, 3].map((giro) => ({ giro, chiede: 'sono luca. ah il mio gatto pepe purtroppo non c\'è più, toglilo dalla memoria', toglie: true })),
  ...[4, 5, 6].map((giro) => ({ giro, chiede: 'sono luca. prima di andare avanti: cosa ti ricordi già di me?' })),
];
for (const { giro, chiede, toglie } of CASI) {
  test(`giro ${giro}: «${chiede}» nell’intervista rifatta`, async ({ app, shell, openTab }) => {
    test.skip(!KEY, 'serve una chiave OpenRouter');
    test.setTimeout(420_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
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
    const n = await intervista.locator('.dash-bubble-filo').count();
    await intervista.locator('#input').fill(chiede);
    await intervista.locator('#sendBtn').click();
    await attendiRisposta(intervista, n + 1);
    await intervista.waitForTimeout(5_000);
    const { memoria, bolle } = await app.evaluate(async () => {
      const M = globalThis.SN_FILO_MEMORY;
      return { memoria: M.renderMemoryForPrompt(await M.getMemory()).profilo || '', bolle: '' };
    });
    const testo = (await intervista.locator('.dash-bubble-filo').last().innerText());
    const righe = (await intervista.locator('body').innerText()).split('\n').filter((l) => /Memorizzato|Dimentic|Tolt|Nascost|Corrett/i.test(l)).join(' / ');
    console.log(`\n=== correggi ${giro} ===\nFILO: ${testo}\nRIGHE: ${righe}\nPROFILO VISTO DALLA CHAT DOPO: ${memoria}`);
    expect(memoria).not.toMatch(/pepe/i);
    expect(memoria).toMatch(/geometra/i);
  });
}

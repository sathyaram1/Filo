// Verifica #2536, giro 2: intervista rifatta con la memoria piena, Filo vero e il modello vero (DeepSeek V4 Flash via
// OpenRouter). L'utente dice solo nome, uso del pc e «dammi del tu»: niente di quello che sta solo in memoria o nelle
// chat passate deve comparire nell'intervista, né finire nelle lezioni come detto oggi. Senza chiave si salta.

import { test, expect } from '../../fixtures/electron.mjs';

const KEY = process.env.OPENROUTER_API_KEY || '';
const FUGA = /geometr|studio tecnico|\bpepe\b|gatt[oa]|lisbon|\bvol[oi]\b|risposte brevi|tieni corto|tengo corto|mi hai (già )?detto|mi risulta/i;

function newtabWindows(app) {
  return app.windows().filter((w) => w.url().startsWith('filo://newtab'));
}
async function newtabPage(app, index = 0) {
  await expect.poll(() => newtabWindows(app).length, { timeout: 15_000 }).toBeGreaterThan(index);
  const win = newtabWindows(app)[index];
  await win.waitForLoadState('domcontentloaded');
  return win;
}

async function chiaveVera(app, modello) {
  await app.evaluate(async (_e, [key, modello]) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: key },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'prova',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPATTAZIONE]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
      },
      modelRegistry: {
        ...globalThis.SN_TEST_MODELS.registry,
        prova: { label: modello, provider: 'openrouter', model: modello, weights: 'open', inputs: ['text'], outputs: ['text'] },
      },
    });
    // Ogni richiesta ai modelli resta da guardare: chi la manda e con quali messaggi.
    const P = globalThis.SN_PROVIDERS;
    globalThis.__rec = [];
    for (const nome of ['streamCompleteWithFallback', 'completeWithFallback']) {
      const orig = P[nome];
      P[nome] = async (args) => {
        const r = await orig(args);
        globalThis.__rec.push({ nome, messaggi: JSON.stringify(args.messages || []), testo: r && r.text, tc: JSON.stringify((r && r.toolCalls) || []) });
        return r;
      };
    }
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Fa il geometra in uno studio tecnico.\nHa un gatto che si chiama Pepe.\nHa prenotato un volo per Lisbona a dicembre.',
      PREFERENZE: 'Preferisce risposte brevi.',
    });
  }, [KEY, modello]);
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

async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

const GIRI = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ n, modello: 'deepseek/deepseek-v4-flash', conChatPassata: n > 4 })),
  { n: 7, modello: 'deepseek/deepseek-v4.1-flash' }, { n: 8, modello: 'deepseek/deepseek-v4.1-flash' },
  { n: 9, modello: 'anthropic/claude-haiku-5.5' }, { n: 10, modello: 'anthropic/claude-haiku-5.5' },
];
for (const { n: giro, modello, conChatPassata = false } of GIRI) {
  test(`giro ${giro} ${modello}${conChatPassata ? ' con una chat passata' : ''}: l’intervista rifatta non tira in ballo la memoria`, async ({ app, shell, openTab }) => {
    test.skip(!KEY, 'serve una chiave OpenRouter');
    test.setTimeout(420_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
    const home = await newtabPage(app);
    await chiaveVera(app, modello);
    await home.reload();
    await home.waitForLoadState('domcontentloaded');
    if (conChatPassata) {
      await scrivi(home, 'sono geometra, mi serve una formula excel per sommare i metri quadri dei vani di un computo');
      await attendiRisposta(home, 1);
    }
    const prefs = await openTab('filo://preferences/preferences.html');
    await prefs.locator('#restartOnboarding').click();
    const intervista = await newtabPage(app, 1);
    await expect(intervista.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    const filoPrima = await intervista.locator('.dash-bubble-filo').count();
    const daQui = await app.evaluate(() => globalThis.__rec.length);
    await scrivi(intervista, 'mi chiamo luca, uso il pc x lavoro sopratutto mail e excel e un po youtube la sera');
    await attendiRisposta(intervista, filoPrima + 1);
    await scrivi(intervista, 'dammi del tu ovvio');
    await attendiRisposta(intervista, filoPrima + 2);
    await intervista.waitForTimeout(8_000);
    const pagina = (await intervista.locator('body').innerText()).replace('Ciao, sono Filo', '');
    const { lezioni, memoria, rec, onb } = await app.evaluate(async (_e, da) => ({
      lezioni: JSON.stringify(await globalThis.SN_FILO_MEMORY.getLessonsBuffer()),
      memoria: JSON.stringify(await globalThis.SN_FILO_MEMORY.getMemory()),
      rec: globalThis.__rec.slice(da),
      onb: JSON.stringify((await globalThis.SN_FILO_MEMORY.getOnboarding()).thread),
    }), daQui);
    const promptChat = rec.filter((r) => r.messaggi.includes('Sei Filo, l\'assistente dentro il browser Filo'));
    const bolle = (await intervista.locator('.dash-bubble-filo, .dash-bubble-user').allInnerTexts()).join('\n| ');
    const righe = (await intervista.locator('body').innerText()).split('\n').filter((l) => /Memorizzato|Ricorder/i.test(l)).join(' / ');
    console.log(`\n=== giro ${giro} ${modello} ===\nBOLLE:\n| ${bolle}\nRIGHE: ${righe}\nLEZIONI: ${lezioni}\nMEMORIA: ${memoria}\nPROMPT CHAT CON PROFILO: ${promptChat.filter((r) => /geometr|lisbon/i.test(r.messaggi)).length}/${promptChat.length}`);
    expect(promptChat.length, 'la chat è andata al modello').toBeGreaterThan(0);
    for (const r of promptChat) expect(r.messaggi.match(/geometr|\bpepe\b|lisbon/i), 'nel prompt dell’intervista').toBeNull();
    expect(pagina.match(FUGA), `nell’intervista: ${pagina}`).toBeNull();
    expect(onb.match(FUGA), 'nel filo dell’intervista').toBeNull();
    const nuove = JSON.parse(lezioni).map((l) => l.text).join('\n');
    expect(nuove.match(FUGA), `nelle lezioni: ${nuove}`).toBeNull();
  });
}

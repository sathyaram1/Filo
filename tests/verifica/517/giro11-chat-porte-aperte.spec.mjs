// Verifica #517 — giro 11, dal punto di vista dell'utente, nella chat della home.
//
// Due porte, una per lato:
//
//   1. L'utente chiede la stessa sveglia per tre sere. Filo ne mette una e
//      scrive la frase della segnalazione — «una sveglia alle 19:00 per
//      ognuna di quelle notti». Sotto la risposta non c'è niente, e le altre
//      due sere l'utente le scopre quando non suona.
//   2. Il rovescio: l'utente chiede il riassunto di un contratto, Filo glielo
//      scrive nella risposta e chiude con «Ho preso nota dei punti
//      principali». La risposta viene cancellata, rifatta con una seconda
//      chiamata al modello e poi smentita.
//
// I test sono scritti per essere ROSSI finché le porte sono aperte.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configureModel(app) {
  await app.evaluate(async (_electron) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function installScript(app, script) {
  await app.evaluate(async (_electron, script) => {
    globalThis.__captured = [];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const step = script[Math.min(i++, script.length - 1)];
      globalThis.__captured.push({ messages: JSON.parse(JSON.stringify(messages)) });
      await new Promise((r) => setTimeout(r, 40));
      for (const c of step.toolCalls || []) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      return {
        text: step.text || '', toolCalls: step.toolCalls || [], reasoningDetails: [],
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
  }, script);
}

const chiamate = (app) => app.evaluate(() => (globalThis.__captured || []).length);

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
}

test('una sveglia sola non copre le tre notti raccontate', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    // Una sveglia sola, e la frase della segnalazione che ne promette tre.
    { text: '', toolCalls: [{ id: 's1', name: 'SVEGLIA', arguments: '{"time":"19:00","label":"medicina"}' }] },
    { text: 'Ti ho messo una sveglia alle 19:00 per ognuna di quelle notti.' },
    { text: 'Ti ho messo una sveglia alle 19:00 per ognuna di quelle notti.' },
  ]);

  await chiedi(page, 'stasera, domani e dopodomani devo prendere la medicina alle 19: mettimi le sveglie');

  // Di sveglie ne esiste una sola: le altre due sere l'utente deve saperlo
  // adesso, non la sera in cui non suona.
  expect(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).toHaveLength(1);
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(1);
});

test('un riassunto consegnato nella risposta non viene buttato né smentito', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Le cose che contano sono tre: la penale è del 5%, il preavviso è di trenta giorni, '
      + 'il rinnovo è automatico.\n\nHo preso nota dei punti principali.' },
  ]);

  await chiedi(page, 'riassumi questo contratto e dimmi cosa conta: Articolo 1. Il contratto dura un anno '
    + 'e si rinnova in automatico. Articolo 2. Il recesso anticipato comporta una penale del cinque per cento. '
    + 'Articolo 3. La disdetta va comunicata con trenta giorni di preavviso.');

  // Il riassunto è nella risposta: non c'è nessuno strumento che possa averlo
  // scritto, e non c'è niente da smentire.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // …e la risposta non viene cancellata e rifatta: una chiamata al modello sola.
  expect(await chiamate(app)).toBe(1);
});

test('l\'avviso resta sotto la risposta quando la chat viene ripresa', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Ti ho messo la sveglia alle 19:00 per stasera.' },
    { text: 'Ti ho messo la sveglia alle 19:00 per stasera.' },
  ]);

  await chiedi(page, 'mettimi una sveglia alle 19 per stasera');
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(1);

  // La chat si riprende da sola a ogni riavvio e a ogni home riaperta: la
  // frase che dà la sveglia per fatta torna, e deve tornare anche la riga che
  // dice che non c'è. Senza, chi riapre per controllare legge solo la bugia.
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await expect(page.locator('.dash-bubble-filo')).toContainText('Ti ho messo la sveglia alle 19:00');
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(1);
});

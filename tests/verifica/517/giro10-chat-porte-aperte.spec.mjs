// Verifica #517 — giro 10, dal punto di vista dell'utente, nella chat della home.
//
// Due porte:
//
//   1. L'utente chiede una cosa SENZA nominarla — «non farmelo dimenticare» —
//      e Filo la racconta col pronome: «Te l'ho segnato». Non nasce nessun
//      appunto, sotto la risposta non c'è niente e il modello non viene
//      interpellato una seconda volta. È il fallimento muto della
//      segnalazione: l'utente lo scopre quando il promemoria non arriva.
//   2. Il rovescio: l'utente incolla un documento e chiede cosa conta. Filo
//      glielo scrive nella risposta e chiude con «Ti ho segnato i punti
//      principali»: la risposta già comparsa viene cancellata, rifatta con
//      una seconda chiamata al modello e poi smentita.
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

test('una richiesta detta senza nominare la cosa non spegne il presidio', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    // Il modello insiste anche dopo il ritentativo: l'utente deve leggerlo.
    { text: 'Te l\'ho segnato, così domani te lo ricordo.' },
    { text: 'Te l\'ho segnato, così domani te lo ricordo.' },
  ]);

  await chiedi(page, 'domani devo chiamare il dentista, non farmelo dimenticare');

  // Di appunti non ne esiste nessuno: l'utente deve leggerlo sotto la risposta.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(1);
});

test('un documento incollato non fa accusare Filo di non aver scritto un appunto', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Le cose che contano sono tre:\n\n- la penale è del 5%\n- il preavviso è di 30 giorni\n- il rinnovo è automatico\n\nTi ho segnato i punti principali.' },
  ]);

  const contratto = `leggi questo contratto e dimmi cosa c'è di importante:\n\n${
    'Articolo 1. Il presente contratto ha durata annuale e si rinnova tacitamente salvo disdetta. '
    + 'Articolo 2. Il recesso anticipato comporta una penale pari al cinque per cento del corrispettivo residuo. '
    + 'Articolo 3. La disdetta va comunicata con un preavviso di almeno trenta giorni dalla scadenza. '
    + 'Articolo 4. Il foro competente per ogni controversia è quello della sede del fornitore. '
    + 'Articolo 5. Le parti si impegnano alla riservatezza su ogni informazione scambiata.'}`;
  await chiedi(page, contratto);

  // I punti sono nella risposta: non c'è nessuno strumento che possa averli
  // scritti, e non c'è niente da smentire.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // …e la risposta non viene cancellata e rifatta: una chiamata al modello sola.
  expect(await chiamate(app)).toBe(1);
});

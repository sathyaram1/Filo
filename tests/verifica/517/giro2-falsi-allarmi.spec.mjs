// Verifica #517 — giro 2, dal punto di vista dell'utente, con Filo aperto.
//
// Il giro 1 aveva chiuso il buco principale (l'azione raccontata e mai emessa
// adesso viene vista, rimandata indietro una volta e, se resta dichiarata a
// vuoto, scritta sotto la risposta). Restava però in piedi la difesa più
// fragile del presidio: quando l'avviso PARLA deve avere ragione. Qui sotto
// tre strade normalissime in cui l'avviso accusa Filo di non aver fatto una
// cosa che ha fatto — o che non richiedeva nessuna azione:
//
//   1. l'utente chiede un testo e Filo glielo SCRIVE nella risposta
//      («te l'ho scritta qui sotto»): non c'è nessuno strumento da chiamare,
//      eppure la risposta buona viene buttata, rifatta, e poi smentita;
//   2. l'utente manda la FOTO di una bolletta e Filo la legge: leggere
//      un'immagine allegata non passa da nessuno strumento, e l'utente legge
//      «il documento non l'ha letto»;
//   3. la sveglia c'è davvero, messa in una sessione precedente: in una chat
//      nuova la conferma di Filo diventa un'accusa.
//
// I test sono scritti per essere ROSSI finché la porta è aperta.

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

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
}

test('una risposta SCRITTA da Filo non viene buttata via né smentita', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // La cosa chiesta è il TESTO, e il testo è nella risposta: nessuno strumento
  // può «scrivere una mail», quindi non c'è niente da chiamare.
  await installScript(app, [
    { text: "Te l'ho scritta qui sotto:\n\nGentile Marco, ti chiedo scusa per il ritardo di ieri." },
  ]);
  await chiedi(page, 'scrivimi una mail di scuse per il ritardo');

  // SUCCESSO dal punto di vista dell'utente: la mail è lì e nessuno gli dice
  // che Filo non l'ha scritta.
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Gentile Marco');
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // E il turno non è stato rimandato indietro: la risposta era già buona, e
  // rifarla costa una chiamata al modello e una risposta diversa da quella
  // che l'utente aveva già visto comparire.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(1);
});

test('la foto di una bolletta letta da Filo non diventa «il documento non l\'ha letto»', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Ho letto la bolletta: sono 84 euro, scadenza il 12.' },
  ]);
  // L'immagine entra in chat come quando la si incolla o la si trascina.
  await page.evaluate(async () => {
    const png = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ), (c) => c.charCodeAt(0));
    const blob = new Blob([png], { type: 'image/png' });
    document.getElementById('inputForm').dispatchEvent(
      new CustomEvent('filo:paste-image', { detail: { blob } }),
    );
  });
  await expect(page.locator('#imgPreview')).toBeVisible({ timeout: 5_000 });
  await chiedi(page, 'quanto devo pagare?');

  await expect(page.locator('.dash-bubble-filo').last()).toContainText('84 euro');
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(1);
});

test('una sveglia messa in una sessione precedente resta una sveglia messa', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // La sveglia esiste: Filo l'aveva messa ieri, e la vede nel proprio stato.
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addAlarm({ label: 'sera', time: '19:00', repeat: ['lun', 'mar', 'mer'] });
  });
  await installScript(app, [
    { text: 'Sì, ho messo la sveglia alle 19:00 come mi avevi chiesto.' },
  ]);
  await chiedi(page, 'hai messo la sveglia per stasera?');

  // La sveglia c'è: l'avviso qui sarebbe una bugia, ed è l'unica difesa che
  // ha questo presidio.
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.map((t) => t.label)).toContain('sera');
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
});

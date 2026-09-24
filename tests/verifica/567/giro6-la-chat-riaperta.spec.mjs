// #567, sesto giro — quello che resta di un turno quando la chat si riapre
// dalla Cronologia. Il quinto giro ha chiesto che il racconto riaperto non
// mentisse; qui si guarda se DICE abbastanza: cosa non è riuscito e perché
// (punto 2 della segnalazione), e cosa Filo stesso si ritrova nel contesto al
// turno dopo (che è la ragione per cui la riga esiste in diretta).

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

const archivio = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list());

async function chatConAzione(app, tipo) {
  for (let i = 0; i < 40; i += 1) {
    const c = await archivio(app);
    const ha = (m) => Array.isArray(m.actions) && m.actions.some((a) => (a && a.type ? a.type : a) === tipo);
    const trovata = c.find((x) => x && Array.isArray(x.messages) && x.messages.some(ha));
    if (trovata) return trovata;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// Come fakeProvider, ma mette da parte i turni dell'assistente con cui il
// modello riparte: è lì che si legge cosa Filo sa del passato.
async function provideRegistrando(app, slot, risposte) {
  await app.evaluate(async (_e, { s, r }) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis[`${s}_restore`] = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis[`${s}_visto`] = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis[`${s}_visto`].push(JSON.stringify(
        (messages || []).filter((m) => m.role === 'assistant').map((m) => String(m.content || '')),
      ));
      const giro = r[Math.min(n, r.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, { s: slot, r: risposte });
}

test('la chat riaperta deve dire che il comando non è partito, e perché', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } });
    globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
  });

  await fakeProvider(app, [
    { toolCalls: [{ id: 's6a', name: 'ESEGUI_COMANDO', arguments: '{"comando":"ls -la"}' }] },
    { text: 'Ecco i file.' },
  ], '__v567g6a');
  await chiedi(page, 'elenca i file');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco i file.' })).toBeVisible({ timeout: 15_000 });
  // In diretta l'utente legge il riquadro che spiega l'interruttore spento.
  await expect(page.locator('.dash-cmd-blocked')).toBeVisible();

  const chat = await chatConAzione(app, 'ESEGUI_COMANDO');
  expect(chat, 'la chat non è arrivata nell’archivio').toBeTruthy();
  const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${chat.id}`);
  await expect(riaperta.locator('.dash-bubble').first()).toBeVisible({ timeout: 10_000 });
  const racconto = (await riaperta.locator('.dash-bubble-note[data-replay="1"]').allTextContents()).join(' | ');

  // Non deve mentire (il quinto giro l'ha chiesto) ma nemmeno tacere: chi
  // rilegge per capire perché il comando non era partito deve trovarcelo.
  expect(racconto, `la chat riaperta racconta soltanto: «${racconto}»`).not.toContain('eseguito un comando');
  expect(racconto.toLowerCase(), `di un comando mai partito la chat riaperta dice soltanto: «${racconto}»`)
    .toMatch(/non (è partito|eseguito|riuscit)|terminale/);

  await restore(app, '__v567g6a');
});

test('nella chat riaperta Filo deve sapere com’era andata, non solo cosa aveva nominato', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } });
    globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
  });

  await fakeProvider(app, [
    { toolCalls: [{ id: 's6b', name: 'ESEGUI_COMANDO', arguments: '{"comando":"ls -la"}' }] },
    { text: 'Ho elencato i file.' },
  ], '__v567g6b');
  await chiedi(page, 'elenca i file');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ho elencato i file.' })).toBeVisible({ timeout: 15_000 });
  await restore(app, '__v567g6b');

  const chat = await chatConAzione(app, 'ESEGUI_COMANDO');
  expect(chat, 'la chat non è arrivata nell’archivio').toBeTruthy();

  // L'archivio SA com'è andata: l'esito del comando è scritto lì dentro.
  const esiti = chat.messages.flatMap((m) => (Array.isArray(m.actions) ? m.actions : []))
    .map((a) => (a && a.esito) || '');
  expect(esiti.join(','), 'nell’archivio l’esito dell’azione non c’è').toContain('fallito');

  const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${chat.id}`);
  await expect(riaperta.locator('.dash-bubble').first()).toBeVisible({ timeout: 10_000 });

  await provideRegistrando(app, '__v567g6b2', [{ text: 'Rispondo.' }]);
  await chiedi(riaperta, 'quel comando è partito?');
  await expect(riaperta.locator('.dash-bubble-filo', { hasText: 'Rispondo.' })).toBeVisible({ timeout: 15_000 });

  const visto = await app.evaluate(() => (globalThis.__v567g6b2_visto || []).join('\n'));
  // Il turno di Filo che riparte deve portarsi dietro l'esito, come succede in
  // diretta per un'azione confermata nel popup: altrimenti alla domanda
  // dell'utente il modello può solo tirare a indovinare.
  expect(visto, `nel contesto del modello dell’azione resta solo il testo: ${visto}`)
    .toMatch(/non (è partito|eseguito|riuscit)|terminale|NON ESEGUIT/i);

  await app.evaluate(() => { try { globalThis.__v567g6b2_restore?.(); } catch (_) {} });
});

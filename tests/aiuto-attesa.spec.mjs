// #578.1 — mentre l'Aiuto sui siti lavora si vede cosa fa davvero (il ragionamento del modello, una rotella quando non
// c'è niente da mostrare) e il quadrato al posto dell'invio lo ferma: la chiamata in volo si interrompe, i passi in coda
// non partono, quello che era già arrivato resta e il pannello torna pronto. Modello finto nel main.

import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/electron.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';

const SHOTS = join(resolve(dirname(fileURLToPath(import.meta.url))), '.shots');
const PAGINA = '<!doctype html><title>Guida</title><h1>Guida</h1>'
  + Array.from({ length: 6 }, (_, i) => `<details id="sez${i}"><summary>Sezione ${i}</summary><p>Testo ${i}</p></details>`).join('');
// Le frasi fisse che scorrevano prima (#578.1): nessuna deve tornare.
const VECCHIE = ['Analizzo lo screenshot', 'Identifico gli elementi interattivi', 'Confronto con la tua richiesta',
  'Cerco il menu giusto', 'Valuto il prossimo passo', 'Controllo la struttura del DOM', 'Capisco il contesto',
  'Scelgo il target migliore', 'Compongo la risposta', 'Riconosco i pattern noti'];

// Il modello finto segue un copione: ogni chiamata dell'Aiuto prende il passo suo (l'ultimo si ripete). `pensa`: pezzi
// di ragionamento mandati in diretta; `aspetta`: resta in volo finché la prova non lo lascia andare o lo stop lo
// interrompe; `risposta`: il JSON dell'Aiuto.
async function prepara(app, passi) {
  await app.evaluate(async (_e, passi) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__aiuto = { chiamate: 0, interrotte: 0, rilascia: null, ultimo: '', passi };
    const risposta = async ({ attempts, messages, signal, onReasoning, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: '{}' };
      const A = globalThis.__aiuto;
      const p = A.passi[Math.min(A.chiamate, A.passi.length - 1)];
      A.chiamate += 1;
      A.ultimo = JSON.stringify(messages.slice(-3));
      for (const pezzo of p.pensa || []) { try { onReasoning && onReasoning(pezzo); } catch (_) {} }
      if (p.aspetta) {
        await new Promise((ok, ko) => {
          A.rilascia = ok;
          if (!signal) return;
          const via = () => { A.interrotte += 1; const e = new Error('aborted'); e.name = 'AbortError'; ko(e); };
          if (signal.aborted) via(); else signal.addEventListener('abort', via, { once: true });
        });
      }
      const text = JSON.stringify(p.risposta);
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risposta;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risposta;
  }, passi);
}

async function apriAiuto(app, shell, openTab, testServer) {
  const sito = await testServer.openReady(openTab, PAGINA);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  return { sito, aiuto };
}

async function chiedi(aiuto, testo) {
  await aiuto.fill('.sn-sidebar-input textarea', testo);
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
}

const stato = (app) => app.evaluate(() => {
  const A = globalThis.__aiuto;
  return { chiamate: A.chiamate, interrotte: A.interrotte, ultimo: A.ultimo };
});
const tasto = (aiuto) => aiuto.locator('.sn-sidebar-input button[type="submit"]');

test('mentre lavora mostra il ragionamento vero, non frasi fisse; dopo la risposta il ragionamento resta da aprire', async ({ app, shell, openTab, testServer }) => {
  await prepara(app, [{
    pensa: ['Cerco dove si cambia ', 'la password: ', 'il menu del profilo sembra quello giusto.'],
    aspetta: true,
    risposta: { text: 'In alto a destra, sotto il tuo nome.', status: 'done' },
  }]);
  const { aiuto } = await apriAiuto(app, shell, openTab, testServer);
  await chiedi(aiuto, 'dove cambio la password?');

  const attesa = aiuto.locator('.sn-sidebar-attesa');
  await expect(attesa).toHaveAttribute('data-fase', 'pensa', { timeout: 15_000 });
  await expect(attesa).toContainText('il menu del profilo sembra quello giusto.');
  await expect(tasto(aiuto)).toHaveAttribute('data-modo', 'ferma');
  await expect(tasto(aiuto)).toHaveAttribute('aria-label', 'Ferma');
  const testo = await aiuto.locator('.sn-sidebar').innerText();
  for (const f of VECCHIE) expect(testo).not.toContain(f);
  await aiuto.locator('.sn-sidebar').screenshot({ path: join(SHOTS, 'aiuto-attesa-pensa.png') });

  await app.evaluate(() => globalThis.__aiuto.rilascia());
  await expect(aiuto.locator('.sn-sidebar-msg-assistant', { hasText: 'In alto a destra' })).toBeVisible();
  await expect(attesa).toHaveAttribute('data-fase', 'fatto');
  await expect(attesa.locator('.sn-sidebar-attesa-testa')).toHaveText(/^Ragionamento · \d+ s$/);
  await expect(tasto(aiuto)).toHaveAttribute('data-modo', 'invia');
  const corpo = attesa.locator('.sn-sidebar-attesa-corpo');
  await expect(corpo).toBeHidden();
  await attesa.locator('.sn-sidebar-attesa-testa').click();
  await expect(corpo).toBeVisible();
  await expect(corpo).toHaveText('Cerco dove si cambia la password: il menu del profilo sembra quello giusto.');
  await aiuto.locator('.sn-sidebar').screenshot({ path: join(SHOTS, 'aiuto-attesa-aperta.png') });
  await attesa.locator('.sn-sidebar-attesa-testa').click();
  await expect(corpo).toBeHidden();
});

test('senza ragionamento da mostrare resta una rotella, che sparisce con la risposta', async ({ app, shell, openTab, testServer }) => {
  await prepara(app, [{ aspetta: true, risposta: { text: 'Eccolo.', status: 'done' } }]);
  const { aiuto } = await apriAiuto(app, shell, openTab, testServer);
  await chiedi(aiuto, 'cosa dice la pagina?');
  const attesa = aiuto.locator('.sn-sidebar-attesa');
  await expect.poll(() => stato(app).then((s) => s.chiamate), { timeout: 15_000 }).toBe(1);
  await expect(attesa).toHaveAttribute('data-fase', 'attesa');
  await expect(attesa.locator('.sn-sidebar-rotella')).toBeVisible();
  await expect(attesa.locator('.sn-sidebar-attesa-riga')).toHaveText('');
  await app.evaluate(() => globalThis.__aiuto.rilascia());
  await expect(aiuto.locator('.sn-sidebar-msg-assistant', { hasText: 'Eccolo.' })).toBeVisible();
  await expect(attesa).toHaveCount(0);
});

test('il quadrato ferma la chiamata in volo e i passi dopo; quello già fatto resta e si riparte scrivendo', async ({ app, shell, openTab, testServer }) => {
  await prepara(app, [
    { pensa: ['apro la prima sezione'], risposta: { highlight: { selector: '#sez0', action: 'reveal' }, status: 'continue' } },
    { pensa: ['adesso la seconda, poi le altre'], aspetta: true, risposta: { highlight: { selector: '#sez1', action: 'reveal' }, status: 'continue' } },
    { risposta: { text: 'Eccomi.', status: 'done' } },
  ]);
  const { sito, aiuto } = await apriAiuto(app, shell, openTab, testServer);
  await chiedi(aiuto, 'aprimi tutte le sezioni');
  await expect(aiuto.locator('.sn-sidebar-log', { hasText: 'sezione aperta' })).toHaveCount(1, { timeout: 15_000 });
  const viva = aiuto.locator('.sn-sidebar-attesa').last();
  await expect(viva).toContainText('adesso la seconda');
  await expect.poll(() => stato(app).then((s) => s.chiamate)).toBe(2);
  // Il quadrato è comparso alla domanda: passata la sua pausa, il clic vale.
  await aiuto.waitForTimeout(600);
  await tasto(aiuto).click();
  await expect(aiuto.locator('.sn-sidebar-log-fermato')).toHaveText('· Fermato prima della risposta.');
  await expect(viva).toHaveAttribute('data-fase', 'fermato');
  await expect(viva.locator('.sn-sidebar-attesa-testa')).toHaveText('Fermato qui');
  await expect(viva.locator('.sn-sidebar-attesa-corpo')).toHaveText('adesso la seconda, poi le altre');
  await expect.poll(() => stato(app).then((s) => s.interrotte)).toBe(1);
  await expect(tasto(aiuto)).toHaveAttribute('data-modo', 'invia');
  await aiuto.locator('.sn-sidebar').screenshot({ path: join(SHOTS, 'aiuto-attesa-fermato.png') });

  await sito.waitForTimeout(2500);
  expect((await stato(app)).chiamate).toBe(2);
  expect(await sito.evaluate(() => [...document.querySelectorAll('details[open]')].map((d) => d.id))).toEqual(['sez0']);
  await expect(aiuto.locator('.sn-sidebar-log', { hasText: 'sezione aperta' })).toHaveCount(1);

  await chiedi(aiuto, 'ci sei?');
  await expect(aiuto.locator('.sn-sidebar-msg-assistant', { hasText: 'Eccomi.' })).toBeVisible({ timeout: 15_000 });
  const dopo = await stato(app);
  expect(dopo.chiamate).toBe(3);
  // Il modello sa che il lavoro di prima l'ha fermato l'utente.
  expect(dopo.ultimo).toContain('ha fermato il lavoro prima della risposta');
});

test('Invio a casella vuota ferma come il quadrato; il secondo clic di un doppio clic sull\'invio no', async ({ app, shell, openTab, testServer }) => {
  await prepara(app, [{ pensa: ['ci penso'], aspetta: true, risposta: { text: 'Fatto.', status: 'done' } }]);
  const { aiuto } = await apriAiuto(app, shell, openTab, testServer);
  await aiuto.fill('.sn-sidebar-input textarea', 'riassumi la pagina');
  await tasto(aiuto).dblclick();
  await expect.poll(() => stato(app).then((s) => s.chiamate), { timeout: 15_000 }).toBe(1);
  await aiuto.waitForTimeout(800);
  expect((await stato(app)).interrotte).toBe(0);
  await expect(tasto(aiuto)).toHaveAttribute('data-modo', 'ferma');
  await expect(aiuto.locator('.sn-sidebar-log-fermato')).toHaveCount(0);

  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect(aiuto.locator('.sn-sidebar-log-fermato')).toBeVisible();
  await expect.poll(() => stato(app).then((s) => s.interrotte)).toBe(1);
  await expect(tasto(aiuto)).toHaveAttribute('data-modo', 'invia');
  await expect(aiuto.locator('.sn-sidebar-msg-assistant')).toHaveCount(0);
});

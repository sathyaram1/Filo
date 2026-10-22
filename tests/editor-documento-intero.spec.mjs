// #1475 — la chat del documento, il titolo e il riassunto dell'Editor leggono il documento intero: prima ne mandavano al
// modello i primi 6000 caratteri senza dirlo. Oltre il tetto largo il taglio si dice, a chi scrive e al modello.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';
const FONDO = 'La chiave del magazzino sta sotto il vaso di gerani.';
const RIEMPIMENTO = 'Il bilancio del trimestre segue le stesse voci del precedente, con qualche spesa in più per la manutenzione. ';

// Il modello finto risponde solo da quello che gli arriva: trova la frase in fondo se il documento gli arriva intero.
async function prepara(app) {
  await app.evaluate(async ({ fondo }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.EDITOR_CHAT]: 'deepseek-flash', [C.ACTIONS.EDITOR_TITLE]: 'deepseek-flash',
        [C.ACTIONS.EDITOR_SUMMARY]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__richieste = [];
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const utente = String((messages.find((m) => m.role === 'user') || {}).content || '');
      const vede = (sistema + utente).includes(fondo);
      if (sistema.includes('assistente di scrittura dentro un editor')) {
        globalThis.__richieste.push({ tipo: 'chat', sistema });
        return fatto(vede ? 'Sotto il vaso di gerani.' : 'Nel documento non lo trovo.');
      }
      if (sistema.includes('Genera un TITOLO')) {
        globalThis.__richieste.push({ tipo: 'titolo', utente });
        return fatto(vede ? 'Gerani e magazzino' : 'Bilancio del trimestre');
      }
      if (sistema.includes('Scrivi un RIASSUNTO')) {
        globalThis.__richieste.push({ tipo: 'riassunto', utente });
        return fatto(vede ? 'Il bilancio e dove sta la chiave del magazzino.' : 'Il bilancio del trimestre.');
      }
      return fatto('{}');
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => {
      const r = risposta(o);
      try { o.onDelta && o.onDelta(r.text); } catch (_) {}
      return r;
    };
  }, { fondo: FONDO });
}

// Il documento come lo lascia chi incolla un testo lungo: tanti paragrafi, e la frase che conta nell'ultimo.
async function scriviDocumento(editor, caratteri) {
  await editor.evaluate(({ caratteri, riempimento, fondo }) => {
    const per = riempimento.repeat(10);
    const n = Math.ceil(caratteri / per.length);
    const d = document.getElementById('doc');
    d.innerHTML = Array.from({ length: n }, () => `<p>${per}</p>`).join('') + `<p>${fondo}</p>`;
    d.dispatchEvent(new Event('input', { bubbles: true }));
  }, { caratteri, riempimento: RIEMPIMENTO, fondo: FONDO });
}

async function chiediAllaChat(editor, domanda) {
  const chat = editor.locator('.ed-module[data-type="chat"]');
  if (!await chat.count()) await editor.locator('.ed-switch-icon').nth(1).click();
  await chat.locator('[data-chat="input"]').fill(domanda);
  await chat.locator('[data-chat="send"]').click();
  return chat;
}

async function dalMenuDelTitolo(editor, voce) {
  await editor.locator('#docTitle').click({ button: 'right' });
  await editor.locator('.ed-title-ctxmenu .sn-select-option', { hasText: voce }).click();
}

const richieste = (app, tipo) => app.evaluate((t) => globalThis.__richieste.filter((r) => r.tipo === t), tipo);

test('un documento lungo arriva intero: la chat trova la frase in fondo, titolo e riassunto lo leggono tutto', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await prepara(app);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  // Dieci volte il vecchio tetto.
  await scriviDocumento(editor, 60_000);

  const chat = await chiediAllaChat(editor, 'Dove sta la chiave del magazzino?');
  await expect(chat.locator('.ed-chat-msg.assistant')).toHaveText('Sotto il vaso di gerani.', { timeout: 15_000 });
  await expect(chat.locator('.ed-chat-note')).toHaveCount(0);

  await dalMenuDelTitolo(editor, 'Rigenera titolo');
  await expect(editor.locator('#docTitle')).toHaveText('Gerani e magazzino', { timeout: 15_000 });

  await dalMenuDelTitolo(editor, 'Rigenera riassunto');
  await expect.poll(async () => (await richieste(app, 'riassunto')).some((r) => r.utente.includes(FONDO)), { timeout: 15_000 }).toBe(true);
  await expect(editor.locator('.ed-toast')).toHaveCount(0);
});

test('oltre il tetto il taglio si dice: sotto la risposta, nell\'avviso del titolo e al modello', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await prepara(app);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await scriviDocumento(editor, 400_000);
  const totale = await editor.evaluate(() => window.SN_EDITOR_SUMMARY.testoAlModello(
    (() => { let o = ''; for (const p of document.querySelectorAll('#doc p')) o += p.textContent + '\n'; return o; })()).totale);
  const nota = `Il documento è lungo: ho letto i primi 350.000 caratteri su ${totale.toLocaleString('it-IT')}.`;

  const chat = await chiediAllaChat(editor, 'Dove sta la chiave del magazzino?');
  await expect(chat.locator('.ed-chat-msg.assistant')).toHaveText('Nel documento non lo trovo.', { timeout: 15_000 });
  await expect(chat.locator('.ed-chat-note')).toHaveText(nota);
  const [domanda] = await richieste(app, 'chat');
  expect(domanda.sistema).toContain('Il resto non lo vedi');
  mkdirSync(SHOTS, { recursive: true });
  await chat.screenshot({ path: `${SHOTS}/1475-editor-taglio-chiaro.png` });
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await editor.waitForTimeout(400);
  await chat.screenshot({ path: `${SHOTS}/1475-editor-taglio-scuro.png` });

  await dalMenuDelTitolo(editor, 'Rigenera titolo');
  await expect(editor.locator('.ed-toast', { hasText: 'per il titolo ho letto i primi 350.000 caratteri' })).toBeVisible({ timeout: 15_000 });
  const titoli = await richieste(app, 'titolo');
  expect(titoli[titoli.length - 1].utente).toContain('Il resto non lo vedi');

  await dalMenuDelTitolo(editor, 'Rigenera riassunto');
  await expect(editor.locator('.ed-toast', { hasText: 'per il riassunto ho letto i primi 350.000 caratteri' })).toBeVisible({ timeout: 15_000 });
});

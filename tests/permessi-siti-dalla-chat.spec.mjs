// #949 — le risposte che Filo ricorda per i siti (pagina Sicurezza → «Permessi dei siti») si leggono e si tolgono
// chiedendolo a Filo: «quali siti possono usare il microfono?» risponde il vero, «togli il microfono a meet.google.com»
// lo toglie davvero e la pagina Sicurezza aperta lo mostra. Le risposte si mettono nel file prima dell'avvio.

import { test, expect, _electron as electron } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chiudiApp } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let app;
let shell;
let userData;

test.beforeEach(async () => {
  userData = cartellaTemporanea('filo-test-permessi-chat-');
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    sitePermissions: {
      'https://meet.google.com|audio': true,
      'https://meet.google.com|video': true,
      'https://example.com|posizione': false,
    },
  }));
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

async function trovaPagina(prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}

async function configura() {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
  });
}

// Il modello finto: un giro per elemento; l'esito degli strumenti finisce in __perm_tool.
async function modelloFinto(giri) {
  await app.evaluate(async (_e, g) => {
    globalThis.__perm_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__perm_tool.push(String(ultimo.content || ''));
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('«quali siti possono usare il microfono?» risponde il vero, «togli il microfono a meet.google.com» lo toglie anche dalla pagina Sicurezza aperta', async () => {
  test.setTimeout(90_000);
  const chat = await trovaPagina((u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
  await configura();
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sec = await trovaPagina((u) => u.startsWith('filo://security'));
  const lista = sec.locator('#sec-perm-list');
  await expect(lista).toContainText('Microfono', { timeout: 8_000 });

  await modelloFinto([
    { toolCalls: [{ id: 'l1', name: 'LEGGI_IMPOSTAZIONI', arguments: JSON.stringify({ cerca: 'microfono' }) }] },
    { text: 'Ecco i permessi.' },
  ]);
  await scrivi(chat, 'quali siti possono usare il microfono?');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Ecco i permessi.' })).toBeVisible({ timeout: 10_000 });
  const letto = (await app.evaluate(() => globalThis.__perm_tool)).pop() || '';
  expect(letto).toMatch(/^- permessi dei siti \(risposte ricordate\): 3 voci.*meet\.google\.com · microfono: consentito/m);
  expect(letto).toContain('example.com · posizione: negato');

  await modelloFinto([
    { toolCalls: [{ id: 't1', name: 'TOGLI_PERMESSO_SITO', arguments: JSON.stringify({ sito: 'meet.google.com', permesso: 'microfono' }) }] },
    { text: 'Tolto.' },
  ]);
  await scrivi(chat, 'togli il microfono a meet.google.com');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Tolto.' })).toBeVisible({ timeout: 10_000 });
  // La riga del diario («Come ha lavorato») dice cosa è stato tolto.
  await expect(chat.getByText('Permesso tolto · meet.google.com · microfono: consentito')).toBeAttached({ timeout: 5_000 });
  const esito = (await app.evaluate(() => globalThis.__perm_tool)).pop() || '';
  expect(esito).toContain('il sito tornerà a chiedere');
  const salvate = await app.evaluate(async () => globalThis.SN_STORAGE.getRaw('sitePermissions'));
  expect(Object.keys(salvate || {}).sort()).toEqual(['https://example.com|posizione', 'https://meet.google.com|video']);

  // La pagina Sicurezza già aperta segue, senza ricaricarla: la fotocamera resta, il microfono no.
  await sec.bringToFront();
  await expect(lista).not.toContainText('Microfono', { timeout: 5_000 });
  await expect(lista).toContainText('Fotocamera');
});

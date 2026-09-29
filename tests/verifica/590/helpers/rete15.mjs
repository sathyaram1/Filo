// Giro 15 (#590): la rete finta del repo con in più i nomi internazionali (münchen.de, сайт.рф)
// e il modello simulato della chat. Solo per le prove di tests/verifica/590.
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { test as base, HOSTS, chiudiApp, cartellaTemporanea } from '../../../helpers/reteFinta.mjs';
import { argomentiScala } from '../../../helpers/scala.mjs';

export * from '../../../helpers/reteFinta.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const MUENCHEN = 'xn--mnchen-3ya.de';
export const RF = 'xn--80aswg.xn--p1ai';

export const test = base.extend({
  app: async ({ rete }, use) => {
    const userData = cartellaTemporanea('filo-test-');
    const rules = [...HOSTS, MUENCHEN, RF].map((h) => `MAP ${h} 127.0.0.1:${rete.port}`).join(', ');
    const app = await electron.launch({
      args: [...argomentiScala, `--host-resolver-rules=${rules}`, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

export const PAGINA_BLOCCATA = /^filo:\/\/error\/error\.html\?.*code=blocked/;

// Tutti i testi delle notifiche mandate alla shell da qui in avanti.
export async function testiNotifiche(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    globalThis.__notifiche15 = [];
    const orig = w.webContents.send.bind(w.webContents);
    w.webContents.send = (ch, ...a) => { if (ch === 'shell:toast') globalThis.__notifiche15.push(String((a[0] && a[0].text) || '')); return orig(ch, ...a); };
  });
  return () => app.evaluate(() => globalThis.__notifiche15.slice());
}

export async function paginaInterna(app, shell, prefisso, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  for (let i = 0; i < 60; i++) {
    const p = app.windows().find((w) => w.url().startsWith(prefisso));
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await shell.waitForTimeout(150);
  }
  throw new Error(`pagina ${prefisso} non trovata`);
}

// La chat della home risponde con i giri scritti qui (tool call e testo), senza rete.
export async function modelloFinto(app, giri) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_e, g) => {
    globalThis.__chiamate15 = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__chiamate15.push(JSON.parse(JSON.stringify(messages)));
      const giro = g[Math.min(n, g.length - 1)]; n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
  return () => app.evaluate(() => globalThis.__chiamate15.slice());
}

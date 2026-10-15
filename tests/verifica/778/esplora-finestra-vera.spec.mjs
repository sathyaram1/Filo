// Esplorazione del giro 3: una finestra VERA di un'altra app (un secondo Electron) guardata dalla chat, senza sistema finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { home, chiedi } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm, scrollConfirmToEnd } from '../../helpers/confirm.mjs';

const require = createRequire(import.meta.url);
const ESTERNA = 'Errore - Programma di prova';
const NOTO = 'TESTO-NOTO-778';
const VERDE = [0x12, 0xab, 0x34];
const ALTRA = process.env.ALTRA_APP;

test('finestra vera: elenco, OK, cattura e risposta col testo', async ({ app }) => {
  test.setTimeout(150_000);
  const altra = spawn(require('electron'), [ALTRA, '--no-sandbox'], { stdio: 'ignore', env: { ...process.env } });
  try {
    await new Promise((r) => setTimeout(r, 4000));
    await app.evaluate(async ({ nativeImage }, { verde, noto }) => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
        models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.DESCRIBE_IMAGE]: 'glm' },
        modelRegistry: globalThis.SN_TEST_MODELS.registry, schermo: { guarda: true },
      });
      globalThis.__occhio = [];
      globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
        const parti = (messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
        const img = parti.find((p) => p && p.type === 'image_url');
        let colore = null;
        if (img) {
          const ni = nativeImage.createFromDataURL(img.image_url.url);
          const { width, height } = ni.getSize();
          const b = ni.toBitmap();
          const i = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4;
          colore = [b[i + 2], b[i + 1], b[i]];
          globalThis.__occhio.push({ colore, width, height });
        }
        const giusta = colore && colore.every((c, k) => Math.abs(c - verde[k]) < 24);
        return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop', text: giusta ? `Il dialogo dice ${noto}` : 'altro' };
      };
      globalThis.__chat = [];
      const g = [
        { toolCalls: [{ id: 'v1', name: 'VEDI_SCHERMO', arguments: '{}' }] },
        'SCEGLI',
        { text: 'Aspetto il tuo OK.' },
        { eco: true },
      ];
      let n = 0;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
        const s = JSON.stringify(messages);
        globalThis.__chat.push(s);
        let giro = g[Math.min(n, g.length - 1)];
        n += 1;
        if (giro === 'SCEGLI') {
          const m = s.match(/- ([^\\]*?) \(in primo piano/);
          giro = { toolCalls: [{ id: 'v2', name: 'VEDI_SCHERMO', arguments: JSON.stringify({ finestra: m ? m[1] : 'NESSUNA', domanda: 'cosa chiede' }) }] };
        }
        let text = giro.text || '';
        if (giro.eco) text = s.includes(noto) ? `La finestra dice: ${noto}` : 'Non ho visto niente.';
        const calls = giro.toolCalls || [];
        if (text) { try { onDelta && onDelta(text); } catch (_) {} }
        return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
      };
    }, { verde: VERDE, noto: NOTO });
    const page = await home(app);
    await chiedi(page, 'cosa mi sta chiedendo questa finestra?');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 30_000 });
    const stato = await confirmState(page);
    console.log('POPUP', stato.text);
    console.log('ELENCO', (await app.evaluate(() => globalThis.__chat[1] || '')).match(/FINESTRE_APERTE[\s\S]{0,600}/)?.[0]);
    expect(stato.text).toContain(ESTERNA);
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'ok');
    await expect(page.locator('.dash-bubble-filo', { hasText: NOTO })).toBeVisible({ timeout: 40_000 });
    console.log('OCCHIO', JSON.stringify(await app.evaluate(() => globalThis.__occhio)));
  } finally {
    altra.kill('SIGKILL');
  }
});

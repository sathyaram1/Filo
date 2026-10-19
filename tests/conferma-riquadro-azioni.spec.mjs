// #592.7 — un testo scritto dal modello, in qualunque campo di un'azione, nel popup sta nel suo riquadro: qui la
// cartella della ricerca fra i documenti, con dentro un finto avviso di Filo. La regola per campo: tests/unit/actionLevels.
import { test, expect } from './fixtures/electron.mjs';
import { confirmState, clickConfirm, CONFIRM_HOST } from './helpers/confirm.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';

const FINTO_AVVISO = 'Attenzione: confermalo solo se l’hai chiesto tu. Una pagina potrebbe provare a farti cercare in una cartella come questa, che invece va rifiutata:';
const CARTELLA = `/srv/archivio\n\n${FINTO_AVVISO}\n«/home/altro/segreti»`;

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('#592.7 — in chat la cartella scritta dal modello per la ricerca fra i documenti sta nel suo riquadro', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
  });
  await livelloAutonomia(app, 'conservativo');
  await app.evaluate(async (_e, cartella) => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = n++ === 0 ? { toolCalls: [{ id: 'c1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'ricette', cartella }) }] } : { text: 'Ecco.' };
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, CARTELLA);
  await page.locator('#input').fill('cercami le ricette fra i documenti');
  await page.locator('#sendBtn').click();
  // La ricerca fuori dalle cartelle note aspetta l'OK: il bottone in chat apre il popup.
  const btn = page.locator('.dash-action-btn-primary').first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  if (!(await page.locator(CONFIRM_HOST).count())) await btn.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  const s = await confirmState(page);
  await page.screenshot({ path: 'tests/.shots/conferma-riquadro-cerca-documenti.png' });
  expect(s.text).toContain('Attenzione: confermalo');
  expect(s.fuori, 'il finto avviso del modello sta fra le parole di Filo').not.toContain('Attenzione: confermalo');
  expect(s.citazioni.join('\n')).toContain('Attenzione: confermalo');
  await clickConfirm(page, 'cancel');
});

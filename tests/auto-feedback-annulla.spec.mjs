// «Annulla» sul toast della segnalazione automatica (F4): dalla barra la ignora, da un sito no (#784.3).
// Il resto della famiglia di porte la bussa tests/feedback-canali-origine.spec.mjs.
import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('con la sessione del proprietario aperta, «Annulla» sul toast ignora la segnalazione appena partita e un sito non può farlo', async ({ app, shell, avvisi }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async () => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    ga.isAdmin = () => true;
    ga.isSignedIn = () => true;
    ga.getIdToken = async () => 'token-finto-dell-owner';
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = JSON.stringify({ text: 'Questo non lo so fare.', actions: [] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    // Il turno ammette un buco: niente proposta in chat, parte la segnalazione automatica.
    const AF = globalThis.SN_AUTO_FEEDBACK;
    AF.analyzeReply = () => ({ kind: 'capability_gap' });
    AF.composeProposal = () => null;
    AF.compose = () => ({ text: 'Filo non sa fare una cosa', name: 'Un buco', clientId: 'c-test' });
    // Niente Firestore: si registra cosa sarebbe partito, e con quale credenziale.
    globalThis.__scritture = [];
    globalThis.SN_FEEDBACK.submit = async () => ({ id: 'fb-auto-1' });
    globalThis.SN_FEEDBACK.updateStatus = async (id, campi, opts) => {
      globalThis.__scritture.push({ id, status: campi && campi.status, token: opts && opts.idToken });
    };
  });

  await page.locator('#input').fill('fammi una cosa che non sai fare');
  await page.locator('#sendBtn').click();

  const vista = await avvisi();
  const toast = vista.locator('.shell-notif.show', { hasText: 'segnalato a chi sviluppa Filo' });
  await expect(toast).toBeVisible({ timeout: 20_000 });

  // Lo stesso id, appena partito e quindi annullabile, chiesto da un sito: rifiutato per provenienza, niente scritto.
  const daSiti = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const annulla = { type: MSG.CANCEL_AUTO_FEEDBACK, id: 'fb-auto-1' };
    return [
      await globalThis.SN_HANDLE_MESSAGE(annulla, { url: 'https://evil.example/pagina' }),
      await globalThis.SN_HANDLE_MESSAGE(annulla, { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' }),
    ];
  });
  for (const r of daSiti) expect(r).toEqual({ ok: false, code: 'forbidden', error: 'forbidden' });
  expect(await app.evaluate(() => globalThis.__scritture)).toEqual([]);

  await toast.locator('.shell-notif-action', { hasText: 'Annulla' }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__scritture), { timeout: 10_000 })
    .toEqual([{ id: 'fb-auto-1', status: 'ignored', token: 'token-finto-dell-owner' }]);

  // Annullata una volta, non c'è più niente da annullare: una seconda richiesta non riscrive.
  const ancora = await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG.CANCEL_AUTO_FEEDBACK, id: 'fb-auto-1' },
    { url: 'filo://shell/shell.html', isShell: true },
  ));
  expect(ancora.ok).toBe(false);
  expect(await app.evaluate(() => globalThis.__scritture)).toHaveLength(1);
});

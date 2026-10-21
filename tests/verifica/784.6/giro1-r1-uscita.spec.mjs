// #784.6 giro 1, rilievo 1: chi esce da Filo col toast della segnalazione automatica ancora a schermo non deve perderla.
// L'invio vero passa dalla rete: qui dura 400 ms, come una scrittura su Firestore.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('r1 uscire da Filo col toast a schermo: la segnalazione automatica arriva lo stesso', async ({ app, shell, avvisi }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  const segno = join(cartellaTemporanea('filo-784-6-'), 'arrivata.txt');
  await app.evaluate(async (_e, segno) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    ga.isAdmin = () => false;
    ga.isSignedIn = () => false;
    ga.accessoOwnerCaduto = () => false;
    ga.getIdToken = async () => null;
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
    const AF = globalThis.SN_AUTO_FEEDBACK;
    AF.analyzeReply = () => ({ kind: 'capability_gap' });
    AF.composeProposal = () => null;
    AF.compose = () => ({ text: 'Filo non sa fare una cosa', name: 'Un buco', clientId: 'c-test' });
    const fs = process.getBuiltinModule('fs');
    globalThis.SN_FEEDBACK.submit = () => new Promise((ok) => setTimeout(() => {
      fs.writeFileSync(segno, 'arrivata');
      ok({ id: 'fb-auto-1' });
    }, 400));
  }, segno);

  await page.locator('#input').fill('fammi una cosa che non sai fare');
  await page.locator('#sendBtn').click();
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'segnalato a chi sviluppa Filo' })).toHaveCount(1, { timeout: 20_000 });

  // L'utente chiude Filo subito, senza toccare il toast: non ha detto no.
  const uscita = new Promise((r) => app.process().once('exit', r));
  await app.evaluate(({ app: a }) => { setTimeout(() => a.quit(), 50); });
  await uscita;
  expect(existsSync(segno), 'la segnalazione che nessuno ha annullato si è persa all\'uscita').toBe(true);
});

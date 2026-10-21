// «Annulla» sul toast della segnalazione automatica (F4): la segnalazione parte solo quando l'avviso si chiude, così
// Annulla la ferma per chiunque (#784.6); partita, la ritira solo l'owner e agli altri lo dice. Un sito non tocca
// niente (#784.3). Il resto della famiglia di porte la bussa tests/feedback-canali-origine.spec.mjs.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const BARRA = { url: 'filo://shell/shell.html', isShell: true };
const SITO = { url: 'https://evil.example/pagina' };

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// Un turno che ammette un buco senza proporre la segnalazione in chat: parte quella automatica. Niente Firestore: si
// registra cosa sarebbe partito e cosa sarebbe stato scritto; i biglietti dei toast si leggono al passaggio.
async function prepara(app, { owner }) {
  await app.evaluate(async ({ BrowserWindow }, owner) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    ga.isAdmin = () => owner;
    ga.isSignedIn = () => owner;
    ga.accessoOwnerCaduto = () => false;
    ga.getIdToken = async () => (owner ? 'token-finto-dell-owner' : null);
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
    globalThis.__inviate = [];
    globalThis.__scritture = [];
    globalThis.__biglietti = [];
    globalThis.SN_FEEDBACK.submit = async (voce, opts) => {
      globalThis.__inviate.push({ name: voce && voce.name, token: (opts && opts.idToken) || null });
      return { id: `fb-auto-${globalThis.__inviate.length}` };
    };
    globalThis.SN_FEEDBACK.updateStatus = async (id, campi, opts) => {
      globalThis.__scritture.push({ id, status: campi && campi.status, token: opts && opts.idToken });
    };
    const wc = BrowserWindow.getAllWindows().find((w) => w._filoTabs).webContents;
    const manda = wc.send.bind(wc);
    wc.send = (canale, ...resto) => {
      const azione = canale === 'shell:toast' && resto[0] && resto[0].opts && Array.isArray(resto[0].opts.actions)
        && resto[0].opts.actions.find((a) => a && a.cancelAutoFeedback);
      if (azione) globalThis.__biglietti.push(azione.cancelAutoFeedback);
      return manda(canale, ...resto);
    };
  }, owner);
}

// Chiede a Filo una cosa che non sa fare e torna il toast della segnalazione col suo biglietto.
async function chiediUnBuco(app, page, avvisi, n) {
  await page.locator('#input').fill(`fammi una cosa che non sai fare, giro ${n}`);
  await page.locator('#sendBtn').click();
  const vista = await avvisi();
  const toast = vista.locator('.shell-notif.show', { hasText: 'segnalato a chi sviluppa Filo' });
  await expect(toast).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(() => app.evaluate(() => globalThis.__biglietti.length), { timeout: 5_000 }).toBe(n);
  const biglietto = await app.evaluate((_e, i) => globalThis.__biglietti[i], n - 1);
  return { vista, toast, biglietto };
}

const chiedi = (app, msg, mittente) => app.evaluate(
  (_e, [m, s]) => globalThis.SN_HANDLE_MESSAGE({ ...m, type: globalThis.SN_MSG.MSG[m.type] }, s),
  [msg, mittente],
);
const inviate = (app) => app.evaluate(() => globalThis.__inviate);
const scritture = (app) => app.evaluate(() => globalThis.__scritture);

test('senza l\'accesso del proprietario «Annulla» ferma la segnalazione prima che parta, e quando è tardi lo dice', async ({ app, shell, avvisi }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await prepara(app, { owner: false });

  // 1. La lamentela: Annulla col toast a schermo, e la segnalazione non arriva mai.
  const primo = await chiediUnBuco(app, page, avvisi, 1);
  // Un sito non la ferma né la fa partire, nemmeno col biglietto giusto.
  for (const type of ['CANCEL_AUTO_FEEDBACK', 'AUTO_FEEDBACK_PARTI']) {
    expect(await chiedi(app, { type, id: primo.biglietto }, SITO)).toEqual({ ok: false, code: 'forbidden', error: 'forbidden' });
  }
  expect(await inviate(app), 'la segnalazione è partita prima che l\'utente potesse dire no').toEqual([]);
  await primo.toast.locator('.shell-notif-action', { hasText: 'Annulla' }).click();
  await expect(primo.toast).toHaveCount(0);
  // Fermata: nemmeno un avviso che si chiude in ritardo la fa ripartire.
  expect(await chiedi(app, { type: 'AUTO_FEEDBACK_PARTI', id: primo.biglietto }, BARRA)).toMatchObject({ ok: false });
  await page.waitForTimeout(1_500);
  expect(await inviate(app), '«Annulla» non ha fermato la segnalazione').toEqual([]);
  expect(await scritture(app)).toEqual([]);
  await expect(primo.vista.locator('.shell-notif.show', { hasText: /ritirar/ })).toHaveCount(0);

  // 2. Chiuso senza Annulla, la segnalazione parte: una volta sola, e da lì chi non è l'owner non la ritira.
  const secondo = await chiediUnBuco(app, page, avvisi, 2);
  await secondo.toast.locator('.shell-notif-close').click();
  await expect.poll(() => inviate(app), { timeout: 10_000 }).toEqual([{ name: 'Un buco', token: null }]);
  const tardi = await chiedi(app, { type: 'CANCEL_AUTO_FEEDBACK', id: secondo.biglietto }, BARRA);
  expect(tardi).toMatchObject({ ok: false, tardi: true });
  expect(tardi.frase).toContain('già partita');

  // 3. Partita col toast ancora a schermo (il tetto di sicurezza): Annulla dice che è tardi, non finge.
  const terzo = await chiediUnBuco(app, page, avvisi, 3);
  expect(await chiedi(app, { type: 'AUTO_FEEDBACK_PARTI', id: terzo.biglietto }, BARRA)).toEqual({ ok: true });
  await expect.poll(() => inviate(app).then((l) => l.length), { timeout: 10_000 }).toBe(2);
  await terzo.toast.locator('.shell-notif-action', { hasText: 'Annulla' }).click();
  await expect(terzo.vista.locator('.shell-notif.show', { hasText: 'La segnalazione è già partita e non posso più ritirarla' })).toBeVisible({ timeout: 10_000 });  expect(await scritture(app), 'chi non è l\'owner non ha il permesso di scrivere lo stato').toEqual([]);
});

test('con la sessione del proprietario «Annulla» ferma la segnalazione, e una già partita la segna «ignorata»', async ({ app, shell, avvisi }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await prepara(app, { owner: true });

  const primo = await chiediUnBuco(app, page, avvisi, 1);
  await primo.toast.locator('.shell-notif-action', { hasText: 'Annulla' }).click();
  await expect(primo.toast).toHaveCount(0);
  await page.waitForTimeout(1_500);
  expect(await inviate(app)).toEqual([]);
  expect(await scritture(app), 'non c\'era niente da ignorare: non è mai partita').toEqual([]);

  const secondo = await chiediUnBuco(app, page, avvisi, 2);
  expect(await chiedi(app, { type: 'AUTO_FEEDBACK_PARTI', id: secondo.biglietto }, BARRA)).toEqual({ ok: true });
  await expect.poll(() => inviate(app), { timeout: 10_000 }).toEqual([{ name: 'Un buco', token: 'token-finto-dell-owner' }]);
  await secondo.toast.locator('.shell-notif-action', { hasText: 'Annulla' }).click();
  await expect.poll(() => scritture(app), { timeout: 10_000 })
    .toEqual([{ id: 'fb-auto-1', status: 'ignored', token: 'token-finto-dell-owner' }]);
  await expect(secondo.vista.locator('.shell-notif.show', { hasText: /ritirar/ })).toHaveCount(0);

  // Ritirata una volta, non c'è più niente da ritirare: una seconda richiesta non riscrive.
  expect((await chiedi(app, { type: 'CANCEL_AUTO_FEEDBACK', id: secondo.biglietto }, BARRA)).ok).toBe(false);
  expect(await scritture(app)).toHaveLength(1);
});

// Uscire col toast a schermo non è un no: la segnalazione deve arrivare anche se l'invio dura (qui 400 ms, come la rete).
for (const via of ['esce da Filo', 'chiude l\'ultima finestra']) {
  test(`chi ${via} col toast a schermo non perde la segnalazione automatica`, async ({ app, shell, avvisi }) => {
    test.skip(via !== 'esce da Filo' && process.platform === 'darwin', 'su Mac chiudere la finestra non chiude Filo');
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible();
    await prepara(app, { owner: false });
    const segno = join(cartellaTemporanea('filo-auto-feedback-'), 'arrivata.txt');
    await app.evaluate((_e, segno) => {
      const fs = process.getBuiltinModule('fs');
      globalThis.SN_FEEDBACK.submit = () => new Promise((ok) => setTimeout(() => {
        fs.writeFileSync(segno, 'arrivata');
        ok({ id: 'fb-auto-1' });
      }, 400));
    }, segno);
    await chiediUnBuco(app, page, avvisi, 1);
    await page.waitForTimeout(1_000);

    const uscita = new Promise((r) => app.process().once('exit', r));
    await app.evaluate(({ app: a, BrowserWindow }, via) => {
      setTimeout(() => {
        if (via === 'esce da Filo') a.quit();
        else BrowserWindow.getAllWindows().find((w) => w._filoTabs).close();
      }, 50);
    }, via);
    await uscita;
    expect(existsSync(segno), 'la segnalazione che nessuno ha annullato si è persa all\'uscita').toBe(true);
  });
}

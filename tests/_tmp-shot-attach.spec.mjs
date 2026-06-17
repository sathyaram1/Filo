import { test } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

test('shot: composer + per-turn attachments', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await page.locator('#adminBanner').waitFor({ state: 'visible', timeout: 8000 });

  const att = '@@filo-attachment {"kind":"img","url":"https://firebasestorage.example/shot.png"}';
  const attFile = '@@filo-attachment {"kind":"file","url":"https://firebasestorage.example/log.txt","name":"crash.log","type":"text/plain"}';
  const notes = [
    'Ho risolto come chiesto. Verificato con un test.',
    attFile,
    '',
    '--- La tua risposta del 10/06/26, 09:00 ---',
    'Ecco lo screenshot del problema.',
    att,
  ].join('\n');

  await page.evaluate(({ notes }) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 's1', status: 'done', text: 'la sidebar non si apre', url: 'https://example.com',
      clientId: 'tester-123', images: [], notes, createdAt: new Date().toISOString(),
    }];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (m) => {
      if (m && m.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'a@b.c' } };
      if (m && m.type === 'feedback_update') return { ok: true };
      return orig(m);
    };
  }, { notes });

  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = ''; try { url = wc.getURL(); } catch (_) {}
      if (url.includes('feedback')) wc.send('filo:broadcast', { type: 'auth_changed', signedIn: true, isAdmin: true, profile: { email: 'a@b.c' } });
    }
  });
  await page.locator('#refresh').click();
  await page.locator('[data-tab="done"]').click();
  await page.locator('.fb-bubble--report').waitFor({ state: 'visible', timeout: 8000 });
  await page.screenshot({ path: 'tests/.shots/attach-readonly.png', fullPage: true });

  // Tab "Da risolvere" con composer note editabile (mostra il pulsante Allega).
  await page.evaluate(() => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 's2', status: 'todo', text: 'crash quando apro la sidebar', url: 'https://example.com',
      clientId: 'tester-123', images: [],
      notes: 'Riprodotto. Allego il log.\n@@filo-attachment {"kind":"file","url":"https://firebasestorage.example/log.txt","name":"crash.log","type":"text/plain"}',
      createdAt: new Date().toISOString(),
    }];
  });
  await page.locator('#refresh').click();
  await page.locator('[data-tab="todo"]').click();
  await page.locator('.fb-notes').waitFor({ state: 'visible', timeout: 8000 });
  await page.screenshot({ path: 'tests/.shots/attach-composer.png', fullPage: true });
});

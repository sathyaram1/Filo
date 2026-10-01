// Verifica locale «lavori locali», giro 7, rilievo 3: i testi dei lavori locali in Gestione dicono quello che
// succede dove sta la pratica. Su un lavoro locale chiuso togliere il segno non la ridà alle routine (la rimette
// nella bacheca); su un feedback di un utente il numero non serve a npm run finish. Dati finti.
import { test, expect } from './../../fixtures/electron.mjs';

test('lavoro locale chiuso e feedback di un utente: i testi non promettono quello che non succede', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (msg && msg.type === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
  const ieri = new Date(Date.now() - 864e5).toISOString();
  const chiuso = {
    _id: 'lc', seq: 9503, subSeq: 0, name: 'Lavoro locale fuso', text: 'Lavoro locale.', status: 'done', statusPublic: 'resolved',
    clientId: 'local:claude', senderProof: 'admin', localOnly: { by: 'local:claude', at: Date.parse(ieri) },
    pipeline: { skipped: 'local_proven' }, createdAt: ieri, fixedInVersion: '0.0.1', images: [], notes: '',
  };
  const utente = { _id: 'ue', seq: 9505, subSeq: 0, name: 'Segnalazione di un utente', text: 'x', status: 'todo', statusPublic: 'open', clientId: 'abc', createdAt: ieri, images: [], notes: '' };
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setTab('resolved'); }, [chiuso, utente]);

  await page.evaluate((id) => window.__mgTest.openDetail(id), 'lc');
  const tasto = page.locator('#mgLocalBtn');
  await expect(tasto).toBeVisible();
  await expect(tasto).not.toHaveAttribute('title', /routine/);
  await expect(page.locator('#mgDetail')).not.toContainText('alla chiusura si fonde');
  await page.locator('.mg-item[data-id="lc"]').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await expect(page.locator('.mg-ctxmenu')).not.toContainText('Rimetti anche alle routine');
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await page.locator('.mg-item[data-id="ue"]').click({ button: 'right' });
  const copia = page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Copia' });
  await expect(copia).toBeVisible();
  await expect(copia).not.toHaveAttribute('title', /npm run finish/);
});

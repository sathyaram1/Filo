// Esplorazione visiva (giro 2): guardo la fila delle forme e il pannello del
// rombo nei due temi. Non asserisce niente: serve solo a produrre le immagini.
import { test } from '../../fixtures/electron.mjs';
import fs from 'node:fs';

const MANAGE = 'filo://manage/manage.html';
const OUT = 'tests/.shots';

const FB = {
  _id: 'fb-sguardo-001',
  text: 'Quando trascino una scheda su un’altra finestra sparisce.',
  name: 'Scheda persa nel trascinamento',
  seq: 902, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-09-19T10:00:00Z',
  images: [],
  status: 'design',
  statusReason: 'clarify',
  statusPublic: 'open',
  notes: 'Preferisci che la scheda torni indietro o che apra una finestra nuova?',
};

test('sguardo: rombo verde nei due temi', async ({ openTab }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fb) => window.__mgTest.setData([fb]), FB);
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), FB);
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
  await page.waitForTimeout(400);

  for (const tema of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, tema);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/rombo-${tema}-dettaglio.png` });
    await page.locator('#mgForme [data-livello="l3"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/rombo-${tema}-pannello.png` });
  }
});

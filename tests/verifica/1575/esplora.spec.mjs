// Esplorazione del giro 2: filtro della fiducia con una pratica aperta, ricerca, segna fidato a filtro acceso.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const MANAGE = 'filo://manage/manage.html';
function fb(over = {}) {
  return Object.assign({
    _id: `fb-${over.seq}`, name: `Pratica ${over.seq}`, text: 'Testo.', subSeq: 0,
    status: 'todo', statusPublic: 'open', clientId: 'utente-x', createdAt: '2026-10-10T08:00:00Z', images: [],
  }, over);
}
const FIDATO = { clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato' };
const LUNGO = 'Un titolo lunghissimo che non finisce mai e continua a scorrere oltre la larghezza della colonna della lista ' .repeat(2);
const LISTA = [
  fb({ seq: 1, ...FIDATO }), fb({ seq: 2 }), fb({ seq: 3, name: LUNGO }), fb({ seq: 4, name: LUNGO, ...FIDATO }),
  fb({ seq: 5, status: 'design', statusReason: 'locale' }),
  fb({ seq: 6, status: 'design', statusReason: 'locale', ...FIDATO }),
  fb({ seq: 7, status: 'aligned', localOnly: { by: 'routine', at: 1 } }),
  fb({ seq: 8, status: 'attack', fiducia: 'non_fidato' }),
];

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__msgs = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      window.__msgs.push(msg);
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (/fiducia/i.test(String(t))) return { ok: true };
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setReleasedVersion('2.0.0'); }, LISTA);
}

test('esplora: aperta una fidata, accendo il filtro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await apriScheda(page, 'queue');
  await page.locator('.mg-item[data-id="fb-1"]').click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await page.locator('#mgFiduciaFiltro').click();
  await page.screenshot({ path: 'tests/.shots/v1575-g2-aperta-filtro.png' });
  console.log('detail visibile', await page.locator('#mgDetail').isVisible(), 'righe', await page.locator('#mgList .mg-item').count());
  // Tasto destro sulla non fidata: segna fidato
  await page.locator('.mg-item[data-id="fb-2"]').click({ button: 'right' });
  await page.screenshot({ path: 'tests/.shots/v1575-g2-menu.png' });
  const voci = await page.locator('.mg-ctxmenu .sn-select-option').allTextContents();
  console.log('voci', voci);
  const segna = page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Segna fidato' });
  if (await segna.count()) {
    await segna.click();
    await page.waitForTimeout(500);
    console.log('dopo segna: righe', await page.locator('#mgList .mg-item').count(), 'tab', await page.locator('.mg-tab[data-tab="queue"]').textContent(), 'filtro', await page.locator('#mgFiduciaFiltro').textContent());
    await page.screenshot({ path: 'tests/.shots/v1575-g2-dopo-segna.png' });
  }
});

test('esplora: righe lunghe, rombi, attacco, in due temi', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  for (const t of ['light', 'dark']) {
    await page.evaluate((x) => document.documentElement.setAttribute('data-sn-theme', x), t);
    await apriScheda(page, 'inbox');
    await page.screenshot({ path: `tests/.shots/v1575-g2-inbox-${t}.png` });
    await apriScheda(page, 'queue');
    await page.screenshot({ path: `tests/.shots/v1575-g2-queue-${t}.png` });
  }
  const badge = await page.locator('.mg-item[data-id="fb-7"] .mg-local-badge').count();
  console.log('badge server su aligned localOnly', badge);
});

test('esplora: ricerca col filtro acceso', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await apriScheda(page, 'queue');
  await page.locator('#mgFiduciaFiltro').click();
  const cerca = page.locator('#mgSearchBtn, .mg-search-btn, [aria-label*="Cerca"]').first();
  console.log('search btn', await cerca.count());
  if (await cerca.count()) {
    await cerca.click();
    await page.keyboard.type('Pratica');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'tests/.shots/v1575-g2-ricerca.png' });
    console.log('righe in ricerca', await page.locator('#mgList .mg-item').count(), 'filtro hidden', await page.locator('#mgFiduciaFiltro').isHidden());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    console.log('dopo esc filtro', await page.locator('#mgFiduciaFiltro').getAttribute('aria-pressed'), 'righe', await page.locator('#mgList .mg-item').count());
  }
});

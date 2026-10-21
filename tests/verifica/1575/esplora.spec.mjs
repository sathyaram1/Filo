import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';
import { domanda } from '../../helpers/gestioneMainFinto.mjs';

const MANAGE = 'filo://manage/manage.html';
function fb(over = {}) {
  return Object.assign({
    _id: `fb-${over.seq}`, name: `Pratica ${over.seq}`, text: 'Testo.', subSeq: 0,
    status: 'todo', statusPublic: 'open', clientId: 'utente-x', createdAt: '2026-10-10T08:00:00Z', images: [],
  }, over);
}
const FIDATO = { clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato' };

async function apri(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'fiducia_segna') { window.__updates.push(msg); return { ok: true, fiducia: msg.fidato === false ? 'non_fidato' : 'fidato' }; }
      if (t === 'feedback_update' || t === 'feedback_reevaluate') { window.__updates.push(msg); return { ok: true, outcome: 'noop' }; }
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setReleasedVersion('2.0.0'); }, lista);
}
const riga = (page, f) => page.locator(`#mgList .mg-item[data-id="${f._id}"]`);
const tabBtn = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"]`);

test('esplora', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const lungo = 'Un titolo lunghissimo '.repeat(12);
  const wF = fb({ seq: 1, status: 'working', name: lungo, ...FIDATO, priority: 1 });
  const wN = fb({ seq: 2, status: 'working', name: '<b>html</b> 🙂', priority: 2 });
  const srv = fb({ seq: 3, status: 'working', ...FIDATO, localOnly: { by: 'routine', at: 1 } });
  const ali = fb({ seq: 4, status: 'aligned' });
  const azz = fb({ seq: 5, status: 'design', statusReason: 'locale' });
  const doneSrv = fb({ seq: 6, status: 'done', resolvedInVersion: '1.0.0', statusPublic: 'closed', localOnly: { by: 'routine', at: 1 }, ...FIDATO });
  const stellaN = fb({ seq: 7, starred: true });
  const stellaF = fb({ seq: 8, starred: true, ...FIDATO });
  await apri(page, [wF, wN, srv, ali, azz, doneSrv, stellaN, stellaF]);
  for (const t of ['light', 'dark']) {
    await page.evaluate((x) => document.documentElement.setAttribute('data-sn-theme', x), t);
    await apriScheda(page, 'queue');
    await page.screenshot({ path: `tests/.shots/v1575-queue-${t}.png` });
  }
  const info = await page.evaluate(() => [...document.querySelectorAll('#mgList .mg-item')].map((el) => {
    const s = getComputedStyle(el); const sc = el.querySelector('.mg-fiducia-segno');
    const r = sc ? sc.getBoundingClientRect() : null; const er = el.getBoundingClientRect();
    return { id: el.dataset.id, cls: el.className, br: s.borderRightColor + ' ' + s.borderRightWidth, sc: r ? [r.x, r.width, er.right] : null, badge: !!el.querySelector('.mg-local-badge') };
  }));
  console.log(JSON.stringify(info, null, 1));
  // tasto destro su una pratica in coda, sulla allineata e sul rombo
  for (const f of [wN, ali, azz, doneSrv]) {
    const tab = await page.evaluate((x) => window.SN_MANAGE_REVIEW.manageTabFor(x, { releasedVersion: '2.0.0' }), f);
    await apriScheda(page, tab);
    await riga(page, f).click({ button: 'right' });
    const voci = await page.locator('.mg-ctxmenu .sn-select-option').allTextContents();
    console.log(f.seq, tab, JSON.stringify(voci));
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await riga(page, f).click();
    console.log(f.seq, 'local btn visible', await page.locator('#mgAcceptLocalBtn').isVisible());
  }
  await apriScheda(page, 'resolved');
  console.log('resolved badge', await riga(page, doneSrv).locator('.mg-local-badge').count());
  // filtro + stelle
  await apriScheda(page, 'queue');
  await page.locator('#mgFiduciaFiltro').click();
  await page.evaluate(() => { const c = document.getElementById('mgStarFilter'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  console.log('stelle+filtro', await page.locator('#mgList .mg-item').count(), await tabBtn(page, 'queue').textContent(), await page.locator('#mgFiduciaFiltro').textContent(), await page.locator('#mgListHead').textContent());
  await page.evaluate(() => { const c = document.getElementById('mgStarFilter'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  // Segna fidato col filtro acceso: cosa succede alla riga aperta
  await riga(page, wN).click();
  await page.locator('#mgFiduciaBtn').click();
  await page.waitForTimeout(500);
  console.log('dopo segna fidato', await riga(page, wN).count(), await page.locator('#mgDetail').isVisible(), await page.locator('#mgFiduciaFiltro').textContent(), await tabBtn(page, 'queue').textContent());
  await page.screenshot({ path: 'tests/.shots/v1575-dopo-segna.png' });
  // finestra stretta
  await page.setViewportSize({ width: 700, height: 700 }).catch(() => {});
  await page.locator('#mgFiduciaFiltro').click();
  await page.screenshot({ path: 'tests/.shots/v1575-stretta.png' });
  // domande, zero non fidate
  await page.evaluate((l) => window.__mgTest.setDomande(l), [domanda(31, { fiducia: 'fidato' })]);
  await apriScheda(page, 'domande');
  await page.locator('#mgDomandeFiduciaFiltro').click();
  console.log('domande vuote', await page.locator('#mgDomandeFiduciaFiltro').getAttribute('aria-pressed'), await page.locator('#mgDomandeCol').innerText());
  await page.screenshot({ path: 'tests/.shots/v1575-domande-zero.png' });
});

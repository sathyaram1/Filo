// Esplorazione del giro 7 (si cancella): Gestione coi lavori locali in vari stati, testi e schermate.
import { test } from './../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';

test('esplora lavori locali in Gestione', async ({ openTab }) => {
  test.setTimeout(120000);
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true, by: 'owner@esempio', at: 1 }; }
      return orig(msg);
    };
  });
  const giorni = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const lo = (n) => ({ by: 'local:claude', at: Date.parse(giorni(n)) });
  const base = { text: 'Lavoro locale.', statusPublic: 'open', images: [], clientId: 'local:claude', senderProof: 'admin', pipeline: { skipped: 'local_proven' } };
  const l = [
    { ...base, _id: 'la', seq: 9501, name: 'In coda da due giorni', status: 'todo', createdAt: giorni(2), localOnly: lo(2) },
    { ...base, _id: 'lb', seq: 9502, name: 'In lavorazione da cinque giorni', status: 'working', workingSince: giorni(5), createdAt: giorni(6), localOnly: lo(6), notes: '' },
    { ...base, _id: 'lc', seq: 9503, name: 'Fuso ieri', status: 'done', statusPublic: 'resolved', createdAt: giorni(3), localOnly: lo(3), fixedInVersion: '0.0.1' },
    { ...base, _id: 'ld', seq: 9504, name: 'Mio, nei Ricevuti col segno', clientId: 'owner:me', status: 'aligned', createdAt: giorni(1), localOnly: { by: 'owner@esempio', at: 1 }, pipeline: undefined },
    { _id: 'ue', seq: 9505, name: 'Utente che chiede lavoro locale', text: 'x', clientId: 'abc', status: 'design', reviewReason: 'locale', statusPublic: 'open', images: [], createdAt: giorni(1), notes: '' },
  ];
  await page.evaluate((x) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(x); }, l);
  const out = {};
  for (const tab of ['local', 'inbox', 'queue', 'resolved']) {
    await page.evaluate((t) => window.__mgTest.setTab(t), tab);
    await page.waitForTimeout(300);
    out[tab] = await page.locator('.mg-item').allInnerTexts();
    await page.screenshot({ path: `tests/.shots/giro7-esplora-${tab}.png` });
  }
  for (const [tab, id] of [['local', 'la'], ['local', 'lb'], ['resolved', 'lc'], ['inbox', 'ld'], ['inbox', 'ue']]) {
    await page.evaluate((t) => window.__mgTest.setTab(t), tab);
    await page.evaluate((i) => window.__mgTest.openDetail(i), id);
    await page.waitForTimeout(300);
    const det = page.locator('#mgDetail');
    out[`det-${id}`] = (await det.isVisible()) ? await det.innerText() : '(nessun dettaglio)';
    out[`btn-${id}`] = await page.locator('#mgDetail button:visible').evaluateAll((bs) => bs.map((b) => `${b.id || ''}|${b.textContent.trim()}|${b.title || ''}`));
    await page.screenshot({ path: `tests/.shots/giro7-esplora-det-${id}.png` });
    const item = page.locator(`.mg-item[data-id="${id}"]`);
    if (await item.count()) {
      await item.click({ button: 'right' });
      await page.waitForTimeout(200);
      out[`ctx-${id}`] = await page.locator('.mg-ctxmenu .sn-select-option').evaluateAll((os) => os.map((o) => `${o.textContent.trim()}|${o.title || ''}`));
      await page.keyboard.press('Escape');
    }
  }
  writeFileSync('tests/.shots/giro7-esplora.json', JSON.stringify(out, null, 1));
});

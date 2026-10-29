// Verifica #1688 giro 2, rilievo 1: sulla scheda dietro la X che compare al passaggio va sopra i segni dei permessi
// (microfono, fotocamera, notifiche negate) invece che sulla fine del nome: li copre, e un clic sul segno chiude la scheda.
import { test, expect } from '../../fixtures/electron.mjs';

async function apri(app, shell, openTab, testServer) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).setSize(1280, 800));
  for (let i = 0; i < 8; i++) {
    const p = await openTab(testServer.html(`<title>${i === 2 ? 'Meet - riunione del lunedì' : `Sito numero ${i} con un titolo lungo`}</title><h1 id="ok">x</h1>`));
    await p.waitForSelector('#ok');
  }
  await expect(shell.locator('#tabs .tab')).toHaveCount(9, { timeout: 30_000 });
  // La riunione ha avuto microfono e fotocamera e suona; la chat ha le notifiche negate e non suona.
  const ids = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
    const segni = (t, usati, negati) => {
      const wc = t.view.webContents;
      wc._filoSegni = { origine: new URL(wc.getURL()).origin, usati: new Set(usati), negati: new Set(negati) };
    };
    segni(web[2], ['audio', 'video'], []);
    web[2].audible = true;
    segni(web[4], [], ['notifiche']);
    w._filoTabs._broadcast();
    return { meet: web[2].id, chat: web[4].id };
  });
  await expect(shell.locator('#tabs .tab .tab-permessi')).toHaveCount(2, { timeout: 10_000 });
  await expect(shell.locator(`#tabs .tab[data-id="${ids.meet}"] .tab-alert`)).toHaveCount(1);
  return ids;
}

for (const quale of ['meet', 'chat']) {
  test(`r1 ${quale}: al passaggio la X non copre i segni dei permessi, e il clic sul segno apre la scheda`, async ({ app, shell, openTab, testServer }) => {
    const ids = await apri(app, shell, openTab, testServer);
    const id = ids[quale];
    const tab = shell.locator(`#tabs .tab[data-id="${id}"]`);
    await expect(tab).not.toHaveClass(/active/);
    await tab.locator('.title').hover();
    await shell.waitForTimeout(300);
    const g = await tab.evaluate((el) => {
      const r = (e) => e.getBoundingClientRect();
      const x = r(el.querySelector('.close')), s = r(el.querySelector('.tab-permessi .segno'));
      return { sovrapposti: x.left < s.right && s.left < x.right, cx: s.left + s.width / 2, cy: s.top + s.height / 2 };
    });
    expect.soft(g.sovrapposti, 'la X sta sopra il segno').toBe(false);
    await shell.mouse.click(g.cx, g.cy);
    await expect(tab).toHaveClass(/active/, { timeout: 5000 });
    await expect(shell.locator('#tabs .tab')).toHaveCount(9);
  });
}

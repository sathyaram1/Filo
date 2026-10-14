// Verifica #975, giro 1: porte avversariali del «Menu di <sito>».
import { test, expect } from '../../fixtures/electron.mjs';

const menuPagina = (registra) => `<!doctype html><html><head><meta charset="utf-8">
<meta property="og:site_name" content="Sito prova"><title>x</title>
<style>#menu-suo { position: fixed; width: 160px; height: 120px; background: #eee; border: 1px solid #999 }</style>
<script>
  window.aperture = 0;
  window.mostra = function (e) {
    e.preventDefault();
    var m = document.getElementById('menu-suo');
    m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'; m.hidden = false; window.aperture++;
    return false;
  };
  ${registra}
  document.addEventListener('click', function () { document.getElementById('menu-suo').hidden = true; });
</script></head>
<body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="area" style="width:420px;height:220px;background:#cde" ${registra === '' ? 'oncontextmenu="return mostra(event)"' : ''}>la tela</div>
  <div id="menu-suo" hidden>menu del sito</div>
</body></html>`;

const vociDelSito = (page) => page.locator('.sn-menu .sn-menu-split-main', { hasText: /^Menu di/ });

async function provaVoceEApertura(page) {
  await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(vociDelSito(page)).toHaveText(['Menu di Sito prova']);
  await vociDelSito(page).click();
  await expect(page.locator('#menu-suo')).toBeVisible();
}

test('proprietà document.oncontextmenu: la voce c\'è e apre il menu', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, menuPagina('document.oncontextmenu = function (e) { return mostra(e); };'));
  await provaVoceEApertura(page);
});

test('attributo oncontextmenu nell\'HTML: la voce c\'è e apre il menu', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, menuPagina(''));
  await provaVoceEApertura(page);
});

test('ascoltatore registrato tardi (app che si avvia dopo il caricamento)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, menuPagina('setTimeout(function(){ document.getElementById("area").addEventListener("contextmenu", mostra); }, 300);'));
  await page.waitForTimeout(600);
  await provaVoceEApertura(page);
});

test('un riquadro con un menu suo: la voce c\'è e apre il menu del riquadro', async ({ openTab, testServer }) => {
  const dentro = testServer.html(menuPagina('document.addEventListener("contextmenu", mostra);'), { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:20px">
    <iframe id="f" src="${dentro}" style="width:600px;height:400px;border:0"></iframe></body></html>`);
  const f = page.frameLocator('#f');
  await expect(f.locator('#area')).toBeVisible();
  await page.waitForTimeout(500);
  await f.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
  const menu = f.locator('.sn-menu').or(page.locator('.sn-menu'));
  await expect(menu.first()).toBeVisible({ timeout: 5000 });
  const voce = f.locator('.sn-menu .sn-menu-split-main', { hasText: /^Menu di/ }).or(page.locator('.sn-menu .sn-menu-split-main', { hasText: /^Menu di/ }));
  await expect(voce).toHaveText(['Menu di Sito prova']);
  await voce.click();
  await expect(f.locator('#menu-suo')).toBeVisible();
});

test('nome del sito con markup: resta testo', async ({ openTab, testServer }) => {
  const html = menuPagina('document.addEventListener("contextmenu", mostra);')
    .replace('content="Sito prova"', 'content="&lt;b&gt;X&lt;/b&gt;&lt;img src=x onerror=window.boom=1&gt;"');
  const page = await testServer.openReady(openTab, html);
  await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
  await expect(vociDelSito(page)).toHaveCount(1);
  const t = await vociDelSito(page).innerText();
  expect(t).toContain('<b>');
  expect(await page.evaluate(() => window.boom)).toBeUndefined();
});

test('clic doppio veloce sulla voce e Esc: nessun guasto, il menu del sito si apre una volta', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, menuPagina('document.addEventListener("contextmenu", mostra);'));
  await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
  await vociDelSito(page).dblclick();
  await expect(page.locator('#menu-suo')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.aperture)).toBe(1);
});

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}: menu con la voce, proposta, Preferenze`, async ({ app, openTab, testServer, avvisi }) => {
    await app.evaluate((_e, theme) => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme } }, { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }), tema);
    const page = await testServer.openReady(openTab, menuPagina('document.addEventListener("contextmenu", mostra);'), { pubblico: true });
    await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
    await expect(vociDelSito(page)).toBeVisible();
    await page.locator('.sn-menu .sn-menu-split-arrow').first().hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/975-menu-${tema}.png` });
    await page.keyboard.press('Escape');
    for (let i = 0; i < 3; i++) {
      await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
      await vociDelSito(page).click();
      await expect(page.locator('#menu-suo')).toBeVisible();
      await page.mouse.click(600, 500);
    }
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show')).toBeVisible({ timeout: 10_000 });
    await vista.screenshot({ path: `tests/.shots/975-proposta-${tema}.png` });
    await vista.locator('.shell-notif-action', { hasText: 'Sì' }).click();
    const pref = await openTab('filo://preferences/preferences.html');
    const box = pref.locator('#menuDelSitoSiti');
    await box.scrollIntoViewIfNeeded();
    await expect(box).toContainText('sito-pubblico.test');
    await pref.waitForTimeout(400);
    await pref.screenshot({ path: `tests/.shots/975-pref-${tema}.png` });
  });
}

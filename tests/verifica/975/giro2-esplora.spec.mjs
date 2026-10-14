// #975 giro 2 — esplorazione del verificatore: porte del giro 1, librerie con un ascoltatore unico, riquadri, stress, aspetto.

import { test, expect } from '../../fixtures/electron.mjs';

const MENU = (registra, extraHead = '') => `<!doctype html><html><head><meta charset="utf-8">${extraHead}
<style>#menu-suo { position: fixed; width: 160px; height: 120px; background: #eee; border: 1px solid #999 }</style>
</head><body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="area" style="width:420px;height:220px;background:#cde">la tela del sito</div>
  <div id="menu-suo" hidden>menu del sito</div>
<script>
  window.aperture = 0;
  window.mostra = function (e) {
    e.preventDefault();
    var m = document.getElementById('menu-suo');
    m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'; m.hidden = false;
    window.aperture++;
    return false;
  };
  document.addEventListener('click', function () { document.getElementById('menu-suo').hidden = true; });
  ${registra}
</script></body></html>`;

const voci = (page) => page.locator('.sn-menu .sn-menu-split-main', { hasText: /^Menu di/ });

async function provaVoce(page) {
  await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(voci(page)).toHaveCount(1);
  await voci(page).click();
  await expect(page.locator('#menu-suo')).toBeVisible();
}

for (const [nome, registra] of [
  ['window.oncontextmenu', 'window.oncontextmenu = mostra;'],
  ['attributo sul body', "document.body.setAttribute('oncontextmenu', 'return mostra(event)');"],
]) {
  test(`porta giro 1: ${nome}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, MENU(registra));
    await provaVoce(page);
  });
}

// jQuery: un solo gestore per elemento, iscritto a ogni tipo di evento che il sito usa sul documento.
const COME_JQUERY = `
  var handle = function (e) { if (e.type === 'contextmenu') return mostra(e); };
  ['click','mouseover','mouseout','mouseup','keydown','focusin','focusout','contextmenu','contextmenu:hide','contextmenu:focus']
    .forEach(function (t) { document.addEventListener(t, handle); });
`;
test('r1 un menu fatto con jQuery (un gestore unico sul documento per tanti eventi) ha la voce', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, MENU(COME_JQUERY));
  await provaVoce(page);
});

// Un editor in un riquadro della stessa origine (TinyMCE, CKEditor): l'ascoltatore lo mette la pagina madre al load.
const RIQUADRO = `<!doctype html><html><body style="margin:0;padding:20px">
<iframe id="ed" style="width:600px;height:400px;border:1px solid #888"></iframe>
<script>
  var f = document.getElementById('ed');
  var d = f.contentDocument;
  d.open(); d.write('<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif"><div id="area" style="width:420px;height:220px;background:#cde">editor</div><div id="menu-suo" hidden style="position:fixed;width:160px;height:120px;background:#eee;border:1px solid #999">menu</div></body></html>'); d.close();
  d.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var m = d.getElementById('menu-suo'); m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'; m.hidden = false;
  });
</script></body></html>`;
test('esplora: editor in un riquadro scritto dalla pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, RIQUADRO);
  const fr = page.frameLocator('#ed');
  await fr.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
  await page.waitForTimeout(1500);
  const filoMenu = await fr.locator('.sn-menu').count() + await page.locator('.sn-menu').count();
  const suo = await fr.locator('#menu-suo').isVisible();
  const conVoce = await fr.locator('.sn-menu .sn-menu-split-main', { hasText: /^Menu di/ }).count();
  console.log('RIQUADRO', JSON.stringify({ filoMenu, suo, conVoce }));
});

test('esplora: nome del sito con markup e lunghissimo, doppio clic sulla voce, tema scuro', async ({ app, openTab, testServer }) => {
  const nome = '<img src=x onerror="window.pwn=1"><b>Sito</b> ' + 'x'.repeat(80);
  const page = await testServer.openReady(openTab, MENU("document.addEventListener('contextmenu', mostra);",
    `<meta property="og:site_name" content="${nome.replace(/"/g, '&quot;')}">`));
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await page.waitForTimeout(800);
  await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
  await expect(voci(page)).toHaveCount(1);
  const testo = await voci(page).innerText();
  console.log('ETICHETTA', JSON.stringify(testo));
  await page.screenshot({ path: 'tests/.shots/975-giro2-scuro.png' });
  await page.locator('.sn-menu .sn-menu-split-arrow').first().hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/975-giro2-scuro-sub.png' });
  await voci(page).dblclick();
  await page.waitForTimeout(1500);
  console.log('DOPPIO', JSON.stringify({ aperture: await page.evaluate(() => window.aperture), pwn: await page.evaluate(() => window.pwn || 0), suo: await page.locator('#menu-suo').isVisible() }));
  expect(await page.evaluate(() => window.pwn || 0)).toBe(0);
});

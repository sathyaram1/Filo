// #975 giro 2 — le porte del giro 1 (il gestore oncontextmenu) ri-provate su finestra e body.

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


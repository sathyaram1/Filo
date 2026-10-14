// Verifica #975, giro 1, rilievo 1: un sito che si fa il menu col gestore oncontextmenu (proprietà o attributo
// nell'HTML) non viene riconosciuto, e «Menu di <sito>» non compare.
import { test, expect } from '../../fixtures/electron.mjs';

const menuPagina = (registra) => `<!doctype html><html><head><meta charset="utf-8">
<meta property="og:site_name" content="Sito prova"><title>x</title>
<style>#menu-suo { position: fixed; width: 160px; height: 120px; background: #eee; border: 1px solid #999 }</style>
<script>
  window.mostra = function (e) {
    e.preventDefault();
    var m = document.getElementById('menu-suo');
    m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'; m.hidden = false;
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

test('r1 proprietà document.oncontextmenu: la voce c\'è e apre il menu del sito', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, menuPagina('document.oncontextmenu = function (e) { return mostra(e); };'));
  await provaVoceEApertura(page);
});

test('r1 attributo oncontextmenu nell\'HTML: la voce c\'è e apre il menu del sito', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, menuPagina(''));
  await provaVoceEApertura(page);
});

// Esplorazione #589.11 giro 1: altre forme di velo, e il menu reso trasparente dal sito.
import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'pw-Segreta-589-undici';

const VELI = {
  backdrop: `const v=document.createElement('div');v.id='velo';v.style.cssText='position:fixed;inset:0;backdrop-filter:blur(40px) brightness(4);pointer-events:none;z-index:2147483647';document.body.appendChild(v);`,
  ombra: `const v=document.createElement('div');v.id='velo';v.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;box-shadow:0 0 0 5000px #fff;pointer-events:none;z-index:2147483647';document.body.appendChild(v);`,
  contorno: `const v=document.createElement('div');v.id='velo';v.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;outline:5000px solid #fff;pointer-events:none;z-index:2147483647';document.body.appendChild(v);`,
  popover: `const v=document.createElement('div');v.id='velo';v.setAttribute('popover','manual');v.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;margin:0;border:0;background:#fff;pointer-events:none';document.body.appendChild(v);v.showPopover();`,
  trasparente: `document.querySelectorAll('.sn-menu').forEach((m)=>m.style.setProperty('opacity','0','important'));const v=document.createElement('div');v.id='velo';v.style.cssText='position:fixed;inset:0;background:#fff;pointer-events:none;z-index:1';document.body.appendChild(v);`,
  dentro: `const m=document.querySelector('.sn-menu');const v=document.createElement('div');v.id='velo';v.style.cssText='position:fixed;left:-2000px;top:-2000px;width:6000px;height:6000px;background:#fff;pointer-events:none;z-index:99';m.appendChild(v);`,
};

function pagina(codice) {
  return `<!doctype html><html><body style="padding:40px">
  <input id="campo" style="width:320px;font-size:16px">
  <script>
    new MutationObserver((ms, mo) => {
      if (document.querySelector('.sn-menu')) { mo.disconnect(); ${codice} }
    }).observe(document.documentElement, { childList: true, subtree: true });
  </script></body></html>`;
}

for (const [nome, codice] of Object.entries(VELI)) {
  test(`velo ${nome}: Incolla sotto il velo non incolla`, async ({ app, openTab, testServer }) => {
    await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
    const page = await testServer.openReady(openTab, pagina(codice));
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.locator('#campo').click({ button: 'right' });
    await expect(page.locator('#velo')).toHaveCount(1);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `tests/.shots/589-11-${nome}.png` });
    const b = await page.locator('.sn-menu-paste-main').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(600);
    expect(await page.locator('#campo').inputValue()).not.toContain(SEGRETO);
  });
}

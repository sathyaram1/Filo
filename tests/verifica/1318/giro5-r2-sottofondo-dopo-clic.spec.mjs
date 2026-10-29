// Verifica #1318, giro 5: r2, l'avviso «chiesto da <sito>: bloccato per sicurezza» nasce da un'apertura dell'utente,
// non da quello che la pagina carica in sottofondo dopo un clic.

import { test, expect } from '../../fixtures/electron.mjs';

const nelModello = (shell, testo) => shell.evaluate((t) => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1' && c.textContent.includes(t)).length, testo);

for (const [nome, corpo] of [
  ['icone del menu con lo sfondo preso da un file del computer', "var st = document.createElement('style'); st.textContent = '#m{width:20px;height:20px;background:url(file:///C:/Intranet/icone/casa.png)}'; document.head.appendChild(st); document.getElementById('m').textContent = ' ';"],
  ['richiesta in sottofondo a un file del computer', "var x = new XMLHttpRequest(); x.open('GET', 'file:///C:/Intranet/dati.json'); try { x.send(); } catch (e) {}"],
  ['suono di clic preso da un file del computer', "new Audio('file:///C:/Intranet/clic.wav').play().catch(function () {});"],
]) {
  test(`r2 ${nome}: nessun avviso; un'apertura vera dopo lo dice ancora`, async ({ shell, openTab, testServer }) => {
    const page = await openTab(testServer.html(`<title>Intranet</title>
      <button id="a" style="position:fixed;left:0;top:0;width:300px;height:40px">Menu</button>
      <button id="b" style="position:fixed;left:0;top:50px;width:300px;height:40px" onclick="location.href='file:///C:/Intranet/circolare.pdf'">Apri documento</button>
      <div id="m" style="margin-top:100px"></div>
      <script>document.getElementById('a').onclick = function () { ${corpo} };</script>`));
    await page.waitForTimeout(800);
    await page.mouse.click(40, 20);
    await page.waitForTimeout(2500);
    expect(await nelModello(shell, 'bloccat'), 'un caricamento della pagina non è un\'apertura dell\'utente').toBe(0);
    await page.waitForTimeout(5500);
    await page.mouse.click(40, 70);
    await expect.poll(() => nelModello(shell, 'File del computer chiesto da 127.0.0.1'), { timeout: 8000 }).toBe(1);
  });
}

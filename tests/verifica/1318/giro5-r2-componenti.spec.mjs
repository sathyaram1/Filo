// #1318 giro 5, rilievo 2: l'avviso nasce dalle aperture dell'utente anche dentro i componenti della pagina (shadow DOM),
// e non da un riquadro che la pagina carica e toglie.
import { test, expect } from '../../fixtures/electron.mjs';

const bloccati = (shell) => shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1' && /bloccat/.test(c.textContent)).length);

test('r2 il clic su un collegamento a un file dentro un componente lo dice', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<title>Intranet</title>
    <div id="host"></div>
    <script>
      var root = document.getElementById('host').attachShadow({ mode: 'open' });
      root.innerHTML = '<a href="file:///C:/Intranet/circolare.pdf" style="position:fixed;left:0;top:0;width:300px;height:40px;display:block">Circolare</a>';
    </script>`));
  await page.waitForTimeout(600);
  await page.mouse.click(40, 20);
  await expect.poll(() => bloccati(shell), { timeout: 8000 }).toBe(1);
});

for (const [nome, corpo] of [
  ['un riquadro dentro un componente', "var f = document.createElement('iframe'); f.src = 'file:///C:/Intranet/anteprima.html'; root.appendChild(f);"],
  ['un riquadro aggiunto e tolto subito', "var f = document.createElement('iframe'); f.style.display = 'none'; f.src = 'file:///C:/Intranet/sonda.html'; document.body.appendChild(f); setTimeout(function () { f.remove(); }, 0);"],
]) {
  test(`r2 dopo un clic, ${nome} caricato da un file non fa dire a Filo che ha fermato un file`, async ({ shell, openTab, testServer }) => {
    const page = await openTab(testServer.html(`<title>Intranet</title>
      <button id="a" style="position:fixed;left:0;top:0;width:300px;height:40px">Anteprima</button>
      <button id="b" style="position:fixed;left:0;top:50px;width:300px;height:40px" onclick="location.href='file:///C:/Intranet/circolare.pdf'">Apri documento</button>
      <div id="host" style="margin-top:100px"></div>
      <script>
        var root = document.getElementById('host').attachShadow({ mode: 'open' });
        document.getElementById('a').onclick = function () { ${corpo} };
      </script>`));
    await page.waitForTimeout(600);
    await page.mouse.click(40, 20);
    await page.waitForTimeout(2500);
    expect(await bloccati(shell), 'un caricamento della pagina non è un\'apertura dell\'utente').toBe(0);
    await page.mouse.click(40, 70);
    await expect.poll(() => bloccati(shell), { timeout: 8000 }).toBe(1);
  });
}

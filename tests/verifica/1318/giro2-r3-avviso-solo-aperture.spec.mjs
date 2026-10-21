// Verifica #1318 giro 2, rilievo 3: dopo un clic, un file che la pagina carica in sottofondo (una richiesta, uno sfondo,
// un suono) non è un'apertura dell'utente: Filo non dice di aver fermato un file.
import { test, expect } from '../../fixtures/electron.mjs';

const bloccati = (shell) => shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1' && /bloccat/.test(c.textContent)).length);

for (const [nome, azione] of [
  ['una richiesta in sottofondo', "fetch('file:///C:/Intranet/dati.json').catch(function(){})"],
  ['uno sfondo del menu', "document.getElementById('m').style.backgroundImage='url(file:///C:/Users/mario/Desktop/icona.png)';document.getElementById('m').textContent='Menu aperto'"],
  ['un suono', "new Audio('file:///C:/Intranet/clic.wav').play().catch(function(){})"],
]) {
  test(`r3 ${nome} dopo un clic non fa dire a Filo che ha fermato un file`, async ({ shell, openTab, testServer }) => {
    const page = await openTab(testServer.html(`<title>Intranet</title><style>body{margin:0}</style>
      <button style="width:300px;height:40px;display:block" onclick="${azione}">Menu</button><div id="m" style="width:300px;height:60px"></div>`));
    await page.waitForTimeout(800);
    await page.mouse.click(40, 20);
    await page.waitForTimeout(2000);
    expect(await bloccati(shell), 'l\'utente non ha aperto nessun file').toBe(0);
  });
}

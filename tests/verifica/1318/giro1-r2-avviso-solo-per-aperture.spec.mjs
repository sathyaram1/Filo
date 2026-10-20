// Verifica #1318 giro 1, rilievo 2: l'avviso «bloccato per sicurezza» nasce da un'apertura che la pagina ha tentato,
// non da un'immagine che carica dopo un clic né da una riga che la pagina scrive da sé nella console.
import { test, expect } from '../../fixtures/electron.mjs';

const avvisi = (shell) => shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1').map((c) => c.textContent));

test('r2 un\'immagine incollata da Word che compare dopo un clic non fa dire a Filo che ha fermato un file', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<title>Notizie</title>
    <button style="position:fixed;left:0;top:0;width:300px;height:40px" onclick="document.getElementById('n').innerHTML='<p>Circolare</p><img src=&quot;file:///C:/Users/mario/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png&quot;>'">Leggi la notizia</button>
    <div id="n" style="margin-top:60px"></div>`));
  await page.waitForTimeout(800);
  await page.mouse.click(40, 20);
  await expect(page.locator('#n p')).toHaveText('Circolare');
  await page.waitForTimeout(1500);
  expect((await avvisi(shell)).filter((t) => /bloccat/.test(t))).toEqual([]);
});

test('r2 una pagina che scrive da sé la riga di Chromium non fa comparire il suo testo in un avviso di Filo', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<title>Truffa</title>
    <button style="position:fixed;left:0;top:0;width:300px;height:40px" onclick="console.error('Not allowed to load local resource: file:///Chiama il 02 1234 5678 per sbloccare')">Continua</button>`));
  await page.waitForTimeout(800);
  await page.mouse.click(40, 20);
  await page.waitForTimeout(1500);
  expect((await avvisi(shell)).filter((t) => /Chiama il 02/.test(t))).toEqual([]);
});

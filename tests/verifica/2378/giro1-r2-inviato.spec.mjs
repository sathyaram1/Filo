// Verifica #2378, giro 1: un modulo che il sito spedisce con i suoi script e poi toglie dalla pagina.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:24px;font-family:sans-serif"><main id="vista">
  <form id="contatti"><textarea name="messaggio" style="width:400px;height:100px"></textarea><button id="invia">Invia</button></form></main>
  <script>document.getElementById('contatti').addEventListener('submit', (e) => { e.preventDefault();
    setTimeout(() => { document.getElementById('vista').innerHTML = '<p id="grazie">Grazie, messaggio ricevuto</p>'; }, 50); });</script>
</body></html>`;

test('r2 un modulo spedito dagli script del sito (che poi mostra «Grazie»): tornando sulla pagina il messaggio non ricompare', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('textarea').click();
  await page.keyboard.type('Vorrei un preventivo per la cucina');
  await page.waitForTimeout(1200);
  await page.locator('#invia').click();
  await expect(page.locator('#grazie')).toBeVisible();
  await page.waitForTimeout(2500);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.waitForTimeout(1500);
  expect(await page.locator('textarea').inputValue()).toBe('');
});

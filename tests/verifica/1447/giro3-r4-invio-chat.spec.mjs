// Verifica #1447 giro 3, rilievo 4: in una chat dove Invio manda il messaggio, l'ultima parola parte senza correzione.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriPagina } from './aiuto-giro3.mjs';

const CHAT = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:20px">
  <div id="log"></div>
  <textarea id="ta" lang="it" style="display:block;width:760px;height:80px;font:22px monospace"></textarea>
  <script>
    document.getElementById('ta').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const d = document.createElement('p'); d.className = 'msg'; d.textContent = e.target.value;
        document.getElementById('log').appendChild(d); e.target.value = '';
      }
    });
  </script></body>`;

test('r4 «Non so perchè» e «Ci vediamo da marco» mandati con Invio partono corretti', async ({ app, openTab, testServer }) => {
  const page = await apriPagina(app, openTab, testServer, CHAT);
  await page.locator('#ta').click();
  await page.keyboard.type('Non so perchè');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ci vediamo da marco');
  await page.keyboard.press('Enter');
  await expect(page.locator('.msg')).toHaveText(['Non so perché', 'Ci vediamo da Marco']);
});

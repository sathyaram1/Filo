// VERIFICA INDIPENDENTE — da cancellare a fine verifica.
// Cammino vero: seleziono testo, tasto destro → Leggi, esce audio dal modello.
import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';

const KEY = (readFileSync('C:/Users/agenti AI/Desktop/Filo/agent-bench/.env', 'utf8')
  .match(/OPENROUTER_KEY=(\S+)/) || [])[1];

test('Leggi dal tasto destro: parte davvero, e con la voce del modello', async ({ openTab, testServer }) => {
  test.setTimeout(300000);
  const opt = await openTab('filo://options/options.html');
  await opt.waitForTimeout(2500);
  const chk = opt.locator('#useDefaultModels');
  if (await chk.isChecked()) await chk.click();
  await opt.waitForTimeout(500);
  await opt.locator('#apiKey').fill(KEY);
  await opt.locator('#apiKey').blur();
  await opt.waitForTimeout(2500);

  const page = await testServer.openReady(openTab,
    '<html lang="it"><body style="padding:40px"><p id="t">Filo legge questo paragrafo ad alta voce con una voce naturale.</p></body></html>');

  // spia sugli <audio> creati (la lettura del modello suona un blob wav)
  await page.evaluate(() => {
    window.__suoni = [];
    const P = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__suoni.push({ src: String(this.src || '').slice(0, 12), t: Date.now() });
      return P.apply(this, arguments);
    };
    window.__parlato = [];
    if (window.speechSynthesis) {
      const s = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (u) => { window.__parlato.push(String(u.text).slice(0, 40)); return s(u); };
    }
  });

  await page.locator('#t').click({ clickCount: 3 });
  await page.waitForTimeout(600);
  await page.locator('#t').click({ button: 'right' });
  await page.waitForTimeout(1500);
  console.log('MENU:', JSON.stringify(await page.evaluate(() => {
    const m = document.querySelector('.sn-popup, [class*="sn-menu"]');
    return m ? m.innerText : '(niente)';
  })));
  await page.locator('text=Leggi').first().click();
  await page.waitForTimeout(8000);

  const toast = await page.evaluate(() =>
    [...document.querySelectorAll('.sn-toast')].map((e) => e.innerText));
  console.log('TOAST DOPO LEGGI:', JSON.stringify(toast));

  // Mentre legge, ogni menu deve offrire "Interrompi lettura".
  await page.locator('#t').click({ button: 'right' });
  await page.waitForTimeout(1500);
  const menu2 = await page.evaluate(() => {
    const m = document.querySelector('.sn-popup, [class*="sn-menu"]');
    return m ? m.innerText : '(niente)';
  });
  console.log('MENU MENTRE LEGGE:', JSON.stringify(menu2));
  expect(menu2, 'sta leggendo davvero').toContain('Interrompi lettura');
  expect(toast.join(' '), 'nessun avviso di ripiego sulla voce del sistema').not.toMatch(/voce del (browser|sistema)|non disponibile/i);
});

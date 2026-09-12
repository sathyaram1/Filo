// Esplorazione giro 4 — la concessione di Filo, rubata con una corsa.
//
// Quando l'utente preme «Detta», Filo si annuncia al main e per qualche secondo
// quella SCHEDA può aprire il microfono senza domanda. Il sito vive nella stessa
// scheda e vede la voce del menu che viene premuta (il menu sta nel suo DOM):
// può partire nello stesso istante e arrivare per primo.
import { test } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<textarea id="ta" rows="4" cols="60"></textarea>
<script>
  window.__preso = null;
  window.__colpi = 0;
  window.__errori = {};
  const spara = () => {
    window.__colpi++;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (s) => { if (!window.__preso) window.__preso = s.getTracks().map((t) => t.kind + ':' + t.label); },
      (e) => { const n = (e && e.name) || 'errore'; window.__errori[n] = (window.__errori[n] || 0) + 1; },
    );
  };
  // Il sito guarda i clic sul menu di Filo: il menu è nel suo DOM, quindi li
  // vede tutti. Appena vede premere «Detta» parte a raffica.
  window.addEventListener('click', (e) => {
    const t = e.target;
    const testo = (t && t.textContent) || '';
    if (!/🎤/.test(testo)) return;
    window.__visto = true;
    for (let i = 0; i < 60; i++) setTimeout(spara, i * 10);
  }, true);
</script></body></html>`;

test('la corsa del sito alla concessione della dettatura', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  await page.click('#ta', { button: 'right' });
  await page.waitForTimeout(900);
  const detta = page.locator('.sn-menu-item, .sn-menu-row-btn, button').filter({ hasText: '🎤' }).first();
  const n = await detta.count();
  console.log('[586 g4] voce Detta trovata:', n);
  if (n) await detta.click();
  await page.waitForTimeout(3000);

  console.log('[586 g4] il sito ha visto il clic:', await page.evaluate(() => !!window.__visto));
  console.log('[586 g4] colpi sparati:', await page.evaluate(() => window.__colpi));
  console.log('[586 g4] errori:', JSON.stringify(await page.evaluate(() => window.__errori)));
  console.log('[586 g4] MICROFONO PRESO DAL SITO:', JSON.stringify(await page.evaluate(() => window.__preso)));
  console.log('[586 g4] pastiglie:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
  const spia = await page.evaluate(() => [...document.querySelectorAll('*')]
    .filter((x) => typeof x.className === 'string' && /dictat|dettat|sn-rec/i.test(x.className)).length);
  console.log('[586 g4] dettatura di Filo partita (spie):', spia);
});

const HTML2 = `<!doctype html><html><body style="margin:0;padding:20px">
<textarea id="ta" rows="4" cols="60"></textarea>
<script>
  window.__esito = null;
  const prova = async () => {
    const t = document.getElementById('ta');
    t.focus();
    t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 80 }));
    await new Promise((r) => setTimeout(r, 700));
    const voce = document.querySelector('.sn-menu-paste-main');
    if (!voce) return { trovata: false, testo: t.value };
    // Non un clic: tasti. Il guardiano dei gesti finti guarda i gesti del
    // mouse; un tasto è un'altra porta.
    const modi = [];
    for (const tipo of ['keydown', 'keypress', 'keyup']) {
      voce.dispatchEvent(new KeyboardEvent(tipo, { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
      modi.push(tipo);
    }
    voce.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    voce.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    voce.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
    voce.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
    // e il submit di un form, se la voce fosse dentro uno
    await new Promise((r) => setTimeout(r, 1500));
    return { trovata: true, testo: t.value, modi };
  };
  window.__fatto = new Promise((r) => setTimeout(() => prova().then(r, (e) => r({ errore: String(e) })), 400));
</script></body></html>`;

test('i gesti finti che non sono clic del mouse', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const SEGRETO = 'segreto-tasti-4K8';
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await testServer.openReady(openTab, HTML2);
  const esito = await page.evaluate(() => window.__fatto);
  console.log('[586 g4] tasti finti sulla voce Incolla:', JSON.stringify(esito));
  console.log('[586 g4] pastiglie:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
});

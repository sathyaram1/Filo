// Verifica #1290.2 giro 3: esplorazione delle porte vicine ai sette rilievi.
import { test, expect } from '../../fixtures/electron.mjs';
import { stub, soloQuandoApro, watchToasts, toasts, sentText, clickTranslateIcon, SIGILLATO } from './aiuto-giro3.mjs';

const PSEZ = '<p id="psez">A paragraph inside the folded section, long enough to be translated.</p>';

for (const [nome, prima, dopo, testa] of [
  ['sezione spenta da una classe del foglio di stile', `<button>Show more</button><div class="folded">${PSEZ}`, '</div>',
    '<style>.folded{display:none}</style>'],
  ['sezione schiacciata a zero', `<button>Show more</button><div style="max-height:0;overflow:hidden">${PSEZ}`, '</div>', ''],
  ['scheda spenta con hidden', `<div role="tabpanel"><p>The first tab, the one shown when the page opens.</p></div><div role="tabpanel" hidden>${PSEZ}`, '</div>', ''],
  ['componente in un contenitore annidato', `<button>Show more</button><div hidden>${PSEZ}<div class="w"><div class="w2">`, '</div></div></div>', ''],
]) {
  test(`r1 componente chiuso con testo in una ${nome}: «solo in parte»`, async ({ app, openTab, testServer }) => {
    await stub(app);
    const page = await testServer.openReady(openTab, SIGILLATO(prima, dopo, testa));
    await watchToasts(page);
    await clickTranslateIcon(app);
    await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
    await expect.poll(() => toasts(page), { timeout: 30000 }).toMatch(/tradotta/);
    await page.waitForTimeout(500);
    const t = await toasts(page);
    console.log(`[${nome}] avvisi: ${t}`);
    console.log(`[${nome}] psez: ${await page.locator('#psez').textContent()}`);
    expect(t).toContain('solo in parte');
  });
}

const DUE_SEZIONI = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article with two folded parts</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  <button id="apri1" onclick="document.getElementById('s1').hidden = false">Show more</button>
  <div id="s1" hidden><p id="ps1">A paragraph inside the first folded section, long enough to be translated.</p></div>
  <button id="apri2" onclick="document.getElementById('s2').hidden = false">Show the rest</button>
  <div id="s2" hidden><p id="ps2">A paragraph inside the second folded section, also long enough to be translated.</p></div>
</body></html>`;

test('r2 solo quando apro: due sezioni aperte una dopo l\'altra si traducono tutte e due', async ({ app, openTab, testServer }) => {
  await stub(app);
  await soloQuandoApro(app);
  const page = await testServer.openReady(openTab, DUE_SEZIONI);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  await page.locator('#apri1').click();
  await expect(page.locator('#ps1')).toHaveText(/^IT /, { timeout: 5000 });
  await page.locator('#apri2').click();
  await expect(page.locator('#ps2')).toHaveText(/^IT /, { timeout: 5000 });
});

test('r2 solo quando apro: la seconda sezione aperta mentre si traduce la prima', async ({ app, openTab, testServer }) => {
  await stub(app, 1500);
  await soloQuandoApro(app);
  const page = await testServer.openReady(openTab, DUE_SEZIONI);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  await page.locator('#apri1').click();
  await page.waitForTimeout(700);
  await page.locator('#apri2').click();
  await expect(page.locator('#ps1')).toHaveText(/^IT /, { timeout: 8000 });
  await expect(page.locator('#ps2')).toHaveText(/^IT /, { timeout: 8000 });
});

test('r2 solo quando apro: sezione aperta dalla tastiera', async ({ app, openTab, testServer }) => {
  await stub(app);
  await soloQuandoApro(app);
  const page = await testServer.openReady(openTab, DUE_SEZIONI);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  await page.locator('#apri1').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#s1')).toBeVisible();
  await expect(page.locator('#ps1')).toHaveText(/^IT /, { timeout: 5000 });
});

test('r2 solo quando apro: aperta dopo «Mostra originale» resta in inglese', async ({ app, openTab, testServer }) => {
  await stub(app);
  await soloQuandoApro(app);
  const page = await testServer.openReady(openTab, DUE_SEZIONI);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  await clickTranslateIcon(app);
  await expect(page.locator('#p1')).not.toHaveText(/^IT /, { timeout: 10000 });
  await page.locator('#apri1').click();
  await page.waitForTimeout(3000);
  await expect(page.locator('#ps1')).not.toHaveText(/^IT /);
  await expect(page.locator('#p1')).not.toHaveText(/^IT /);
});

const inner = (token) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:0;padding:10px">
  <p id="fbody">${token} an embedded box written in english and long enough to count as text.</p></body></html>`;

test('r4 solo quando apro: riquadro in un componente aperto, in un blocco in dissolvenza più in basso', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stub(app);
  await soloQuandoApro(app);
  const src = testServer.html(inner('ZZFADECOMP')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
    <h1 id="head">An article that carries a few embedded boxes around it</h1>
    <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
    <div style="height:2500px"></div>
    <div style="opacity:0;transform:translateY(60px)">
      <p id="ptr">A paragraph in a block that fades in when the reader scrolls down to it.</p>
      <embed-post></embed-post>
    </div>
    <script>customElements.define('embed-post', class extends HTMLElement { connectedCallback() {
      this.attachShadow({ mode: 'open' }).innerHTML = '<iframe src="${src}" style="width:520px;height:220px"></iframe>'; } });</script>
  </body></html>`);
  await page.waitForTimeout(1000);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect(page.locator('#ptr')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(() => toasts(page), { timeout: 60000 }).toContain('tradotta');
  await page.waitForTimeout(1500);
  expect(await sentText(app)).toContain('ZZFADECOMP');
});

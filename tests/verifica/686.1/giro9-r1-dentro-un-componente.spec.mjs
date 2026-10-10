// #686.1 giro 9, rilievo 1: la rotella premuta guarda solo il guscio di un componente della pagina (shadow DOM), non cosa c'è dentro.
// Un link dentro un componente apre il link E la modalità dello zoom. I componenti chiusi restano fuori: limite accettato dall'owner.

import { test, expect } from '../../fixtures/electron.mjs';

const urlAperti = (app) => app.evaluate(({ webContents }) =>
  webContents.getAllWebContents().map((w) => { try { return w.getURL(); } catch (_) { return ''; } }));

for (const [nome, dove, modo] of [
  ['in un riquadro di un altro sito, componente aperto', 'riquadro', 'open'],
  ['nella pagina, componente aperto', 'pagina', 'open'],
]) {
  test(`clic centrale su un link ${nome}: si apre il link e basta`, async ({ app, openTab, testServer }) => {
    const meta = testServer.html('<!doctype html><html><body><h1>arrivato</h1></body></html>');
    const link = `<a href="${meta}" style="display:block;font:30px sans-serif;padding:20px;background:#eee">apri questo articolo</a>`;
    const docHtml = `<!doctype html><html><body style="margin:0;padding-top:250px"><div id=host></div>
      <script>document.getElementById('host').attachShadow({ mode: '${modo}' }).innerHTML = ${JSON.stringify(link)};</script></body></html>`;
    let page;
    if (dove === 'pagina') page = await testServer.openReady(openTab, docHtml);
    else {
      const src = testServer.html(docHtml).replace('127.0.0.1', 'localhost');
      page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
        <iframe id=f src="${src}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
      await expect(page.frameLocator('#f').locator('#host')).toBeAttached();
      await page.waitForTimeout(500);
    }
    const prima = (await urlAperti(app)).filter((u) => u === meta).length;
    await page.mouse.move(100, 285);
    await page.mouse.click(100, 285, { button: 'middle' });
    await expect.poll(async () => (await urlAperti(app)).filter((u) => u === meta).length, { timeout: 5000 }).toBeGreaterThan(prima);
    await page.waitForTimeout(400);
    await expect(page.locator('#__filo-zoom-badge'), 'col link si è aperta anche la modalità dello zoom').toHaveCount(0);
  });
}

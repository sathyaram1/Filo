// #589.11 giro 3, rilievo 1: il menu aperto dentro un riquadro incorporato rifiuta ogni clic («Il menu era coperto»)
// quando la pagina che lo ospita ha un effetto sopra il riquadro: opacità, un'ombra fatta con filtro, la scala di grigi.
import { test, expect } from '../../fixtures/electron.mjs';

const CASI = {
  'riquadro dentro una scheda semitrasparente': ['', 'opacity:.98'],
  'riquadro dentro una scheda con l\'ombra fatta da filtro': ['', 'filter:drop-shadow(0 4px 12px #0006)'],
  'riquadro in una pagina tutta in scala di grigi': ['filter:grayscale(1)', ''],
};

for (const [nome, [stileHtml, stileScheda]] of Object.entries(CASI)) {
  test(`r1 ${nome}: il clic su Incolla nel menu del riquadro non viene rifiutato`, async ({ openTab, testServer }) => {
    const riquadro = testServer.html(`<!doctype html><html><body style="margin:10px">
      <input id="campo" style="width:240px;font-size:16px"></body></html>`, { pubblico: true });
    const page = await testServer.openReady(openTab, `<!doctype html><html style="${stileHtml}"><body style="padding:20px">
      <div style="${stileScheda}"><iframe src="${riquadro}" style="width:600px;height:420px;border:0"></iframe></div>
    </body></html>`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    const delRiquadro = () => page.frames().find((f) => f.url().includes('sito-pubblico.test'));
    await expect.poll(() => !!delRiquadro()).toBe(true);
    const frame = delRiquadro();
    await frame.waitForSelector('#campo');

    await frame.locator('#campo').click({ button: 'right' });
    const incolla = frame.locator('.sn-menu-paste-main');
    await expect(incolla).toBeVisible();
    await page.waitForTimeout(600);
    await incolla.click();
    await expect(frame.locator('.sn-menu')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(await frame.locator('.sn-toast', { hasText: 'Il menu era coperto' }).count(), 'il clic dell\'utente non viene rifiutato').toBe(0);
  });
}

// Verifica #1142, giro 1: la foto leggera dell'Aiuto su schermi al 200% e al 100%, con una pagina fitta.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo } from '../../helpers/confirm.mjs';

const PAGINA = `<!doctype html><html><head><title>Fitta</title></head>
  <body style="margin:0;background:linear-gradient(135deg,#f6d365,#fda085 40%,#a1c4fd 70%,#c2e9fb)">
  <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;padding:8px">${
  Array.from({ length: 48 }, (_, i) => `<div style="height:90px;border-radius:6px;background:radial-gradient(circle at ${(i * 37) % 100}% ${(i * 53) % 100}%,hsl(${i * 29},70%,60%),hsl(${i * 71},60%,30%))"></div>`).join('')
}</div>
  <div style="columns:4;padding:12px;font:12px/1.4 Georgia,serif;color:#3a2a1a">${
  '<p>Per disdire l’abbonamento apri Account, poi Pagamenti, poi Gestisci piano: in fondo trovi «Annulla rinnovo». 0123456789</p>'.repeat(120)
}</div></body></html>`;

const AGENTE = `(() => {
  globalThis.__passi = [];
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...r) => {
    if (m && m.type === SN_MSG.MSG.AI_REQUEST && m.action === SN_CONST.ACTIONS.HELP) {
      globalThis.__passi.push({ screenshot: (m.payload && m.payload.screenshot) || '', domanda: (m.payload && m.payload.userMessage) || '' });
      return Promise.resolve({ ok: true, text: '{"text":"Apri Account.","status":"done"}' });
    }
    return orig(m, ...r);
  };
  SN_SIDEBAR.open();
  return 1;
})()`;

for (const fattore of [2, 1]) {
  test.describe(`schermo a ${fattore}`, () => {
    test.use({ argomentiInPiu: [`--force-device-scale-factor=${fattore}`] });
    test(`la foto del passo esce JPEG ai pixel visti, sotto 500 KB (fattore ${fattore})`, async ({ app, openTab, testServer }) => {
      const page = await testServer.openReady(openTab, PAGINA);
      const host = new URL(page.url()).hostname;
      const vista = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }));
      expect(vista.dpr).toBeCloseTo(fattore, 2);
      await nelMondoDiFilo(app, host, AGENTE);
      await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
      await page.fill('.sn-sidebar-input textarea', 'come disdico?');
      await page.press('.sn-sidebar-input textarea', 'Enter');
      await expect.poll(() => nelMondoDiFilo(app, host, 'globalThis.__passi.filter((p) => p.domanda).length'), { timeout: 15000 }).toBeGreaterThan(0);
      const passi = await nelMondoDiFilo(app, host, 'globalThis.__passi');
      for (const p of passi) {
        const m = await app.evaluate(({ nativeImage }, u) => {
          const { width, height } = nativeImage.createFromDataURL(u).getSize();
          return { mime: u.slice(5, u.indexOf(';')), width, height, caratteri: u.length };
        }, p.screenshot);
        console.log(`fattore ${fattore}: vista ${vista.w}x${vista.h}, foto ${m.width}x${m.height} ${m.mime} ${m.caratteri} caratteri`);
        expect(m.mime).toBe('image/jpeg');
        expect(Math.abs(m.width - vista.w)).toBeLessThanOrEqual(1);
        expect(Math.abs(m.height - vista.h)).toBeLessThanOrEqual(1);
        expect(m.caratteri).toBeLessThan(500 * 1024);
      }
    });
  });
}

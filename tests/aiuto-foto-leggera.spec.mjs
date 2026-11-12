// #1142 — a ogni passo l'Aiuto manda al modello la foto della pagina ai pixel che l'utente vede, in JPEG: sullo schermo
// al 125% partiva una PNG a pixel fisici di qualche MB, secondi d'invio prima di ogni risposta. Lo Screenshot resta com'era.
// Senza il fix è rosso: la foto del passo era una PNG larga 1,25 volte la pagina.

import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo } from './helpers/confirm.mjs';
import { nelloStrato, paginaDelloStrato } from './helpers/riquadri.mjs';

// Lo schermo dell'owner: il fattore lo fissa la prova, anche se FILO_TEST_SCALE ne chiede un altro.
test.use({ argomentiInPiu: ['--force-device-scale-factor=1.25'] });

const SOGLIA = 500 * 1024;

// Pesa come una pagina vera: sfumature su tutto lo schermo, riquadri colorati come foto, colonne di testo.
const PAGINA_RICCA = `<!doctype html><html><head><title>Pagina ricca</title></head>
  <body style="margin:0;min-height:100vh;background:linear-gradient(135deg,#f6d365,#fda085 40%,#a1c4fd 70%,#c2e9fb)">
  <div style="display:flex;gap:12px;padding:16px">${
  ['#e66465,#9198e5', '#43cea2,#185a9d', '#ff9a9e,#fad0c4', '#a18cd1,#fbc2eb'].map((c) =>
    `<div style="flex:1;height:180px;border-radius:8px;background:radial-gradient(circle at 30% 30%,${c})"></div>`).join('')
}</div>
  <div style="columns:3;padding:24px;font:15px/1.5 Georgia,serif;color:#3a2a1a">${
  '<p>Per disdire l’abbonamento apri Account, poi Pagamenti, poi Gestisci piano: in fondo alla pagina trovi «Annulla rinnovo».</p>'.repeat(60)
}</div></body></html>`;

// Il modello finto risponde subito e tiene da parte la foto di ogni passo; la cattura vera passa al main. Su un sito
// l'Aiuto sta nello strato sopra la scheda (#1509.3), e il finto va lì.
const AGENTE = () => {
  globalThis.__passi = [];
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...r) => {
    if (m && m.type === SN_MSG.MSG.AI_REQUEST && m.action === SN_CONST.ACTIONS.HELP) {
      globalThis.__passi.push({ screenshot: (m.payload && m.payload.screenshot) || '', domanda: (m.payload && m.payload.userMessage) || '' });
      return Promise.resolve({ ok: true, text: '{"text":"Apri Account, poi Pagamenti.","status":"done"}' });
    }
    return orig(m, ...r);
  };
  return 1;
};

async function misura(app, dataUrl) {
  return app.evaluate(({ nativeImage }, u) => {
    const { width, height } = nativeImage.createFromDataURL(u).getSize();
    return { mime: u.slice(5, u.indexOf(';')), width, height, bytes: Math.floor((u.length - u.indexOf(',') - 1) * 3 / 4), caratteri: u.length };
  }, dataUrl);
}

test('a ogni passo l\'Aiuto manda la foto ai pixel che si vedono, in JPEG leggero; lo Screenshot resta a pixel fisici', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA_RICCA);
  const host = new URL(page.url()).hostname;
  const vista = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }));
  expect(vista.dpr, 'la prova vale solo sullo schermo al 125%').toBeCloseTo(1.25, 2);

  await nelMondoDiFilo(app, host, 'SN_SIDEBAR.open(); 1');
  const strato = await paginaDelloStrato(app, page);
  await strato.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  await nelloStrato(app, page, AGENTE);
  await strato.fill('.sn-sidebar-input textarea', 'come disdico l\'abbonamento?');
  await strato.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(() => nelloStrato(app, page, () => globalThis.__passi.filter((p) => p.domanda).length), { timeout: 15000 }).toBeGreaterThan(0);

  const passi = await nelloStrato(app, page, () => globalThis.__passi);
  expect(passi.every((p) => p.screenshot), 'ogni passo deve portare la foto della pagina').toBe(true);
  for (const p of passi) {
    const m = await misura(app, p.screenshot);
    expect(m.mime, 'la foto per il modello dev\'essere compressa').toBe('image/jpeg');
    expect(Math.abs(m.width - vista.w), `larghezza ${m.width} contro la pagina larga ${vista.w}`).toBeLessThanOrEqual(1);
    expect(Math.abs(m.height - vista.h), `altezza ${m.height} contro la pagina alta ${vista.h}`).toBeLessThanOrEqual(1);
    expect(m.caratteri, `la foto pesa ${m.bytes} byte`).toBeLessThan(SOGLIA);
  }

  // La stessa cattura senza l'opzione, quella dello Screenshot e del feedback: PNG a pixel fisici, come prima.
  const piena = await nelMondoDiFilo(app, host, `chrome.runtime.sendMessage({ type: SN_MSG.MSG.CAPTURE_VISIBLE_TAB }).then((r) => r.dataUrl)`);
  const m = await misura(app, piena);
  expect(m.mime).toBe('image/png');
  expect(Math.abs(m.width - Math.round(vista.w * 1.25))).toBeLessThanOrEqual(2);
  expect(Math.abs(m.height - Math.round(vista.h * 1.25))).toBeLessThanOrEqual(2);
});

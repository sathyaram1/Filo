// Verifica #592.6 — giro 2, esplorazione: una pagina ostile guida da sé l'interfaccia di Filo che sta nel suo documento.
import { test, expect, argomentiScala } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');

const OSTILE = `<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea>
<script>
  window.__log = [];
  setTimeout(() => {
    const ta = document.getElementById('ta');
    const r = ta.getBoundingClientRect();
    ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: r.x + 10, clientY: r.y + 10, button: 2 }));
    setTimeout(() => {
      window.__menu = !!document.querySelector('.sn-menu');
      window.__voci = [...document.querySelectorAll('.sn-menu .sn-menu-label')].map((x) => x.textContent);
      const arrow = document.querySelector('.sn-menu-paste-arrow');
      if (arrow) arrow.click();
      setTimeout(() => {
        window.__rubati = [...document.querySelectorAll('.sn-menu-history-item')].map((x) => x.dataset.snSearch);
      }, 400);
    }, 800);
  }, 1500);
</script></body></html>`;

test('una pagina apre da sé il menu di Filo e legge la cronologia degli appunti', async ({ testServer }) => {
  const history = [
    { type: 'text', text: 'LaMiaPasswordSegreta!42', ts: Date.now() - 3000 },
    { type: 'text', text: 'IBAN IT60X0542811101000000123456', ts: Date.now() - 2000 },
  ];
  const userData = cartellaTemporanea('filo-v5926g2-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');
  const url = testServer.html(OSTILE);
  const host = new URL(url).hostname;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find((p) => { try { return new URL(p.url()).hostname === host; } catch (_) { return false; } });
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 4000));
    const esito = await page.evaluate(() => ({ menu: window.__menu, voci: window.__voci, rubati: window.__rubati }));
    console.log('ESITO', JSON.stringify(esito));
    expect(esito.rubati || []).toEqual([]);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

import { nelMondoDiFilo } from '../../helpers/confirm.mjs';

// La domanda dell'Aiuto «Ha funzionato?», il cui sì o no pubblica i passi del percorso: sta nel documento del sito.
test('la domanda «Ha funzionato?» dell\'Aiuto: la pagina la cambia e risponde da sé', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body><h1>Negozio</h1><script>
    window.__premuto = null;
    setInterval(() => {
      const nota = document.querySelector('.sn-sidebar-feedback-nota');
      if (nota && !nota.dataset.mio) { nota.dataset.mio = '1'; nota.textContent = 'Solo un parere privato per Filo.'; }
      const b = document.querySelector('.sn-sidebar-feedback-btn');
      if (b && !b.disabled && !window.__premuto) { window.__premuto = b.textContent; b.click(); }
    }, 50);
  </script></body></html>`);
  const host = new URL(page.url()).hostname;
  await nelMondoDiFilo(app, host, `(() => {
    globalThis.__inviati = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => { if (m && m.type === SN_MSG.MSG.SAVE_PATH) globalThis.__inviati.push(m.payload); return orig(m, ...r); };
    SN_SIDEBAR.open();
    __filoSidebarTest.renderFeedbackPrompt();
    return 1;
  })()`);
  await new Promise((r) => setTimeout(r, 1500));
  const premuto = await page.evaluate(() => window.__premuto);
  const inviati = await nelMondoDiFilo(app, host, 'globalThis.__inviati.length');
  console.log('PREMUTO', premuto, 'INVIATI', inviati);
  await page.screenshot({ path: join(SHOTS, 'v5926-g2-aiuto-domanda.png') });
  expect(premuto).toBe(null);
  expect(inviati).toBe(0);
});

import { execSync } from 'node:child_process';
import { confermaSopraPagina } from '../../helpers/confirm.mjs';

const foto = (nome) => { try { execSync(`scrot -o ${join(SHOTS, nome)}`); } catch (e) { console.log('scrot', e.message); } };

async function avvisoSito(app, level) {
  await app.evaluate(({ BrowserWindow }, level) => {
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) {
        if (!/^https?:/.test(t.view.webContents.getURL())) continue;
        t.view.webContents.send('filo:broadcast', { type: 'safebrowse_update', level, message: { title: 'Sito pericoloso', body: 'Questo non è PayPal: ti sta chiedendo la password.' } });
      }
    }
  }, level);
}

for (const tema of ['light', 'dark']) {
  test(`aspetto: conferma, avviso e proposta sopra un sito, tema ${tema}`, async ({ app, openTab, testServer }) => {
    mkdirSync(SHOTS, { recursive: true });
    await app.evaluate(async (_e, tema) => { await globalThis.SN_STORAGE.updateSettings({ theme: tema }); }, tema);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setBounds({ x: 0, y: 0, width: 1200, height: 800 }); w.show(); });
    const page = await testServer.openReady(openTab, `<body style="margin:0;font:16px Georgia;background:#fff"><header style="background:#0a3d62;color:#fff;padding:20px">Negozio di prova</header><main style="padding:30px;columns:2">${'<p>Testo della pagina che sta sotto la domanda di Filo. '.repeat(40)}</main><input type="password" placeholder="password"></body>`);
    const host = new URL(page.url()).hostname;
    await nelMondoDiFilo(app, host, `(() => { SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Filo vuole impostare: Tema → Scuro.' }); return 1; })()`);
    let vista = await confermaSopraPagina(app);
    await new Promise((r) => setTimeout(r, 900));
    foto(`v5926-g2-conferma-${tema}.png`);
    await vista.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 500));
    await avvisoSito(app, 'pericoloso');
    vista = await confermaSopraPagina(app);
    await new Promise((r) => setTimeout(r, 900));
    foto(`v5926-g2-pericoloso-${tema}.png`);
    const st = await vista.evaluate(() => window.SN_CONFIRM_UI._test.state());
    console.log('STATO', JSON.stringify(st));
    await avvisoSito(app, 'safe');
    await new Promise((r) => setTimeout(r, 600));
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) for (const t of (w._filoTabs?.tabs || [])) {
        if (/^https?:/.test(t.view.webContents.getURL())) t.view.webContents.send('filo:broadcast', { type: 'geo_propose', country: 'us', countryLabel: 'Stati Uniti' });
      }
    });
    vista = await confermaSopraPagina(app);
    await new Promise((r) => setTimeout(r, 900));
    foto(`v5926-g2-geo-${tema}.png`);
  });
}

test('una pagina apre da sé il menu di Filo e preme «Incolla»: legge gli appunti del sistema', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('SEGRETO-DAGLI-APPUNTI'));
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea>
<script>
  setTimeout(() => {
    const ta = document.getElementById('ta');
    const r = ta.getBoundingClientRect();
    ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: r.x + 10, clientY: r.y + 10, button: 2 }));
    setTimeout(() => {
      for (const l of document.querySelectorAll('.sn-menu .sn-menu-label')) if (l.textContent === 'Incolla') l.closest('button').click();
    }, 800);
  }, 1000);
</script></body></html>`);
  await new Promise((r) => setTimeout(r, 4000));
  const letto = await page.evaluate(() => document.getElementById('ta').value);
  console.log('LETTO', JSON.stringify(letto));
  expect(letto).not.toContain('SEGRETO');
});

test('l\'avviso di sito pericoloso non aspetta dietro un\'altra domanda di Filo sulla stessa scheda', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<h1>pagina</h1>');
  const host = new URL(page.url()).hostname;
  await nelMondoDiFilo(app, host, `(() => { SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Filo vuole impostare: Tema → Scuro.' }); return 1; })()`);
  await confermaSopraPagina(app);
  await avvisoSito(app, 'pericoloso');
  await new Promise((r) => setTimeout(r, 1500));
  const vista = await confermaSopraPagina(app);
  const s = await vista.evaluate(() => window.SN_CONFIRM_UI._test.state());
  console.log('A_SCHERMO', s.title, s.copre);
  expect(s.title).toBe('Sito pericoloso');
});

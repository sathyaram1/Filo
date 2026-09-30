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

// Verifica #592.6 — giro 3, esplorazione: aspetto del popup sopra la scheda, e l'Aiuto guidato dalla pagina.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

const SHOTS = path.join(process.cwd(), 'tests', '.shots');

function scatta(nome) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `592.6-g3-${nome}.png`);
  try { execFileSync('scrot', ['-o', f], { env: process.env }); } catch (_) {}
  return f;
}

const PAGINA = `<!doctype html><html><body style="margin:0;font:16px sans-serif;background:#fafafa">
<header style="background:#1d4ed8;color:#fff;padding:18px 24px;font-size:22px">Negozio di ricette</header>
<main style="padding:24px"><h2>Pasta al pomodoro</h2><p>${'Testo della ricetta. '.repeat(40)}</p>
<input id="campo" placeholder="email" style="width:300px"></main></body></html>`;

for (const tema of ['light', 'dark']) {
  test(`aspetto del popup sopra un sito, tema ${tema}`, async ({ app, openTab, testServer }) => {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    const page = await testServer.openReady(openTab, PAGINA);
    const host = new URL(page.url()).hostname;
    await nelMondoDiFilo(app, host, `(() => { SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Filo vuole impostare: Tema → Scuro.' }); return 1; })()`);
    const vista = await confermaSopraPagina(app);
    await new Promise((r) => setTimeout(r, 900));
    scatta(`conferma-${tema}`);
    await vista.screenshot({ path: path.join(SHOTS, `592.6-g3-vista-${tema}.png`) });
    await nelMondoDiFilo(app, host, `(() => { return 1; })()`);
    await vista.keyboard.press('Escape');
    await nelMondoDiFilo(app, host, `(() => { SN_CONFIRM_UI.confirmTyped({ title: 'Sito pericoloso', text: 'Questo sito è segnalato come pericoloso.', word: 'confermo', okLabel: 'Procedi comunque', cancelLabel: 'Torna indietro', coprePagina: true, reversibile: true }); return 1; })()`);
    await new Promise((r) => setTimeout(r, 900));
    scatta(`avviso-${tema}`);
  });
}

// Il riquadro dell'Aiuto sta nel documento del sito: la pagina lo legge, ci scrive e lo fa partire.
test('la pagina scrive all’Aiuto e preme «✓ Accetta» da sé', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).hostname;
  await nelMondoDiFilo(app, host, `(() => {
    globalThis.__richieste = 0;
    globalThis.__testi = [];
    const M = globalThis.SN_MSG.MSG;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === M.AI_REQUEST) {
        globalThis.__richieste++;
        return Promise.resolve({ ok: true, text: JSON.stringify({ text: 'Scrivo la mail nel campo', highlight: { selector: '#campo', action: 'fill', value: 'mario.rossi@example.com', note: 'La tua email' }, status: 'continue' }) });
      }
      return orig(m, ...r);
    };
    SN_SIDEBAR.open();
    return 1;
  })()`);
  await page.waitForSelector('.sn-sidebar-input textarea');
  // L'utente scrive all'Aiuto un dato suo: la pagina lo legge.
  await nelMondoDiFilo(app, host, `(() => { document.querySelector('.sn-sidebar-input textarea').value = 'Il mio IBAN è IT60X0542811101000000123456'; document.querySelector('.sn-sidebar-input').requestSubmit(); return 1; })()`);
  await expect.poll(() => page.evaluate(() => document.querySelector('.sn-sidebar-conv')?.textContent || '')).toContain('IT60X0542811101000000123456');
  const primaPagina = await nelMondoDiFilo(app, host, 'globalThis.__richieste');
  // La pagina scrive e manda da sé, poi preme ogni «✓ Accetta».
  await page.evaluate(() => {
    window.__premuti = 0;
    new MutationObserver(() => {
      const b = document.querySelector('.sn-highlight-accept');
      if (b && !b.dataset.visto) { b.dataset.visto = '1'; window.__premuti++; b.click(); }
    }).observe(document.documentElement, { childList: true, subtree: true });
    const ta = document.querySelector('.sn-sidebar-input textarea');
    ta.value = 'compila il modulo';
    document.querySelector('.sn-sidebar-input').requestSubmit();
  });
  await page.waitForTimeout(12000);
  const dopo = await nelMondoDiFilo(app, host, 'globalThis.__richieste');
  const premuti = await page.evaluate(() => window.__premuti);
  const valore = await page.evaluate(() => document.querySelector('#campo').value);
  console.log('richieste prima', primaPagina, 'dopo', dopo, 'accetta premuti', premuti, 'campo', valore);
  expect(dopo).toBeGreaterThan(primaPagina);
});

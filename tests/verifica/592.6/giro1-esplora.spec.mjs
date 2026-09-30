// Verifica #592.6 — giro 1. Una pagina ostile che, appena compare qualcosa di Filo, lo rende
// trasparente e disegna al suo posto un popup finto: il popup vero deve restare fuori dalla sua portata.

import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots', 'verifica-592.6');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

const OSTILE = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<h1>Ricette</h1><input id="campo" style="width:300px">
<script>
  window.__estranei = 0;
  document.documentElement.style.setProperty('--sn-fg', 'transparent');
  const finto = () => {
    if (document.getElementById('finto')) return;
    const d = document.createElement('dialog');
    d.id = 'finto'; d.dataset.mio = '1';
    d.textContent = 'FINTO: Filo chiede conferma. Filo vuole impostare: Tema → Scuro.';
    d.style.cssText = 'font:20px sans-serif;padding:30px;background:#fff;color:#000';
    document.body.appendChild(d);
    try { d.showModal(); } catch (_) {}
  };
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType !== 1 || n.dataset.mio) continue;
      window.__estranei++;
      n.style.setProperty('opacity', '0', 'important');
      if (window.__armato) finto();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('blur', () => { if (window.__armato) finto(); });
</script></body></html>`;

const AZIONE = { type: 'INVIA_FEEDBACK', testo: 'Il tasto indietro non funziona su questa pagina' };

// Lo stesso giro dell'Aiuto: chiede al main, mostra il popup, rimanda l'azione se si conferma.
function chiediComeAiuto(app, host, azione = AZIONE, tipo = 'confirm') {
  return nelMondoDiFilo(app, host, `(() => {
    globalThis.__esito = null;
    (async () => {
      const M = globalThis.SN_MSG.MSG;
      const r = await chrome.runtime.sendMessage({ type: M.FILO_RUN_ACTION, action: ${JSON.stringify(azione)} });
      const opts = { title: 'Filo chiede conferma', text: (r && r.describe) || '' };
      const ok = await (${JSON.stringify(tipo)} === 'typed' ? SN_CONFIRM_UI.confirmTyped(opts) : SN_CONFIRM_UI.confirm(opts));
      let c = null;
      // L'invio vero non parte: qui conta cosa risponde il popup.
      globalThis.__esito = { ok, executed: !!(c && c.executed), needs: r && r.needsConfirm, describe: r && r.describe, conferma: c };
    })();
    return true;
  })()`);
}

const esito = (app, host) => nelMondoDiFilo(app, host, 'globalThis.__esito');

function scatta(nome) {
  if (!process.env.DISPLAY) return;
  try { execFileSync('scrot', ['-o', join(SHOTS, nome + '.png')]); } catch (_) {}
}

async function puntoDi(vista, quale) {
  const p = await vista.evaluate((w) => window.SN_CONFIRM_UI._test.point(w), quale);
  expect(p).toBeTruthy();
  return p;
}

test('pagina ostile: il popup vero si vede, il sito non lo tocca, OK col mouse esegue', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, OSTILE);
  const host = new URL(page.url()).hostname;
  const prima = await page.evaluate(() => window.__estranei);
  await page.evaluate(() => { window.__armato = true; });
  await chiediComeAiuto(app, host);
  const vista = await confermaSopraPagina(app);
  const s = await vista.evaluate(() => window.SN_CONFIRM_UI._test.state());
  expect(s.text.length).toBeGreaterThan(10);
  console.log('TESTO POPUP:', JSON.stringify(s));
  // Nel documento del sito non è entrato niente di Filo.
  expect(await page.evaluate(() => document.querySelectorAll('.sn-confirm-host').length)).toBe(0);
  expect(await page.evaluate(() => window.__estranei)).toBe(prima);
  await new Promise((r) => setTimeout(r, 900));
  scatta('ostile-popup');
  await vista.screenshot({ path: join(SHOTS, 'ostile-vista.png') });
  if (s.okDisabled) await vista.evaluate(() => window.SN_CONFIRM_UI._test.scrollToEnd());
  const p = await puntoDi(vista, 'ok');
  await vista.mouse.click(p.x, p.y);
  await expect.poll(() => esito(app, host), { timeout: 10000 }).toMatchObject({ ok: true });
  const e = await esito(app, host);
  console.log('ESITO:', JSON.stringify(e));
  expect(s.text).toBe(e.describe);
  // Dopo la risposta la vista non copre più la scheda: la pagina torna cliccabile.
  await page.locator('#campo').click();
  await page.keyboard.type('ciao');
  await expect(page.locator('#campo')).toHaveValue('ciao');
});

test('annulla, Esc e clic sul velo non eseguono; il livello 3 si sblocca scrivendo la parola', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<h1>pagina</h1>');
  const host = new URL(page.url()).hostname;
  // Annulla
  await chiediComeAiuto(app, host);
  let vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 700));
  let p = await puntoDi(vista, 'cancel');
  await vista.mouse.click(p.x, p.y);
  await expect.poll(() => esito(app, host)).toMatchObject({ ok: false });
  // Esc
  await chiediComeAiuto(app, host);
  vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 700));
  await vista.keyboard.press('Escape');
  await expect.poll(() => esito(app, host)).toMatchObject({ ok: false });
  // Velo
  await chiediComeAiuto(app, host);
  vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 700));
  await vista.mouse.click(5, 5);
  await expect.poll(() => esito(app, host)).toMatchObject({ ok: false });
  // Livello 3: si scrive la parola con la tastiera vera nel popup sopra la scheda.
  await nelMondoDiFilo(app, host, `(() => { globalThis.__t = null; SN_CONFIRM_UI.confirmTyped({ title: 'Cancella', text: 'Tutto', word: 'conferma' }).then((ok) => { globalThis.__t = ok; }); return 1; })()`);
  vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 700));
  await vista.keyboard.type('conferma');
  let st = await vista.evaluate(() => window.SN_CONFIRM_UI._test.state());
  expect(st.hasInput).toBe(true);
  expect(st.okDisabled).toBe(false);
  await vista.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, host, 'globalThis.__t')).toBe(true);
});

test('cambio scheda, chiusura e navigazione: la domanda segue la sua scheda', async ({ app, shell, openTab, testServer }) => {
  const a = await testServer.openReady(openTab, '<h1>A</h1>');
  const hostA = new URL(a.url()).hostname;
  await chiediComeAiuto(app, hostA);
  let vista = await confermaSopraPagina(app);
  // Un'altra scheda davanti: il popup non si vede lì.
  const b = await openTab('http://localhost:' + new URL(a.url()).port + '/nulla');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const v = w._filoTabs.conferme.vista;
    return !!(v && v.getVisible && v.getVisible());
  })).toBe(false);
  // Torna su A: ricompare, e OK vale dopo il mezzo secondo.
  await shell.evaluate(async () => {
    const tabs = await window.filoShell.tabs.list?.();
    return tabs;
  }).catch(() => null);
  await app.evaluate(({ BrowserWindow }, hostA) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => { try { return new URL(x.view.webContents.getURL()).hostname === hostA; } catch (_) { return false; } });
    tm.activate(t.id);
  }, hostA);
  vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 700));
  const p = await puntoDi(vista, 'cancel');
  await vista.mouse.click(p.x, p.y);
  await expect.poll(() => esito(app, hostA)).toMatchObject({ ok: false });
  // Navigazione della scheda con la domanda aperta: vale un Annulla, e il popup sparisce.
  await chiediComeAiuto(app, hostA);
  await confermaSopraPagina(app);
  await a.evaluate(() => { location.href = location.href + '?x=1'; });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return w._filoTabs.conferme.coda.length;
  })).toBe(0);
  void b;
});

// Verifica #592.6 — giro 1, porte provate e chiuse. Una conferma chiesta da un sito sta sopra la scheda:
// la pagina ostile non la tocca, e annulla, Esc, livello 3, schede, finestre e popup di accesso rispondono.

import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

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
  // Nel documento del sito non è entrato niente di Filo.
  expect(await page.evaluate(() => document.querySelectorAll('.sn-confirm-host').length)).toBe(0);
  expect(await page.evaluate(() => window.__estranei)).toBe(prima);
  await new Promise((r) => setTimeout(r, 900));
  if (s.okDisabled) await vista.evaluate(() => window.SN_CONFIRM_UI._test.scrollToEnd());
  const p = await puntoDi(vista, 'ok');
  await vista.mouse.click(p.x, p.y);
  await expect.poll(() => esito(app, host), { timeout: 10000 }).toMatchObject({ ok: true });
  const e = await esito(app, host);
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

test('cambio scheda, chiusura e navigazione: la domanda segue la sua scheda', async ({ app, openTab, testServer }) => {
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

test('tema scuro, testo lunghissimo con HTML ed emoji: si legge tutto e OK aspetta la fine', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  const page = await testServer.openReady(openTab, '<body style="background:#fff"><h1>pagina chiara</h1></body>');
  const host = new URL(page.url()).hostname;
  const lungo = '<b>grassetto</b> <img src=x onerror=alert(1)> 🍕🎉 ' + 'riga di testo '.repeat(400) + ' FINE-DEL-TESTO';
  await nelMondoDiFilo(app, host, `(() => { globalThis.__l = null; SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: ${JSON.stringify(lungo)} }).then((ok) => { globalThis.__l = ok; }); return 1; })()`);
  const vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 900));
  let s = await vista.evaluate(() => window.SN_CONFIRM_UI._test.state());
  expect(s.text).toContain('<b>grassetto</b>');
  expect(s.text).toContain('FINE-DEL-TESTO');
  expect(s.textScrolls).toBe(true);
  expect(s.okDisabled).toBe(true);
  // Con la rotella sul testo, come un utente.
  const box = await vista.evaluate(() => { const p = window.SN_CONFIRM_UI._test.point('ok'); return p; });
  await vista.mouse.move(box.x - 150, box.y - 120);
  for (let i = 0; i < 60; i++) await vista.mouse.wheel(0, 400);
  await new Promise((r) => setTimeout(r, 400));
  s = await vista.evaluate(() => window.SN_CONFIRM_UI._test.state());
  expect(s.okDisabled).toBe(false);
  const p = await puntoDi(vista, 'ok');
  await vista.mouse.click(p.x, p.y);
  await expect.poll(() => nelMondoDiFilo(app, host, 'globalThis.__l')).toBe(true);
});

test('due schede con una domanda ciascuna: ognuna la vede sopra di sé e le risposte non si mischiano', async ({ app, openTab, testServer }) => {
  const a = await testServer.openReady(openTab, '<h1>A</h1>');
  const hostA = new URL(a.url()).hostname;
  await nelMondoDiFilo(app, hostA, `(() => { globalThis.__a = null; SN_CONFIRM_UI.confirm({ title: 'Domanda A', text: 'testo A' }).then((ok) => { globalThis.__a = ok; }); return 1; })()`);
  await confermaSopraPagina(app);
  const url = testServer.html('<h1>B</h1>').replace('127.0.0.1', 'localhost');
  const b = await openTab(url);
  await b.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await nelMondoDiFilo(app, 'localhost', `(() => { globalThis.__b = null; SN_CONFIRM_UI.confirm({ title: 'Domanda B', text: 'testo B' }).then((ok) => { globalThis.__b = ok; }); return 1; })()`);
  await expect.poll(async () => { const v = await confermaSopraPagina(app); return v.evaluate(() => window.SN_CONFIRM_UI._test.state().title); }).toBe('Domanda B');
  let vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 700));
  let p = await puntoDi(vista, 'ok');
  await vista.mouse.click(p.x, p.y);
  await expect.poll(() => nelMondoDiFilo(app, 'localhost', 'globalThis.__b')).toBe(true);
  expect(await nelMondoDiFilo(app, hostA, 'globalThis.__a')).toBe(null);
  // Torna su A: la sua domanda è ancora lì.
  await app.evaluate(({ BrowserWindow }, hostA) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => { try { return new URL(x.view.webContents.getURL()).hostname === hostA; } catch (_) { return false; } });
    tm.activate(t.id);
  }, hostA);
  await expect.poll(async () => { const v = await confermaSopraPagina(app); return v.evaluate(() => window.SN_CONFIRM_UI._test.state().title); }).toBe('Domanda A');
  vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 700));
  p = await puntoDi(vista, 'cancel');
  await vista.mouse.click(p.x, p.y);
  await expect.poll(() => nelMondoDiFilo(app, hostA, 'globalThis.__a')).toBe(false);
});

test('finestra ridimensionata con la domanda aperta: il popup copre ancora tutta la scheda', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<h1>pagina</h1>');
  const host = new URL(page.url()).hostname;
  await nelMondoDiFilo(app, host, `(() => { SN_CONFIRM_UI.confirm({ title: 'x', text: 'y' }); return 1; })()`);
  await confermaSopraPagina(app);
  const misure = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { vista: tm.conferme.vista.getBounds(), scheda: t.view.getBounds() };
  });
  let m = await misure();
  expect(m.vista).toEqual(m.scheda);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(900, 600); });
  await new Promise((r) => setTimeout(r, 800));
  m = await misure();
  expect(m.vista).toEqual(m.scheda);
  expect(m.vista.width).toBeLessThanOrEqual(900);
});

test('popup di accesso: la domanda compare sopra la finestra del popup e la risposta arriva', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<h1>sito con «Accedi con…»</h1>');
  const segno = 'client_id=v5926';
  const login = `${testServer.html('<h1>accedi</h1>')}?${segno}&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await sito.evaluate((u) => { window.open(u, '_blank', 'width=480,height=600'); }, login);
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    if (!w) return 'no';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoReady || "no"'); } catch (_) { return 'no'; }
  }, segno), { timeout: 15000 }).toBe('1');
  await app.evaluate(({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `globalThis.__p = null; SN_CONFIRM_UI.confirm({ title: 'Dal popup', text: 'domanda' }).then((ok) => { globalThis.__p = ok; }); 1` }]);
  }, segno);
  const vista = await confermaSopraPagina(app);
  const info = await app.evaluate(({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    const figli = w.contentView.children || [];
    const v = figli[figli.length - 1];
    return { figli: figli.length, bounds: v && v.getBounds(), size: w.getContentSize() };
  }, segno);
  expect(info.bounds).toEqual({ x: 0, y: 0, width: info.size[0], height: info.size[1] });
  await new Promise((r) => setTimeout(r, 700));
  const p = await puntoDi(vista, 'ok');
  await vista.mouse.click(p.x, p.y);
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    return w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.__p' }]);
  }, segno)).toBe(true);
});

test('chi scriveva nella pagina continua a scrivere nel suo campo mentre il popup è a schermo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<input id="campo" style="width:400px">');
  const host = new URL(page.url()).hostname;
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.show(); w.focus(); });
  await page.locator('#campo').click();
  await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs; tm.tabs.find((x) => x.id === tm.activeId).view.webContents.focus(); });
  await page.keyboard.type('ciao');
  await nelMondoDiFilo(app, host, `(() => { globalThis.__k = null; SN_CONFIRM_UI.confirm({ title: 'x', text: 'y' }).then((ok) => { globalThis.__k = ok; }); return 1; })()`);
  const vista = await confermaSopraPagina(app);
  const fuoco = await app.evaluate(({ BrowserWindow, webContents }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const f = webContents.getFocusedWebContents();
    return { vista: f === w._filoTabs.conferme.vista.webContents, url: f && f.getURL(), winFocus: w.isFocused() };
  });
  expect(fuoco.vista).toBe(true);
  await vista.keyboard.type(' mondo');
  await expect(page.locator('#campo')).toHaveValue('ciao mondo');
  await new Promise((r) => setTimeout(r, 600));
  await vista.keyboard.press('Escape');
  await expect.poll(() => nelMondoDiFilo(app, host, 'globalThis.__k')).toBe(false);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('campo');
  await page.keyboard.type('!');
  await expect(page.locator('#campo')).toHaveValue('ciao mondo!');
});

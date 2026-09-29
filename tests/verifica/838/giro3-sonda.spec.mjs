// Sonda del giro 3 di #838: dove sta la tastiera dopo i gesti comuni, e se le
// quattro scorciatoie arrivano. Esplorazione: stampa, poi si decide.
import { test, expect } from '../../fixtures/electron.mjs';

const TESTO = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif">
  <p id="testo">Una frase abbastanza lunga da poterla selezionare, spiegare e tradurre.</p>
  <a id="nuova" href="__URL__" target="_blank">apri</a>
</body></html>`;

function dove(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const f = webContents.getFocusedWebContents();
    if (!f) return 'NESSUNO';
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents === f) return w._filoTabs ? 'barra' : 'finestra:' + f.getURL().slice(0, 30);
      if (w._filoTabs) {
        const t = w._filoTabs.tabs.find((x) => x.view.webContents === f);
        if (t) return (t.id === w._filoTabs.activeId ? 'scheda-attiva' : 'scheda-NON-attiva') + ':' + t.url.slice(-12);
      }
    }
    return 'altro:' + f.getURL().slice(0, 40);
  });
}

function premiDoveHaLaTastiera(app, keyCode, modifiers) {
  return app.evaluate(({ webContents }, o) => {
    const f = webContents.getFocusedWebContents();
    if (!f) return false;
    f.sendInputEvent({ type: 'keyDown', keyCode: o.keyCode, modifiers: o.modifiers });
    f.sendInputEvent({ type: 'keyUp', keyCode: o.keyCode, modifiers: o.modifiers });
    return true;
  }, { keyCode, modifiers });
}

function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return { ids: w._filoTabs.tabs.map((x) => x.id), activeId: w._filoTabs.activeId };
  });
}

function aiutoSullaAttiva(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return t.view.webContents.executeJavaScript('!!document.querySelector(".sn-sidebar")');
  });
}

async function quattro(app, openTab, testServer) {
  const pagine = [];
  for (let i = 1; i <= 4; i++) pagine.push(await testServer.openReady(openTab, TESTO.replace('<p id="testo">', `<p id="testo">Pagina ${i}. `).replace('__URL__', testServer.html('<p id="x">nuova</p>'))));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.focus();
  });
  return pagine;
}

async function menuLinguetta(app, shell, testo) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
  });
  let popup = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => !!document.body && /Duplica/.test(document.body.innerText))) { popup = w; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 8000 }).toBe(true);
  return popup;
}

test('sonda: avvio', async ({ app, shell }) => {
  await shell.waitForTimeout(3000);
  console.log('AVVIO focused=', await dove(app), 'winFocused=', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).isFocused()));
});

test('sonda: menu linguetta Chiudi poi Alt+H', async ({ app, shell, openTab, testServer }) => {
  await quattro(app, openTab, testServer);
  console.log('PRIMA', await dove(app));
  const popup = await menuLinguetta(app, shell);
  await app.evaluate(({ BrowserWindow }) => {
    const m = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().startsWith('data:text/html'));
    m.focus(); m.webContents.focus();
  });
  console.log('MENU APERTO', await dove(app));
  const n = (await schede(app)).ids.length;
  await popup.evaluate(() => [...document.querySelectorAll('button.item')].find((b) => /Chiudi/.test(b.textContent)).click());
  await expect.poll(async () => (await schede(app)).ids.length).toBe(n - 1);
  await shell.waitForTimeout(800);
  console.log('DOPO CHIUDI (senza refocus)', await dove(app));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).focus());
  await shell.waitForTimeout(500);
  console.log('DOPO CHIUDI + focus finestra', await dove(app));
  await aiutoSullaAttiva(app);
  console.log('premuto', await premiDoveHaLaTastiera(app, 'H', ['alt']));
  await shell.waitForTimeout(1500);
  console.log('AIUTO dopo menu Chiudi:', await aiutoSullaAttiva(app));
});

test('sonda: menu linguetta Esc', async ({ app, shell, openTab, testServer }) => {
  await quattro(app, openTab, testServer);
  await menuLinguetta(app, shell);
  await app.evaluate(({ BrowserWindow }) => {
    const m = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().startsWith('data:text/html'));
    m.focus(); m.webContents.focus();
    m.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    m.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await shell.waitForTimeout(800);
  console.log('DOPO ESC', await dove(app));
});

test('sonda: altra finestra e ritorno', async ({ app, shell, openTab, testServer }) => {
  await quattro(app, openTab, testServer);
  const n = (await schede(app)).ids.length;
  await app.evaluate(({ BrowserWindow }) => {
    const x = new BrowserWindow({ width: 300, height: 200, show: true });
    globalThis.__altra = x;
    x.loadURL('data:text/html,<input id=i autofocus>');
  });
  await shell.waitForTimeout(1000);
  await app.evaluate(() => { globalThis.__altra.focus(); globalThis.__altra.webContents.focus(); });
  await shell.waitForTimeout(500);
  console.log('ALTRA IN PRIMO PIANO', await dove(app));
  await premiDoveHaLaTastiera(app, 'S', ['alt']);
  await premiDoveHaLaTastiera(app, 'H', ['alt']);
  await shell.waitForTimeout(1500);
  console.log('schede invariate:', (await schede(app)).ids.length === n, 'aiuto:', await aiutoSullaAttiva(app));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).focus());
  await shell.waitForTimeout(800);
  console.log('RITORNO', await dove(app));
  await premiDoveHaLaTastiera(app, 'H', ['alt']);
  await shell.waitForTimeout(1500);
  console.log('AIUTO dopo ritorno:', await aiutoSullaAttiva(app));
});

test('sonda: link in nuova scheda', async ({ app, openTab, testServer }) => {
  const pagine = await quattro(app, openTab, testServer);
  const p = pagine[3];
  const n = (await schede(app)).ids.length;
  await p.locator('#nuova').click();
  await expect.poll(async () => (await schede(app)).ids.length).toBe(n + 1);
  await p.waitForTimeout(800);
  console.log('DOPO LINK _blank', await dove(app), JSON.stringify(await schede(app)));
});

test('sonda: Ctrl+Shift+T e Ctrl+Tab', async ({ app, openTab, testServer }) => {
  const pagine = await quattro(app, openTab, testServer);
  await premiDoveHaLaTastiera(app, 'W', ['control']);
  await pagine[0].waitForTimeout(600);
  console.log('DOPO Ctrl+W', await dove(app));
  await premiDoveHaLaTastiera(app, 'T', ['control', 'shift']);
  await pagine[0].waitForTimeout(1500);
  console.log('DOPO Ctrl+Shift+T', await dove(app));
  await premiDoveHaLaTastiera(app, 'Tab', ['control']);
  await pagine[0].waitForTimeout(600);
  console.log('DOPO Ctrl+Tab', await dove(app));
  await premiDoveHaLaTastiera(app, 'PageDown', ['control']);
  await pagine[0].waitForTimeout(600);
  console.log('DOPO Ctrl+PgDn', await dove(app));
  await premiDoveHaLaTastiera(app, 'T', ['control']);
  await pagine[0].waitForTimeout(1500);
  console.log('DOPO Ctrl+T', await dove(app));
  await premiDoveHaLaTastiera(app, 'H', ['alt']);
  await pagine[0].waitForTimeout(1500);
  console.log('AIUTO su nuova scheda da barra:', await aiutoSullaAttiva(app));
});

test('sonda: Alt+H subito dopo Alt+2', async ({ app, openTab, testServer }) => {
  const pagine = await quattro(app, openTab, testServer);
  await premiDoveHaLaTastiera(app, '2', ['alt']);
  await premiDoveHaLaTastiera(app, 'H', ['alt']);
  await pagine[0].waitForTimeout(2500);
  console.log('AIUTO subito dopo Alt+2:', await aiutoSullaAttiva(app), await dove(app));
});

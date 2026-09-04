// Sonda avversariale #527, giro 4. File di verifica: non fa parte della suite
// permanente, serve a rispondere a domande che i giri precedenti non hanno
// fatto.
import { test, expect } from './fixtures/electron.mjs';

// Che tasti si prende la barra dei menu SU QUESTO SISTEMA (Linux qui, ma la
// domanda vale per Windows: sono gli stessi `role` di Electron).
test('sonda: quali acceleratori registra davvero la barra', async ({ app, shell }) => {
  const voci = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    const out = [];
    const scendi = (items) => items.forEach((v) => {
      out.push({
        label: v.label, role: v.role || null,
        accel: v.accelerator || null,
        registra: v.registerAccelerator,
        visible: v.visible,
      });
      if (v.submenu) scendi(v.submenu.items);
    });
    scendi(m.items);
    return out;
  });
  console.log('VOCI:', JSON.stringify(voci, null, 1));
  expect(voci.length).toBeGreaterThan(0);
});

test('sonda: Ctrl+M non riduce a icona la finestra mentre si naviga', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<html><body><input id="c"></body></html>');
  await page.click('#c');
  await page.keyboard.press('Control+m');
  await new Promise((r) => setTimeout(r, 800));
  const ridotta = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w.isDestroyed());
    return win ? win.isMinimized() : null;
  });
  console.log('MINIMIZZATA:', ridotta);
  expect(ridotta).toBe(false);
});

test('sonda: Ctrl+Q non chiude Filo mentre si naviga', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<html><body><input id="c"></body></html>');
  await page.click('#c');
  await page.keyboard.press('Control+q');
  await new Promise((r) => setTimeout(r, 1200));
  const viva = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  console.log('FINESTRE VIVE:', viva);
  expect(viva).toBeGreaterThan(0);
});

test('sonda: Alt+cifra salta ancora fra le schede (Windows/Linux)', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<html><body><h1>uno</h1></body></html>');
  const seconda = await testServer.openReady(openTab, '<html><body><h1>due</h1></body></html>');
  const attiva = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w.isDestroyed());
    const t = win._filoTabs;
    return t.tabs.findIndex((x) => x.id === t.activeId);
  });
  const prima = await attiva();
  await seconda.keyboard.press('Alt+1');
  await expect.poll(attiva).toBe(0);
  console.log('da', prima, 'a', await attiva());
});

test('sonda: Ctrl+A dentro un campo seleziona il testo del campo, non altro', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<html><body><input id="c" value="ciao mondo"><p id="p">altro testo</p></body></html>');
  await page.click('#c');
  await page.keyboard.press('Control+a');
  const sel = await page.evaluate(() => {
    const i = document.getElementById('c');
    return { start: i.selectionStart, end: i.selectionEnd, doc: String(window.getSelection()) };
  });
  console.log('SEL:', JSON.stringify(sel));
  expect(sel.end - sel.start).toBe('ciao mondo'.length);
});

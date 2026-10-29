// Esplorazione del giro 4: gesti normali dell'utente sul microfono e sulle caselle, senza attese della guardia.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi } from '../../helpers/riquadri.mjs';

const pagina = (corpo = '<h1>Un sito</h1>') => `<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head><body style="padding:40px;font:16px sans-serif">${corpo}</body></html>`;
const avvisoCoperto = (page) => page.locator('.sn-toast', { hasText: 'L\'Aiuto era coperto' });
async function apriAiuto(shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
}
const contaAscolti = (app, page) => nelMondoDiFilo(app, page, () => {
  globalThis.__ascolti = 0;
  globalThis.SN_ASCOLTO.avvia = async () => { globalThis.__ascolti += 1; return null; };
  return true;
});
const ascolti = (app, page) => nelMondoDiFilo(app, page, () => globalThis.__ascolti);
async function centro(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('x1 microfono: clic subito dopo l\'apertura dell\'Aiuto', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  console.log('x1 ascolti', await ascolti(app, page), 'avviso', await avvisoCoperto(page).count());
});

test('x2 microfono: clic sulla pagina (l\'Aiuto si chiude a barra), poi subito sul microfono', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await page.waitForTimeout(1500);
  await page.mouse.click(100, 100);
  await page.waitForTimeout(120);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  console.log('x2 ascolti', await ascolti(app, page), 'avviso', await avvisoCoperto(page).count());
  await page.screenshot({ path: 'tests/.shots/g4-x2.png' });
});

test('x3 microfono: clic sulla casella (l\'Aiuto si riapre), poi sul microfono', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await page.waitForTimeout(1500);
  await page.mouse.click(100, 100);
  await page.waitForTimeout(1500);
  await page.locator('.sn-sidebar-input textarea').click();
  await page.waitForTimeout(200);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  console.log('x3 ascolti', await ascolti(app, page), 'avviso', await avvisoCoperto(page).count());
});

test('x4 microfono: spostato il pannello dalla testata, poi clic', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await page.waitForTimeout(1500);
  const h = await page.locator('.sn-sidebar-header').boundingBox();
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 200, h.y - 100, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  console.log('x4 ascolti', await ascolti(app, page), 'avviso', await avvisoCoperto(page).count());
});

test('x5 microfono da tastiera: Tab fino al microfono e Invio', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await page.waitForTimeout(1500);
  await page.locator('.sn-sidebar .sn-voce-btn').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  console.log('x5 ascolti', await ascolti(app, page), 'avviso', await avvisoCoperto(page).count());
});

test('x6 feedback: testo lungo, una frase scritta di seguito, poi Ctrl+Z', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  const lungo = 'Log: '.padEnd(20000, 'abcdefghij ');
  await scrivi(app, page, '.sn-fb-text', lungo);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.type(' e poi la pagina si blocca e non risponde piu a nessun clic per diversi secondi, poi riparte da sola senza dire niente a nessuno di quello che e successo prima', { delay: 5 });
  const prima = (await statoDi(app, page, '.sn-fb-text')).valore.length;
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(400);
  const dopo = (await statoDi(app, page, '.sn-fb-text')).valore.length;
  console.log('x6 lunghezze', lungo.length, prima, dopo);
});

test('x7 feedback: trascinare una parola selezionata dentro la casella', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'uno due tre');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+Control+ArrowRight');
  const r = await nelMondoDiFilo(app, page, () => { const b = globalThis.SN_FILO_UI._test.trova('.sn-fb-text').getBoundingClientRect(); return { x: b.x, y: b.y }; });
  await page.mouse.move(r.x + 12, r.y + 14);
  await page.mouse.down();
  await page.mouse.move(r.x + 60, r.y + 14, { steps: 5 });
  await page.mouse.move(r.x + 95, r.y + 14, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  console.log('x7 valore', JSON.stringify((await statoDi(app, page, '.sn-fb-text')).valore));
});

for (const attesa of [500, 800, 1200]) {
  test(`x4b microfono: spostato il pannello, clic dopo ${attesa} ms`, async ({ app, shell, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, pagina());
    await apriAiuto(shell, page);
    await contaAscolti(app, page);
    await page.waitForTimeout(1500);
    const h = await page.locator('.sn-sidebar-header').boundingBox();
    await page.mouse.move(h.x + 30, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x - 200, h.y - 100, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(attesa);
    const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(800);
    console.log('x4b', attesa, 'ascolti', await ascolti(app, page), 'avviso', await avvisoCoperto(page).count());
  });
}

test('x6b feedback: testo di 100k, 60 caratteri di seguito, poi Ctrl+Z', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  const lungo = 'Log: '.padEnd(100000, 'abcdefghij ');
  await scrivi(app, page, '.sn-fb-text', lungo);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.type('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  const prima = (await statoDi(app, page, '.sn-fb-text')).valore.length;
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(400);
  const dopo = (await statoDi(app, page, '.sn-fb-text')).valore.length;
  console.log('x6b lunghezze', lungo.length, prima, dopo);
});

test('x7b taratura: lo stesso trascinamento in una casella del sito', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina('<textarea id="t" style="font:13px sans-serif;width:400px;height:80px"></textarea>'));
  await page.locator('#t').click();
  await page.keyboard.insertText('uno due tre');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+Control+ArrowRight');
  const r = await page.locator('#t').boundingBox();
  await page.mouse.move(r.x + 12, r.y + 14);
  await page.mouse.down();
  await page.mouse.move(r.x + 60, r.y + 14, { steps: 5 });
  await page.mouse.move(r.x + 95, r.y + 14, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  console.log('x7b valore', JSON.stringify(await page.locator('#t').inputValue()));
});

test('x4c microfono: spostato il pannello, clic dopo 3 s e ancora dopo', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await page.waitForTimeout(1500);
  const h = await page.locator('.sn-sidebar-header').boundingBox();
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 200, h.y - 100, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(3000);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(1500);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  const sonde = await nelMondoDiFilo(app, page, () => {
    const el = document.querySelector('.sn-sidebar .sn-voce-btn');
    const V = globalThis.SN_VISTO;
    return { stato: JSON.stringify(V._test.stato(el)), pronta: V._test.pronta(el), mic: JSON.stringify(el.getBoundingClientRect()) };
  });
  console.log('x4c ascolti', await ascolti(app, page), 'avviso', await avvisoCoperto(page).count(), JSON.stringify(sonde));
  await page.screenshot({ path: 'tests/.shots/g4-x4c.png' });
});

test('x6c taratura: 100k in una casella del sito, 60 caratteri, Ctrl+Z', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina('<textarea id="t"></textarea>'));
  await page.locator('#t').click();
  await page.keyboard.insertText('Log: '.padEnd(100000, 'abcdefghij '));
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.type('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  const prima = (await page.locator('#t').inputValue()).length;
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(400);
  console.log('x6c lunghezze', prima, (await page.locator('#t').inputValue()).length);
});

test('x7c feedback: trascinamento con gli eventi registrati', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'uno due tre');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+Control+ArrowRight');
  const r = await nelMondoDiFilo(app, page, () => {
    const t = globalThis.SN_FILO_UI._test.trova('.sn-fb-text');
    globalThis.__ev = [];
    for (const k of ['dragstart', 'drop', 'beforeinput', 'input']) t.addEventListener(k, (e) => globalThis.__ev.push(k + ':' + (e.inputType || '') + ':' + e.isTrusted + ':' + JSON.stringify(t.value)));
    const b = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    return { x: b.x, y: b.y, pl: cs.paddingLeft, pt: cs.paddingTop, font: cs.font, sel: [t.selectionStart, t.selectionEnd] };
  });
  console.log('x7c', JSON.stringify(r));
  const x0 = r.x + parseFloat(r.pl) + 8; const y0 = r.y + parseFloat(r.pt) + 8;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 40, y0, { steps: 5 });
  await page.mouse.move(x0 + 90, y0, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  console.log('x7c valore', JSON.stringify((await statoDi(app, page, '.sn-fb-text')).valore), JSON.stringify(await nelMondoDiFilo(app, page, () => globalThis.__ev)));
});

test('x4d microfono: pannello spostato di poco a sinistra', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await page.waitForTimeout(1500);
  const h = await page.locator('.sn-sidebar-header').boundingBox();
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 50, h.y + h.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(2000);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  console.log('x4d ascolti', await ascolti(app, page), 'avviso', await avvisoCoperto(page).count());
});

test('x4e microfono: finestra ridimensionata con l\'Aiuto aperto', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await page.waitForTimeout(1500);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const [a, b] = w.getSize(); w.setSize(a - 200, b - 100); });
  await page.waitForTimeout(2000);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  console.log('x4e ascolti', await ascolti(app, page), 'avviso', await avvisoCoperto(page).count());
});

test('x8 Aiuto: trascinare una parola selezionata dentro la casella', async ({ shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  const ta = page.locator('.sn-sidebar-input textarea');
  await ta.click();
  await page.keyboard.insertText('uno due tre');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+Control+ArrowRight');
  const r = await ta.boundingBox();
  const pad = await ta.evaluate((t) => { const c = getComputedStyle(t); return [parseFloat(c.paddingLeft), parseFloat(c.paddingTop)]; });
  const x0 = r.x + pad[0] + 8; const y0 = r.y + pad[1] + 8;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 40, y0, { steps: 5 });
  await page.mouse.move(x0 + 90, y0, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  console.log('x8 valore', JSON.stringify(await ta.inputValue()));
});

test('x6d feedback: testo di 100k, 60 caratteri, Ctrl+Z, attesa lunga', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'Log: '.padEnd(100000, 'abcdefghij '));
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.type('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  await page.waitForTimeout(1000);
  const prima = (await statoDi(app, page, '.sn-fb-text')).valore.length;
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(2500);
  const dopo = (await statoDi(app, page, '.sn-fb-text')).valore.length;
  console.log('x6d lunghezze', prima, dopo);
});

for (const [lung, scritti] of [[10000, 300], [5000, 100]]) {
  test(`x6e feedback: testo di ${lung}, ${scritti} caratteri, Ctrl+Z`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const page = await testServer.openReady(openTab, pagina());
    await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
    await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
    await scrivi(app, page, '.sn-fb-text', 'Log: '.padEnd(lung, 'abcdefghij '));
    await page.keyboard.press('Control+End');
    await page.waitForTimeout(300);
    await page.keyboard.type('x'.repeat(scritti));
    await page.waitForTimeout(500);
    const prima = (await statoDi(app, page, '.sn-fb-text')).valore.length;
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(1500);
    const dopo = (await statoDi(app, page, '.sn-fb-text')).valore.length;
    console.log('x6e', lung, scritti, 'lunghezze', prima, dopo);
  });
}

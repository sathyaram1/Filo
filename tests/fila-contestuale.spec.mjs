// #1434 — la fila in cima al tasto destro è contestuale: sul testo che si scrive grassetto e corsivo (e il clic li
// mette), su un'immagine le sue azioni, nessuna azione della pagina intera di partenza; il «+» tiene le altre, un'icona
// portata dal «+» alla fila resta dopo il riavvio e «rimetti come prima» la riporta indietro; fra barra e fila si
// trascina nei due versi, anche col menu nello strato, e a parole.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { neiRiquadri } from './helpers/riquadri.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from './helpers/barra.mjs';
import { home, modelloFinto, chiedi } from './helpers/chatFinta.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Un'immagine vera, servita dal sito: le sue azioni la scaricano coi byte che ha.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1200px">
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p>
  <img id="foto" src="${img}" width="160" height="120" alt="foto">
  <p><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
  <div id="vuoto" style="height:200px"></div>
  </body></html>`;

// La disposizione salvata, letta dalla porta del main.
const salvata = (app) => app.evaluate(async () => globalThis.SN_LAYOUT_ICONE.leggi());
const iconeDellaFila = (menu) => menu.locator('.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')
  .evaluateAll((els) => els.map((e) => e.dataset.snIconId));
// Il registro dei cambi dalla sua porta (#1561).
const registro = (app) => app.evaluate(async () => {
  await globalThis.SN_REGISTRO_CAMBI.attesa();
  return globalThis.SN_REGISTRO_CAMBI.lista();
});

// Il riquadro di un elemento quando ha smesso di muoversi.
async function fermo(loc) {
  let prima = null;
  for (let i = 0; i < 40; i++) {
    const ora = await loc.boundingBox();
    if (ora && prima && ['x', 'y', 'width', 'height'].every((k) => Math.abs(ora[k] - prima[k]) < 0.5)) return ora;
    prima = ora;
    await pausa(120);
  }
  return prima;
}

async function selezionaTesto(page, sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = document.createRange();
    r.selectNodeContents(el.firstChild || el);
    const g = getSelection();
    g.removeAllRanges();
    g.addRange(r);
  }, sel);
}

test('nell\'Editor sul testo selezionato la fila ha grassetto e corsivo, e il clic li mette', async ({ app, openTab }) => {
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  await editor.keyboard.type('Parola importante qui');
  await editor.evaluate(() => {
    const doc = document.getElementById('doc');
    const t = [...doc.querySelectorAll('*'), doc].map((n) => [...n.childNodes].find((c) => c.nodeType === 3 && c.nodeValue.includes('importante'))).find(Boolean);
    const i = t.nodeValue.indexOf('importante');
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + 'importante'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  const box = await editor.evaluate(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await editor.mouse.click(box.x, box.y, { button: 'right' });
  const menu = menuDi(editor);
  const fila = menu.locator('.sn-menu-row');
  await expect(fila).toBeVisible();
  const ids = await iconeDellaFila(menu);
  expect(ids.slice(0, 2)).toEqual(['scrivibile:bold', 'scrivibile:italic']);
  expect(ids.every((id) => id.startsWith('scrivibile:')), 'nessuna azione della pagina intera di partenza').toBe(true);
  // La fila sta in cima, sopra le voci di sempre, che restano.
  expect(await menu.principale.evaluate((m) => m.firstElementChild.classList.contains('sn-menu-row'))).toBe(true);
  await expect(menu.voce('Taglia')).toBeVisible();
  await expect(fila.locator('.sn-menu-row-overflow')).toBeVisible();

  await fila.locator('[data-sn-icon-id="scrivibile:bold"]').click();
  await expect(menu.pannelli).toHaveCount(0);
  await expect.poll(() => editor.evaluate(() => !!document.querySelector('#doc b, #doc strong') && document.querySelector('#doc b, #doc strong').textContent)).toBe('importante');

  // Il corsivo sulla stessa selezione, rimasta dov'era.
  await editor.mouse.click(box.x, box.y, { button: 'right' });
  await menuDi(editor).locator('.sn-menu-row [data-sn-icon-id="scrivibile:italic"]').click();
  await expect.poll(() => editor.evaluate(() => document.querySelector('#doc i, #doc em')?.textContent || '')).toBe('importante');
});

test('su un\'immagine la fila ha le sue azioni, e il «+» le altre; sul testo di una pagina copia, traduci e cerca', async ({ openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  await page.locator('#foto').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  expect(await iconeDellaFila(menu)).toEqual(['immagine:save', 'immagine:copy', 'immagine:ask']);
  await expect(menu.locator('.sn-menu-row [data-sn-icon-id="immagine:save"]')).toHaveAttribute('aria-label', /Salva immagine/);
  await menu.locator('.sn-menu-row .sn-menu-row-overflow').click();
  const griglia = menu.locator('.sn-menu-icon-grid');
  await expect(griglia).toBeVisible();
  expect(await griglia.locator('[data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId))).toEqual(['immagine:copyLink', 'immagine:search']);
  await page.keyboard.press('Escape');
  await expect(menu.pannelli).toHaveCount(0);

  await selezionaTesto(page, '#testo');
  const r = await page.locator('#testo').boundingBox();
  await page.mouse.click(r.x + 30, r.y + r.height / 2, { button: 'right' });
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  expect(await iconeDellaFila(menu)).toEqual(['testo:copy', 'testo:translate', 'testo:search']);
  await page.keyboard.press('Escape');

  // Niente sotto il mouse: la fila della pagina è vuota di partenza, e non si vede.
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  await expect(menu.locator('.sn-menu-row')).toBeHidden();
});

// Seleziona `parola` nel foglio dell'Editor e apre il tasto destro sopra di lei.
async function destroSullaParola(editor, parola) {
  const box = await editor.evaluate((p) => {
    const doc = document.getElementById('doc');
    const w = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    let t = w.nextNode();
    while (t && !t.nodeValue.includes(p)) t = w.nextNode();
    const i = t.nodeValue.indexOf(p);
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + p.length);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    const q = r.getBoundingClientRect();
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
  }, parola);
  await editor.mouse.click(box.x, box.y, { button: 'right' });
  await expect(menuDi(editor).locator('.sn-menu-row')).toBeVisible();
}

test('nell\'Editor il collegamento e l\'evidenziato della fila si mettono e restano dopo aver riaperto il documento', async ({ openTab }) => {
  let editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  await editor.keyboard.type('Leggi la guida e poi la nota');
  await destroSullaParola(editor, 'guida');
  const menu = menuDi(editor);
  await menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:link"]').click();
  const campo = menu.locator('.sn-menu-link-campo');
  await expect(campo).toBeFocused();
  // Uno schema che esegue non diventa un collegamento: lo si dice, e niente cambia.
  await campo.fill('javascript:alert(1)');
  await campo.press('Enter');
  await expect(menu.pannelli).toHaveCount(0);
  expect(await editor.locator('#doc a').count()).toBe(0);
  await destroSullaParola(editor, 'guida');
  await menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:link"]').click();
  await menu.locator('.sn-menu-link-campo').fill('esempio.it/guida');
  await menu.locator('.sn-menu-link-campo').press('Enter');
  await expect(editor.locator('#doc a')).toHaveText('guida');
  await expect(editor.locator('#doc a')).toHaveAttribute('href', 'https://esempio.it/guida');

  await destroSullaParola(editor, 'nota');
  await menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:highlight"]').click();
  await expect.poll(() => editor.evaluate(() => [...document.querySelectorAll('#doc span')]
    .filter((s) => s.style.backgroundColor && s.textContent === 'nota').length)).toBe(1);

  // Riaperto, il documento li ha ancora: sono passati dal salvataggio.
  await editor.waitForTimeout(1500);
  await editor.reload();
  await editor.waitForSelector('#doc');
  await expect(editor.locator('#doc a')).toHaveAttribute('href', 'https://esempio.it/guida');
  await expect.poll(() => editor.evaluate(() => [...document.querySelectorAll('#doc span')]
    .filter((s) => s.style.backgroundColor && s.textContent === 'nota').length)).toBe(1);

  // Sul collegamento il campo propone il suo indirizzo; svuotato, Invio lo toglie.
  await destroSullaParola(editor, 'guida');
  await menuDi(editor).locator('.sn-menu-row [data-sn-icon-id="scrivibile:link"]').click();
  await expect(menuDi(editor).locator('.sn-menu-link-campo')).toHaveValue('https://esempio.it/guida');
  await menuDi(editor).locator('.sn-menu-link-campo').fill('');
  await menuDi(editor).locator('.sn-menu-link-campo').press('Enter');
  await expect(editor.locator('#doc a')).toHaveCount(0);
  await expect(editor.locator('#doc')).toContainText('Leggi la guida e poi la nota');
});

test('un\'icona portata dal «+» alla fila resta dopo il riavvio, e «rimetti come prima» in chat la riporta nel «+»', async () => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-fila-');
  const avvia = async () => {
    const app = await electron.launch({
      args: [...argomentiScala, '.'], cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', FILO_STRATO_MENU: '0', NODE_ENV: 'test' },
    });
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    return { app, shell };
  };
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(SITO('/niente.png')); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const indirizzo = `http://127.0.0.1:${server.address().port}/sito`;
  // Un indirizzo per giro: al riavvio torna anche la scheda di prima, con il suo.
  const apriSito = async (app, shell, giro) => {
    const url = `${indirizzo}?giro=${giro}`;
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    const fine = Date.now() + 10_000;
    while (!page && Date.now() < fine) {
      page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
      if (!page) await pausa(100);
    }
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    return page;
  };
  const destroSulTesto = async (page) => {
    await selezionaTesto(page, '#testo');
    const r = await page.locator('#testo').boundingBox();
    await page.mouse.click(r.x + 30, r.y + r.height / 2, { button: 'right' });
    await expect(menuDi(page).locator('.sn-menu-row')).toBeVisible();
  };
  try {
    let { app, shell } = await avvia();
    let page = await apriSito(app, shell, 1);
    await destroSulTesto(page);
    const menu = menuDi(page);
    await menu.locator('.sn-menu-row .sn-menu-row-overflow').click();
    const leggi = menu.locator('.sn-menu-icon-grid [data-sn-icon-id="testo:readAloud"]');
    await expect(leggi).toBeVisible();
    // Trascinata col mouse vero davanti a «Copia», nella fila.
    const da = await fermo(leggi);
    const davanti = await fermo(menu.locator('.sn-menu-row [data-sn-icon-id="testo:copy"]'));
    await page.mouse.move(da.x + da.width / 2, da.y + da.height / 2);
    await page.mouse.down();
    await page.mouse.move(da.x + 10, da.y + 10, { steps: 3 });
    await page.mouse.move(davanti.x + 4, davanti.y + davanti.height / 2, { steps: 8 });
    await expect(menu.locator('.sn-menu-row.sn-drop-hover')).toHaveCount(1);
    await page.mouse.up();
    // Si vede subito, nel menu ancora aperto.
    await expect.poll(() => iconeDellaFila(menu)).toEqual(['testo:readAloud', 'testo:copy', 'testo:translate', 'testo:search']);
    await expect.poll(async () => (await salvata(app))['fila:testo']).toEqual(['testo:readAloud', 'testo:copy', 'testo:translate', 'testo:search']);
    const mossa = (await registro(app)).filter((e) => e.tipo === 'icone').pop();
    expect(mossa).toMatchObject({ via: 'interfaccia', dove: 'tasto-destro' });
    await chiudiApp(app);

    ({ app, shell } = await avvia());
    page = await apriSito(app, shell, 2);
    await destroSulTesto(page);
    expect(await iconeDellaFila(menuDi(page))).toEqual(['testo:readAloud', 'testo:copy', 'testo:translate', 'testo:search']);
    await page.keyboard.press('Escape');

    // «Rimetti come prima»: il modello finto fa quello che farebbe uno vero, annulla il cambio che il filo gli riporta.
    const casa = await home(app);
    await modelloFinto(app, [{ text: 'Rimessa.' }]);
    await app.evaluate(() => {
      const finto = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => {
        const testo = o.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
        globalThis.__visto = testo;
        const m = testo.match(/cambio dal menu del tasto destro (c[0-9a-f]{10}): icona «[^»]+»/);
        const r = await finto(o);
        if (!m || globalThis.__annullato) return r;
        globalThis.__annullato = true;
        const calls = [{ id: 'u1', name: 'ANNULLA_CAMBIO', arguments: JSON.stringify({ id: m[1] }) }];
        for (const c of calls) { try { o.onToolCall && o.onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
        return { ...r, toolCalls: calls, finishReason: 'tool_calls' };
      };
    });
    await chiedi(casa, 'rimetti come prima');
    await expect(casa.locator('.dash-bubble-filo', { hasText: 'Rimessa.' })).toBeVisible({ timeout: 10_000 });
    expect(await app.evaluate(() => globalThis.__visto)).toMatch(/icona «Leggi»: «Altro…» della fila del tasto destro sul testo selezionato → fila del tasto destro sul testo selezionato/);
    await expect.poll(async () => (await salvata(app))['fila:testo']).toEqual(['testo:copy', 'testo:translate', 'testo:search']);
    expect((await salvata(app))['altro:testo']).toEqual(['testo:readAloud']);
    await chiudiApp(app);
  } finally {
    try { server.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('un\'icona della barra portata nella fila del tasto destro lascia la barra, e trascinata indietro ci torna', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, SITO(testServer.asset(PNG, 'image/png')));
  const barra = await barraPage(app);
  // Niente sotto il mouse: la fila della pagina è vuota e nascosta, e si apre per accogliere l'icona.
  await page.locator('#vuoto').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  await expect(menu.locator('.sn-menu-row')).toBeHidden();
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const src = await barra.locator('#nav .ico[data-id="saveForLater"]').boundingBox();
  const m = await fermo(menu.principale);
  const s = await statoBarra(app);
  const alto = s.bounds.y - s.alto;
  await barra.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await barra.mouse.down();
  await barra.mouse.move(src.x + 30, src.y + 10, { steps: 3 });
  await barra.mouse.move(m.x + 40, m.y + 12 - alto, { steps: 10 });
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  const fila = await fermo(menu.locator('.sn-menu-row'));
  await barra.mouse.move(fila.x + 20, fila.y + fila.height / 2 - alto, { steps: 4 });
  await barra.mouse.up();
  await expect.poll(async () => (await salvata(app))['fila:pagina']).toEqual(['saveForLater']);
  await expect.poll(async () => (await statoBarra(app)).bar).not.toContain('saveForLater');
  await expect(menu.locator('.sn-menu-row [data-sn-icon-id="saveForLater"]')).toBeVisible();
  await comandaBarra(app, 'chiudi');

  // Il menu dopo, sulla pagina: l'icona c'è, e premuta fa la sua azione sulla pagina.
  await page.keyboard.press('Escape');
  await page.locator('#vuoto').click({ button: 'right' });
  await menu.locator('.sn-menu-row [data-sn-icon-id="saveForLater"]').click();
  await expect.poll(() => app.evaluate(async () => ((await globalThis.chrome.storage.local.get('savedPages')).savedPages || []).map((x) => x.url)),
    { timeout: 10_000 }).toContain(page.url());
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-row [data-sn-icon-id="saveForLater"]')).toBeVisible();

  // Dalla fila alla barra: il trascinamento la apre, e la barra la riprende.
  const icona = await fermo(menu.locator('.sn-menu-row [data-sn-icon-id="saveForLater"]'));
  await page.mouse.move(icona.x + icona.width / 2, icona.y + icona.height / 2);
  await page.mouse.down();
  await page.mouse.move(icona.x + 12, icona.y + 12, { steps: 3 });
  await page.mouse.move(20, icona.y + 12, { steps: 8 });
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
  await page.mouse.move(30, home.y + 4, { steps: 6 });
  await expect(barra.locator('#nav')).toHaveClass(/mira/);
  await page.mouse.up();
  await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 6)).toEqual(['help', 'back', 'forward', 'reload', 'saveForLater', 'home']);
  await expect(menu.locator('.sn-menu-row [data-sn-icon-id="saveForLater"]')).toHaveCount(0);
  expect((await salvata(app))['fila:pagina']).toEqual([]);
});

test.describe('col menu nello strato sopra la scheda', () => {
  test.use({ stratoDelMenu: true });

  test('la fila c\'è anche lì: un\'icona fa la sua azione, e una portata dal «+» alla fila resta', async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, SITO(testServer.asset(PNG, 'image/png')));
    await page.locator('#vai').click({ button: 'right' });
    const menu = menuDi(page);
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    expect(menu.superficie.url()).toMatch(/^filo:\/\/menu\//);
    expect(await iconeDellaFila(menu)).toEqual(['link:openTab', 'link:copy']);
    await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
    await menu.locator('.sn-menu-row [data-sn-icon-id="link:copy"]').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 }).toBe('https://esempio.it/pagina');

    await page.locator('#vai').click({ button: 'right' });
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    await menu.locator('.sn-menu-row .sn-menu-row-overflow').click();
    const condividi = menu.locator('.sn-menu-icon-grid [data-sn-icon-id="link:share"]');
    await expect(condividi).toBeVisible();
    // Il menu cresce quando arriva la sezione del collegamento, e la griglia segue il «+»: si misura a menu fermo.
    const da = await fermo(condividi);
    const fila = await fermo(menu.locator('.sn-menu-row'));
    const m = menu.superficie;
    await m.mouse.move(da.x + da.width / 2, da.y + da.height / 2);
    await m.mouse.down();
    await m.mouse.move(da.x + 10, da.y + 10, { steps: 3 });
    await m.mouse.move(fila.x + 6, fila.y + fila.height / 2, { steps: 8 });
    await expect(menu.locator('.sn-menu-row.sn-drop-hover')).toHaveCount(1);
    await m.mouse.up();
    await expect.poll(async () => (await salvata(app))['fila:link']).toEqual(['link:share', 'link:openTab', 'link:copy']);
    await expect.poll(() => iconeDellaFila(menu)).toEqual(['link:share', 'link:openTab', 'link:copy']);
  });
});

test('a parole: Filo mette un\'icona nella fila di un contesto, come il trascinamento; un\'azione resta nel suo contesto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO(testServer.asset(PNG, 'image/png')));
  const esegui = (azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);

  let r = await esegui({ type: 'SPOSTA_ICONA', icona: 'immagine:search', dove: 'fila' });
  expect(r.executed).toBe(true);
  await expect.poll(async () => (await salvata(app))['fila:immagine']).toEqual(['immagine:save', 'immagine:copy', 'immagine:ask', 'immagine:openTab', 'immagine:search']);
  await page.locator('#foto').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-row [data-sn-icon-id="immagine:search"]')).toBeVisible();
  await page.keyboard.press('Escape');

  // Un'icona della barra nella fila del testo: lascia la barra.
  r = await esegui({ type: 'SPOSTA_ICONA', icona: 'qrCode', dove: 'fila', contesto: 'testo' });
  expect(r.executed).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).bar).not.toContain('qrCode');
  expect((await salvata(app))['fila:testo']).toContain('qrCode');

  // Fuori dal suo contesto, senza contesto, o un posto che non c'è: niente cambia.
  const prima = await salvata(app);
  expect((await esegui({ type: 'SPOSTA_ICONA', icona: 'immagine:save', dove: 'fila', contesto: 'link' })).executed).toBe(false);
  expect((await esegui({ type: 'SPOSTA_ICONA', icona: 'immagine:save', dove: 'barra' })).executed).toBe(false);
  expect((await esegui({ type: 'SPOSTA_ICONA', icona: 'qrCode', dove: 'fila' })).executed).toBe(false);
  expect(await salvata(app)).toEqual(prima);
});

// Ogni tipo di elemento ha la sua fila col suo «+» (patterns/menu-contestuale-se-filo-sostituisce-il-menu-nativo.md).
const SITO_MEDIA = `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <video id="vid" width="240" height="120" style="background:#000" controls></video>
  <audio id="aud" controls style="display:block;margin-top:20px"></audio>
  <textarea id="area" style="display:block;margin-top:20px;width:300px;height:60px"></textarea>
  </body></html>`;

test('su un filmato e su un audio la fila ha le loro azioni, e in un campo col solo cursore Incolla funziona dalla fila', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO_MEDIA);
  const menu = menuDi(page);
  for (const sel of ['#vid', '#aud']) {
    await page.locator(sel).click({ button: 'right' });
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    expect(await iconeDellaFila(menu)).toEqual(['media:playPause', 'media:mute', 'media:save']);
    await expect(menu.locator('.sn-menu-row [data-sn-icon-id="media:playPause"]')).toHaveAttribute('aria-label', /Riproduci/);
    await expect(menu.locator('.sn-menu-row .sn-menu-row-overflow')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu.pannelli).toHaveCount(0);
  }
  // Il clic sull'icona dell'audio lo zittisce, e riaperta l'icona dice il contrario.
  await page.locator('#aud').click({ button: 'right' });
  await menu.locator('.sn-menu-row [data-sn-icon-id="media:mute"]').click();
  await expect.poll(() => page.evaluate(() => document.getElementById('aud').muted)).toBe(true);
  await page.locator('#aud').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-row [data-sn-icon-id="media:mute"]')).toHaveAttribute('aria-label', /Riattiva audio/);
  await page.keyboard.press('Escape');

  await app.evaluate(({ clipboard }) => clipboard.writeText('dagli appunti'));
  await page.locator('#area').click();
  await page.locator('#area').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  expect((await iconeDellaFila(menu))[0]).toBe('cursore:paste');
  await menu.locator('.sn-menu-row [data-sn-icon-id="cursore:paste"]').click();
  await expect.poll(() => page.locator('#area').inputValue()).toBe('dagli appunti');
});

test('con del testo selezionato altrove, il tasto destro su un\'immagine o un collegamento dà la fila di quell\'elemento', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO(testServer.asset(PNG, 'image/png')));
  const menu = menuDi(page);
  for (const [sel, prima] of [['#foto', 'immagine:save'], ['#vai', 'link:openTab']]) {
    await selezionaTesto(page, '#testo');
    await page.locator(sel).click({ button: 'right' });
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    expect((await iconeDellaFila(menu))[0]).toBe(prima);
    await page.keyboard.press('Escape');
  }
  // Sopra la selezione resta il menu del testo.
  await selezionaTesto(page, '#testo');
  const r = await page.locator('#testo').boundingBox();
  await page.mouse.click(r.x + 30, r.y + r.height / 2, { button: 'right' });
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  expect((await iconeDellaFila(menu))[0]).toBe('testo:copy');
});

test('con tante icone portate nella stessa fila, vanno a capo dentro il menu', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO(testServer.asset(PNG, 'image/png')));
  await app.evaluate(async () => {
    for (const id of ['translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab', 'back', 'forward', 'reload', 'home']) {
      await globalThis.SN_LAYOUT_ICONE.posa({ id, target: 'fila:testo', beforeId: null });
    }
  });
  await selezionaTesto(page, '#testo');
  const r = await page.locator('#testo').boundingBox();
  await page.mouse.click(r.x + 30, r.y + r.height / 2, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  const fuori = await menu.principale.evaluate((m) => {
    const box = m.getBoundingClientRect();
    return [...m.querySelectorAll('.sn-menu-row .sn-menu-row-btn')]
      .filter((e) => { const q = e.getBoundingClientRect(); return q.right > box.right + 0.5 || q.left < box.left - 0.5; })
      .map((e) => e.dataset.snIconId || e.getAttribute('aria-label'));
  });
  expect(fuori, 'icone disegnate fuori dal menu').toEqual([]);
  expect(await iconeDellaFila(menu)).toHaveLength(13);
});

test('Chiedi a Filo su un\'immagine scritta nella pagina (data:) la allega con un nome da immagine', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO('/niente.png'));
  const src = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#c33'; g.fillRect(0, 0, 160, 120);
    const u = c.toDataURL('image/png');
    document.getElementById('foto').src = u;
    return u;
  });
  await page.locator('#foto').click({ button: 'right' });
  await menuDi(page).locator('.sn-menu-row [data-sn-icon-id="immagine:ask"]').click();
  let allegati = [];
  await expect.poll(async () => {
    allegati = await neiRiquadri(app, page, () => globalThis.__filoSidebarTest?.allegati?.() || []);
    return allegati.length;
  }, { timeout: 8000 }).toBe(1);
  expect(allegati[0].nome).toBe('immagine.png');
  expect(src.includes(allegati[0].nome)).toBe(false);
});

// Seleziona `parola` dentro `sel` (un campo che si scrive) e dà il punto dove cliccare.
const selezionaParola = (page, sel, parola) => page.evaluate(([s, p]) => {
  const el = document.querySelector(s);
  el.focus();
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const i = t.nodeValue.indexOf(p);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + p.length);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  return null;
}, [sel, parola]);

test('la fila legge gli stili della selezione: Grassetto acceso sul grassetto, Evidenzia premuto due volte toglie l\'evidenziato', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>Stili</title><body style="padding:40px">
    <div id="ricco" contenteditable="true" style="width:400px">Una <b>parola</b> da formattare.</div></body>`);
  const menu = menuDi(page);
  let p = await selezionaParola(page, '#ricco', 'parola');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:bold"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:italic"]')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');

  const fondo = () => page.evaluate(() => {
    const t = [...document.querySelectorAll('#ricco, #ricco *')].flatMap((n) => [...n.childNodes]).find((c) => c.nodeType === 3 && c.nodeValue.includes('formattare'));
    for (let n = t.parentElement; n && n.id !== 'ricco'; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
    }
    return '';
  });
  for (const [acceso, dopo] of [['false', /./], ['true', /^$/]]) {
    p = await selezionaParola(page, '#ricco', 'formattare');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    const ev = menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:highlight"]');
    await expect(ev).toHaveAttribute('aria-pressed', acceso);
    await ev.click();
    await expect.poll(fondo).toMatch(dopo);
  }
});

test('su un\'immagine o un filmato dentro un collegamento la fila apre il collegamento in una nuova scheda', async ({ app, openTab, testServer }) => {
  const meta = testServer.asset(Buffer.from('<!doctype html><title>Articolo</title><p>articolo</p>'), 'text/html');
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, `<!doctype html><title>Anteprime</title><body style="padding:40px">
    <a href="${meta}"><img id="foto" src="${img}" width="160" height="120" alt="anteprima"></a>
    <a href="${meta}" style="display:block;margin-top:20px"><video id="vid" width="200" height="110" style="background:#000"></video></a></body>`);
  const menu = menuDi(page);
  for (const [sel, ctx] of [['#vid', 'media'], ['#foto', 'immagine']]) {
    await page.locator(sel).click({ button: 'right' });
    await expect(menu.locator(`.sn-menu-row [data-sn-icon-id="${ctx}:openTab"]`)).toHaveAttribute('aria-label', /Apri in nuova tab/);
    await page.keyboard.press('Escape');
  }
  await page.locator('#foto').click({ button: 'right' });
  await menu.locator('.sn-menu-row [data-sn-icon-id="immagine:openTab"]').click();
  await expect.poll(() => app.evaluate(({ webContents }, u) => webContents.getAllWebContents().some((w) => w.getURL() === u), meta)).toBe(true);
});

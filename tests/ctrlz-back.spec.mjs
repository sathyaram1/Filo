// Feedback #267 — "fai in modo che con ctrl+z si torni indietro alla pagina
// precedente". Ctrl+Z deve funzionare come la freccia "Indietro": torna alla
// pagina precedente nella cronologia della scheda.
//
// L'invariante delicata (sollevata in revisione): Ctrl+Z è l'"annulla"
// universale. Dentro un campo di testo NON deve navigare, o scrivere perderebbe
// l'undo. Quindi due asserzioni, entrambe sul COMPORTAMENTO:
//   1) fuori da un campo di testo, Ctrl+Z torna davvero alla pagina precedente;
//   2) col fuoco in un <input>, Ctrl+Z NON naviga (resta "annulla").
//
// Precondizione = stato in cui senza il fix il test fallisce: senza la
// scorciatoia, (1) resta sulla pagina B (assert rosso); senza la guardia sui
// campi editabili, (2) navigherebbe a A (assert rosso).

import { test, expect, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apriCronologia, statoCronologia } from './helpers/cronologiaAppunti.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const PAGE_A = '<!doctype html><title>A</title><h1 id="mark-a">pagina A</h1>';
const PAGE_B = '<!doctype html><title>B</title><h1 id="mark-b">pagina B</h1>'
  + '<input id="box" type="text">';

// Naviga la scheda corrente verso `url` (stesso host del testServer) e aspetta
// che i content script Filo si siano rimontati sul nuovo documento.
async function navigateAndReady(page, url) {
  await page.evaluate((u) => { window.location.href = u; }, url);
  await page.waitForURL(url, { timeout: 10_000 });
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null,
    { timeout: 8_000 },
  );
}

test('Ctrl+Z torna alla pagina precedente (fuori dai campi di testo)', async ({ openTab, testServer }) => {
  const urlA = testServer.html(PAGE_A);
  const urlB = testServer.html(PAGE_B);

  // Parto su A, poi navigo su B: ora la scheda ha A nella cronologia indietro.
  const page = await testServer.openReady(openTab, PAGE_A);
  // openReady serve una pagina anonima: rinavigo su urlA "vero" così l'indietro
  // ha una destinazione stabile e verificabile per URL.
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, urlB);
  await expect(page.locator('#mark-b')).toBeVisible();

  // Fuoco fuori da qualsiasi campo: clic sul titolo (non editabile).
  await page.locator('#mark-b').click();

  // La scorciatoia richiesta.
  await page.keyboard.press('Control+z');

  // SUCCESSO = la scheda è tornata su A (la pagina precedente).
  await page.waitForURL(urlA, { timeout: 8_000 });
  await expect(page.locator('#mark-a')).toBeVisible();
});

test('Ctrl+Z resta "annulla" mentre si scrive in un campo di testo', async ({ openTab, testServer }) => {
  const urlA = testServer.html(PAGE_A);
  const urlB = testServer.html(PAGE_B);

  const page = await testServer.openReady(openTab, PAGE_A);
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, urlB);

  // Fuoco DENTRO il campo di testo.
  const box = page.locator('#box');
  await box.click();
  await box.type('ciao');
  await expect(box).toBeFocused();

  await page.keyboard.press('Control+z');

  // SUCCESSO = NON ha navigato: la scheda è ancora su B e la pagina A non è
  // stata caricata. (Se la guardia sui campi editabili mancasse, qui saremmo su A.)
  await page.waitForTimeout(500);
  expect(page.url()).toBe(urlB);
  await expect(page.locator('#mark-b')).toBeVisible();
  await expect(page.locator('#mark-a')).toHaveCount(0);
});

// #685.1 — un componente web a shadow DOM chiuso nasconde il suo campo: si scrive lo stesso.
test('Ctrl+Z resta "annulla" in un campo dentro un componente chiuso', async ({ openTab, testServer }) => {
  const urlA = testServer.html(PAGE_A);
  const urlC = testServer.html('<!doctype html><title>C</title><x-campo id="c"></x-campo><script>'
    + 'customElements.define("x-campo", class extends HTMLElement { constructor() { super();'
    + ' window.__campo = this.attachShadow({ mode: "closed" }); window.__campo.innerHTML = "<input style=width:300px>"; } });</script>');
  const page = await testServer.openReady(openTab, PAGE_A);
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, urlC);

  await page.locator('#c').click();
  await page.keyboard.type('scrivo');
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1_000);
  expect(page.url()).toBe(urlC);
  expect(await page.evaluate(() => window.__campo.querySelector('input').value)).toBe('');
});

// #685.1 — l'ombra chiusa si può appendere anche a un div: il campo lì dentro resta un campo.
test('Ctrl+Z resta "annulla" in un campo dentro un\'ombra chiusa appesa a un div', async ({ openTab, testServer }) => {
  const urlA = testServer.html(PAGE_A);
  const urlD = testServer.html('<!doctype html><title>D</title><div id="h"></div><script>'
    + 'window.__o = document.getElementById("h").attachShadow({ mode: "closed" }); window.__o.innerHTML = "<input style=width:300px>";</script>');
  const page = await testServer.openReady(openTab, PAGE_A);
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, urlD);

  await page.evaluate(() => window.__o.querySelector('input').focus());
  await page.keyboard.type('scrivo');
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1_000);
  expect(page.url()).toBe(urlD);
  expect(await page.evaluate(() => window.__o.querySelector('input').value)).toBe('');
});

// Una pagina che all'Invio toglie il fuoco al campo (al body, o a un contenitore che lo racchiude) lascia la
// selezione nel campo: lì non si scrive più, e Ctrl+Z torna indietro (#685.1 giri 6 e 7).
const PAGINE_FUOCO_LASCIATO = {
  'al body': '<!doctype html><title>R</title><input id="cerca">'
    + '<script>cerca.addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });</script>',
  'al contenitore principale': '<!doctype html><title>R</title><main id="m" tabindex="-1"><form><input id="cerca"></form></main>'
    + '<script>cerca.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); m.focus(); } });</script>',
  'alla scheda del commento': '<!doctype html><title>R</title><section id="m" tabindex="-1"><div id="cerca" contenteditable>x</div></section>'
    + '<script>cerca.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); m.focus(); } });</script>',
};
for (const [dove, html] of Object.entries(PAGINE_FUOCO_LASCIATO)) {
  test(`Ctrl+Z torna indietro dopo che la pagina ha dato il fuoco ${dove}`, async ({ openTab, testServer }) => {
    const urlA = testServer.html(PAGE_A);
    const urlR = testServer.html(html);
    const page = await testServer.openReady(openTab, PAGE_A);
    await navigateAndReady(page, urlA);
    await navigateAndReady(page, urlR);

    await page.locator('#cerca').click();
    await page.keyboard.type('gatti');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement.id !== 'cerca')).toBe(true);
    await page.keyboard.press('Control+z');
    await page.waitForURL(urlA, { timeout: 8_000 });
  });
}

// #685.1 — la ricerca negli appunti (tasto destro → freccetta di Incolla) sta in un'ombra chiusa appesa a un div:
// è un campo di testo, e i tasti che lì muovono il cursore o annullano non portano via la pagina.
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const urlAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.view.webContents.getURL();
});
const premiTasto = (app, keyCode, modifiers) => app.evaluate(({ BrowserWindow }, arg) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: arg.keyCode, modifiers: arg.modifiers });
  t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: arg.keyCode, modifiers: arg.modifiers });
}, { keyCode, modifiers });

for (const [nome, tasto, mod, mac] of [['Cmd+freccia sinistra su Mac', 'Left', ['meta'], true], ['Ctrl+Z', 'z', ['control'], false]]) {
  test(`scrivendo nella ricerca degli appunti, ${nome} non porta via la pagina`, async ({ testServer }) => {
    const userData = cartellaTemporanea('filo-685-appunti-');
    writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: [
      { type: 'text', text: 'primo appunto', ts: Date.now() - 2000 },
      { type: 'text', text: 'secondo appunto', ts: Date.now() - 1000 },
    ] }), 'utf8');
    const a = testServer.html('<!doctype html><h1>A</h1>');
    const b = testServer.html('<!doctype html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body>');
    const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
    try {
      const shell = await primaFinestra(app);
      await shell.evaluate((u) => window.filoShell.tabs.open(u), a);
      await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toBe(a);
      await app.evaluate(({ BrowserWindow }, u) => {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
        w._filoTabs.navigate(w._filoTabs.activeId, u);
      }, b);
      await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toBe(b);
      // Il main vede l'URL nuovo prima che Playwright aggiorni la pagina: cercarla una volta sola a volte non la trova.
      let page = null;
      await expect.poll(() => { page = app.windows().find((w) => w.url() === b); return !!page; }, { timeout: 10_000 }).toBe(true);
      await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
      if (mac) await app.evaluate(() => { Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true }); });
      const stato = await apriCronologia(app, page, '#ta');
      expect(stato.voci.length).toBe(2);
      // Il campo prende il fuoco un giro dopo essere montato: digitare prima perde le prime lettere.
      await expect.poll(async () => (await statoCronologia(app, page))?.cerca?.fuoco, { timeout: 3000 }).toBe(true);
      await page.keyboard.type('secondo');
      await expect.poll(async () => (await statoCronologia(app, page))?.cerca?.valore, { timeout: 3000 }).toBe('secondo');
      await page.waitForTimeout(400);
      await premiTasto(app, tasto, mod);
      await page.waitForTimeout(1500);
      expect(await urlAttiva(app)).toBe(b);
    } finally {
      await app.close().catch(() => {});
    }
  });
}


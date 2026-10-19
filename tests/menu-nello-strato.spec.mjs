// #1054 — col menu nello strato acceso, il tasto destro su una pagina web apre il menu di Filo nello strato sopra la
// scheda e funziona come quello di oggi: Incolla e la sua cronologia, Detta, una spiegazione, la griglia «Altro…», le
// icone che si trascinano. E un sito ostile non legge la cronologia né si fa incollare gli appunti (#586 giro 16).
// Regole: patterns/il-menu-del-tasto-destro-sta-in-uno-strato-sopra-la-scheda.md

import { test, expect } from './fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato, statoCronologia } from './helpers/menuContestuale.mjs';
import { cronologiaPronta } from './helpers/cronologiaAppunti.mjs';

test.use({ stratoDelMenu: true });

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function apriPagina(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

async function pronto(app) {
  const strato = await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  return strato;
}

const appunti = (app, testo) => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);

// Il menu si è aperto nello strato, e nel documento della scheda non c'è niente del menu.
async function apertoNelloStrato(app, page) {
  await expect.poll(async () => (await statoDelloStrato(app))?.aperto).toBe(true);
  await expect(menuDi(page).principale).toBeVisible();
  // menu-dal-sito: la prova cerca il menu nel documento del sito, dove non deve esserci.
  expect(await page.evaluate(() => document.querySelectorAll('.sn-menu, [data-sn-icon-id]').length)).toBe(0);
}

async function chiusoLoStrato(app) {
  await expect.poll(async () => { const s = await statoDelloStrato(app); return !!s && !s.aperto && !s.visibile; }).toBe(true);
}

// Il fuoco è nella scheda, nel campo dove l'utente aveva fatto tasto destro.
async function fuocoNelCampo(page, sel) {
  await expect.poll(() => page.evaluate((s) => document.hasFocus() && document.activeElement === document.querySelector(s), sel)).toBe(true);
}

test.describe('il menu nello strato', () => {
  test('Incolla mette gli appunti dove stava il cursore, in un campo e in un editor ricco, col fuoco rimesso lì', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0;font:16px sans-serif">
      <input id="campo" value="prima dopo" style="position:absolute;left:40px;top:40px;width:300px">
      <div id="ricco" contenteditable="true" style="position:absolute;left:40px;top:120px;width:300px;height:60px;border:1px solid #888">uno tre</div>
      <script>
        // Un editor «controllato» come quelli dei documenti online: l'incolla lo fa lui, dove dice la sua selezione.
        const ricco = document.getElementById('ricco');
        ricco.addEventListener('paste', (e) => {
          e.preventDefault();
          const t = e.clipboardData.getData('text/plain');
          const r = getSelection().getRangeAt(0);
          r.deleteContents();
          r.insertNode(document.createTextNode(t));
        });
      </script></body>`);
    await appunti(app, 'IN MEZZO ');

    // Il cursore dopo «prima ».
    await page.locator('#campo').click();
    await page.evaluate(() => { const c = document.getElementById('campo'); c.setSelectionRange(6, 6); });
    await page.locator('#campo').click({ button: 'right', position: { x: 60, y: 8 } });
    await apertoNelloStrato(app, page);
    await page.evaluate(() => { const c = document.getElementById('campo'); c.setSelectionRange(6, 6); });
    const menu = menuDi(page);
    await expect(menu.locator('.sn-menu-paste-main')).toContainText('Incolla');
    await menu.locator('.sn-menu-paste-main').click();
    await chiusoLoStrato(app);
    await expect(page.locator('#campo')).toHaveValue('prima IN MEZZO dopo');
    await fuocoNelCampo(page, '#campo');

    // Nell'editor ricco, fra «uno » e «tre».
    await page.locator('#ricco').click();
    await page.evaluate(() => {
      const t = document.getElementById('ricco').firstChild;
      const r = document.createRange();
      r.setStart(t, 4);
      r.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    const box = await page.locator('#ricco').boundingBox();
    await page.mouse.click(box.x + box.width - 20, box.y + box.height - 10, { button: 'right' });
    await apertoNelloStrato(app, page);
    await menu.locator('.sn-menu-paste-main').click();
    await chiusoLoStrato(app);
    await expect(page.locator('#ricco')).toHaveText('uno IN MEZZO tre');
    await fuocoNelCampo(page, '#ricco');
  });

  test('la cronologia degli appunti si apre nello strato, sceglie, toglie, e la pagina non ne legge niente', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    // Un Incolla vero su un'altra pagina porta il testo nella cronologia di Filo.
    await appunti(app, 'codice-banca-1054');
    const banca = await apriPagina(openTab, testServer, '<!doctype html><title>Banca</title><input id="c">');
    await banca.locator('#c').click({ button: 'right' });
    await apertoNelloStrato(app, banca);
    await menuDi(banca).locator('.sn-menu-paste-main').click();
    await expect(banca.locator('#c')).toHaveValue('codice-banca-1054');
    await appunti(app, 'altro-appunto');

    // menu-dal-sito: il sito ostile osserva tutto il documento (anche dentro gli shadow root) e cerca il testo.
    const page = await apriPagina(openTab, testServer, `<!doctype html><title>Ostile</title>
      <input id="campo" style="width:300px"><script>
      window.__letti = [];
      const guarda = (radice) => {
        new MutationObserver((ms) => {
          for (const m of ms) for (const n of m.addedNodes) {
            window.__letti.push(n.textContent || '');
            if (n.nodeType === 1) window.__letti.push(n.outerHTML || '');
            if (n.shadowRoot) guarda(n.shadowRoot);
          }
        }).observe(radice, { childList: true, subtree: true, characterData: true, attributes: true });
      };
      guarda(document.documentElement);
      setInterval(() => {
        window.__letti.push(document.documentElement.outerHTML);
        try { if (window.find('codice-banca-1054')) window.__letti.push('trovato con find'); } catch (_) {}
      }, 50);
    </script>`);
    await page.locator('#campo').click({ button: 'right' });
    await apertoNelloStrato(app, page);
    const menu = menuDi(page);
    await menu.locator('.sn-menu-paste-arrow').hover();
    const stato = await cronologiaPronta(app, page);
    expect(stato.voci.map((v) => v.testo)).toContain('codice-banca-1054');
    await pausa(500);
    const letti = await page.evaluate(() => window.__letti.join(' | '));
    expect(letti, 'il sito ha letto la cronologia degli appunti').not.toContain('codice-banca-1054');

    // Si cerca scrivendo: la tastiera è dello strato, e la scheda non riceve i tasti.
    const strato = menu.superficie;
    await strato.keyboard.type('banca');
    await expect.poll(async () => (await statoCronologia(app, page))?.cerca?.valore).toBe('banca');
    expect(await page.locator('#campo').inputValue()).toBe('');

    // La voce scelta finisce nel campo.
    const voce = (await statoCronologia(app, page)).voci.find((v) => v.testo === 'codice-banca-1054');
    await strato.mouse.click(voce.incolla.x, voce.incolla.y);
    await chiusoLoStrato(app);
    await expect(page.locator('#campo')).toHaveValue('codice-banca-1054');
    await fuocoNelCampo(page, '#campo');

    // Tolta dalla × resta barrata finché il pannello è aperto, e alla riapertura non c'è più.
    await page.locator('#campo').click({ button: 'right' });
    await apertoNelloStrato(app, page);
    await menu.locator('.sn-menu-paste-arrow').hover();
    const s2 = await cronologiaPronta(app, page);
    const da = s2.voci.find((v) => v.testo === 'codice-banca-1054');
    await strato.mouse.click(da.rimuovi.x, da.rimuovi.y);
    await expect.poll(async () => (await statoCronologia(app, page))?.voci.find((v) => v.testo === 'codice-banca-1054')?.tolta).toBe(true);
    await strato.keyboard.press('Escape');
    await chiusoLoStrato(app);
    await page.locator('#campo').click({ button: 'right' });
    await apertoNelloStrato(app, page);
    await menu.locator('.sn-menu-paste-arrow').hover();
    const s3 = await cronologiaPronta(app, page);
    expect(s3.voci.map((v) => v.testo)).not.toContain('codice-banca-1054');
    expect((await page.evaluate(() => window.__letti.join(' | ')))).not.toContain('codice-banca-1054');
  });

  test('un «Incolla» premuto o travestito dalla pagina non porta gli appunti nel campo', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    await appunti(app, 'password-1054');
    // menu-dal-sito: il sito cerca il menu per riscriverlo e premerlo, e clicca dove il menu si disegna.
    const page = await apriPagina(openTab, testServer, `<!doctype html><title>Ostile</title>
      <input id="campo" style="position:absolute;left:20px;top:20px;width:300px"><script>
      window.__premuti = 0;
      const premi = () => {
        for (const b of document.querySelectorAll('.sn-menu-paste-main, .sn-menu button, button')) {
          for (const n of b.querySelectorAll('*')) if (!n.children.length && n.textContent.trim()) n.textContent = 'Traduci la pagina';
          b.click();
          window.__premuti++;
        }
        for (let x = 20; x < 400; x += 20) for (let y = 20; y < 500; y += 20) {
          const el = document.elementFromPoint(x, y);
          if (el && el.id !== 'campo') { el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })); }
        }
        try { document.execCommand('paste'); } catch (_) {}
        document.getElementById('campo').focus();
      };
      new MutationObserver(premi).observe(document.documentElement, { childList: true, subtree: true });
      addEventListener('contextmenu', () => setTimeout(premi, 0), true);
      setInterval(premi, 100);
    </script>`);
    await page.locator('#campo').click({ button: 'right' });
    await apertoNelloStrato(app, page);
    const menu = menuDi(page);
    // Lo strato dice quello che fa: la pagina non ne cambia le parole.
    await expect(menu.locator('.sn-menu-paste-main')).toContainText('Incolla');
    await pausa(1500);
    expect(await page.locator('#campo').inputValue(), 'la pagina ha incollato gli appunti da sé').toBe('');
    expect((await statoDelloStrato(app)).aperto, 'la pagina non chiude il menu').toBe(true);
    // Con la voce vera, premuta dall'utente, gli appunti arrivano: c'era davvero qualcosa da rubare.
    await menu.locator('.sn-menu-paste-main').click();
    await expect(page.locator('#campo')).toHaveValue('password-1054');
  });
});

// #1054 — col menu nello strato acceso il tasto destro su un sito apre il menu di Filo sopra la scheda, e funziona come
// quello di oggi: Incolla e cronologia, Detta, spiegazione, correttore; la barra laterale gli sta sopra; un sito ostile
// non legge la cronologia (#586 giro 16). Regole: patterns/il-menu-del-tasto-destro-sta-in-uno-strato-sopra-la-scheda.md

import { test, expect } from './fixtures/electron.mjs';
import { menuDi, menuDelloStratoAperto, paginaDelloStrato, statoDelloStrato, statoCronologia } from './helpers/menuContestuale.mjs';
import { cronologiaPronta } from './helpers/cronologiaAppunti.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

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

// Un modello finto nel main: la spiegazione di una selezione, la parola del correttore.
async function fornitoreFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chieste = [];
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      globalThis.__chieste.push(t);
      if (t.includes('ha selezionato un testo')) return { text: 'Spiegazione **di prova** dello strato', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      if (t.includes('col tasto destro su una parola')) return { text: '{"misspelled":false,"correction":""}', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      return { text: 'ok', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}

const appunti = (app, testo) => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);

// Il menu si è aperto nello strato, e nel documento della scheda non c'è niente del menu.
async function apertoNelloStrato(app, page) {
  await expect.poll(async () => (await statoDelloStrato(app))?.aperto).toBe(true);
  await expect(menuDi(page).principale).toBeVisible();
  // Nel punto del tasto destro, come il menu di oggi (o ribaltato sul punto quando sotto non ci sta).
  const { punto } = await statoDelloStrato(app);
  const b = await menuDi(page).principale.boundingBox();
  const vicino = (v, a, c) => Math.abs(v - a) <= 2 || Math.abs(v - c) <= 2;
  expect(vicino(punto.x, b.x, b.x + b.width) || b.x + b.width >= punto.x, `menu a ${b.x},${b.y}, punto ${punto.x},${punto.y}`).toBe(true);
  expect(vicino(punto.y, b.y, b.y + b.height), `menu a ${b.x},${b.y}, punto ${punto.x},${punto.y}`).toBe(true);
  // menu-dal-sito: la prova cerca il menu nel documento del sito, dove non deve esserci.
  expect(await page.evaluate(() => document.querySelectorAll('.sn-menu').length)).toBe(0);
}

async function chiusoLoStrato(app) {
  await expect.poll(async () => { const s = await statoDelloStrato(app); return !!s && !s.aperto && !s.visibile; }).toBe(true);
}

// Il fuoco è nella scheda, nel campo dove l'utente aveva fatto tasto destro.
async function fuocoNelCampo(page, sel) {
  await expect.poll(() => page.evaluate((s) => document.hasFocus() && document.activeElement === document.querySelector(s), sel)).toBe(true);
}

test.describe('il menu nello strato', () => {
  test('appena aperto Filo, il primo tasto destro trova il menu anche se lo strato sta ancora caricando', async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;height:100vh"><p style="margin:60px">pagina</p></body>');
    await pronto(app);
    // Lo strato ancora in caricamento per un attimo, come al primo avvio su una macchina lenta.
    await app.evaluate(({ BrowserWindow }) => {
      const s = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.strato;
      s.pronta = false;
      setTimeout(() => { s.pronta = true; }, 700);
    });
    await page.mouse.click(200, 200, { button: 'right' });
    await apertoNelloStrato(app, page);
    await expect(menuDi(page).voce('Aiuto')).toBeVisible();
  });

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

    // Il cursore è dove l'utente ha fatto tasto destro, a metà del testo.
    await page.locator('#campo').click({ button: 'right', position: { x: 40, y: 8 } });
    await apertoNelloStrato(app, page);
    const qui = await page.evaluate(() => document.getElementById('campo').selectionStart);
    expect(qui).toBeGreaterThan(0);
    expect(qui).toBeLessThan('prima dopo'.length);
    const menu = menuDi(page);
    await expect(menu.locator('.sn-menu-paste-main')).toContainText('Incolla');
    await menu.locator('.sn-menu-paste-main').click();
    await chiusoLoStrato(app);
    await expect(page.locator('#campo')).toHaveValue(`${'prima dopo'.slice(0, qui)}IN MEZZO ${'prima dopo'.slice(qui)}`);
    await fuocoNelCampo(page, '#campo');

    // Nell'editor ricco, tasto destro fra «uno » e «tre».
    const p = await page.evaluate(() => {
      const t = document.getElementById('ricco').firstChild;
      const r = document.createRange();
      r.setStart(t, 4);
      r.setEnd(t, 5);
      const b = r.getBoundingClientRect();
      return { x: b.left + 1, y: b.top + b.height / 2 };
    });
    await page.mouse.click(p.x, p.y, { button: 'right' });
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
        // Il testo del documento, senza questo script che nomina il pezzo da cercare.
        window.__letti.push(document.body.innerText);
        try { if (window.find(['codice', 'banca', '1054'].join('-'))) window.__letti.push('trovato con find'); } catch (_) {}
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

  test('una spiegazione arriva nello strato, mai nel documento, e «Approfondisci» parte da lì', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    await fornitoreFinto(app);
    const page = await testServer.openReady(openTab, `<!doctype html><body style="font:18px sans-serif;padding:40px">
      <p id="testo">Il fotone è la particella elementare della luce.</p></body>`, { pubblico: true });
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    const p = await page.evaluate(() => {
      const t = document.getElementById('testo').firstChild;
      const r = document.createRange();
      r.setStart(t, 3);
      r.setEnd(t, 9);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await apertoNelloStrato(app, page);
    const menu = menuDi(page);
    const sezione = menu.locator('.sn-menu-inline-explain');
    await expect(sezione).toContainText('Spiegazione di prova dello strato', { timeout: 8000 });
    // Il grassetto del modello resta grassetto, e nessuno script viaggia con lui.
    await expect(sezione.locator('strong')).toHaveText('di prova');
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('Spiegazione di prova');

    const prima = await app.evaluate(() => globalThis.__chieste.length);
    await sezione.locator('.sn-menu-inline-arrow').click();
    await chiusoLoStrato(app);
    await expect.poll(() => app.evaluate(() => globalThis.__chieste.length), { timeout: 8000 }).toBeGreaterThan(prima);
  });

  test('il correttore riempie la riga in cima a menu aperto, e la correzione scelta va nel campo', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    await fornitoreFinto(app);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0">
      <textarea id="ta" style="position:absolute;left:40px;top:40px;width:420px;height:80px;font:24px monospace;padding:10px">ciiao come stai</textarea></body>`);
    await page.locator('#ta').click();
    const box = await page.locator('#ta').boundingBox();
    await page.mouse.click(box.x + 10 + 30, box.y + 10 + 14, { button: 'right' });
    await apertoNelloStrato(app, page);
    // Il correttore nativo arriva dopo l'apertura: la riga nascosta si riempie nello strato.
    await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.tabs.find((t) => t.id === tm.activeId).view.webContents.send('filo:broadcast', { type: '_spell:native', word: 'ciiao', suggestions: ['ciao', 'chiao'] });
    });
    const menu = menuDi(page);
    const riga = menu.locator('.sn-menu-correction');
    await expect(riga).toBeVisible({ timeout: 5000 });
    await expect(riga.locator('.sn-menu-label').first()).toHaveText('ciao');
    await riga.locator('.sn-menu-correction-main').click();
    await chiusoLoStrato(app);
    await expect(page.locator('#ta')).toHaveValue('ciao come stai');
  });

  test('un tasto destro fuori dal menu lo riapre lì, e Esc o un clic fuori lo chiudono senza toccare la pagina', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0;height:100vh">
      <a id="link" href="https://example.com/x" style="position:absolute;left:500px;top:300px">un collegamento</a>
      <script>window.clic = 0; addEventListener('click', () => { window.clic++; }, true);</script></body>`);
    await page.mouse.click(100, 100, { button: 'right' });
    await apertoNelloStrato(app, page);
    const menu = menuDi(page);
    await expect(menu.voce('Copia URL')).toHaveCount(0);
    const strato = menu.superficie;
    const l = await page.locator('#link').boundingBox();
    await strato.mouse.click(l.x + 10, l.y + l.height / 2, { button: 'right' });
    await expect(menu.voce('Copia URL')).toBeVisible({ timeout: 5000 });
    const s = await statoDelloStrato(app);
    expect(Math.abs(s.punto.x - Math.round(l.x + 10))).toBeLessThanOrEqual(1);
    await strato.keyboard.press('Escape');
    await chiusoLoStrato(app);
    // Anche l'Esc che arriva alla scheda (la tastiera è rimasta lì) lo chiude.
    await page.mouse.click(100, 100, { button: 'right' });
    await apertoNelloStrato(app, page);
    await page.keyboard.press('Escape');
    await chiusoLoStrato(app);
    await page.mouse.click(100, 100, { button: 'right' });
    await apertoNelloStrato(app, page);
    await page.evaluate(() => { window.clic = 0; });
    await strato.mouse.click(700, 500);
    await chiusoLoStrato(app);
    expect(await page.evaluate(() => window.clic)).toBe(0);
  });

  test('Detta, scelta nello strato, scrive nel campo della pagina quello che si dice', async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(90_000);
    await pronto(app);
    await app.evaluate(async () => {
      await globalThis.SN_STORAGE.setSettings({
        useDefaultModels: false,
        apiKeys: { openrouter: 'k-test' },
        modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
        models: { ...globalThis.SN_TEST_MODELS.models },
      });
      globalThis.__dettate = 0;
      globalThis.SN_PROVIDER_OPENROUTER.transcribe = async ({ audioBase64 }) => {
        globalThis.__dettate += 1;
        const bytes = Buffer.from(String(audioBase64 || ''), 'base64').length;
        return { text: ` frase ${globalThis.__dettate} `, usage: { seconds: bytes / 32000, costUsd: 0.00001 }, generationId: null };
      };
    });
    // Il microfono lo apre la finestra di Filo per la pagina: qui un tono, che per chi spezza le frasi è voce.
    await shell.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const ac = new AudioContext();
        const osc = ac.createOscillator();
        osc.frequency.value = 220;
        const gain = ac.createGain();
        gain.gain.value = 0.4;
        const dest = ac.createMediaStreamDestination();
        osc.connect(gain); gain.connect(dest); osc.start();
        try { await ac.resume(); } catch (_) {}
        window.__tono = gain;
        return dest.stream;
      };
    });
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0">
      <textarea id="campo" style="position:absolute;left:40px;top:40px;width:320px;height:60px"></textarea></body>`);
    await page.locator('#campo').click({ button: 'right' });
    await apertoNelloStrato(app, page);
    await menuDi(page).locator('.sn-menu-split-main', { hasText: 'Detta' }).click();
    await chiusoLoStrato(app);
    await expect.poll(() => shell.evaluate(() => !!window.__tono), { timeout: 10_000 }).toBe(true);
    await pausa(1800);
    await shell.evaluate(() => { window.__tono.gain.value = 0; });
    await expect.poll(() => page.locator('#campo').inputValue(), { timeout: 15_000 }).toMatch(/frase \d+/);
  });

  test('aspetto: il menu dello strato in tema chiaro e scuro', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0;background:#fff">
      <input id="campo" style="position:absolute;left:40px;top:40px;width:300px"><p style="margin:120px 40px">Testo della pagina</p></body>`);
    const menu = menuDi(page);
    for (const tema of ['light', 'dark']) {
      await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
      await page.locator('#campo').click({ button: 'right' });
      await apertoNelloStrato(app, page);
      await expect.poll(() => menu.valuta(() => document.documentElement.dataset.snTheme)).toBe(tema);
      await pausa(300);
      await menu.superficie.screenshot({ path: `tests/.shots/menu-nello-strato-${tema}.png` });
      await page.screenshot({ path: `tests/.shots/menu-nello-strato-${tema}-scheda.png` });
      await menu.superficie.keyboard.press('Escape');
      await chiusoLoStrato(app);
    }
  });

  test('il menu di una selezione resta mentre la rotella fa scorrere la pagina sotto; quello normale si chiude', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0;font:18px sans-serif">
      <p id="testo" style="margin:40px">Una frase da selezionare qui.</p><div style="height:3000px"></div></body>`);
    const p = await page.evaluate(() => {
      const t = document.getElementById('testo').firstChild;
      const r = document.createRange();
      r.setStart(t, 4);
      r.setEnd(t, 9);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await apertoNelloStrato(app, page);
    const strato = menuDi(page).superficie;
    await strato.mouse.move(900, 500);
    await strato.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    expect((await statoDelloStrato(app)).aperto, 'il menu della selezione resta aperto').toBe(true);
    await strato.keyboard.press('Escape');
    await chiusoLoStrato(app);

    // La pagina ferma in cima prima del tasto destro: uno scorrimento ancora in arrivo chiude il menu normale appena aperto.
    await expect.poll(() => page.evaluate(() => new Promise((ok) => {
      getSelection().removeAllRanges();
      window.scrollTo({ top: 0, behavior: 'instant' });
      setTimeout(() => ok(window.scrollY), 250);
    }))).toBe(0);
    await page.mouse.click(300, 300, { button: 'right' });
    await apertoNelloStrato(app, page);
    await strato.mouse.move(900, 500);
    await strato.mouse.wheel(0, 400);
    await chiusoLoStrato(app);
  });

  test('la finestra che si accorcia lascia il menu aperto e lo fa rientrare, come il menu di oggi (#500)', async ({ app, openTab, testServer }) => {
    await pronto(app);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0;font:16px sans-serif;height:4000px">
      <div style="height:55vh"></div><a id="link" href="https://example.com/a">un collegamento</a></body>`);
    await page.locator('#link').click({ button: 'right' });
    const menu = menuDi(page);
    await expect(menu.principale).toBeVisible();
    const prima = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const b = w.getBounds();
      w.setBounds({ ...b, height: b.height - 340 });
      return b;
    });
    try {
      // Lo strato segue la scheda: stessa area, ancora in cima, e il menu dentro la finestra con l'ultima voce a portata.
      await expect.poll(async () => { const s = await statoDelloStrato(app); return !!s && s.aperto && s.visibile && s.inCima && s.bounds.height === s.area.height && s.area.height < prima.height - 300; }).toBe(true);
      await expect.poll(async () => {
        const r = await menu.principale.boundingBox();
        return !!r && r.y >= 0 && r.y + r.height <= await menu.valuta(() => innerHeight) + 1;
      }).toBe(true);
      await menu.voce('Copia URL').click();
      await chiusoLoStrato(app);
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://example.com/a');
    } finally {
      await app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setBounds(b), prima);
    }
  });

  test('la pagina che scorre da tastiera o da sola chiude il menu normale, quello di una selezione resta', async ({ app, openTab, testServer }) => {
    const inCima = (page) => expect.poll(() => page.evaluate(() => new Promise((ok) => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      setTimeout(() => ok(window.scrollY), 250);
    }))).toBe(0);
    await pronto(app);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0;font:16px sans-serif;height:4000px">
      <p id="testo" style="margin:40px">Una frase da selezionare qui.</p>
      <div style="height:30vh"></div><a id="link" href="https://example.com/a">un collegamento</a></body>`);
    await page.locator('#link').click({ button: 'right' });
    await apertoNelloStrato(app, page);
    await page.keyboard.press('PageDown');
    await chiusoLoStrato(app);

    // Lo scorrimento morbido di Pagina giù va lasciato finire: un suo evento ancora in arrivo chiuderebbe il menu nuovo.
    await inCima(page);
    await page.locator('#link').click({ button: 'right' });
    await apertoNelloStrato(app, page);
    await page.evaluate(() => window.scrollBy(0, 200));
    await chiusoLoStrato(app);

    await inCima(page);
    const p = await page.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.getElementById('testo'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await apertoNelloStrato(app, page);
    await page.evaluate(() => window.scrollBy(0, 200));
    await page.waitForTimeout(500);
    expect((await statoDelloStrato(app)).aperto, 'il menu della selezione resta aperto').toBe(true);
  });

  test('un collegamento scritto nella spiegazione si apre in una scheda nuova, come nel menu di oggi', async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    const dest = testServer.html('<!doctype html><title>Destinazione</title><p>ok</p>');
    await fornitoreFinto(app);
    await app.evaluate((_, d) => {
      const finto = async ({ messages }) => {
        const t = JSON.stringify(messages);
        return { text: t.includes('ha selezionato un testo') ? `Vedi [la fonte](${d}) per saperne di più.` : 'ok', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      };
      globalThis.SN_PROVIDERS.completeWithFallback = finto;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    }, dest);
    const page = await testServer.openReady(openTab, `<!doctype html><body style="font:18px sans-serif;padding:40px">
      <p id="testo">Il fotone è la particella elementare della luce.</p></body>`, { pubblico: true });
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    const p = await page.evaluate(() => {
      const t = document.getElementById('testo').firstChild;
      const r = document.createRange();
      r.setStart(t, 3);
      r.setEnd(t, 9);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await apertoNelloStrato(app, page);
    const link = menuDi(page).locator('.sn-menu-inline-explain a.filo-md-link', { hasText: 'la fonte' });
    await expect(link).toBeVisible({ timeout: 8000 });
    // Si vede che è un collegamento, come nella pagina.
    expect(await link.evaluate((a) => getComputedStyle(a).textDecorationLine)).toContain('underline');
    const urlSchede = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.url));
    await link.click();
    await expect.poll(urlSchede, { timeout: 8000 }).toContain(dest);
  });

  test('a menu aperto la barra laterale si apre sopra lo strato, e il menu resta aperto mentre la si usa', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0;padding:40px;height:1400px">
      <p id="p">Clic destro qui.</p></body>`);
    const barra = await barraPage(app);
    await page.locator('#p').click({ button: 'right' });
    await apertoNelloStrato(app, page);
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    // La barra aperta sta sopra lo strato: il puntatore la raggiunge.
    expect((await statoDelloStrato(app)).inCima).toBe(true);
    expect(await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const figli = w.contentView.children;
      return figli[figli.length - 1] === w._filoTabs.barra.vista;
    })).toBe(true);
    // Home trascinata sopra Indietro: la barra si riordina, e il menu è ancora lì.
    const src = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
    const dst = await barra.locator('#nav .ico[data-id="back"]').boundingBox();
    await barra.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await barra.mouse.down();
    await barra.mouse.move(src.x + src.width / 2 + 2, src.y - 10, { steps: 3 });
    await barra.mouse.move(dst.x + dst.width / 2, dst.y + 4, { steps: 8 });
    await barra.mouse.up();
    await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 3)).toEqual(['help', 'home', 'back']);
    expect((await statoDelloStrato(app)).aperto).toBe(true);
    await expect(menuDi(page).principale).toBeVisible();
  });

  test('nella finestrella di accesso aperta da un sito il menu sta nel suo strato, e Incolla scrive nel campo', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    const FINTA = 'https://login.sito-finto.it/login';
    await app.evaluate(({ session, net }, html) => {
      try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
      session.defaultSession.protocol.handle('https', (req) => {
        const u = new URL(req.url);
        if (u.hostname + u.pathname === 'login.sito-finto.it/login') return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        return net.fetch(req, { bypassCustomProtocolHandlers: true });
      });
      globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
    }, '<title>Accedi</title><body style="margin:20px"><input id="pw" type="password" style="width:200px"></body>');
    await appunti(app, 'segreto-1054');
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:40px">
      <button id="b" style="width:200px;height:50px" onclick="window.open('${FINTA}', 'acc', 'width=500,height=400')">Accedi con</button></body>`);
    await page.locator('#b').click();
    let pop = null;
    await expect.poll(() => Boolean(pop = app.windows().find((w) => { try { return w.url() === FINTA; } catch (_) { return false; } })), { timeout: 8000 }).toBe(true);
    await pop.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await pop.locator('#pw').click({ button: 'right' });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoStrato && w._filoStrato.stato().aperto)), { timeout: 5000 }).toBe(true);
    // menu-dal-sito: lo script della finestrella non trova il menu nel suo documento.
    expect(await pop.evaluate(() => document.documentElement.innerText)).not.toContain('Incolla');
    let menu = null;
    await expect.poll(async () => Boolean(menu = await menuDelloStratoAperto(app)), { timeout: 5000 }).toBe(true);
    await menu.locator('.sn-menu-paste-main').click();
    await expect(pop.locator('#pw')).toHaveValue('segreto-1054');
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoStrato && w._filoStrato.stato().aperto))).toBe(false);
  });
});

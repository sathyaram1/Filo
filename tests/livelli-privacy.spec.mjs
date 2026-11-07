// #1589 — i livelli di privacy: si sceglie una volta nell'intervista, si rivede in Sicurezza, si cambia in chat
// (alzare vuole «conferma»); il tasto destro su un'immagine aspetta il clic dove Filo chiede prima; l'incognito chiede
// sempre; il pavimento tiene password, carte e codici lontani dal modello a ogni livello.

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm, confirmState, fillConfirmInput, scrollConfirmToEnd } from './helpers/confirm.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { home } from './helpers/chatFinta.mjs';

const SANITA = 'sanita-di-prova.test';
const POSTA = 'posta-di-prova.test';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const privacy = (app) => app.evaluate(async () => globalThis.SN_LIVELLI_PRIVACY.regola(await globalThis.SN_STORAGE.getSettings()));

// Il modello finto registra quello che riceve e risponde «Descrizione finta.».
async function modelliFinti(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      globalThis.__mandato.push(JSON.stringify(messages));
      return { text: 'Descrizione finta.', provider: 'openrouter', model: 'stub', usage: {} };
    };
  });
}
const immaginiMandate = (app) => app.evaluate(() => globalThis.__mandato.filter((m) => m.includes('image_url')).length);

// Una pagina col suo nome da internet: l'elenco di serie si allunga di un sito di prova per categoria.
async function siteDiProva(app) {
  await app.evaluate(({}, { SANITA, POSTA }) => {
    const P = globalThis.SN_PAGINE_DELICATE.PREDEFINITI;
    if (!P.sanita.includes(SANITA)) P.sanita.push(SANITA);
    if (!P.posta.includes(POSTA)) P.posta.push(POSTA);
  }, { SANITA, POSTA });
}
const CON_IMMAGINE = `<!doctype html><html><head><title>Referto</title></head><body style="margin:0;padding:40px">
  <img id="foto" src="${PNG}" style="width:160px;height:120px;display:block"><p>Esito delle analisi</p></body></html>`;
async function apriSu(openTab, testServer, host, corpo) {
  const url = testServer.html(corpo).replace('127.0.0.1', host);
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  return page;
}
async function tastoDestroSullaFoto(page) {
  const b = await page.locator('#foto').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const sezione = menuDi(page).locator('.sn-menu-inline[data-subject="image"]');
  await expect(sezione).toBeVisible({ timeout: 10_000 });
  return sezione;
}

test.describe('nel sito', () => {
  test.use({ hostInPiu: [SANITA, POSTA] });

  test('su una pagina di sanità col livello di serie il tasto destro su un\'immagine mostra «Descrivi» e non parte; sulla posta parte', async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    await modelliFinti(app);
    await siteDiProva(app);
    expect(await privacy(app)).toEqual(expect.objectContaining({ livello: 'anticipo', chiedi: ['sanita'] }));

    const referto = await apriSu(openTab, testServer, SANITA, CON_IMMAGINE);
    const sezione = await tastoDestroSullaFoto(referto);
    const descrivi = sezione.locator('.sn-menu-inline-chiedi-tasto');
    await expect(descrivi).toHaveText('Descrivi');
    await expect(descrivi).toHaveAttribute('title', /solo quello che chiedi/);
    await pausa(800);
    expect(await immaginiMandate(app), 'aperto il menu, l\'immagine non è partita').toBe(0);
    await menuDi(referto).superficie.screenshot({ path: 'tests/.shots/1589-descrivi-sanita.png' }).catch(() => {});
    // La descrizione si disegna in glifi che il sito non legge (#946): qui conta che parta, e che il tasto se ne vada.
    await descrivi.click();
    await expect.poll(() => immaginiMandate(app), { timeout: 10_000 }).toBe(1);
    await expect(descrivi).toHaveCount(0);
    await referto.keyboard.press('Escape');

    // La stessa immagine si ricorderebbe dalla cache: sulla posta la si chiede di nuovo da capo.
    await app.evaluate(() => globalThis.SN_AI_CACHE.clear());
    const mail = await apriSu(openTab, testServer, POSTA, CON_IMMAGINE.replace('Referto', 'Posta in arrivo'));
    const daSola = await tastoDestroSullaFoto(mail);
    await expect.poll(() => immaginiMandate(app), { timeout: 10_000 }).toBe(2);
    await expect(daSola.locator('.sn-menu-inline-chiedi-tasto')).toHaveCount(0);
  });

  // La spiegazione del link passa dallo stream: anche lì il livello decide prima che parta.
  test('su una pagina di sanità il tasto destro su un link mostra «Spiega il link» e non parte', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await modelliFinti(app);
    await siteDiProva(app);
    await app.evaluate(() => {
      globalThis.__stream = 0;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
        globalThis.__stream += 1;
        try { onDelta && onDelta('Porta alla prenotazione.'); } catch (_) {}
        return { text: 'Porta alla prenotazione.', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      };
    });
    const altra = testServer.html('<!doctype html><title>Prenota</title><body>Prenota</body>').replace('127.0.0.1', SANITA);
    const pagina = await apriSu(openTab, testServer, SANITA, `<!doctype html><title>Referto</title>
      <body style="padding:40px;font:20px sans-serif"><a id="l" href="${altra}">Prenota la visita</a></body>`);
    const b = await pagina.locator('#l').boundingBox();
    await pagina.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
    const sezione = menuDi(pagina).locator('.sn-menu-inline[data-subject="link"]');
    const tasto = sezione.locator('.sn-menu-inline-chiedi-tasto');
    await expect(tasto).toHaveText('Spiega il link', { timeout: 10_000 });
    await pausa(800);
    expect(await app.evaluate(() => globalThis.__stream), 'aperto il menu, il link non è partito').toBe(0);
    await tasto.click();
    await expect(sezione).toContainText('Porta alla prenotazione.', { timeout: 10_000 });
    expect(await app.evaluate(() => globalThis.__stream)).toBe(1);
  });

  test('a «Chiedi sempre» anche una pagina qualunque aspetta il clic, e il correttore aspetta «Controlla»', async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    await modelliFinti(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ security: { privacy: { livello: 'sempre' } } }));
    const pagina = await apriSu(openTab, testServer, 'sito-pubblico.test', CON_IMMAGINE.replace('Referto', 'Ricetta'));
    const sezione = await tastoDestroSullaFoto(pagina);
    await expect(sezione.locator('.sn-menu-inline-chiedi-tasto')).toHaveText('Descrivi');
    await pagina.keyboard.press('Escape');

    // Il correttore: il primo controllo che partirebbe da solo si ferma, e sul campo compare «Controlla».
    const scrivi = await apriSu(openTab, testServer, 'sito-pubblico.test', `<!doctype html><title>Messaggio</title>
      <body style="padding:30px"><textarea id="t" style="width:400px;height:120px"></textarea></body>`);
    await scrivi.locator('#t').click();
    await scrivi.keyboard.type('Domani vado al mare con la mia famiglia. ', { delay: 20 });
    await pausa(1500);
    const delCampo = () => app.evaluate(() => globalThis.__mandato.filter((m) => m.includes('Domani vado al mare')).length);
    expect(await delCampo(), 'il correttore non manda niente da solo').toBe(0);
    await scrivi.locator('#t').click({ button: 'right' });
    const controlla = menuDi(scrivi).voce('Controlla');
    await expect(controlla).toBeVisible({ timeout: 10_000 });
    await controlla.click();
    await expect.poll(delCampo, { timeout: 10_000 }).toBeGreaterThan(0);
  });
});

// La sezione del tasto destro si monta nel mondo dei content script della scheda in incognito, come la monta il menu.
test('in incognito, di serie, la descrizione del tasto destro aspetta il clic', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  await modelliFinti(app);
  expect((await privacy(app)).incognito).toBe('sempre');
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  const url = testServer.html(CON_IMMAGINE.replace('Referto', 'Ricetta'), { pubblico: true });
  const nellaScheda = (codice) => app.evaluate(async ({ BrowserWindow }, { url, codice }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)._filoTabs;
    let tab = tm.tabs.find((t) => t.url === url);
    if (!tab) {
      const id = tm.openTab(url);
      const t0 = Date.now();
      while (Date.now() - t0 < 10_000) {
        tab = tm.tabs.find((t) => t.id === id);
        const pronta = tab && tab.view && await tab.view.webContents.executeJavaScript(
          'document.documentElement.dataset.filoContentReady === "1"').catch(() => false);
        if (pronta) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: codice }], true);
  }, { url, codice });
  await nellaScheda(`(() => {
    const el = document.createElement('div');
    window.__sezione = el;
    SN_ACTIONS.buildInlineExplainImage(document.getElementById('foto')).onMount(el);
    return true;
  })()`);
  const tasto = () => nellaScheda(`(window.__sezione.querySelector('button') || {}).textContent || ''`);
  await expect.poll(tasto, { timeout: 10_000 }).toBe('Descrivi');
  await pausa(800);
  expect(await immaginiMandate(app)).toBe(0);
  await nellaScheda(`window.__sezione.querySelector('button').click()`);
  await expect.poll(() => immaginiMandate(app), { timeout: 10_000 }).toBe(1);
});

test('in Sicurezza il livello si vede e si cambia: abbassarlo parte, alzarlo vuole «conferma»; la pagina segue la chat', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const sicurezza = await openTab('filo://security/security.html');
  await expect(sicurezza.locator('#sec-privacy-title')).toHaveText('Quanto Filo manda ai modelli', { timeout: 8000 });
  await expect(sicurezza.locator('#privacy-livello-anticipo')).toBeChecked();
  await expect(sicurezza.locator('#privacy-livello-anticipo-desc')).toHaveText(/sulla sanità chiede prima/);
  await expect(sicurezza.locator('#privacy-livello-sempre-label')).toHaveText('Chiedi sempre');
  await expect(sicurezza.locator('#privacy-incognito')).toHaveValue('sempre');
  const categoria = (nome) => sicurezza.locator('.sn-privacy-categoria', { hasText: nome }).locator('input');
  await expect(categoria('sanità')).toBeChecked();
  await expect(categoria('posta')).not.toBeChecked();
  await expect(sicurezza.locator('#privacy-pavimento')).toContainText('non escono a nessun livello');
  await sicurezza.locator('#sec-privacy').screenshot({ path: 'tests/.shots/1589-sicurezza-chiaro.png' });

  await sicurezza.locator('label:has(#privacy-livello-sempre)').click();
  await expect(sicurezza.locator(CONFIRM_HOST)).toHaveCount(0);
  await expect.poll(async () => (await privacy(app)).livello, { timeout: 4000 }).toBe('sempre');
  await expect(categoria('posta')).toBeDisabled();

  // Alzare: senza la parola resta com'era, con la parola passa.
  await sicurezza.locator('label:has(#privacy-livello-anticipo)').click();
  await expect(sicurezza.locator(CONFIRM_HOST)).toBeVisible();
  expect((await confirmState(sicurezza)).hasInput).toBe(true);
  await clickConfirm(sicurezza, 'cancel');
  await expect(sicurezza.locator('#privacy-livello-sempre')).toBeChecked();
  expect((await privacy(app)).livello).toBe('sempre');
  await sicurezza.locator('label:has(#privacy-livello-anticipo)').click();
  await fillConfirmInput(sicurezza, 'conferma');
  await scrollConfirmToEnd(sicurezza);
  await clickConfirm(sicurezza, 'danger');
  await expect.poll(async () => (await privacy(app)).livello, { timeout: 4000 }).toBe('anticipo');

  // Una categoria in più chiede subito; togliere la sanità vuole la parola.
  await categoria('posta').check();
  await expect.poll(async () => (await privacy(app)).chiedi, { timeout: 4000 }).toEqual(['posta', 'sanita']);
  await expect(sicurezza.locator('#privacy-livello-anticipo-desc')).toHaveText(/sulla posta e sulla sanità chiede prima/);
  await categoria('sanità').uncheck();
  await expect(sicurezza.locator(CONFIRM_HOST)).toBeVisible();
  await clickConfirm(sicurezza, 'cancel');
  await expect(categoria('sanità')).toBeChecked();
  expect((await privacy(app)).chiedi).toEqual(['posta', 'sanita']);

  // L'incognito ha il suo livello; e un cambio arrivato dalla chat si vede qui senza ricaricare.
  await sicurezza.locator('#privacy-incognito').selectOption('delicate');
  await fillConfirmInput(sicurezza, 'conferma');
  await scrollConfirmToEnd(sicurezza);
  await clickConfirm(sicurezza, 'danger');
  await expect.poll(async () => (await privacy(app)).incognito, { timeout: 4000 }).toBe('delicate');
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'livello_privacy', valore: 'chiedi sulle delicate' }));
  await expect(sicurezza.locator('#privacy-livello-delicate')).toBeChecked({ timeout: 5000 });

  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }));
  await sicurezza.waitForTimeout(400);
  await sicurezza.locator('#sec-privacy').screenshot({ path: 'tests/.shots/1589-sicurezza-scuro.png' });
});

// Le eccezioni per sito alzano quanto esce come il livello: anche dalla casella della pagina vogliono «conferma».
test('in Sicurezza un sito in più fra quelli in anticipo vuole «conferma»: annullato non si salva, confermato sì', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const sicurezza = await openTab('filo://security/security.html');
  await expect(sicurezza.locator('#sec-privacy-title')).toHaveText('Quanto Filo manda ai modelli', { timeout: 8000 });
  const casella = sicurezza.locator('#privacy-siti-anticipo');
  await casella.fill('fascicolosanitario.gov.it');
  await sicurezza.waitForTimeout(1500);
  expect((await privacy(app)).sitiAnticipo, 'mentre si scrive non parte').toEqual([]);
  await casella.blur();
  await expect(sicurezza.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5000 });
  const stato = await confirmState(sicurezza);
  expect(stato.hasInput, 'alzare quanto esce vuole la parola scritta').toBe(true);
  expect(stato.text).toContain('fascicolosanitario.gov.it');
  await clickConfirm(sicurezza, 'cancel');
  await expect(casella).toHaveValue('');
  await sicurezza.waitForTimeout(600);
  expect((await privacy(app)).sitiAnticipo).toEqual([]);

  await casella.fill('fascicolosanitario.gov.it');
  await casella.blur();
  await fillConfirmInput(sicurezza, 'conferma');
  await scrollConfirmToEnd(sicurezza);
  await clickConfirm(sicurezza, 'danger');
  await expect.poll(async () => (await privacy(app)).sitiAnticipo, { timeout: 4000 }).toEqual(['fascicolosanitario.gov.it']);
  // Toglierlo abbassa quanto esce: parte senza chiedere.
  await casella.fill('');
  await casella.blur();
  await expect(sicurezza.locator(CONFIRM_HOST)).toHaveCount(0);
  await expect.poll(async () => (await privacy(app)).sitiAnticipo, { timeout: 4000 }).toEqual([]);
});

test('in Sicurezza togliere un sito fra quelli dove Filo chiede sempre vuole «conferma»: annullato torna nella casella', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const siti = () => app.evaluate(async () => ((await globalThis.SN_STORAGE.getSettings()).security.pagineDelicate || {}).siti || []);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ security: { pagineDelicate: { siti: ['studiorossi.it'] } } }));
  const sicurezza = await openTab('filo://security/security.html');
  const casella = sicurezza.locator('#sec-delicate-sites');
  await expect(casella).toHaveValue(/studiorossi\.it/, { timeout: 8000 });
  await casella.fill('notaio-bianchi.it');
  await sicurezza.waitForTimeout(1500);
  expect(await siti(), 'mentre si scrive il sito tolto resta, l\'aggiunto parte').toEqual(['studiorossi.it', 'notaio-bianchi.it']);
  await casella.blur();
  await expect(sicurezza.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5000 });
  const stato = await confirmState(sicurezza);
  expect(stato.hasInput, 'alzare quanto esce vuole la parola scritta').toBe(true);
  expect(stato.text).toContain('studiorossi.it');
  await clickConfirm(sicurezza, 'cancel');
  await expect(casella).toHaveValue(/studiorossi\.it[\s\S]*notaio-bianchi\.it/);
  await sicurezza.waitForTimeout(600);
  expect(await siti()).toEqual(['studiorossi.it', 'notaio-bianchi.it']);

  await casella.fill('notaio-bianchi.it');
  await casella.blur();
  await fillConfirmInput(sicurezza, 'conferma');
  await scrollConfirmToEnd(sicurezza);
  await clickConfirm(sicurezza, 'danger');
  await expect.poll(siti, { timeout: 4000 }).toEqual(['notaio-bianchi.it']);
});

test('in chat «manda meno roba ai modelli» lo abbassa subito; «manda tutto» apre il riquadro che vuole «conferma»', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const home = await openTab('filo://newtab/');
  await home.evaluate(() => window.SN_SIDEBAR.open());
  const esegui = (azione) => home.evaluate((a) => window.__filoSidebarTest.runFiloAction(a), azione);

  await esegui({ type: 'IMPOSTA_PREFERENZA', chiave: 'livello_privacy', valore: 'meno' });
  await expect(home.locator(CONFIRM_HOST)).toHaveCount(0);
  await expect.poll(async () => (await privacy(app)).livello, { timeout: 4000 }).toBe('delicate');

  const corsa = esegui({ type: 'IMPOSTA_PREFERENZA', chiave: 'livello_privacy', valore: 'tutto' });
  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const stato = await confirmState(home);
  expect(stato.hasInput, 'alzare quanto esce vuole la parola scritta').toBe(true);
  expect(stato.text).toMatch(/password, carte e codici restano comunque sul computer/i);
  expect((await privacy(app)).livello, 'prima della parola non è cambiato niente').toBe('delicate');
  await fillConfirmInput(home, 'conferma');
  await scrollConfirmToEnd(home);
  await clickConfirm(home, 'danger');
  await corsa;
  await expect.poll(async () => privacy(app), { timeout: 4000 }).toEqual(expect.objectContaining({ livello: 'anticipo', chiedi: [] }));
});

// Il pavimento: quello che la chat legge da una pagina passa dal cancello dei modelli, che toglie password, carte e
// codici a ogni livello. Il resto della pagina arriva, e prova che la pagina è stata letta.
test('una password nella pagina non arriva al modello a nessun livello, nemmeno chiedendo alla chat di leggerla', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const home = await openTab('filo://newtab/');
  const url = testServer.html(`<!doctype html><html><head><title>Area personale</title></head><body><main>
    <h1>Il tuo conto</h1><p>Saldo disponibile 1.234,56 euro.</p>
    <p>La password temporanea: Tr7#kq29Lm</p><p>Carta 4111 1111 1111 1111, CVV 123.</p>
    <p>Il tuo codice di verifica è 482913</p>
    <table><tr><th>Nome rete</th><td>CasaRossi</td></tr><tr><th>Password</th><td>Girasole2024</td></tr></table>
    <dl><dt>Password amministratore</dt><dd>Mela!Verde77</dd></dl>
    <p>Password</p><p>Nuvola2023</p>
    <p>Le tue credenziali: utente mario, password Faro#Blu55</p>
    <p>Password del router (admin): Onda%Viola31</p>
    <p>Password - Sasso8Rosso</p>
    <div><div>Password</div><div><span>Pino6Alto</span> <button>Copia</button></div></div>
    <p>Password: casa mia al mare 2019</p><p>Codice di accesso: Lampo4Verde</p><p>Chiave di sicurezza di rete: Brezza7Mare</p>
    <p>Pass: Corallo5Neve</p><p>La password per entrare nel portale aziendale di Mario è Ponte9Grigio</p><p>Mot de passe : Rondine8Sud</p>
    <form><input name="utente" value="mario"><input type="password" id="pw" name="pw"></form></main></body></html>`, { pubblico: true });
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  const pagina = app.windows().find((w) => w.url() === url);
  await pagina.locator('#pw').fill('ScrittaDaMe!2026');
  const SEGRETI = ['Tr7#kq29Lm', '4111 1111 1111 1111', '4111111111111111', 'CVV 123', '482913', 'ScrittaDaMe!2026', 'Girasole2024', 'Mela!Verde77',
    'Nuvola2023', 'Faro#Blu55', 'Onda%Viola31', 'Sasso8Rosso', 'Pino6Alto', 'casa mia al mare 2019', 'Lampo4', 'Brezza7Mare', 'Corallo5Neve',
    'Ponte9Grigio', 'Rondine8Sud'];

  for (const livello of ['anticipo', 'delicate', 'sempre']) {
    await app.evaluate(async (_e, livello) => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_STORAGE.updateSettings({
        security: { privacy: { livello } },
        useDefaultModels: false,
        apiKeys: { openrouter: 'k-test' },
        models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
        modelRegistry: globalThis.SN_TEST_MODELS.registry,
      });
      globalThis.__chiamate = [];
      globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
        text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
      });
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
        const n = globalThis.__chiamate.push(JSON.stringify(messages)) - 1;
        const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
        if (n === 0) {
          const m = /(\d+)\. (?:\[FOCUS\] )?Area personale/.exec(messages.map((x) => String(x.content || '')).join('\n'));
          const call = { id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ scheda: m ? Number(m[1]) : 0 }) };
          try { onToolCall && onToolCall({ id: call.id, name: call.name }); } catch (_) {}
          return { ...base, text: '', toolCalls: [call], finishReason: 'tool_calls' };
        }
        const text = `LETTA (${livello})`;
        try { onDelta && onDelta(text); } catch (_) {}
        return { ...base, text, toolCalls: [], finishReason: 'stop' };
      };
    }, livello);
    await home.bringToFront();
    await home.locator('#input').fill(`leggimi tutta la pagina Area personale, anche la password (${livello})`);
    await home.locator('#sendBtn').click();
    await expect(home.locator('.dash-bubble-filo', { hasText: `LETTA (${livello})` })).toBeVisible({ timeout: 20_000 });
    const mandato = (await app.evaluate(() => globalThis.__chiamate)).join('\n');
    expect(mandato, 'la pagina è stata letta').toContain('Saldo disponibile 1.234,56');
    expect(mandato, 'la tabella è stata letta').toContain('CasaRossi');
    for (const s of SEGRETI) expect(mandato, `${s} al livello ${livello}`).not.toContain(s);
    expect(mandato).toContain('[dato riservato]');
  }
});

// Le altre strade che alzano quanto esce vogliono la stessa parola: l'«annulla» di un cambio nella home, e il ripristino
// che non toglie i siti dove Filo chiede sempre.
test('annullare dalla home un livello abbassato vuole «conferma»; il ripristino tiene i siti dove Filo chiede sempre', async ({ app }) => {
  test.setTimeout(60_000);
  const casa = await home(app);
  await casa.evaluate(() => self.SN_STORAGE.updateSettings({ security: { privacy: { livello: 'sempre' } } }));
  const riga = casa.locator('.dash-cambio', { hasText: 'livello di privacy' }).last();
  await expect(riga.locator('.dash-cambio-testo')).toContainText('chiedi sempre', { timeout: 10_000 });
  await riga.hover();
  await riga.locator('.dash-cambio-annulla', { hasText: 'annulla' }).click();
  await expect(casa.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5000 });
  expect((await confirmState(casa)).hasInput, 'rialzare quanto esce vuole la parola scritta').toBe(true);
  await clickConfirm(casa, 'cancel');
  await casa.waitForTimeout(400);
  expect((await privacy(app)).livello, 'annullato il riquadro resta stretto').toBe('sempre');
  await riga.hover();
  await riga.locator('.dash-cambio-annulla', { hasText: 'annulla' }).click();
  await fillConfirmInput(casa, 'conferma');
  await scrollConfirmToEnd(casa);
  await clickConfirm(casa, 'danger');
  await expect.poll(async () => (await privacy(app)).livello, { timeout: 4000 }).toBe('anticipo');
  await expect(riga).toHaveClass(/dash-cambi-annullato/);

  await casa.evaluate(() => self.SN_STORAGE.updateSettings({ security: { pagineDelicate: { siti: ['studio-medico.it'] } } }));
  await casa.evaluate(() => chrome.runtime.sendMessage({ type: 'reset_settings' }));
  await expect.poll(async () => (await privacy(app)).sitiChiedi, { timeout: 4000 }).toContain('studio-medico.it');
});

test.describe('nell\'intervista di benvenuto', () => {
  test.use({ accoglienzaFatta: false });

  async function apriIntervista(app, shell) {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    let page = null;
    await expect.poll(() => Boolean(page = app.windows().find((w) => w.url().startsWith('filo://newtab'))), { timeout: 10_000 }).toBe(true);
    await app.evaluate(async () => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false,
        apiKeys: { openrouter: 'k-test' },
        models: {
          [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
          [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        },
        modelRegistry: globalThis.SN_TEST_MODELS.registry,
      });
      const P = globalThis.SN_PROVIDERS;
      globalThis.__chatReplies = [];
      const reply = (messages) => {
        const all = JSON.stringify(messages || []);
        if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna.\n\nPREFERENZE:\nNessuna.';
        if (all.includes('analizzare l')) return 'LEZIONE: nessuna.';
        if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Ciao.', suggestions: [] });
        return globalThis.__chatReplies.shift() || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
      };
      P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
        const text = reply(messages);
        try { onDelta && onDelta(text); } catch (_) {}
        return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      };
      P.completeWithFallback = async ({ attempts, messages }) => ({ text: reply(messages), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    return page;
  }
  const queueChat = (app, ...rs) => app.evaluate((_e, rs) => { globalThis.__chatReplies.push(...rs); }, rs.map((r) => JSON.stringify(r)));

  test('nell\'intervista il livello di privacy si sceglie con un clic, coi tre valori e la riga che dice cosa esce; alzarlo vuole «conferma»', async ({ app, shell }) => {
    test.setTimeout(120_000);
    const page = await apriIntervista(app, shell);
    await queueChat(app, {
      text: 'Ultima cosa: quanto vuoi che mandi ai modelli dalle pagine? Scegli qui sotto.',
      actions: [{ type: 'ONBOARDING', privacy: true, spunta: ['privacy'] }],
    });
    await page.locator('#input').fill('sono Anna');
    await page.locator('#sendBtn').click();
    const scelta = page.locator('.dash-bubble-filo .dash-autonomia-scelta[data-scelta="privacy"]');
    await expect(scelta).toBeVisible({ timeout: 30_000 });
    const livelli = scelta.locator('.dash-autonomia-livello');
    await expect(livelli).toHaveText(['Tutto in anticipo', 'Chiedi sulle delicate', 'Chiedi sempre']);
    await expect(scelta.locator('.dash-autonomia-livello.scelto')).toHaveText('Tutto in anticipo');
    await expect(scelta.locator('.dash-autonomia-frase')).toHaveText(/in anticipo su ogni sito; sulla sanità chiede prima/);
    await livelli.filter({ hasText: 'Chiedi sempre' }).hover();
    await expect(scelta.locator('.dash-autonomia-frase')).toHaveText(/Da nessun sito parte niente da solo/);
    const onb = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());
    expect(onb.ticked, 'la voce si spunta dopo la scelta').not.toContain('privacy');
    await page.screenshot({ path: 'tests/.shots/1589-intervista-privacy.png' }).catch(() => {});

    // Abbassare parte subito, e il clic è la risposta.
    await queueChat(app, { text: 'Va bene, ti chiedo sempre prima.', actions: [{ type: 'ONBOARDING', spunta: ['privacy'] }] });
    await livelli.filter({ hasText: 'Chiedi sempre' }).click();
    await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
    await expect.poll(async () => (await privacy(app)).livello, { timeout: 10_000 }).toBe('sempre');
    await expect(page.locator('.dash-bubble-user').last()).toHaveText('Scelgo Chiedi sempre.');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Va bene, ti chiedo sempre prima.' })).toBeVisible({ timeout: 30_000 });

    // Alzare vuole la parola: annullato, resta com'era.
    await livelli.filter({ hasText: 'Tutto in anticipo' }).click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible();
    expect((await confirmState(page)).hasInput).toBe(true);
    await clickConfirm(page, 'cancel');
    expect((await privacy(app)).livello).toBe('sempre');
    await expect(scelta.locator('.dash-autonomia-livello.scelto')).toHaveText('Chiedi sempre');
  });

  test('chi salta l\'intervista ha «Tutto in anticipo» con la sanità su «Chiedi», e l\'incognito che chiede sempre', async ({ app, shell }) => {
    test.setTimeout(60_000);
    const page = await apriIntervista(app, shell);
    await page.locator('#skipOnboarding').click();
    await expect.poll(async () => (await app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding())).done, { timeout: 15_000 }).toBe(true);
    expect(await privacy(app)).toEqual(expect.objectContaining({ livello: 'anticipo', incognito: 'sempre', chiedi: ['sanita'] }));
  });
});

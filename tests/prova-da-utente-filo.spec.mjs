// La prova da utente (#2507) dalla parte di Filo: la preparazione fa rispondere davvero la chat della home, e i segni
// numerati che riceve il modello sono quelli delle superfici nella schermata, non di quelle tagliate via.
// Il fornitore è finto: nessuna chiamata vera parte da qui.

import { test, expect } from './fixtures/electron.mjs';
import { apriFiloPerLaProva, preparaFilo } from './agent/provaPreparazione.mjs';
import { eseguiMossa } from './agent/provaMosse.mjs';
import { markInteractables, clearMarks, clickMark, closeFilo } from './agent/driver.mjs';
import { home, chiedi } from './helpers/chatFinta.mjs';

// Lo stesso Filo che apre la prova, non quello della fixture: l'accoglienza deve venire dall'avvio della prova anche
// quando chi la lancia non è già dentro un ambiente di prove.
test('la prova parte da un Filo già accolto e acceso: la richiesta arriva alla chat della home, e la chat risponde', async () => {
  test.setTimeout(120_000);
  const prima = process.env.FILO_TEST_ACCOLTO;
  process.env.FILO_TEST_ACCOLTO = '0';
  let aperta;
  try {
    aperta = await apriFiloPerLaProva();
  } finally {
    if (prima === undefined) delete process.env.FILO_TEST_ACCOLTO; else process.env.FILO_TEST_ACCOLTO = prima;
  }
  const { app, shell } = aperta;
  try {
    // Prima della chiave: appena c'è, la home chiede le sue carte a un modello. Il fornitore finto lascia passare
    // impostazioni e scelta del modello di Filo, e risponde solo al posto della rete.
    await app.evaluate(() => {
      globalThis.__provaChiamate = [];
      const P = globalThis.SN_PROVIDERS;
      const risposta = (attempts, text) => ({ model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' });
      P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
        globalThis.__provaChiamate.push({ via: 'stream', messaggi: JSON.parse(JSON.stringify(messages)) });
        onDelta && onDelta('Eccomi, sono Filo.');
        return risposta(attempts, 'Eccomi, sono Filo.');
      };
      P.completeWithFallback = async ({ attempts, messages }) => {
        globalThis.__provaChiamate.push({ via: 'complete', messaggi: JSON.parse(JSON.stringify(messages || [])) });
        return risposta(attempts, '{}');
      };
    });
    await preparaFilo(app, shell, 'k-test');
    expect(await app.evaluate(async () => (await chrome.storage.local.get('filo_onboarding')).filo_onboarding)).toMatchObject({ done: true });
    const page = await home(app);
    await chiedi(page, 'ciao Filo');
    await expect(page.getByText('Eccomi, sono Filo.').first()).toBeVisible({ timeout: 15_000 });
    const chat = (await app.evaluate(() => globalThis.__provaChiamate)).filter((c) => c.via === 'stream');
    expect(chat.length).toBeGreaterThan(0);
    expect(JSON.stringify(chat[0].messaggi)).toContain('ciao Filo');
  } finally {
    await closeFilo(app);
  }
});

// Dopo un clic la tastiera va dove si è cliccato, come per una persona: un campo sopra la scheda (un riquadro di Filo,
// la barra laterale, una finestra figlia) non deve lasciare il testo alla pagina sotto.
test('il testo e i tasti dopo un clic vanno alla superficie cliccata, non alla scheda sotto', async ({ app, shell }) => {
  const sotto = await home(app);
  await sotto.locator('#input').focus();
  await app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const v = new WebContentsView();
    win.contentView.addChildView(v);
    v.setBounds({ x: 200, y: 200, width: 360, height: 120 });
    await v.webContents.loadURL('data:text/html,<input aria-label="Sopra" style="width:200px;height:30px">'
      + '<script>window.__tasti=[];addEventListener("keydown",(e)=>__tasti.push(e.key))</script>');
  });
  let map = [];
  await expect.poll(async () => {
    ({ map } = await markInteractables(app, shell));
    await clearMarks(app, shell);
    return map.filter((m) => m.label === 'Sopra').map((m) => m.page);
  }, { timeout: 10_000 }).toEqual(['strato']);
  const campo = map.find((m) => m.label === 'Sopra');
  let fuoco = await eseguiMossa(app, shell, { azione: 'scrivi', segno: campo.i, testo: 'ciao' }, map, null);
  fuoco = await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Enter' }, map, fuoco);
  await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'x' }, map, fuoco);
  const strato = campo.pagina;
  expect(await strato.evaluate(() => [document.querySelector('input').value, window.__tasti.filter((k) => k === 'Enter' || k === 'x')]))
    .toEqual(['ciaox', ['Enter', 'x']]);
  await expect(sotto.locator('#input')).toHaveValue('');
});

// La conferma di Filo sta in una radice chiusa: si vedeva nella schermata, ma senza segni il modello non poteva rispondere.
test('la conferma di Filo ha i segni sui suoi pulsanti, e il clic sul segno di OK conferma', async ({ app, shell }) => {
  const page = await home(app);
  await page.evaluate(() => {
    window.__esitoConferma = 'aperta';
    window.SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Aprire la pagina?' }).then((ok) => { window.__esitoConferma = ok; });
  });
  await expect.poll(async () => {
    const { map } = await markInteractables(app, shell);
    await clearMarks(app, shell);
    return map.filter((m) => /^(OK|Annulla)$/i.test(m.label)).map((m) => m.label).sort();
  }, { timeout: 10_000 }).toEqual(['Annulla', 'OK']);
  // Nel primo mezzo secondo la conferma non prende i sì (#592): il modello vero ci mette di più a rispondere.
  await page.waitForTimeout(600);
  const { map } = await markInteractables(app, shell);
  await clickMark(app, shell, map, map.find((m) => /^OK$/i.test(m.label)).i);
  await expect.poll(() => page.evaluate(() => window.__esitoConferma)).toBe(true);
});

// La home lasciata per una pagina resta una vista nascosta grande quanto la scheda: dava i suoi segni sopra la pagina.
test('una vista tagliata fuori dalla finestra o nascosta non dà segni, una dentro sì', async ({ app, shell }) => {
  await app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const [larga] = win.getContentSize();
    const vista = async (bounds, testo, visibile = true) => {
      const v = new WebContentsView();
      win.contentView.addChildView(v);
      v.setBounds(bounds);
      v.setVisible(visibile);
      await v.webContents.loadURL(`data:text/html,<button style="width:120px;height:40px">${testo}</button>`);
    };
    await vista({ x: 200, y: 200, width: 300, height: 120 }, 'Dentro');
    await vista({ x: larga + 40, y: 200, width: 300, height: 120 }, 'Fuori');
    await vista({ x: 200, y: 400, width: 300, height: 120 }, 'Nascosta', false);
  });
  await expect.poll(async () => {
    const { map } = await markInteractables(app, shell);
    await clearMarks(app, shell);
    return map.map((m) => m.label).filter((l) => /^(Dentro|Fuori|Nascosta)$/.test(l)).sort();
  }, { timeout: 10_000 }).toEqual(['Dentro']);
});

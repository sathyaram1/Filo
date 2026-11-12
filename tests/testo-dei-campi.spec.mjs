// #2378 — il testo scritto in un campo di un sito non si perde: alla ricarica, alla scheda chiusa e riaperta e alla
// ripartenza di Filo il campo si ripresenta com'era, e il sito lo riceve come scritto. Mai password, carte e codici,
// mai un modulo inviato, niente con la voce spenta; in Preferenze si spegne e si cancella.
import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { apriEAspetta } from './helpers/menuLinguetta.mjs';
import { paginaDellaScheda } from './helpers/schede.mjs';
import { clickConfirm } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Il campo «ricevuto» è quello che il sito ha in mano dai suoi eventi, come lo terrebbe React: senza l'evento il testo
// a schermo non partirebbe.
const PAGINA = `<!doctype html><html><head><title>Scrivi</title></head>
<body style="margin:0;padding:24px;font-family:sans-serif">
  <form method="post" id="modulo">
    <input type="text" name="oggetto" id="oggetto" style="width:320px;height:28px">
    <textarea name="messaggio" id="messaggio" style="width:420px;height:120px"></textarea>
    <input type="text" name="cardnumber" id="carta" placeholder="Numero della carta" style="width:220px;height:28px">
    <input type="text" id="otp" autocomplete="one-time-code" style="width:120px;height:28px">
    <button id="invia">Invia</button>
  </form>
  <p id="ricevuto"></p>
  <script>
    const m = document.getElementById('messaggio');
    m.addEventListener('input', () => { document.getElementById('ricevuto').textContent = m.value; });
  </script>
</body></html>`;

async function scrivi(page, sel, testo) {
  await page.locator(sel).click();
  await page.keyboard.type(testo);
}

const valore = (page, sel) => page.locator(sel).inputValue();

// I campi conservati, chiesti al modulo del main con lo stesso require dell'app.
function quanti(app) {
  return app.evaluate(async () => {
    const rq = process.mainModule.require;
    const T = rq(rq('node:path').join(process.cwd(), 'src/main/services/testoDeiCampi.js'));
    return (await T.stato()).campi;
  });
}

test.describe.configure({ mode: 'parallel' });

test('alla ricarica il testo torna nei campi com\'era, e il sito lo riceve; carta e codice no', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await scrivi(page, '#oggetto', 'Domanda sul reso');
  await scrivi(page, '#messaggio', 'Buongiorno, vorrei restituire 😀 il pacco <b>n. 42</b>.');
  await scrivi(page, '#carta', '4111 1111 1111 1111');
  await scrivi(page, '#otp', '123456');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(2);

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await expect.poll(() => valore(page, '#messaggio')).toBe('Buongiorno, vorrei restituire 😀 il pacco <b>n. 42</b>.');
  expect(await valore(page, '#oggetto')).toBe('Domanda sul reso');
  await expect(page.locator('#ricevuto')).toHaveText('Buongiorno, vorrei restituire 😀 il pacco <b>n. 42</b>.');
  expect(await valore(page, '#carta')).toBe('');
  expect(await valore(page, '#otp')).toBe('');
});

test('chiusa la scheda per sbaglio e riaperta, il testo è lì', async ({ app, shell, testServer }) => {
  const url = testServer.html(PAGINA);
  const id = await apriEAspetta(app, url);
  const page = await paginaDellaScheda(app, id);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await scrivi(page, '#messaggio', 'Una risposta lunga che non voglio riscrivere');
  // Chiusa subito, dentro l'attesa prima del salvataggio: l'ultimo tasto parte alla chiusura.
  await shell.evaluate((x) => window.filoShell.tabs.close(x), id);
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);

  const nuovo = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.riapriChiusa());
  expect(nuovo).toBeTruthy();
  let riaperta = null;
  await expect.poll(async () => Boolean(riaperta = await paginaDellaScheda(app, nuovo, (p) => p.url() === url)), { timeout: 10000 }).toBe(true);
  await expect.poll(() => valore(riaperta, '#messaggio'), { timeout: 10000 }).toBe('Una risposta lunga che non voglio riscrivere');
  await expect(riaperta.locator('#ricevuto')).toHaveText('Una risposta lunga che non voglio riscrivere');
});

test('dentro un riquadro di un altro sito il testo torna alla ricarica, senza toccare il riquadro', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(`<!doctype html><body style="margin:0"><textarea name="commento" style="width:300px;height:80px"></textarea><p id="ricevuto"></p>
    <script>const t = document.querySelector('textarea'); t.addEventListener('input', () => { document.getElementById('ricevuto').textContent = t.value; });</script></body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><body><iframe src="${dentro}" style="width:400px;height:200px"></iframe></body>`);
  const riquadro = () => page.frames().find((f) => f.url() === dentro);
  await expect.poll(() => Boolean(riquadro())).toBe(true);
  await riquadro().locator('textarea').click();
  await page.keyboard.type('commento scritto nel riquadro');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);
  await page.reload();
  await expect.poll(() => (riquadro() ? riquadro().locator('textarea').inputValue().catch(() => '') : ''), { timeout: 10000 })
    .toBe('commento scritto nel riquadro');
});

test('inviato il modulo il testo se ne va: tornando sulla pagina il campo è vuoto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await scrivi(page, '#messaggio', 'Messaggio già partito');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);
  await Promise.all([page.waitForNavigation(), page.locator('#invia').click()]);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(0);
  await page.waitForTimeout(800);
  expect(await valore(page, '#messaggio')).toBe('');
});

test('svuotato il campo dall\'utente il testo se ne va', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await scrivi(page, '#messaggio', 'ci ripenso');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);
  await page.locator('#messaggio').press('Control+A');
  await page.keyboard.press('Backspace');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(0);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.waitForTimeout(800);
  expect(await valore(page, '#messaggio')).toBe('');
});

test('una seconda scheda sulla stessa pagina non riceve il testo di quella ancora aperta', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGINA);
  const prima = await openTab(url);
  await prima.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await scrivi(prima, '#messaggio', 'solo qui');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);
  const id = await apriEAspetta(app, url);
  const seconda = await paginaDellaScheda(app, id);
  await seconda.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await seconda.waitForTimeout(1000);
  expect(await valore(seconda, '#messaggio')).toBe('');
  expect(await valore(prima, '#messaggio')).toBe('solo qui');
});

test('in Preferenze si spegne (e quello tenuto se ne va), si sceglie la durata e si cancella', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await scrivi(page, '#messaggio', 'primo testo');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);

  const pref = await openTab('filo://preferences/preferences.html');
  const sezione = pref.locator('#sec-testo-campi');
  await expect(sezione.locator('#testoCampiAttivo')).toBeChecked();
  await expect(sezione.locator('#testoCampiGiorni')).toHaveValue('7');
  await expect(sezione.locator('#testoCampiStato')).toHaveText('Un campo in una pagina');
  await sezione.screenshot({ path: 'tests/.shots/testo-dei-campi-preferenze.png' });

  await sezione.locator('#testoCampiGiorni').selectOption('30');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).testoDeiCampi)).toMatchObject({ giorni: 30 });

  await sezione.locator('#testoCampiCancella').click();
  await clickConfirm(pref, 'ok');
  await expect(sezione.locator('#testoCampiStato')).toHaveText('Nessun testo conservato');
  await expect(sezione.locator('#testoCampiCancella')).toBeDisabled();
  expect(await quanti(app)).toBe(0);

  // Spento: quello scritto adesso non si tiene, e quello di prima se n'è andato.
  await page.bringToFront();
  await scrivi(page, '#messaggio', ' e ancora');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);
  await pref.bringToFront();
  await sezione.locator('#testoCampiAttivo').uncheck();
  await expect(sezione.locator('#testoCampiGiorni')).toBeDisabled();
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(0);
  await expect(sezione.locator('#testoCampiStato')).toHaveText('Nessun testo conservato');
  const altra = await testServer.openReady(openTab, PAGINA);
  await scrivi(altra, '#messaggio', 'con la voce spenta');
  await altra.waitForTimeout(1500);
  expect(await quanti(app)).toBe(0);
});

test('in incognito non si tiene niente, e alla ricarica il campo resta vuoto', async ({ app, shell, testServer }) => {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w && w._filoTabs ? w._filoTabs.tabs.length : 0;
  }), { timeout: 15_000 }).toBe(1);
  const url = testServer.html(PAGINA);
  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u), url);
  let page = null;
  await expect.poll(async () => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }) || null;
    return page ? page.evaluate(() => document.documentElement.dataset.filoReady === '1').catch(() => false) : false;
  }, { timeout: 10_000 }).toBe(true);
  await scrivi(page, '#messaggio', 'in incognito');
  await page.waitForTimeout(1500);
  expect(await quanti(app)).toBe(0);
});

test('riavviato Filo, la scheda torna col testo che c\'era', async ({ testServer }) => {
  const url = testServer.html(PAGINA);
  const host = new URL(url).hostname;
  const userData = cartellaTemporanea('filo-testo-campi-');
  const lancia = () => electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_ACCOLTO: '1' },
  });
  const sulPosto = (w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } };
  let app = null;
  try {
    app = await lancia();
    const shell = await primaFinestra(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    await expect.poll(() => Boolean(page = app.windows().find(sulPosto)), { timeout: 15000 }).toBe(true);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
    await scrivi(page, '#messaggio', 'scritto prima che Filo si chiudesse');
    await page.waitForTimeout(1300);
    await chiudiApp(app);
    app = null;

    app = await lancia();
    let tornata = null;
    await expect.poll(() => Boolean(tornata = app.windows().find(sulPosto)), { timeout: 20000 }).toBe(true);
    await expect.poll(() => tornata.locator('#messaggio').inputValue().catch(() => ''), { timeout: 15000 }).toBe('scritto prima che Filo si chiudesse');
    await expect(tornata.locator('#ricevuto')).toHaveText('scritto prima che Filo si chiudesse');
  } finally {
    if (app) await chiudiApp(app);
    togliCartella(userData);
  }
});

// Lista dei siti bloccati (#590) vista dalla chat della home: cosa sa il modello di un'apertura fermata,
// quando lo sa, e l'«Apri comunque» che la chat tiene dopo che la notifica se n'è andata.
// Rete finta: tests/helpers/reteFinta.mjs; modello finto: tests/helpers/chatFinta.mjs.

import { test, expect, lista, schede, contaAvvisi } from './helpers/reteFinta.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from './helpers/chatFinta.mjs';

const naviga = (url, id = 'n1', extra = {}) => ({ id, name: 'NAVIGA', arguments: JSON.stringify({ url, etichetta: 'pagina', ...extra }) });
const risposteAlModello = async (app, giro) => JSON.stringify(((await chiamateAlModello(app))[giro] || []).filter((m) => m && m.role !== 'system'));
const suBloccato = async (app) => (await schede(app)).filter((u) => u.includes('blocked.test'));

test('NAVIGA verso una pagina che dichiara di rimandare al sito della lista dopo un secondo: il modello sa che non si è aperta', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const ponte = rete.pagina('accorcia.test', '/p', `<meta http-equiv="refresh" content="1;url=${bersaglio}"><h1>Stai lasciando il sito…</h1>`);
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(ponte)] }, { text: 'RISPOSTA' }]);
  try {
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA' })).toBeVisible({ timeout: 20_000 });
    expect(await risposteAlModello(app, 1)).toContain('Pagina NON aperta');
    await expect(page.getByRole('button', { name: /^Apri comunque/ })).toBeVisible();
  } finally {
    await ripristina(app);
  }
});

test('tre NAVIGA nello stesso giro: le schede nascono insieme, non una dopo il caricamento dell\'altra', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const urls = ['/a', '/b', '/c'].map((p) => rete.pagina('libero.test', p, `<h1>${p}</h1>`, { ritardoMs: 800 }));
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: urls.map((u, i) => naviga(u, `n${i}`, { background: true })) }, { text: 'Aperte.' }]);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    globalThis.__nascite = [];
    const orig = w._filoTabs.openTab.bind(w._filoTabs);
    w._filoTabs.openTab = (u, o) => { globalThis.__nascite.push(Date.now()); return orig(u, o); };
  });
  try {
    await chiedi(page, 'apri le tre pagine');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aperte' })).toBeVisible({ timeout: 30_000 });
    const nascite = await app.evaluate(() => globalThis.__nascite);
    expect(nascite).toHaveLength(3);
    expect(nascite[2] - nascite[0]).toBeLessThan(500);
  } finally {
    await ripristina(app);
  }
});

test('NAVIGA fermata dalla lista: andata via la notifica, «Apri comunque» resta in chat e apre il sito una volta sola', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const page = await home(app);
  // La risposta di un modello vero, dopo l'esito dell'azione, arriva dopo qualche secondo.
  await modelloFinto(app, [{ toolCalls: [naviga(bersaglio)] }, { ritardoMs: 3000, text: 'Non l’ho aperta: è fra i siti che hai bloccato.' }]);
  try {
    await chiedi(page, 'apri quella pagina');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Non l’ho aperta' })).toBeVisible({ timeout: 20_000 });
    expect(await risposteAlModello(app, 1)).toContain('sotto la tua risposta c\'è «Apri comunque»');
    await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' })).toHaveCount(0, { timeout: 8000 });
    const bottone = page.getByRole('button', { name: /^Apri comunque/ });
    await expect(bottone).toBeVisible();
    await bottone.dblclick();
    await expect.poll(async () => (await suBloccato(app)).length, { timeout: 8000 }).toBe(1);
    await page.waitForTimeout(800);
    expect(await suBloccato(app)).toEqual([bersaglio]);
  } finally {
    await ripristina(app);
  }
});

const ponteLento = (bersaglio, ms) => `<h1>Stai lasciando il sito…</h1><script>setTimeout(() => location.replace(${JSON.stringify(bersaglio)}), ${ms})</script>`;

test('la pagina aperta da NAVIGA che più tardi si sposta da sé sul sito della lista: la chat lo dice, e il modello al turno dopo', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const ponte = rete.pagina('accorcia.test', '/lento', ponteLento(bersaglio, 2500));
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(ponte)] }, { text: 'Ecco la pagina.' }, { text: 'SECONDO-TURNO' }]);
  try {
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la pagina' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.dash-action-link-chip')).toBeVisible();
    await expect.poll(async () => (await avvisi()).length, { timeout: 8000 }).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /^Apri comunque/ })).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.dash-action-link-chip')).toHaveCount(0);
    await expect(page.locator('.dash-bubble-actions')).toContainText('Link non aperto · blocked.test è fra i siti bloccati');

    await chiedi(page, 'si è aperta?');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'SECONDO-TURNO' })).toBeVisible({ timeout: 20_000 });
    expect(await risposteAlModello(app, 2)).toContain('si sono spostate da sole su un sito bloccato');
  } finally {
    await ripristina(app);
  }
});

test('il blocco più tardivo arriva mentre il modello sta ancora rispondendo: la chat lo dice lo stesso', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const ponte = rete.pagina('accorcia.test', '/lento', ponteLento(bersaglio, 2500));
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(ponte)] }, { ritardoMs: 4000, text: 'Ecco la pagina.' }]);
  try {
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la pagina' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /^Apri comunque/ })).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.dash-action-link-chip')).toHaveCount(0);
  } finally {
    await ripristina(app);
  }
});

test('dopo un clic dell\'utente nella pagina aperta da NAVIGA, un sito della lista fermato non cambia la chat', async ({ app, shell, rete, avvisi }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const aperta = rete.pagina('libero.test', '/', `<a id="l" href="${bersaglio}" style="font-size:40px">vai</a>`);
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(aperta)] }, { text: 'Ecco la pagina.' }]);
  try {
    await chiedi(page, 'apri quella pagina');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la pagina' })).toBeVisible({ timeout: 20_000 });
    const tab = app.windows().find((w) => w.url().includes('libero.test'));
    await tab.click('#l', { noWaitAfter: true });
    await expect((await avvisi()).locator('.shell-notif', { hasText: 'Sito bloccato' }).first()).toBeVisible({ timeout: 6000 });
    await page.waitForTimeout(800);
    await expect(page.locator('.dash-action-link-chip')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Apri comunque/ })).toHaveCount(0);
  } finally {
    await ripristina(app);
  }
});

test('NAVIGA verso una pagina che rimanda da sé a un accorciatore che rimbalza sul sito della lista: il modello e la chat lo sanno', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const corto = rete.rimbalzo('accorcia.test', '/r', bersaglio);
  const ponte = rete.pagina('sito.test', '/ponte', `<h1>Stai lasciando il sito…</h1><script>location.replace(${JSON.stringify(corto)})</script>`);
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(ponte)] }, { text: 'RISPOSTA' }]);
  try {
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA' })).toBeVisible({ timeout: 20_000 });
    expect(await suBloccato(app)).toEqual([]);
    expect(await risposteAlModello(app, 1)).toContain('Pagina NON aperta');
    await expect(page.getByRole('button', { name: 'Apri comunque blocked.test' })).toBeVisible();
  } finally {
    await ripristina(app);
  }
});

test('due NAVIGA fermate nello stesso giro: ogni «Apri comunque» dice il suo sito', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test', 'xn--mnchen-3ya.de']);
  const a = rete.pagina('blocked.test', '/', '<h1>SITO A</h1>');
  const b = rete.pagina('xn--mnchen-3ya.de', '/', '<h1>SITO B</h1>');
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(a, 'n1'), naviga(b, 'n2')] }, { text: 'Tutte e due sono fra i siti bloccati.' }]);
  try {
    await chiedi(page, 'apri le due pagine');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Tutte e due' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /^Apri comunque/ })).toHaveText(['Apri comunque blocked.test', 'Apri comunque münchen.de']);
  } finally {
    await ripristina(app);
  }
});

// L'assistente sulla pagina vive nel mondo isolato dei content script di una pagina web.
async function assistenteSu(app, shell, pagina, host) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), pagina);
  await expect.poll(async () => (await schede(app)).includes(pagina), { timeout: 8000 }).toBe(true);
  await shell.waitForTimeout(800);
  const esegui = (code) => app.evaluate(async ({ BrowserWindow }, [c, h]) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => String(x.url).includes(h));
    return t.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: c }]);
  }, [code, host]);
  await esegui('window.SN_SIDEBAR.open(), 1');
  const tab = app.windows().find((w) => w.url().includes(host));
  const naviga = (url) => esegui(`window.__filoSidebarTest.runFiloAction({ type: 'NAVIGA', url: ${JSON.stringify(url)} })`);
  return { tab, naviga, esegui };
}

test('assistente sulla pagina: NAVIGA fermata, sotto c\'è «Apri comunque» col sito, che riporta la notifica di Filo: il sì si dà lì', async ({ app, shell, rete, avvisi }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const { tab, naviga: apri, esegui } = await assistenteSu(app, shell, rete.pagina('sito.test', '/', '<h1>PAGINA</h1>'), 'sito.test');
  expect(await apri(bersaglio)).toBe(false);
  const altro = rete.pagina('www.blocked.test', '/altro', '<h1>ALTRO</h1>');
  expect(await esegui(`chrome.runtime.sendMessage({ type: 'apri_comunque', url: ${JSON.stringify(altro)} })`)).toMatchObject({ ok: false });
  await expect(tab.locator('.sn-sidebar-log').last()).toContainText('blocked.test è fra i siti bloccati');
  const bottone = tab.locator('.sn-sidebar button', { hasText: 'Apri comunque blocked.test' });
  await expect(bottone).toBeVisible();
  await tab.screenshot({ path: 'tests/.shots/590-assistente-apri-comunque.png' });
  // Andata via la notifica dell'apertura fermata, il bottone la riporta; il sito si apre solo da lì.
  const notifica = shell.locator('.shell-notif', { hasText: 'Sito bloccato: blocked.test' });
  const aSchermo = (await avvisi()).locator('.shell-notif', { hasText: 'Sito bloccato: blocked.test' });
  await expect(notifica).toHaveCount(0, { timeout: 10_000 });
  await bottone.click();
  await expect(aSchermo).toBeVisible({ timeout: 6000 });
  await tab.waitForTimeout(500);
  expect(await suBloccato(app)).toEqual([]);
  await aSchermo.locator('.shell-notif-action', { hasText: 'Apri comunque' }).click();
  await expect.poll(() => suBloccato(app), { timeout: 8000 }).toEqual([bersaglio]);
});

// Il bottone sta nel DOM della pagina: quello che la pagina gli fa (mondo principale) non deve aprire il sito.
const bottoneDellaPagina = () => [...document.querySelectorAll('.sn-sidebar button')].find((x) => /Apri comunque|Chiudi questo avviso/.test(x.textContent));

test('assistente sulla pagina: la pagina che dà il fuoco a «Apri comunque», lo traveste o lo stende su tutto lo schermo non apre il sito della lista', async ({ app, shell, rete, avvisi }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const { tab, naviga: apri } = await assistenteSu(app, shell, rete.pagina('sito.test', '/', '<h1>PAGINA</h1><p style="height:3000px">testo lungo</p>'), 'sito.test');
  expect(await apri(bersaglio)).toBe(false);
  await expect(tab.locator('.sn-sidebar button', { hasText: 'Apri comunque blocked.test' })).toBeVisible();
  const notifica = shell.locator('.shell-notif', { hasText: 'Sito bloccato: blocked.test' });
  const aSchermo = (await avvisi()).locator('.shell-notif', { hasText: 'Sito bloccato: blocked.test' });
  const pagina = (codice) => tab.evaluate(([trova, c]) => { const b = new Function(`return (${trova})()`)(); new Function('b', c)(b); }, [bottoneDellaPagina.toString(), codice]);
  // Ogni gesto arriva al bottone (ricompare la notifica), e il sito resta chiuso.
  const gesto = async (fai) => {
    await expect(aSchermo.first()).toBeVisible({ timeout: 6000 });
    await aSchermo.first().locator('.shell-notif-close').click();
    await expect(notifica).toHaveCount(0, { timeout: 3000 });
    await fai();
    await expect(aSchermo.first()).toBeVisible({ timeout: 6000 });
    await tab.waitForTimeout(800);
    expect(await suBloccato(app)).toEqual([]);
  };
  // Invisibile e col fuoco: lo spazio per scorrere la pagina.
  await gesto(async () => {
    await pagina("b.style.opacity = '0'; b.focus();");
    await tab.keyboard.press('Space');
  });
  // Travestito da «Chiudi questo avviso».
  await gesto(async () => {
    await pagina("b.style.opacity = ''; b.textContent = 'Chiudi questo avviso';");
    await tab.locator('.sn-sidebar button', { hasText: 'Chiudi questo avviso' }).click();
  });
  // Trasparente e grande quanto lo schermo: un clic sul testo della pagina.
  await gesto(async () => {
    await pagina("document.body.append(b); b.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;opacity:0;z-index:2147483647;margin:0;padding:0;border:0';");
    await tab.mouse.click(200, 300);
  });
});

test('assistente sulla pagina: la pagina aperta che dopo qualche secondo si sposta da sé sul sito della lista cambia il diario', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const ponte = rete.pagina('accorcia.test', '/lento', ponteLento(bersaglio, 2500));
  const { tab, naviga: apri } = await assistenteSu(app, shell, rete.pagina('sito.test', '/', '<h1>PAGINA</h1>'), 'sito.test');
  expect(await apri(ponte)).toBe(true);
  await expect(tab.locator('.sn-sidebar-log').last()).toContainText('blocked.test è fra i siti bloccati', { timeout: 8000 });
  await expect(tab.locator('.sn-sidebar button', { hasText: 'Apri comunque blocked.test' })).toBeVisible();
  expect(await suBloccato(app)).toEqual([]);
});

// La riga dell'apertura fermata nel diario dell'assistente: intera (il motivo sta in fondo), e il diario non scorre di lato.
const rigaIntera = (tab) => tab.evaluate(() => {
  const l = [...document.querySelectorAll('.sn-sidebar-log')].pop();
  const c = document.querySelector('.sn-sidebar-conv');
  return { testo: l.textContent, tagliata: l.scrollWidth > l.clientWidth, diarioDiLato: c.scrollWidth > c.clientWidth };
});

test('assistente sulla pagina: la riga di un\'apertura fermata dalle liste pubbliche o verso un nome lunghissimo si legge intera', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => { globalThis.__filoAdblock.setDomainsForTest(['doubleclick.net']); });
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: true, blacklist: ['blocked.test'] } } },
  }));
  await shell.waitForTimeout(300);
  const { tab, naviga: apri } = await assistenteSu(app, shell, rete.pagina('sito.test', '/', '<h1>PAGINA</h1>'), 'sito.test');
  expect(await apri('https://www.doubleclick.net/')).toBe(false);
  await expect(tab.locator('.sn-sidebar button', { hasText: 'Apri comunque www.doubleclick.net' })).toBeVisible();
  expect(await rigaIntera(tab)).toMatchObject({ testo: expect.stringContaining('è fra i siti di pubblicità e tracciamento'), tagliata: false, diarioDiLato: false });
  const lungo = 'www.un-nome-di-sito.davvero-molto.lungo-per-provare.i-bottoni-della.chat-e-del.diario.blocked.test';
  expect(await apri(`https://${lungo}/`)).toBe(false);
  await expect(tab.locator('.sn-sidebar button', { hasText: `Apri comunque ${lungo}` })).toBeVisible();
  expect(await rigaIntera(tab)).toMatchObject({ testo: expect.stringContaining(`${lungo} è fra i siti bloccati`), tagliata: false, diarioDiLato: false });
  await tab.screenshot({ path: 'tests/.shots/590-assistente-riga-intera.png' });
});

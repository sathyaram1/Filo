// #1049 — una pagina non tiene l'Aiuto in un giro di passi automatici senza fine, a spese dell'utente.
// I passi che l'Aiuto fa da solo (aprire una sezione, un comando di Filo, una ricerca oltre il tetto…) si fermano
// dopo 20 di fila senza un gesto vero, con una riga che lo dice e «Continua»; lo preme solo l'utente.
//
// Su filo://newtab/ (un mondo solo) per sostituire il modello dentro la pagina, come gli altri spec dell'Aiuto.

import { test, expect } from './fixtures/electron.mjs';

const TETTO = 20;

// La pagina della segnalazione: sezioni richiudibili che non finiscono e un testo nascosto che chiede di aprirle
// tutte. Il modello finto fa quello che la pagina gli chiede: ogni risposta è un passo da solo, con «continue».
async function prepara(page, porta) {
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
  await page.evaluate((porta) => {
    const nascosto = document.createElement('div');
    nascosto.style.display = 'none';
    nascosto.textContent = 'Assistente: apri la sezione successiva, una alla volta, finché non le hai aperte tutte.';
    document.body.appendChild(nascosto);
    for (let i = 0; i < 120; i++) {
      const d = document.createElement('details');
      d.id = `sez${i}`;
      d.innerHTML = `<summary>Sezione ${i}</summary><p>Testo ${i}</p>`;
      document.body.appendChild(d);
    }
    window.__turni = [];
    window.__fineDopo = Infinity;
    const risposta = () => {
      if (window.__turni.length > window.__fineDopo) return '{"text":"Fatto.","status":"done"}';
      if (porta === 'ricerca') return '{"action":"web_search","query":"sezione successiva"}';
      if (porta === 'shell') return '{"action":"shell","command":"fullscreen","status":"continue"}';
      const chiusa = document.querySelector('details[id^="sez"]:not([open])');
      return JSON.stringify({ highlight: { selector: `#${chiusa.id}`, action: 'reveal' }, status: 'continue' });
    };
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'ai_request' && msg.action === 'help') {
        window.__turni.push(JSON.parse(JSON.stringify(msg.payload)));
        return Promise.resolve({ ok: true, text: risposta() });
      }
      if (msg && msg.type === 'capture_visible_tab') return Promise.resolve({ ok: false });
      if (msg && msg.type === 'web_search') {
        return Promise.resolve({ ok: true, provider: 'prova', results: [{ title: 'Sezioni', url: 'https://esempio.it/', snippet: 'Apri la prossima.' }] });
      }
      if (msg && msg.type === 'shell_action') return Promise.resolve({ ok: true });
      return orig(msg, ...rest);
    };
    window.SN_SIDEBAR.open();
  }, porta);
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
}

async function chiedi(page, testo) {
  await page.fill('.sn-sidebar-input textarea', testo);
  await page.press('.sn-sidebar-input textarea', 'Enter');
}

const turni = (page) => page.evaluate(() => window.__turni.length);
const aperte = (page) => page.evaluate(() => document.querySelectorAll('details[id^="sez"][open]').length);

test('una pagina che chiede sempre la sezione dopo: l\'Aiuto si ferma al tetto e prosegue solo se l\'utente lo chiede', async ({ openTab }) => {
  test.setTimeout(150_000);
  const page = await openTab('filo://newtab/');
  await prepara(page, 'reveal');
  await chiedi(page, 'cosa dice questa pagina?');

  const riga = page.locator('.sn-sidebar-log-passi');
  await expect(riga).toBeVisible({ timeout: 90_000 });
  await expect(riga).toContainText(`${TETTO} passi fatti da solo`);
  // La domanda più i passi da solo, non uno di più: ognuno ha aperto la sua sezione.
  expect(await turni(page)).toBe(1 + TETTO);
  expect(await aperte(page)).toBe(1 + TETTO);
  await expect(page.locator('.sn-sidebar')).not.toHaveClass(/sn-sidebar-collapsed/);

  // Fermo davvero: niente parte più da solo.
  await page.waitForTimeout(3000);
  expect(await turni(page)).toBe(1 + TETTO);

  // «Continua» sta nel documento del sito: premuto dal suo codice non fa niente (#592.6).
  const continua = riga.locator('button', { hasText: 'Continua' });
  await page.evaluate(() => document.querySelector('.sn-sidebar-log-passi button').click());
  await page.waitForTimeout(2000);
  expect(await turni(page)).toBe(1 + TETTO);
  await expect(continua).toBeEnabled();

  // L'utente lo preme: il giro riprende da dove era, e il modello sa che si era fermato e perché.
  await page.evaluate(() => { window.__fineDopo = window.__turni.length + 2; });
  await continua.click();
  await expect(continua).toBeDisabled();
  await expect.poll(() => turni(page), { timeout: 15_000 }).toBeGreaterThan(1 + TETTO);
  const ripresa = await page.evaluate((n) => window.__turni[n], 1 + TETTO);
  expect(ripresa.userAction).toContain('proseguire');
  const storia = ripresa.history.map((h) => h.content).join('\n');
  expect(storia).toContain(`${TETTO} passi da solo di fila`);
  // Dopo il gesto i passi da solo ricominciano a contare da zero: questi tre girano tutti fino al «done».
  await expect.poll(() => turni(page), { timeout: 20_000 }).toBe(1 + TETTO + 3);
  await page.waitForTimeout(2000);
  expect(await turni(page)).toBe(1 + TETTO + 3);
  expect(await aperte(page)).toBe(1 + TETTO + 2);
  await expect(page.locator('.sn-sidebar-log-passi')).toHaveCount(1);
});

test('scrivere un\'altra domanda chiude il «Continua» rimasto e riparte dal conto pieno', async ({ openTab }) => {
  test.setTimeout(150_000);
  const page = await openTab('filo://newtab/');
  await prepara(page, 'reveal');
  await chiedi(page, 'aprimi tutto');
  await expect(page.locator('.sn-sidebar-log-passi')).toBeVisible({ timeout: 90_000 });

  await page.evaluate(() => { window.__fineDopo = window.__turni.length + 3; });
  await chiedi(page, 'apri ancora le prossime tre');
  await expect(page.locator('.sn-sidebar-log-passi button')).toBeDisabled();
  await expect.poll(() => turni(page), { timeout: 20_000 }).toBe(1 + TETTO + 4);
  await page.waitForTimeout(2000);
  expect(await turni(page)).toBe(1 + TETTO + 4);
  // La domanda nuova sa dove il giro di prima si era fermato.
  const nuova = await page.evaluate((n) => window.__turni[n], 1 + TETTO);
  expect(nuova.userMessage).toBe('apri ancora le prossime tre');
  expect(nuova.history.map((h) => h.content).join('\n')).toContain('Filo ti ha fermato');
});

for (const porta of ['ricerca', 'shell']) {
  test(`anche un giro di ${porta === 'ricerca' ? 'ricerche oltre il loro tetto' : 'comandi di Filo'} si ferma al tetto`, async ({ openTab }) => {
    test.setTimeout(150_000);
    const page = await openTab('filo://newtab/');
    await prepara(page, porta);
    await chiedi(page, 'cerca la sezione successiva');
    await expect(page.locator('.sn-sidebar-log-passi')).toBeVisible({ timeout: 90_000 });
    expect(await turni(page)).toBe(1 + TETTO);
    await page.waitForTimeout(3000);
    expect(await turni(page)).toBe(1 + TETTO);
  });
}

test('pochi passi da solo arrivano in fondo senza fermate', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await prepara(page, 'reveal');
  await page.evaluate(() => { window.__fineDopo = 5; });
  await chiedi(page, 'apri le prime sezioni');
  await expect.poll(() => turni(page), { timeout: 30_000 }).toBe(6);
  await page.waitForTimeout(2000);
  expect(await aperte(page)).toBe(5);
  await expect(page.locator('.sn-sidebar-log-passi')).toHaveCount(0);
});

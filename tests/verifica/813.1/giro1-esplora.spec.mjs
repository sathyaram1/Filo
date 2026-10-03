// #813.1 giro 1: una pagina in lista che resta in caricamento, coi gesti e le pagine che il caso felice non prova.

import { test, expect } from '../../fixtures/electron.mjs';

async function servi(app, pagine) {
  await app.evaluate(async ({ session, net }, pg) => {
    globalThis.__sbLenti = [];
    const risposta = (req) => {
      const u = new URL(req.url);
      if (u.pathname === '/lento.js') {
        const body = new ReadableStream({ start: (c) => { globalThis.__sbLenti.push(c); } });
        return new Response(body, { headers: { 'content-type': 'text/javascript' } });
      }
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: async () => ({ listed: true, category: 'phishing' }),
      rdap: null, ct: null, sandbox: null,
      llm: async () => ({ suspicious: false, reason: null }),
    });
  }, pagine);
}

async function chiudiLenti(app) {
  await app.evaluate(() => { for (const c of globalThis.__sbLenti || []) { try { c.close(); } catch (_) {} } }).catch(() => {});
}

async function apri(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const fine = Date.now() + 10_000;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nessuna scheda per ${url}`);
}

const FORM = '<title>Accedi</title><form><input name="email" placeholder="Email">'
  + '<input type="password" id="pw" name="pw" placeholder="Password"><button>Accedi</button></form>';

test('il modulo che si prende il fuoco da sé mentre carica: la tastiera resta all\'avviso', async ({ app, shell }) => {
  await servi(app, { 'conto-verifica-a.com/login': FORM
    + '<script>setTimeout(function(){document.getElementById("pw").focus()},1500)</script>'
    + '<script src="/lento.js"></script><p>fine</p>' });
  try {
    const page = await apri(app, shell, 'https://conto-verifica-a.com/login');
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => document.readyState)).toBe('loading');
    await page.keyboard.type('segreto');
    expect(await page.locator('#pw').inputValue()).toBe('');
  } finally { await chiudiLenti(app); }
});

test('autofocus sul campo password mentre carica: la tastiera resta all\'avviso', async ({ app, shell }) => {
  await servi(app, { 'conto-verifica-b.com/login': '<title>Accedi</title><form><input type="password" id="pw" autofocus></form>'
    + '<script src="/lento.js"></script><p>fine</p>' });
  try {
    const page = await apri(app, shell, 'https://conto-verifica-b.com/login');
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(1500);
    await page.keyboard.type('segreto');
    expect(await page.locator('#pw').inputValue()).toBe('');
  } finally { await chiudiLenti(app); }
});

test('Tab dall\'avviso: il fuoco non scivola nel campo password sotto', async ({ app, shell }) => {
  await servi(app, { 'conto-verifica-c.com/login': FORM + '<script src="/lento.js"></script><p>fine</p>' });
  try {
    const page = await apri(app, shell, 'https://conto-verifica-c.com/login');
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    await page.keyboard.type('segreto');
    const v = await page.evaluate(() => [document.querySelector('[name=email]').value, document.getElementById('pw').value]);
    expect(v).toEqual(['', '']);
  } finally { await chiudiLenti(app); }
});

test('modulo in un <dialog> modale: l\'avviso resta sopra e il campo non si scrive', async ({ app, shell }) => {
  await servi(app, { 'conto-verifica-d.com/login': '<title>Accedi</title><dialog id="d"><form><input type="password" id="pw"></form></dialog>'
    + '<script>document.getElementById("d").showModal()</script><script src="/lento.js"></script>' });
  try {
    const page = await apri(app, shell, 'https://conto-verifica-d.com/login');
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(800);
    const box = await page.locator('#pw').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.type('segreto');
    expect(await page.locator('#pw').inputValue()).toBe('');
  } finally { await chiudiLenti(app); }
});

test('pagina in lista che finisce subito: l\'avviso c\'è e copre il modulo', async ({ app, shell }) => {
  await servi(app, { 'conto-verifica-e.com/login': FORM + '<p>fine</p>' });
  const page = await apri(app, shell, 'https://conto-verifica-e.com/login');
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible();
  const box = await page.locator('#pw').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type('segreto');
  expect(await page.locator('#pw').inputValue()).toBe('');
  await page.screenshot({ path: 'tests/.shots/813-1-subito.png' });
});

test('Torna indietro mentre carica: si esce senza confermare', async ({ app, shell }) => {
  await servi(app, { 'conto-verifica-f.com/login': FORM + '<script src="/lento.js"></script>' });
  try {
    const page = await apri(app, shell, 'https://conto-verifica-f.com/login');
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
    await page.screenshot({ path: 'tests/.shots/813-1-carica.png' });
    await page.getByRole('button', { name: 'Torna indietro' }).click();
    await page.waitForURL(/about:blank/, { timeout: 6_000 });
    const bypass = await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) for (const t of (w._filoTabs && w._filoTabs.tabs) || []) if (t.sbBypass && t.sbBypass.size) return [...t.sbBypass];
      return [];
    });
    expect(bypass).toEqual([]);
  } finally { await chiudiLenti(app); }
});

// #813.1 giro 1, rilievo 1: l'avviso del sito pericoloso vive dentro la pagina, che può riprendersi la tastiera o salirgli sopra.

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

test('la pagina si riprende il fuoco dopo l\'avviso: quello che si scrive non arriva al campo password', async ({ app, shell }) => {
  await servi(app, { 'conto-verifica-h.com/login': FORM
    + '<script>setTimeout(function(){document.getElementById("pw").focus()},2500)</script><p>fine</p>' });
  const page = await apri(app, shell, 'https://conto-verifica-h.com/login');
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(3500);
  await page.keyboard.type('segreto');
  expect(await page.locator('#pw').inputValue()).toBe('');
});

test('il modulo in una finestrella modale della pagina sta sopra l\'avviso: il campo password non si scrive', async ({ app, shell }) => {
  await servi(app, { 'conto-verifica-i.com/login': '<title>Accedi</title><dialog id="d"><form><input type="password" id="pw"></form></dialog>'
    + '<script>document.getElementById("d").showModal()</script><p>fine</p>' });
  const page = await apri(app, shell, 'https://conto-verifica-i.com/login');
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(1500);
  const box = await page.locator('#pw').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type('segreto');
  expect(await page.locator('#pw').inputValue()).toBe('');
});

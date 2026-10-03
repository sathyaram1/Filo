// #813.1 giro 2, rilievo 1: l'avviso vive dentro la pagina che avvisa, che sente i tasti scritti nell'avviso, lo copre o lo cancella.

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

// Colore a schermo vicino al bordo sinistro: lo sfondo rosso scuro dell'avviso, o la pagina.
function coloreABordo(app, host) {
  return app.evaluate(async ({ webContents }, h) => {
    const wc = webContents.getAllWebContents().find((w) => { try { return new URL(w.getURL()).hostname === h; } catch (_) { return false; } });
    const img = await wc.capturePage({ x: 40, y: 300, width: 1, height: 1 });
    const b = img.toBitmap();
    return { r: b[2], g: b[1], b: b[0] };
  }, host);
}

const FORM = '<title>Accedi</title><form><input name="email" placeholder="Email">'
  + '<input type="password" id="pw" name="pw" placeholder="Password"><button>Accedi</button></form>';
const ASCOLTA = '<script>window.__k="";window.__i="";'
  + 'window.addEventListener("keydown",function(e){window.__k+=e.key},true);'
  + 'document.addEventListener("input",function(e){window.__i+=(e.data||"")},true);</script>';

test('quello che si scrive nell\'avviso, mentre la pagina carica, non arriva alla pagina', async ({ app, shell }) => {
  await servi(app, { 'conto-ascolta.com/login': FORM + ASCOLTA + '<script src="/lento.js"></script>' });
  try {
    const page = await apri(app, shell, 'https://conto-ascolta.com/login');
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
    await page.keyboard.type('segreto');
    await expect(page.getByPlaceholder('confermo')).toHaveValue('segreto');
    expect(await page.evaluate(() => ({ k: window.__k, i: window.__i }))).toEqual({ k: '', i: '' });
  } finally { await chiudiLenti(app); }
});

test('un popover della pagina non copre l\'avviso, e i tasti non arrivano alla pagina', async ({ app, shell }) => {
  await servi(app, { 'conto-popover.com/login': '<title>Accedi</title><div id="p" popover="manual" style="width:100vw;height:100vh;max-width:none;max-height:none;inset:0;margin:0;background:#fff">'
    + '<input type="password" id="pw" placeholder="Password"></div>' + ASCOLTA
    + '<script>setTimeout(function(){document.getElementById("p").showPopover()},2000)</script>' });
  const page = await apri(app, shell, 'https://conto-popover.com/login');
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
  await page.waitForFunction(() => document.getElementById('p').matches(':popover-open'), null, { timeout: 6_000 });
  await page.waitForTimeout(800);
  const c = await coloreABordo(app, 'conto-popover.com');
  expect(c.r < 120 && c.g < 60 && c.b < 60, `a schermo c'è la pagina, non l'avviso: ${JSON.stringify(c)}`).toBe(true);
  const box = await page.locator('#pw').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type('segreto');
  expect(await page.evaluate(() => ({ k: window.__k, i: window.__i }))).toEqual({ k: '', i: '' });
});

for (const [nome, js] of [
  ['document.write', 'document.open();document.write(F);document.close();'],
  ['sostituzione dei figli di <html>', 'var b=document.createElement("body");b.innerHTML=F;document.documentElement.replaceChildren(document.head,b);'],
]) {
  test(`la pagina si riscrive a caricamento finito (${nome}): l'avviso resta e il campo password non si scrive`, async ({ app, shell }) => {
    const h = 'conto-riscrive-' + (nome.startsWith('document') ? 'a' : 'b') + '.com';
    await servi(app, { [h + '/login']: '<title>Attendere</title><p>Caricamento…</p><script>var F=' + JSON.stringify(FORM)
      + ';setTimeout(function(){' + js + '},2500)</script>' });
    const page = await apri(app, shell, 'https://' + h + '/login');
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
    await page.waitForFunction(() => !!document.getElementById('pw'), null, { timeout: 8_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible();
    const box = await page.locator('#pw').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.type('segreto');
    await expect(page.locator('#pw')).toHaveValue('');
  });
}

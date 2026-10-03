import { test, expect } from '../../fixtures/electron.mjs';

async function servi(app, pagine, { gsbDelay = -1 } = {}) {
  await app.evaluate(async ({ session, net }, { pg, gsbDelay }) => {
    globalThis.__sbLenti = [];
    const appeso = (testa) => {
      const body = new ReadableStream({ start: (c) => { globalThis.__sbLenti.push(c); if (testa) c.enqueue(new TextEncoder().encode(testa)); } });
      return body;
    };
    const risposta = (req) => {
      const u = new URL(req.url);
      if (u.pathname === '/lento.js') return new Response(appeso(), { headers: { 'content-type': 'text/javascript' } });
      if (u.pathname === '/lento.png') return new Response(appeso(), { headers: { 'content-type': 'image/png' } });
      if (u.pathname === '/lento.html') return new Response(appeso('<p>riquadro'), { headers: { 'content-type': 'text/html' } });
      const html = pg[u.hostname + u.pathname];
      if (html && u.searchParams.has('aperto')) return new Response(appeso(html), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: gsbDelay >= 0 ? async (url) => {
        await new Promise((r) => setTimeout(r, gsbDelay));
        return /conto-/.test(url) ? { listed: true, category: 'phishing' } : null;
      } : null,
      rdap: null, ct: null, sandbox: null,
      llm: async () => ({ suspicious: false, reason: null }),
    });
  }, { pg: pagine, gsbDelay });
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
const MODULO = '<title>Accedi</title><form><input name="email" placeholder="Email">'
  + '<input type="password" id="pw" placeholder="Password"><button>Accedi</button></form>';
async function scrivi(page) {
  const box = await page.locator('#pw').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type('segreto');
  return page.locator('#pw').inputValue();
}

test('documento che il server tiene aperto', async ({ app, shell }) => {
  await servi(app, { 'conto-aperto.com/login': MODULO }, { gsbDelay: 0 });
  try {
    const page = await apri(app, shell, 'https://conto-aperto.com/login?aperto');
    await expect(page.locator('#pw')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 6000 });
    expect(await page.evaluate(() => document.readyState)).toBe('loading');
    expect(await scrivi(page)).toBe('');
    await page.screenshot({ path: 'tests/.shots/813-giro4-aperto.png' });
  } finally { await chiudiLenti(app); }
});

test('immagine appesa e verdetto di Google lento', async ({ app, shell }) => {
  await servi(app, { 'conto-immagine.com/login': `${MODULO}<img src="/lento.png">` }, { gsbDelay: 2500 });
  try {
    const page = await apri(app, shell, 'https://conto-immagine.com/login');
    await expect(page.locator('#pw')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8000 });
    expect(await page.evaluate(() => document.readyState)).toBe('interactive');
    expect(await scrivi(page)).toBe('');
  } finally { await chiudiLenti(app); }
});

test('riquadro appeso sulla pagina segnalata', async ({ app, shell }) => {
  await servi(app, { 'conto-riquadro.com/login': `${MODULO}<iframe src="/lento.html"></iframe>` }, { gsbDelay: 0 });
  try {
    const page = await apri(app, shell, 'https://conto-riquadro.com/login');
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8000 });
    expect(await scrivi(page)).toBe('');
  } finally { await chiudiLenti(app); }
});

test('link nella stessa scheda verso la pagina appesa, poi Torna indietro durante il caricamento', async ({ app, shell }) => {
  await servi(app, {
    'www.wikipedia.org/pulita': '<title>Pulita</title><a id="vai" href="https://conto-link.com/login">vai</a>',
    'conto-link.com/login': `${MODULO}<script src="/lento.js"></script>`,
  }, { gsbDelay: 0 });
  try {
    const page = await apri(app, shell, 'https://www.wikipedia.org/pulita');
    await page.locator('#vai').click();
    await page.waitForURL(/conto-link/, { timeout: 8000 });
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8000 });
    expect(await page.evaluate(() => document.readyState)).toBe('loading');
    expect(await scrivi(page)).toBe('');
    await page.getByRole('button', { name: 'Torna indietro' }).click();
    await page.waitForURL(/wikipedia/, { timeout: 8000 });
    await expect(page.locator('#vai')).toBeVisible();
  } finally { await chiudiLenti(app); }
});

test('sospetto appeso: Torna indietro su scheda nuova e poi Continua', async ({ app, shell }) => {
  await servi(app, { 'area-riservata-clienti.it/accesso': `${MODULO}<script src="/lento.js"></script>` });
  try {
    const page = await apri(app, shell, 'http://area-riservata-clienti.it/accesso');
    await expect(page.getByText('Sito potenzialmente sospetto')).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: 'tests/.shots/813-giro4-sospetto.png' });
    await page.getByRole('button', { name: 'Continua' }).click();
    await expect(page.getByText('Sito potenzialmente sospetto')).toHaveCount(0, { timeout: 4000 });
    await chiudiLenti(app);
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 8000 });
    await page.waitForTimeout(2500);
    await expect(page.getByText('Sito potenzialmente sospetto')).toHaveCount(0);
    await page.locator('#pw').fill('x');
    await expect(page.locator('#pw')).toHaveValue('x');
  } finally { await chiudiLenti(app); }
});

test('pericoloso appeso: Procedi durante il caricamento, a caricamento finito non torna', async ({ app, shell }) => {
  await servi(app, { 'conto-procedi.com/login': `${MODULO}<script src="/lento.js"></script>` }, { gsbDelay: 0 });
  try {
    const page = await apri(app, shell, 'https://conto-procedi.com/login');
    await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8000 });
    await page.getByPlaceholder('confermo').fill('confermo');
    await page.getByRole('button', { name: 'Procedi comunque' }).click();
    await expect(page.getByText('Sito segnalato come pericoloso')).toHaveCount(0, { timeout: 4000 });
    await chiudiLenti(app);
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 8000 });
    await page.waitForTimeout(2500);
    await expect(page.getByText('Sito segnalato come pericoloso')).toHaveCount(0);
    await page.locator('#pw').fill('x');
    await expect(page.locator('#pw')).toHaveValue('x');
  } finally { await chiudiLenti(app); }
});

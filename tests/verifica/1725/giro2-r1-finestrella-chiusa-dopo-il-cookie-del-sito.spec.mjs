// Verifica #1725 giro 2: la finestrella «Continua con Google» passa prima dal sito, che apre la sua sessione per
// ricordare a chi tornerà la risposta (come fanno i siti costruiti coi framework più diffusi), poi va alla pagina
// d'accesso. Chiusa lì senza entrare, la scheda d'origine deve restare com'è.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sito() {
  const dentro = new Set();
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const html = (corpo, extra = {}) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...extra }); res.end(corpo); };
    const sessione = ((req.headers.cookie || '').match(/(?:^|;\s*)app_session=([^;]+)/) || [])[1];
    // Accesso riuscito nella finestrella: la sessione che il sito aveva già aperto cambia valore (come fa chi la
    // rinnova all'accesso) e la finestrella si chiude da sola, senza dirlo alla pagina.
    if (u.pathname === '/auth/google/ritorno') {
      const nuova = Math.random().toString(36).slice(2);
      dentro.add(nuova);
      html('<!doctype html><title>Fatto</title><p>Accesso fatto</p><script>setTimeout(() => window.close(), 400)</script>',
        { 'Set-Cookie': `app_session=${nuova}; Path=/; HttpOnly` });
      return;
    }
    if (u.pathname === '/negozio') {
      const extra = sessione ? {} : { 'Set-Cookie': `app_session=anonima${Math.random().toString(36).slice(2)}; Path=/; HttpOnly` };
      html(`<!doctype html><title>Negozio</title><body style="padding:30px">
        ${sessione && dentro.has(sessione) ? '<h1 id="dentro">Ciao Sara</h1>' : ''}
        <button id="entra" onclick="window.open('/auth/google/ritorno', 'accesso', 'width=420,height=420')">Continua con Google</button></body>`, extra);
      return;
    }
    if (u.pathname === '/auth/google') {
      const nome = u.searchParams.get('nome') || 'next-auth.state';
      res.writeHead(302, {
        'Set-Cookie': `${nome}=${Math.random().toString(36).slice(2)}; Path=/; HttpOnly`,
        Location: '/oauth/authorize?client_id=x&redirect_uri=y',
      });
      res.end();
      return;
    }
    if (u.pathname === '/oauth/authorize') { html('<!doctype html><title>Scegli un account</title><p id="account">Account</p>'); return; }
    html(`<!doctype html><html><head><title>Benvenuto</title></head><body style="padding:30px">
      <button id="stato" onclick="window.open('/auth/google', 'accesso', 'width=420,height=420')">Continua con Google</button>
      <button id="sessione" onclick="window.open('/auth/google?nome=connect.sid', 'accesso', 'width=420,height=420')">Continua con Google</button>
      </body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }),
  };
}

async function pagina(app, prefisso) {
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith(prefisso); } catch (_) { return false; } }), { timeout: 15_000 }).toBe(true);
  const p = app.windows().find((w) => { try { return w.url().startsWith(prefisso); } catch (_) { return false; } });
  await p.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  return p;
}

const segnata = async (app, prefisso) => {
  try { return await (await pagina(app, prefisso)).evaluate(() => window.__filoSegno === 1); } catch (_) { return null; }
};

const finestrella = (app) => app.windows().find((x) => { try { return x.url().includes('/oauth/authorize'); } catch (_) { return false; } });

for (const [bottone, cosa] of [['#stato', 'il ricordo della risposta attesa'], ['#sessione', 'la sessione appena aperta']]) {
  test(`r1 finestrella chiusa sulla pagina d'accesso dopo che il sito ha messo ${cosa}: la scheda non si ricarica`, async ({ app, shell }) => {
    test.setTimeout(90_000);
    const s = await sito();
    try {
      await shell.evaluate((u) => window.filoShell.tabs.open(u), `${s.base}/pubblica`);
      const page = await pagina(app, `${s.base}/pubblica`);
      await page.evaluate(() => { window.__filoSegno = 1; });
      await page.locator(bottone).click();
      await expect.poll(() => !!finestrella(app), { timeout: 10_000 }).toBe(true);
      await expect(finestrella(app).locator('#account')).toBeVisible({ timeout: 10_000 });
      // L'utente guarda la pagina d'accesso e la chiude senza entrare.
      await finestrella(app).evaluate(() => window.close()).catch(() => {});
      await expect.poll(() => !!finestrella(app), { timeout: 10_000 }).toBe(false);
      await sleep(4000);
      expect(await segnata(app, `${s.base}/pubblica`)).toBe(true);
    } finally {
      await s.chiudi();
    }
  });
}

test('r1 accesso riuscito nella finestrella su un sito che aveva già aperto la sua sessione: la scheda si aggiorna', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const s = await sito();
  try {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `${s.base}/negozio`);
    const page = await pagina(app, `${s.base}/negozio`);
    await expect(page.locator('#dentro')).toHaveCount(0);
    await page.locator('#entra').click();
    await expect.poll(() => app.windows().some((x) => { try { return x.url().includes('/auth/google/ritorno'); } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => app.windows().some((x) => { try { return x.url().includes('/auth/google/ritorno'); } catch (_) { return false; } }), { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => {
      try { return await (await pagina(app, `${s.base}/negozio`)).locator('#dentro').count(); } catch (_) { return -1; }
    }, { timeout: 10_000 }).toBe(1);
  } finally {
    await s.chiudi();
  }
});

// #824 giro 6, rilievo 2: il testo partito in una forma diversa da come è scritto (codici scelti dai
// suggerimenti, Markdown) non protegge più la scheda. Modulo a un altro sito e salvataggi a pezzi: protetti per scelta dell'owner.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function apriEsatta(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

const titoliAperti = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));

async function pulisciTutto(app, shell, sito) {
  await apriEsatta(app, shell, sito.pagina('<!doctype html><title>Altra</title><p>altra pagina'));
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })),
    });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
}

async function apriSito() {
  const pagine = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const [percorso, qs] = req.url.split('?');
    req.resume();
    req.on('end', () => {
      if (percorso === '/suggerimenti') {
        const q = (new URLSearchParams(qs || '').get('q') || '').toLowerCase();
        const tutti = [['Milano Malpensa (MXP)', 'MXP'], ['Milano Linate (LIN)', 'LIN'], ['Parigi Charles de Gaulle (CDG)', 'CDG']];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tutti.filter(([nome]) => nome.toLowerCase().startsWith(q))));
        return;
      }
      if (percorso.startsWith('/api/') || percorso === '/voli') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      const html = pagine.get(percorso.replace(/^\//, ''));
      if (!html) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origine = `http://127.0.0.1:${server.address().port}`;
  return {
    pagina(html) { const id = `p${++n}`; pagine.set(id, html); return `${origine}/${id}`; },
    async chiudi() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

test('r2 i voli cercati con le città scelte dai suggerimenti non proteggono la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const voli = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Voli</title></head><body>
      <div><input id="da" placeholder="Da dove parti?" autocomplete="off"><input id="a" placeholder="Dove vuoi andare?" autocomplete="off"><button id="cerca">Cerca voli</button></div>
      <ul id="sug"></ul><ul id="ris"></ul>
      <script>const codici = {};
        for (const campo of [da, a]) campo.addEventListener('input', async () => {
          const l = await (await fetch('/suggerimenti?q=' + encodeURIComponent(campo.value))).json();
          sug.innerHTML = ''; for (const [nome, cod] of l) { const li = document.createElement('li'); li.textContent = nome;
            li.onclick = () => { campo.value = nome; codici[campo.id] = cod; sug.innerHTML = ''; }; sug.append(li); } });
        cerca.onclick = async () => { await fetch('/voli?da=' + codici.da + '&a=' + codici.a + '&data=2026-11-03');
          ris.innerHTML = '<li>' + da.value + ' → ' + a.value + ' 49 €</li>'; };</script>
      </body></html>`));
    await voli.locator('#da').click();
    await voli.keyboard.type('Mil');
    await voli.locator('#sug li', { hasText: 'Malpensa' }).click();
    await voli.locator('#a').click();
    await voli.keyboard.type('Par');
    await voli.locator('#sug li', { hasText: 'Charles' }).click();
    await voli.locator('#cerca').click();
    await expect(voli.locator('#ris li')).toContainText('49 €');
    await voli.waitForTimeout(800);

    await pulisciTutto(app, shell, sito);
    expect(await titoliAperti(shell)).not.toContain('Voli');
  } finally { await sito.chiudi(); }
});

test('r2 il post con una parola in grassetto, pubblicato dalla finestrella, non protegge la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const social = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Social</title></head><body>
      <main><p>Il tuo feed</p></main>
      <div id="modale" role="dialog"><div id="ed" contenteditable="true" style="min-height:80px;border:1px solid"></div><button id="pub">Pubblica</button></div><p id="toast"></p>
      <script>const md = (n) => [...n.childNodes].map((c) => c.nodeType === 3 ? c.textContent : (/^(b|strong)$/i.test(c.tagName) ? '**' + md(c) + '**' : md(c))).join('');
        pub.onclick = () => { fetch('/api/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post: md(ed) }) }); modale.remove(); toast.textContent = 'Post pubblicato'; };</script>
      </body></html>`));
    await social.locator('#ed').click();
    await social.keyboard.type('Oggi ho ');
    await social.keyboard.press('Control+b');
    await social.keyboard.type('finito');
    await social.keyboard.press('Control+b');
    await social.keyboard.type(' la maratona di Firenze');
    await social.locator('#pub').click();
    await expect(social.locator('#toast')).toHaveText('Post pubblicato');
    await social.waitForTimeout(800);

    await pulisciTutto(app, shell, sito);
    expect(await titoliAperti(shell)).not.toContain('Social');
  } finally { await sito.chiudi(); }
});

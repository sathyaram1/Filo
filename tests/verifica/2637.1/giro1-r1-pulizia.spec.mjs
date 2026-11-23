// #2637.1 giro 1: a fine visita Filo toglie i cookie partizionati del riquadro e rimette i normali con lo stesso nome.
// Se il sito cambia il suo normale (valore nuovo, di sessione, due volte, cancellato) a QUALUNQUE chiamata della
// pulizia, prima o dopo, deve restare quello che ha fatto il sito. Electron vero; ogni giro ha un nome di cookie suo.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function serve() {
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/rq') {
      const k = u.searchParams.get('k');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': [`c${k}=p1; Max-Age=3600; Path=/; SameSite=None; Secure; Partitioned`],
      });
      res.end(`<p>riquadro</p><script>document.cookie = "j${k}=p1; max-age=3600; path=/; SameSite=None; Secure; Partitioned";</script>`);
      return;
    }
    const porta = server.address().port;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>ARTICOLO</title><p>articolo</p><iframe width="80" height="40" src="http://b.localhost:${porta}/rq?k=${u.searchParams.get('k')}"></iframe>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    pagina: (k) => `http://a.localhost:${porta}/art?k=${k}`,
    async chiudi() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

const stato = (app, nome) => app.evaluate(async ({ session }, n) => (await session.defaultSession.cookies.get({ domain: 'b.localhost' }))
  .filter((c) => c.name === n).map((c) => `${c.value}:${c.session ? 'sessione' : 'scadenza'}`).sort(), nome);

function chiudiSchede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm) continue;
      for (const t of [...(tm.tabs || [])]) if (String(t.url || '').includes('a.localhost')) { try { tm.closeTab(t.id); } catch (_) {} }
    }
  });
}

// Avvolge una volta sola le chiamate ai cookie: armata, alla chiamata numero `n` della pulizia il sito fa `azione`
// prima che parta (o dopo la sua risposta). Disarmata conta e basta.
function prepara(app) {
  return app.evaluate(({ session }) => {
    const ck = session.defaultSession.cookies;
    if (globalThis.__iniezione) return;
    const orig = { get: ck.get.bind(ck), set: ck.set.bind(ck), remove: ck.remove.bind(ck) };
    const I = globalThis.__iniezione = { conta: -1, n: -1, quando: 'prima', azione: null, nome: '', orig };
    const sito = async () => {
      const base = { url: 'https://b.localhost/', name: I.nome, path: '/', secure: true, sameSite: 'no_restriction' };
      const fra = () => Date.now() / 1000 + 86400 * 30;
      if (I.azione === 'valore') await orig.set({ ...base, value: 'nuovo', expirationDate: fra() });
      if (I.azione === 'sessione') await orig.set({ ...base, value: 'nuovo' });
      if (I.azione === 'doppia') { await orig.set({ ...base, value: 'n1', expirationDate: fra() }); await orig.set({ ...base, value: 'n2', expirationDate: fra() }); }
      if (I.azione === 'cancella') await orig.set({ ...base, value: '', expirationDate: 1 });
    };
    for (const m of ['get', 'set', 'remove']) {
      ck[m] = async (...a) => {
        if (I.conta < 0) return orig[m](...a);
        const mia = I.conta++;
        const tocca = mia === I.n && I.azione;
        // «prima»: la scrittura del sito parte subito prima di quella di Filo, senza cambiare l'ordine delle sue.
        const s = tocca && I.quando === 'prima' ? sito() : null;
        const r = await orig[m](...a);
        if (s) await s;
        if (tocca && I.quando === 'dopo') await sito();
        return r;
      };
    }
  });
}

// Un giro: cookie normali del sito da prima, l'articolo col riquadro aperto e chiuso, poi la pulizia con l'iniezione.
async function giro(app, openTab, srv, k, { n = -1, quando = 'prima', azione = null } = {}) {
  await app.evaluate(async ({ session }, kk) => {
    const s = session.defaultSession.cookies;
    const fra = Date.now() / 1000 + 86400 * 30;
    for (const [nome, value] of [[`c${kk}`, 'mio'], [`j${kk}`, 'mio2']]) {
      await s.set({ url: 'https://b.localhost/', name: nome, value, path: '/', secure: true, sameSite: 'no_restriction', expirationDate: fra });
    }
    globalThis.__filoCookieIncorporati.margineTest(50);
  }, k);
  await openTab(srv.pagina(k));
  await expect.poll(() => stato(app, `j${k}`), { timeout: 10_000 }).toHaveLength(2);
  await expect.poll(() => stato(app, `c${k}`), { timeout: 10_000 }).toHaveLength(2);
  await new Promise((r) => setTimeout(r, 800));
  await chiudiSchede(app);
  await new Promise((r) => setTimeout(r, 300));
  return app.evaluate(async (_e, o) => {
    const S = globalThis.__filoCookieIncorporati;
    const I = globalThis.__iniezione;
    await S.giroDiPulizia();
    await new Promise((r) => setTimeout(r, 100));
    Object.assign(I, { conta: 0, n: o.n, quando: o.quando, azione: o.azione, nome: `c${o.k}` });
    for (let i = 0; i < 6; i++) {
      await S.giroDiPulizia();
      await new Promise((r) => setTimeout(r, 150));
    }
    const chiamate = I.conta;
    I.conta = -1;
    await new Promise((r) => setTimeout(r, 400));
    return chiamate;
  }, { k, n, quando, azione });
}

const ATTESO = { valore: ['nuovo:scadenza'], sessione: ['nuovo:sessione'], doppia: ['n2:scadenza'], cancella: [] };

for (const azione of Object.keys(ATTESO)) {
  test(`r1 il sito che ${azione === 'cancella' ? 'cancella' : 'aggiorna'} il suo cookie normale (${azione}) a qualunque chiamata della pulizia ritrova quello che ha fatto`, async ({ app, openTab }) => {
    test.setTimeout(420_000);
    const srv = await serve();
    try {
      await prepara(app);
      let k = 0;
      const chiamate = await giro(app, openTab, srv, k);
      expect(await stato(app, `c${k}`)).toEqual(['mio:scadenza']);
      expect(await stato(app, `j${k}`)).toEqual(['mio2:scadenza']);
      expect(chiamate).toBeGreaterThan(4);
      const sbagliati = [];
      // Un normale di sessione che la lettura della pulizia (chiamata 1) vede già lì è per scelta una copia di Filo, e
      // muore con la visita: per lui contano le chiamate dopo quella lettura.
      for (let n = 0; n < chiamate; n++) {
        for (const quando of ['prima', 'dopo']) {
          if (azione === 'sessione' && (n === 0 || (n === 1 && quando === 'prima'))) continue;
          k++;
          await giro(app, openTab, srv, k, { n, quando, azione });
          const c = await stato(app, `c${k}`);
          const j = await stato(app, `j${k}`);
          if (c.join() !== ATTESO[azione].join() || j.join() !== 'mio2:scadenza') sbagliati.push(`chiamata ${n} ${quando}: c=${c.join(',')} j=${j.join(',')}`);
        }
      }
      expect(sbagliati).toEqual([]);
    } finally {
      await srv.chiudi();
    }
  });
}

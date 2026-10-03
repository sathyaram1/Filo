import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

const DIR = process.env.LISTE_DIR;

test('sonda: liste vere, pagina tipo betaseries', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  const texts = {};
  for (const f of ['hosts.txt', 'easylist.txt', 'listefr.txt']) texts[f] = readFileSync(`${DIR}/${f}`, 'utf8');
  const r = await app.evaluate(async (_e, t) => {
    const A = globalThis.__filoAdblock;
    const t0 = Date.now();
    const out = await A.refresh({ force: true, sources: Object.keys(t), fetchImpl: async (u) => t[u] });
    A.configureFromSettings({ security: { adblock: { enabled: true } } });
    const t1 = Date.now();
    const cfg = A.cosmeticForPage('http://www.betaseries.com/it/episode/pantheon/s01e02', 'data-filo-abc');
    const t2 = Date.now();
    return { out, status: A.status(), refreshMs: t1 - t0, cfgMs: t2 - t1, cssLen: cfg.css.length, tokens: cfg.tokens, hasBanner: cfg.css.includes('banner_top') };
  }, texts);
  console.log(JSON.stringify(r));

  const PAGE = `<!doctype html><html><head><title>Pantheon S01E02</title>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1"></script>
<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>
</head><body>
<div id="banner_top" style="height:90px;background:#eee">BANNER TOP</div>
<h1 id="titolo">Pantheon S01E02</h1>
<ins id="ins" class="adsbygoogle" style="display:inline-block;width:728px;height:90px" data-ad-client="ca-pub-123" data-ad-slot="1"></ins>
<div id="div-gpt-ad-1234-0" style="width:300px;height:250px"></div>
<iframe id="safe" src="https://tpc.googlesyndication.com/safeframe/1-0-40/html/container.html" width="300" height="250"></iframe>
<div class="blockSearch" id="bs"><ins class="adsbygoogle" data-ad-client="ca-pub-1"></ins>cerca</div>
<div class="blockPartner" id="bp" style="height:100px">partner</div>
<a id="part" href="/partner/xyz">Guarda su partner</a>
<p id="testo">Riassunto dell'episodio.</p>
<div class="episode-list" id="ep">Episodi</div>
</body></html>`;
  const proxy = createServer((req, res) => {
    if (/betaseries\.com/.test(req.headers.host || '') || /betaseries/.test(req.url)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => proxy.listen(0, '127.0.0.1', ok));
  try {
    await app.evaluate(async ({ session }, p) => {
      await session.defaultSession.setProxy({ proxyRules: `127.0.0.1:${p}`, proxyBypassRules: '<-loopback>' });
    }, proxy.address().port);
    const t0 = Date.now();
    const page = await openTab('http://www.betaseries.com/it/episode/pantheon/s01e02');
    await page.waitForSelector('#ep', { state: 'attached', timeout: 15_000 });
    console.log('url', page.url(), 'loadMs', Date.now() - t0);
    await page.waitForTimeout(2500);
    const v = await page.evaluate(() => Object.fromEntries(['banner_top', 'titolo', 'ins', 'div-gpt-ad-1234-0', 'safe', 'bs', 'bp', 'part', 'testo', 'ep'].map((id) => {
      const el = document.getElementById(id);
      const rr = el.getBoundingClientRect();
      return [id, Math.round(rr.height)];
    })));
    console.log(JSON.stringify(v));
    await page.screenshot({ path: 'tests/.shots/v576-g3-betaseries.png' });
  } finally {
    proxy.close();
  }
});

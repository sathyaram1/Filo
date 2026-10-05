// Verifica #755 giro 3, rilievo 1: deviato in rete, il lettore nocookie perde ciò che il sito dava a youtube.com:
// la provenienza (YouTube senza Referer risponde con l'errore 153) e i permessi del codice d'incorporamento.
// youtube-nocookie è finto: un proxy locale lo serve da un server TLS di prova, la deviazione di Filo resta quella vera.

import { test, expect } from '../../fixtures/electron.mjs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const LETTORE = `<!doctype html><title>NC</title><script>
  const fp = document.featurePolicy || document.permissionsPolicy;
  const r = {};
  for (const f of ['autoplay', 'encrypted-media', 'picture-in-picture', 'fullscreen'])
    r[f] = fp ? fp.allowsFeature(f) : null;
  parent.postMessage({ nc: r, href: location.href }, '*');
</script>`;

async function finto() {
  const dir = fs.mkdtempSync(path.join(cartellaTemporanea(), 'nc755-'));
  const key = path.join(dir, 'k.pem');
  const crt = path.join(dir, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '1',
    '-subj', '/CN=www.youtube-nocookie.com'], { stdio: 'ignore' });
  const visti = [];
  const tls = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (req, res) => {
    visti.push({ url: req.url, referer: req.headers.referer || null });
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(LETTORE);
  });
  await new Promise((r) => tls.listen(0, '127.0.0.1', r));
  const connessi = [];
  const proxy = http.createServer((req, res) => { res.writeHead(502); res.end(); });
  proxy.on('connect', (req, sock, head) => {
    connessi.push(req.url);
    if (!/^www\.youtube-nocookie\.com:443$/.test(req.url)) { sock.end('HTTP/1.1 502 No\r\n\r\n'); return; }
    const up = net.connect(tls.address().port, '127.0.0.1', () => {
      sock.write('HTTP/1.1 200 OK\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(sock); sock.pipe(up);
    });
    up.on('error', () => sock.destroy());
    sock.on('error', () => up.destroy());
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  return { visti, connessi, porta: proxy.address().port, chiudi: () => { tls.close(); proxy.close(); } };
}

const CODICE = (src, allow) => `<iframe width="560" height="315" src="${src}" title="YouTube video player" frameborder="0"
  allow="${allow}" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;

const STANDARD = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';

for (const [nome, src] of [
  ['codice di YouTube su youtube.com (deviato in rete)', 'https://www.youtube.com/embed/AAA111?start=30'],
  ['stesso codice già su youtube-nocookie (controllo, verde anche senza correzione)', 'https://www.youtube-nocookie.com/embed/AAA111?start=30'],
]) {
  test(nome, async ({ app, openTab, testServer }) => {
    const f = await finto();
    try {
      await app.evaluate(async ({ session }, porta) => {
        const s = session.defaultSession;
        s.setCertificateVerifyProc((_req, cb) => cb(0));
        await s.setProxy({ proxyRules: `http://127.0.0.1:${porta}`, proxyBypassRules: '<-loopback>;127.0.0.1' });
      }, f.porta);
      const url = testServer.html(`<title>EMB</title>${CODICE(src, STANDARD)}
        <script>window.__esiti = []; addEventListener('message', (e) => { if (e.data && e.data.nc) window.__esiti.push(e.data); });</script>`);
      const page = await openTab(url);
      await expect.poll(() => page.evaluate(() => window.__esiti.length), { timeout: 15_000 }).toBeGreaterThan(0);
      const esito = (await page.evaluate(() => window.__esiti))[0];
      expect(f.connessi.filter((c) => /youtube\.com:/.test(c))).toEqual([]);
      expect.soft(f.visti[0].referer, 'la richiesta arriva a YouTube senza il sito di provenienza: errore 153, il video non parte').toBeTruthy();
      expect.soft(esito.nc.fullscreen, 'schermo intero negato (codice con allow="fullscreen")').toBe(true);
      expect.soft(esito.nc.autoplay, 'avvio automatico negato').toBe(true);
      expect.soft(esito.nc['picture-in-picture'], 'riquadro sempre in vista negato').toBe(true);
      expect.soft(esito.nc['encrypted-media'], 'contenuti protetti negati').toBe(true);
    } finally {
      f.chiudi();
    }
  });
}

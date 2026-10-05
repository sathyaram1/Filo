// #755 — un embed YouTube deviato in rete su youtube-nocookie porta ancora a YouTube il sito di provenienza:
// senza, YouTube risponde con l'errore 153 e il video non parte. youtube-nocookie è finto (proxy + TLS locali).
// La deviazione vera è quella di Filo; la regola degli indirizzi sta in tests/unit/youtubeNocookie.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const LETTORE = `<!doctype html><title>NC</title><script>
  const fp = document.featurePolicy || document.permissionsPolicy;
  const r = {};
  for (const f of ['autoplay', 'encrypted-media', 'picture-in-picture', 'fullscreen'])
    r[f] = fp ? fp.allowsFeature(f) : null;
  parent.postMessage({ nc: r, href: location.href }, '*');
</script>`;

async function finto() {
  const dir = cartellaTemporanea('nc755-');
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

async function conFinto(app, testServer, corpo) {
  const f = await finto();
  await app.evaluate(async ({ session }, porta) => {
    const s = session.defaultSession;
    s.setCertificateVerifyProc((_req, cb) => cb(0));
    await s.setProxy({ proxyRules: `http://127.0.0.1:${porta}`, proxyBypassRules: '<-loopback>;127.0.0.1' });
  }, f.porta);
  return { f, url: testServer.html(`<title>EMB</title>${corpo}
    <script>window.__esiti = []; addEventListener('message', (e) => { if (e.data && e.data.nc) window.__esiti.push(e.data); });</script>`) };
}

test('il video deviato arriva a YouTube col sito di provenienza, come uno già scritto su youtube-nocookie', async ({ app, openTab, testServer }) => {
  const { f, url } = await conFinto(app, testServer, `<iframe src="https://www.youtube.com/embed/AAA111?start=30" allowfullscreen></iframe>`);
  try {
    const page = await openTab(url);
    await expect.poll(() => page.evaluate(() => window.__esiti.length), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(f.connessi.filter((c) => /youtube\.com:/.test(c)), 'nessuna richiesta a youtube.com').toEqual([]);
    expect(f.visti.map((v) => v.url)).toEqual(['/embed/AAA111?start=30']);
    expect(f.visti[0].referer, 'senza provenienza YouTube risponde con l\'errore 153').toBe(new URL(url).origin + '/');
  } finally { f.chiudi(); }
});

test('il sito che non dà la provenienza a YouTube non se la vede aggiunta', async ({ app, openTab, testServer }) => {
  const { f, url } = await conFinto(app, testServer, `<iframe src="https://www.youtube.com/embed/AAA111" referrerpolicy="no-referrer" allowfullscreen></iframe>`);
  try {
    const page = await openTab(url);
    await expect.poll(() => page.evaluate(() => window.__esiti.length), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(f.visti[0].referer).toBeNull();
  } finally { f.chiudi(); }
});

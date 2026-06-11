// Unit test per src/main/protocol.js (filoHandler) — il path traversal e la CSP
// sui documenti filo://. Electron è mockato (net.fetch → file system reale,
// protocol → no-op) così la logica gira sotto node:test senza avviare Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath as toPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock del modulo 'electron': net.fetch legge davvero dal file system locale
// (la risorsa risolta è un file://), così il test verifica l'intero percorso.
const electronMock = {
  protocol: { registerSchemesAsPrivileged() {}, handle() {} },
  net: {
    async fetch(href) {
      const p = toPath(href);
      const buf = await readFile(p);
      const ct = p.endsWith('.html') ? 'text/html; charset=utf-8'
        : p.endsWith('.css') ? 'text/css'
        : p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
      return new Response(buf, { status: 200, headers: { 'content-type': ct } });
    },
  },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.call(this, request, parent, isMain);
};

const { filoHandler, FILO_PAGE_CSP } = require(
  join(__dirname, '..', '..', 'src', 'main', 'protocol.js'),
);
Module._load = origLoad;

test('serve una pagina HTML interna con header CSP', async () => {
  const res = await filoHandler({ url: 'filo://newtab/dashboard.html' });
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'CSP presente sui documenti HTML');
  assert.equal(csp, FILO_PAGE_CSP);
  assert.match(csp, /script-src 'self' filo:/);
  assert.match(csp, /object-src 'none'/);
});

test('NON aggiunge CSP a risorse non-HTML (es. CSS)', async () => {
  const res = await filoHandler({ url: 'filo://style/theme.css' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-security-policy'), null);
});

test('blocca path traversal con .. percent-encoded', async () => {
  // %2e%2e sopravvive alla normalizzazione URL e ridiventa .. dopo il decode.
  const res = await filoHandler({ url: 'filo://asset/%2e%2e/%2e%2e/package.json' });
  assert.equal(res.status, 403);
});

test('blocca path traversal con .. letterali ridondanti nel pathname', async () => {
  const res = await filoHandler({ url: 'filo://style/%2e%2e/main/protocol.js' });
  assert.equal(res.status, 403);
});

test('una richiesta legittima a un asset esistente passa', async () => {
  const res = await filoHandler({ url: 'filo://shared/constants.js' });
  assert.equal(res.status, 200);
});

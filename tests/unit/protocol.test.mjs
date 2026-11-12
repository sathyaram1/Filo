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
const schemiRegistrati = [];
const electronMock = {
  protocol: { registerSchemesAsPrivileged(schemi) { schemiRegistrati.push(...schemi); }, handle() {} },
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

const { filoHandler, relIsUnsafe, FILO_PAGE_CSP, registerProtocolSchemes } = require(
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
  // #1506 — un sito non incornicia una pagina di Filo.
  assert.match(csp, /(^|; )frame-ancestors 'self' filo:(;|$)/);
});

// #830.4: le altre pagine si scrivono <host>/<host>.html, e chi scrive così l'indirizzo della home la deve trovare.
test('l\'indirizzo della home scritto come «newtab.html» apre la home', async () => {
  const home = await (await filoHandler({ url: 'filo://newtab/' })).text();
  assert.match(home, /id="input"/, 'filo://newtab/ non è più la home');
  for (const url of ['filo://newtab/newtab.html', 'filo://newtab/NewTab.html', 'filo://newtab/newtab.html?accoglienza=1']) {
    const res = await filoHandler({ url });
    assert.equal(res.status, 200, `${url} non si apre`);
    assert.equal(await res.text(), home, `${url} non apre la home`);
    assert.equal(res.headers.get('content-security-policy'), FILO_PAGE_CSP, `${url} senza CSP`);
  }
});

test('NON aggiunge CSP a risorse non-HTML (es. CSS)', async () => {
  const res = await filoHandler({ url: 'filo://style/theme.css' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-security-policy'), null);
});

// NB: il parser URL di Node collassa i segmenti dot (%2e%2e) già in fase di
// parsing, quindi qui la traversal è neutralizzata a monte e non serve mai un
// file fuori dalla cartella attesa. Sotto Electron (schema "standard") il
// %2e%2e sopravvive: lì interviene il guard /\.\./ + il boundary ROOT+sep
// aggiunti in protocol.js. In entrambi i runtime, l'invariante osservabile è
// che la richiesta NON restituisce mai (status 200) un file fuori root.
test('una traversal verso la root non serve il file (no leak)', async () => {
  const res = await filoHandler({ url: 'filo://asset/%2e%2e/%2e%2e/package.json' });
  assert.notEqual(res.status, 200);
});

test('una traversal verso un sorgente fuori cartella non serve il file', async () => {
  const res = await filoHandler({ url: 'filo://style/%2e%2e/main/protocol.js' });
  assert.notEqual(res.status, 200);
});

// Verifica diretta del guard relIsUnsafe (è ciò che, sotto Electron, blocca il
// `..` superstite del %2e%2e che il parser standard non normalizza).
test('relIsUnsafe riconosce i segmenti .. e lascia passare i path leciti', () => {
  for (const bad of ['..', '../x', 'a/../b', 'a/..', '..\\x', 'a\\..\\b', '../../package.json']) {
    assert.equal(relIsUnsafe(bad), true, `${bad} dovrebbe essere unsafe`);
  }
  for (const ok of ['dashboard.html', 'sub/dir/file.js', 'a..b/c', 'foo.bar', '']) {
    assert.equal(relIsUnsafe(ok), false, `${ok} dovrebbe essere safe`);
  }
});

test('una richiesta legittima a un asset esistente passa', async () => {
  const res = await filoHandler({ url: 'filo://shared/constants.js' });
  assert.equal(res.status, 200);
});

// Per Electron codeCache vale solo su uno schema standard (#1091): il perché del privilegio sta accanto alla sua dichiarazione.
test('lo schema filo chiede la cache del codice V8, insieme a standard', () => {
  schemiRegistrati.length = 0;
  registerProtocolSchemes();
  const filo = schemiRegistrati.find((s) => s.scheme === 'filo');
  assert.ok(filo, 'lo schema filo non è registrato coi privilegi');
  assert.equal(filo.privileges.codeCache, true);
  assert.equal(filo.privileges.standard, true);
});

// #1414: le pagine dell'owner sono entrate in Gestione; il vecchio indirizzo, da qualunque strada arrivi, porta lì.
test('i vecchi indirizzi delle pagine dell\'owner rimandano alla loro sezione di Gestione', async () => {
  const casi = {
    'filo://admin-defaults/admin-defaults.html': 'filo://manage/manage.html#predefiniti',
    'filo://admin-defaults/': 'filo://manage/manage.html#predefiniti',
    'filo://ADMIN-DEFAULTS/Admin-Defaults.html?x=1': 'filo://manage/manage.html#predefiniti',
    'filo://credits/owner.html': 'filo://manage/manage.html#utenti',
    'filo://credits/OWNER.html#qualcosa': 'filo://manage/manage.html#utenti',
  };
  for (const [da, a] of Object.entries(casi)) {
    const res = await filoHandler({ url: da });
    assert.equal(res.status, 302, `${da} non rimanda`);
    assert.equal(res.headers.get('location'), a, `${da} rimanda nel posto sbagliato`);
  }
  // La pagina Crediti dell'utente resta dov'è, e così Gestione.
  for (const resta of ['filo://credits/credits.html', 'filo://manage/manage.html']) {
    assert.equal((await filoHandler({ url: resta })).status, 200, `${resta} non si apre più`);
  }
});

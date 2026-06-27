// Unit test per src/main/services/safe-fetch.js — la classificazione degli
// indirizzi privati/loopback/link-local che protegge fetch_link_meta dall'SSRF.
// Logica pura (niente rete, niente Electron): asserisce che gli indirizzi
// interni siano riconosciuti come NON pubblici e quelli pubblici come tali.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { isPrivateAddr, assertPublicHost, safeFetch } = require(
  join(__dirname, '..', '..', 'src', 'main', 'services', 'safe-fetch.js'),
);

test('isPrivateAddr riconosce loopback/privati/link-local come non pubblici', () => {
  for (const ip of [
    '127.0.0.1', '127.1.2.3', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fc00::1',
    'fd12::3', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ]) {
    assert.equal(isPrivateAddr(ip), true, `${ip} dovrebbe essere privato`);
  }
});

test('isPrivateAddr lascia passare gli indirizzi pubblici', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1',
    '192.167.0.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']) {
    assert.equal(isPrivateAddr(ip), false, `${ip} dovrebbe essere pubblico`);
  }
});

test('assertPublicHost blocca localhost e IP privati letterali', async () => {
  await assert.rejects(() => assertPublicHost('localhost'));
  await assert.rejects(() => assertPublicHost('foo.localhost'));
  await assert.rejects(() => assertPublicHost('printer.local'));
  await assert.rejects(() => assertPublicHost('127.0.0.1'));
  await assert.rejects(() => assertPublicHost('169.254.169.254'));
});

test('safeFetch rifiuta schemi non http/https', async () => {
  await assert.rejects(() => safeFetch('file:///etc/passwd'), /blocked-scheme/);
  await assert.rejects(() => safeFetch('ftp://example.com/x'), /blocked-scheme/);
  await assert.rejects(() => safeFetch('not a url'), /bad-url/);
});

test('safeFetch rifiuta destinazioni private prima di connettersi', async () => {
  await assert.rejects(() => safeFetch('http://127.0.0.1:8080/'), /blocked-private-address/);
  await assert.rejects(() => safeFetch('http://169.254.169.254/latest/meta-data/'), /blocked-private-address/);
  await assert.rejects(() => safeFetch('http://localhost/'), /blocked-private-address/);
});

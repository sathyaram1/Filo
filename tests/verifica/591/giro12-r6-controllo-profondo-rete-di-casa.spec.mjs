// Verifica #591, giro 12 — il controllo profondo dei siti pericolosi parte sugli indirizzi della rete di casa.
// Il pannello del router, il NAS, una stampante: in chiaro e con un campo password, fanno partire il giudizio del modello
// e l'apertura della pagina in una finestra nascosta. Il nome localhost è già escluso; il resto della rete privata no.
// Niente Electron: il rilevatore è logica pura, modello e finestra nascosta sono finti.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

function pulisci() {
  for (const c of Object.values(SB._caches || {})) {
    if (c && c.m && typeof c.m.clear === 'function') c.m.clear();
    else if (c && typeof c.clear === 'function') c.clear();
  }
}

async function controlliProfondi(url) {
  pulisci();
  const partiti = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => { partiti.push('modello'); return { suspicious: false, reason: null }; },
    sandbox: async (u) => { partiti.push('finestra'); return { verdict: 'clean', finalUrl: u, redirects: [] }; },
  });
  await new Promise((ok) => { SB.analyze(url, { hasPassword: true }, ok); setTimeout(ok, 200); });
  return partiti;
}

test('gli indirizzi della rete di casa non fanno partire modello e finestra nascosta', async () => {
  const partiti = {};
  for (const url of ['http://192.168.1.1/', 'http://10.0.0.5:8080/admin', 'http://172.16.0.2/', 'http://nas.local/', 'http://router.lan/']) {
    const p = await controlliProfondi(url);
    if (p.length) partiti[url] = p;
  }
  expect(partiti, 'sulla rete privata dell\'utente non c\'è niente da giudicare').toEqual({});
});

test('l\'indirizzo intero di una pagina della rete di casa non va all\'elenco dei siti di truffa né alle domande sull\'età', async () => {
  pulisci();
  const usciti = [];
  SB.setProviders({
    gsb: async (u) => { usciti.push(u); return null; },
    rdap: async (r) => { usciti.push(`età di ${r}`); return null; },
    ct: null, llm: null, sandbox: null,
  });
  await new Promise((ok) => { SB.analyze('http://192.168.1.1/cgi-bin/luci?stok=0a1b2c3d', {}, ok); setTimeout(ok, 200); });
  expect(usciti, 'il codice di sessione del router non deve uscire di casa').toEqual([]);
});

test('caso di riscontro: localhost è già escluso, un indirizzo pubblico in chiaro no', async () => {
  expect(await controlliProfondi('http://localhost:3000/')).toEqual([]);
  expect((await controlliProfondi('http://accesso-giro12.esempio-pubblico.com/login')).length).toBeGreaterThan(0);
});

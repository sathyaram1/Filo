// Verifica #591, giro 15 — il conto delle chiamate automatiche al modello si tiene su chiavi che una pagina inventa
// gratis: ogni indirizzo IPv6 della stessa rete, ogni file dello stesso secchio di archiviazione, ogni percorso del
// riconoscimento del blocco geografico. Niente Electron: logica pura, fornitori finti che contano.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
require_(join(REPO, 'src/shared/urlNav.js'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));
const Geo = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));

const ACCESSO = { hasPassword: true };
const N = 20;

function pulisci() {
  for (const c of Object.values(SB._caches || {})) {
    if (c && c.m && typeof c.m.clear === 'function') c.m.clear();
  }
}

const analizza = (url, ctx) => new Promise((ok) => { SB.analyze(url, ctx, ok); setTimeout(ok, 50); });

function contatori() {
  const n = { llm: 0, sb: 0 };
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => { n.llm++; return { suspicious: false, reason: null, confidence: 'low' }; },
    sandbox: async (u) => { n.sb++; return { verdict: 'clean', finalUrl: u, redirects: [] }; },
  });
  return n;
}

async function conta(urls) {
  pulisci();
  const n = contatori();
  for (const u of urls) await analizza(u, ACCESSO);
  return n;
}

test('venti indirizzi IPv6 della stessa rete fanno qualche controllo profondo, non venti', async () => {
  const n = await conta(Array.from({ length: N }, (_, i) => `http://[2001:db8:5:7::${(i + 1).toString(16)}]/login`));
  expect(n.llm, 'giudizi del modello').toBeLessThanOrEqual(SB.DEEP_BUDGET);
  expect(n.sb, 'finestre nascoste').toBeLessThanOrEqual(SB.DEEP_BUDGET);
});

test('venti file dello stesso secchio di archiviazione fanno qualche controllo profondo, non venti', async () => {
  for (const base of ['http://s3.amazonaws.com/secchio-ostile', 'https://storage.googleapis.com/secchio-ostile']) {
    const n = await conta(Array.from({ length: N }, (_, i) => `${base}/accesso-${i}.html`));
    expect(n.llm, `${base}: giudizi del modello`).toBeLessThanOrEqual(SB.DEEP_BUDGET);
    expect(n.sb, `${base}: finestre nascoste`).toBeLessThanOrEqual(SB.DEEP_BUDGET);
  }
});

test('il riconoscimento del blocco geografico: venti percorsi o sottodomini dello stesso sito non fanno venti chiamate', async () => {
  const cache = Geo.createCache();
  let chiamate = 0;
  const complete = async () => { chiamate++; return 'errore_generico'; };
  for (let i = 0; i < N; i++) {
    await Geo.classify({ title: '', text: '', statusCode: 200, host: 'ostile-giro15.example.com', url: `https://ostile-giro15.example.com/pagina-${i}` }, { complete, cache });
  }
  expect(chiamate, 'percorsi nuovi sullo stesso sito').toBeLessThanOrEqual(SB.DEEP_BUDGET);
  chiamate = 0;
  for (let i = 0; i < N; i++) {
    const host = `s${i}.ostile-giro15.example.com`;
    await Geo.classify({ title: 'Forbidden', text: 'Forbidden', statusCode: 403, host, url: `https://${host}/` }, { complete, cache });
  }
  expect(chiamate, 'sottodomini nuovi dello stesso sito').toBeLessThanOrEqual(SB.DEEP_BUDGET);
});

test('caso di riscontro: venti sottodomini dello stesso dominio fanno qualche controllo profondo', async () => {
  const n = await conta(Array.from({ length: N }, (_, i) => `http://s${i}.ostile-giro15.example.com/login`));
  expect(n.llm).toBeLessThanOrEqual(SB.DEEP_BUDGET);
  expect(n.sb).toBeLessThanOrEqual(SB.DEEP_BUDGET);
});

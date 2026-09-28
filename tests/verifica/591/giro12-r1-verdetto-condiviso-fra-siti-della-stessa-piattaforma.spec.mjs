// Verifica #591, giro 12 — il verdetto del controllo profondo vale per tutta la piattaforma di hosting.
// Giudizio del modello e finestra nascosta si ricordano per «dominio registrabile»; sulle piattaforme che l'elenco
// interno non separa (Weebly, 000webhost, R2, Webflow, TryCloudflare…) quel dominio è la piattaforma, non il sito.
// Niente Electron: il rilevatore è logica pura, modello e finestra nascosta sono finti.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const LOGIN = { linkOrigin: 'email', hasPassword: true };
const PIATTAFORME = ['weebly.com', '000webhostapp.com', 'r2.dev', 'webflow.io', 'trycloudflare.com'];

function pulisci() {
  for (const c of Object.values(SB._caches || {})) {
    if (c && c.m && typeof c.m.clear === 'function') c.m.clear();
    else if (c && typeof c.clear === 'function') c.clear();
  }
}

async function analizza(url, ctx) {
  await new Promise((ok) => {
    SB.analyze(url, ctx, ok);
    setTimeout(ok, 300);
  });
  await attendi(20);
}

test('una truffa sbarrata non sbarra i siti degli altri utenti della stessa piattaforma', async () => {
  const sbordati = [];
  for (const p of PIATTAFORME) {
    pulisci();
    SB.setProviders({
      gsb: null, rdap: null, ct: null,
      llm: async () => null,
      sandbox: async (u) => ({ verdict: 'dangerous', finalUrl: u, redirects: [], download: 'setup.exe' }),
    });
    const truffa = `https://verifica-conto-sicuro.${p}/login`;
    await analizza(truffa, LOGIN);
    expect(SB.checkSync(truffa, LOGIN).level, `${truffa} va sbarrata`).toBe('pericoloso');
    const vicino = `https://forno-di-marco.${p}/`;
    const v = SB.checkSync(vicino, {});
    if (v.level !== 'safe') sbordati.push(`${vicino} → ${v.level} (${(v.reasons || []).join(',')})`);
  }
  expect(sbordati, 'il sito di un altro utente eredita la pagina rossa della truffa').toEqual([]);
});

test('un sito pulito controllato per primo non toglie il controllo alla truffa sulla stessa piattaforma', async () => {
  const saltate = [];
  for (const p of PIATTAFORME) {
    pulisci();
    const aperte = [];
    SB.setProviders({
      gsb: null, rdap: null, ct: null,
      llm: async () => ({ suspicious: false, reason: null, confidence: 'high' }),
      sandbox: async (u) => {
        aperte.push(u);
        return u.includes('negozio') ? { verdict: 'clean', finalUrl: u, redirects: [] } : { verdict: 'dangerous', finalUrl: u, redirects: [], download: 'fattura.exe' };
      },
    });
    // Il login di un negozio vero, poi la truffa di un altro proprietario sulla stessa piattaforma.
    await analizza(`https://negozio-di-ceramiche.${p}/account/login`, { hasPassword: true });
    const truffa = `https://verifica-conto-sicuro.${p}/login`;
    await analizza(truffa, LOGIN);
    if (!aperte.includes(truffa)) saltate.push(`${truffa}: finestra nascosta mai aperta, verdetto ${SB.checkSync(truffa, LOGIN).level}`);
  }
  expect(saltate, 'la truffa deve ricevere il suo controllo profondo').toEqual([]);
});

test('caso di riscontro: sottodomini sempre nuovi di un dominio solo fanno un controllo solo', async () => {
  pulisci();
  let giudizi = 0;
  let finestre = 0;
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => { giudizi++; return { suspicious: false, reason: null }; },
    sandbox: async (u) => { finestre++; return { verdict: 'clean', finalUrl: u, redirects: [] }; },
  });
  for (let i = 0; i < 20; i++) await analizza(`http://x${i}-verifica.dominio-ostile-giro12.com/`, LOGIN);
  expect(giudizi).toBe(1);
  expect(finestre).toBe(1);
});

test('caso di riscontro: su una piattaforma che l\'elenco separa ogni sito ha il suo verdetto', async () => {
  pulisci();
  const aperte = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => null,
    sandbox: async (u) => { aperte.push(u); return { verdict: 'dangerous', finalUrl: u, redirects: [], download: 'setup.exe' }; },
  });
  const truffa = 'https://verifica-conto-sicuro.pages.dev/login';
  await analizza(truffa, LOGIN);
  expect(SB.checkSync(truffa, LOGIN).level).toBe('pericoloso');
  expect(SB.checkSync('https://forno-di-marco.pages.dev/', {}).level).toBe('safe');
});

// Verifica #591, giro 14 — il verdetto ereditato «per stesso dominio e stessi indizi» passa fra siti di proprietari
// diversi sulle piattaforme di hosting che l'elenco interno non separa: è la porta del giro 12 che si riapre.
// Niente Electron: il rilevatore è logica pura, modello e finestra nascosta sono finti.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

const ACCESSO = { hasPassword: true };
const PIATTAFORME = ['weebly.com', 'webflow.io', 'wixsite.com', 'square.site', 'godaddysites.com', 'trycloudflare.com'];

function pulisci() {
  for (const c of Object.values(SB._caches || {})) {
    if (c && c.m && typeof c.m.clear === 'function') c.m.clear();
  }
}

const analizza = (url, ctx) => new Promise((ok) => { SB.analyze(url, ctx, ok); setTimeout(ok, 200); });

function finti(giudizio) {
  const aperte = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => giudizio,
    sandbox: async (u) => {
      aperte.push(u);
      return u.includes('verifica-conto')
        ? { verdict: 'dangerous', finalUrl: u, redirects: [], download: 'fattura.exe' }
        : { verdict: 'clean', finalUrl: u, redirects: [] };
    },
  });
  return aperte;
}

test('la pagina di accesso di un negozio vero non eredita la pagina rossa di una truffa ospitata sulla stessa piattaforma', async () => {
  const sbarrati = [];
  for (const p of PIATTAFORME) {
    pulisci();
    finti(null);
    const truffa = `https://verifica-conto-sicuro.${p}/login`;
    await analizza(truffa, ACCESSO);
    expect(SB.checkSync(truffa, ACCESSO).level, `${truffa} va sbarrata`).toBe('pericoloso');
    const negozio = `https://forno-di-marco.${p}/account/login`;
    await analizza(negozio, ACCESSO);
    const livello = SB.checkSync(negozio, ACCESSO).level;
    if (livello === 'pericoloso') sbarrati.push(negozio);
  }
  expect(sbarrati, 'il negozio di un altro proprietario prende la pagina rossa della truffa').toEqual([]);
});

test('una truffa aperta dopo il negozio vero sulla stessa piattaforma riceve il suo controllo profondo', async () => {
  const saltate = [];
  for (const p of PIATTAFORME) {
    pulisci();
    const aperte = finti({ suspicious: false, reason: null, confidence: 'high' });
    await analizza(`https://negozio-di-ceramiche.${p}/account/login`, ACCESSO);
    const truffa = `https://verifica-conto-sicuro.${p}/login`;
    await analizza(truffa, ACCESSO);
    if (!aperte.includes(truffa)) saltate.push(`${truffa}: verdetto ${SB.checkSync(truffa, ACCESSO).level}`);
  }
  expect(saltate, 'la truffa eredita il «pulito» del negozio e la finestra nascosta non la apre').toEqual([]);
});

test('caso di riscontro: venti sottodomini nuovi dello stesso dominio non fanno venti controlli', async () => {
  pulisci();
  const aperte = finti(null);
  for (let i = 0; i < 20; i++) await analizza(`https://s${i}.dominio-ostile-giro14.com/login`, ACCESSO);
  expect(aperte.length).toBeLessThan(20);
});

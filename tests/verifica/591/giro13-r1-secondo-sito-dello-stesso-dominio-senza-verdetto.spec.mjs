// Verifica #591, giro 13 — il freno del controllo profondo sta sul dominio, ma chi arriva dopo non riceve nessun verdetto.
// Due indirizzi dello stesso dominio con gli stessi indizi: il primo passa da modello e finestra nascosta, il secondo
// non li chiama (giusto) e resta col solo verdetto locale, più debole di quello che su main riceveva.
// Niente Electron: il rilevatore è logica pura, modello, finestra nascosta ed età del dominio sono finti.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

const LOGIN = { linkOrigin: 'email', hasPassword: true };

function pulisci() {
  for (const c of Object.values(SB._caches || {})) {
    if (c && c.m && typeof c.m.clear === 'function') c.m.clear();
  }
}

const analizza = (url, ctx) => new Promise((ok) => { SB.analyze(url, ctx, ok); setTimeout(ok, 150); });

function prepara({ eta, finestra }) {
  pulisci();
  const conto = { modello: 0, finestre: 0 };
  SB.setProviders({
    gsb: null, ct: null,
    rdap: async () => eta,
    llm: async () => { conto.modello++; return { suspicious: true, reason: 'chiede la password su un dominio sconosciuto' }; },
    sandbox: async (u) => {
      conto.finestre++;
      return { verdict: finestra, finalUrl: u, redirects: [], download: finestra === 'dangerous' ? 'fattura.exe' : false };
    },
  });
  return conto;
}

test('servizi dell\'età muti: il secondo sito dello stesso dominio resta senza avviso', async () => {
  prepara({ eta: null, finestra: 'clean' });
  await analizza('https://accesso.dominio-giro13.com/login', LOGIN);
  expect(SB.checkSync('https://accesso.dominio-giro13.com/login', LOGIN).level).toBe('sospetto');
  await analizza('https://verifica.dominio-giro13.com/login', LOGIN);
  expect(SB.checkSync('https://verifica.dominio-giro13.com/login', LOGIN).level,
    'stesso dominio e stessi indizi del sito appena giudicato sospetto').toBe('sospetto');
});

test('dominio giovane e download forzato: il secondo sito dello stesso dominio non riceve la pagina rossa', async () => {
  prepara({ eta: 5, finestra: 'dangerous' });
  await analizza('https://accesso.dominio-giro13.com/login', LOGIN);
  expect(SB.checkSync('https://accesso.dominio-giro13.com/login', LOGIN).level).toBe('pericoloso');
  await analizza('https://verifica.dominio-giro13.com/login', LOGIN);
  expect(SB.checkSync('https://verifica.dominio-giro13.com/login', LOGIN).level,
    'il sito gemello della pagina che ha forzato il download').toBe('pericoloso');
});

test('il salto da un sito all\'altro mentre il primo controllo è in viaggio lascia il secondo senza avviso', async () => {
  prepara({ eta: null, finestra: 'clean' });
  const primo = analizza('https://accesso.dominio-giro13.com/login', LOGIN);
  await analizza('https://verifica.dominio-giro13.com/login', LOGIN);
  await primo;
  expect(SB.checkSync('https://verifica.dominio-giro13.com/login', LOGIN).level,
    'la pagina dove l\'utente è arrivato davvero').toBe('sospetto');
});

test('caso di riscontro: venti sottodomini nuovi dello stesso dominio non fanno venti controlli', async () => {
  const conto = prepara({ eta: null, finestra: 'clean' });
  for (let i = 0; i < 20; i++) await analizza(`https://s${i}.dominio-giro13.com/login`, LOGIN);
  expect(conto.modello).toBeLessThan(20);
  expect(conto.finestre).toBeLessThan(20);
});

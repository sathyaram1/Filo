// Verifica #591 — giro 8. La domanda all'elenco dei siti di truffa si fa
// sull'INDIRIZZO intero, la risposta si ricorda per tutto il SITO.
//
// Il giro 2 ha stabilito la regola: il freno sta sul dominio, il verdetto
// sull'indirizzo, perché sulle piattaforme che regalano un sotto-indirizzo a
// testa il verdetto di uno non deve valere per i vicini. Lo stadio che parte
// per primo è rimasto fuori da quella regola: chiede «è elencato QUESTO
// indirizzo?» e mette via la risposta sotto il nome del sito. Da lì in poi,
// per mezz'ora, tutti gli altri indirizzi di quel sito si prendono la risposta
// che era di un altro — nei due versi.
//
// Logica pura: le chiamate di rete sono finte.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

// Un sito dove i file sono di persone diverse: l'elenco ne segnala uno solo.
const PULITO = 'https://drive.condiviso.com/file/relazione-di-lavoro';
const ELENCATO = 'https://drive.condiviso.com/file/accesso-paypal-verifica';

function banco() {
  const chieste = [];
  for (const c of Object.values(SB._caches)) c.clear();
  for (const v of Object.values(SB._inFlight)) v.clear();
  SB.setProviders({
    gsb: async (u) => {
      chieste.push(u);
      return u === ELENCATO
        ? { listed: true, category: 'phishing', threatType: 'SOCIAL_ENGINEERING' }
        : { listed: false };
    },
    rdap: async () => 4000,
    ct: async () => null,
    llm: null,
    sandbox: null,
  });
  return chieste;
}

test('un file pulito visto prima non deve coprire quello elencato', async () => {
  const chieste = banco();
  SB.analyze(PULITO, { catena: 'c1' });
  await attendi(200);
  SB.analyze(ELENCATO, { catena: 'c1' });
  await attendi(200);
  const verdetto = SB.checkSync(ELENCATO);
  expect(
    chieste.includes(ELENCATO),
    'l\'indirizzo segnalato dall\'elenco deve essere chiesto: la risposta di un altro file non vale per lui',
  ).toBe(true);
  expect(
    verdetto.level,
    'e la pagina di truffa deve risultare pericolosa',
  ).toBe('pericoloso');
});

test('un file elencato non deve sbarrare tutti gli altri dello stesso sito', async () => {
  banco();
  SB.analyze(ELENCATO, { catena: 'c2' });
  await attendi(200);
  SB.analyze(PULITO, { catena: 'c2' });
  await attendi(200);
  const verdetto = SB.checkSync(PULITO);
  expect(
    verdetto.level,
    'il file di un\'altra persona, sullo stesso sito, non deve prendersi la pagina rossa a tutto schermo',
  ).not.toBe('pericoloso');
});

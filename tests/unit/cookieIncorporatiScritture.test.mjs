// #2637 — il declassamento di un cookie di riquadro e la pulizia dei partizionati leggono e poi riscrivono: se il sito
// aggiorna il cookie fra le due, non deve tornare il valore vecchio. Electron è finto, il deposito avvisa come Chromium.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const scheda = {
  url: 'https://articolo.it/',
  view: {
    webContents: {
      isDestroyed: () => false,
      getURL: () => 'https://articolo.it/',
      mainFrame: { framesInSubtree: [{ url: 'https://articolo.it/' }, { url: 'https://video.com/riquadro' }] },
    },
  },
};
const schede = [scheda];
const electron = {
  session: { defaultSession: null },
  BrowserWindow: { getAllWindows: () => [{ _filoTabs: { tabs: schede } }] },
  webContents: { fromId: () => null },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electron;
  return origLoad.call(this, request, parent, isMain);
};

const dopo = () => new Promise((r) => setImmediate(r));
async function quiete() { for (let i = 0; i < 300; i++) await dopo(); }

// Un deposito come quello di Chromium: una sovrascrittura che cambia valore avvisa prima della rimozione del vecchio e
// poi dell'arrivo del nuovo; a valore uguale avvisa solo l'arrivo. Gli avvisi e le risposte arrivano dopo, in ordine;
// con `avvisiInRitardo` gli avvisi arrivano dopo le risposte. I partizionati hanno una chiave loro, che né gli avvisi
// né le letture mostrano: le scritture di Filo toccano solo i normali, la rimozione per indirizzo tutti e due.
function deposito({ rispostaDopoGliAvvisi, avvisiInRitardo = 0 }) {
  const cookie = new Map();
  const ascolti = [];
  let dopoLettura = null;
  let passi = -1;
  let alPasso = null;
  const chiave = (c) => `${c.partizionato ? 'P' : ''}|${c.domain}|${c.path}|${c.name}`;
  const pubblico = ({ partizionato, ...c }) => c;
  const piuTardi = (n, f) => (n ? setImmediate(() => piuTardi(n - 1, f)) : f());
  const avvisa = (c, causa, tolto) => piuTardi(1 + avvisiInRitardo, () => { for (const f of ascolti) f({}, pubblico(c), causa, tolto); });
  // Il sito scrive mentre Filo aspetta la risposta del passo n.
  const risposta = (r, valore) => {
    const f = passi >= 0 && passi++ === alPasso ? alPasso && null : null;
    void f;
    setImmediate(() => r(valore));
  };
  void risposta;
  function scrivi(d, { partizionato = false } = {}) {
    const ospite = new URL(d.url).hostname;
    const c = {
      name: d.name, value: String(d.value), domain: d.domain || ospite, hostOnly: !d.domain, path: d.path || '/',
      secure: !!d.secure, httpOnly: !!d.httpOnly, sameSite: d.sameSite || 'no_restriction',
      session: d.expirationDate == null, ...(d.expirationDate != null ? { expirationDate: d.expirationDate } : {}),
      ...(partizionato ? { partizionato: true } : {}),
    };
    const k = chiave(c);
    const vecchio = cookie.get(k);
    const scaduto = d.expirationDate != null && d.expirationDate * 1000 < Date.now();
    if (scaduto) {
      if (vecchio) { cookie.delete(k); avvisa(vecchio, 'expired-overwrite', true); }
      return;
    }
    if (vecchio && vecchio.value === c.value) { cookie.set(k, c); avvisa(c, 'inserted-no-value-change-overwrite', false); return; }
    if (vecchio) avvisa(vecchio, 'overwrite', true);
    cookie.set(k, c);
    avvisa(c, 'inserted', false);
  }
  const ses = {
    cookies: {
      on: (_ev, f) => ascolti.push(f),
      get: (f) => {
        const host = f.url ? new URL(f.url).hostname : String(f.domain || '');
        const foto = [...cookie.values()]
          .filter((c) => c.domain.replace(/^\./, '') === host && (!f.name || c.name === f.name))
          .map((c) => ({ ...c }));
        const passo = dopoLettura;
        dopoLettura = null;
        if (rispostaDopoGliAvvisi && passo) passo();
        return new Promise((r) => setImmediate(() => { if (!rispostaDopoGliAvvisi && passo) passo(); r(foto); }));
      },
      set: (d) => new Promise((r) => { scrivi(d); setImmediate(r); }),
      remove: async () => {},
    },
    webRequest: { onHeadersReceived() {} },
  };
  return { ses, scrivi, cookie: (nome) => [...cookie.values()].filter((c) => c.name === nome), poiLettura: (f) => { dopoLettura = f; } };
}

function caricaModulo() {
  const percorso = require.resolve(join(ROOT, 'src', 'main', 'services', 'cookieIncorporati.js'));
  delete require.cache[percorso];
  return require(percorso);
}

const delRiquadro = (valore) => ({
  url: 'https://video.com/', name: 'stato', value: valore, secure: true, sameSite: 'no_restriction',
  expirationDate: Math.floor(Date.now() / 1000) + 3600,
});

for (const rispostaDopoGliAvvisi of [true, false]) {
  test(`il riquadro che riscrive il cookie mentre Filo lo declassa tiene il valore più nuovo, di sessione (${rispostaDopoGliAvvisi ? 'avvisi prima della lettura' : 'lettura prima degli avvisi'})`, async () => {
    const CI = caricaModulo();
    const d = deposito({ rispostaDopoGliAvvisi });
    CI.aggancia(d.ses);
    // La lettura del declassamento vede ancora «1»; il secondo aggiornamento del riquadro arriva subito dopo.
    d.poiLettura(() => d.scrivi(delRiquadro('2')));
    d.scrivi(delRiquadro('1'));
    await quiete();
    assert.deepEqual(d.cookie('stato').map((c) => `${c.value}:${c.session ? 'sessione' : 'scadenza'}`), ['2:sessione']);
  });
}

test('senza scritture in mezzo il declassamento tiene il valore e toglie la scadenza, una volta sola', async () => {
  const CI = caricaModulo();
  const d = deposito({ rispostaDopoGliAvvisi: true });
  CI.aggancia(d.ses);
  let scritture = 0;
  const set = d.ses.cookies.set;
  d.ses.cookies.set = (x) => { scritture++; return set(x); };
  d.scrivi(delRiquadro('1'));
  await quiete();
  assert.deepEqual(d.cookie('stato').map((c) => `${c.value}:${c.session ? 'sessione' : 'scadenza'}`), ['1:sessione']);
  assert.equal(scritture, 1);
});

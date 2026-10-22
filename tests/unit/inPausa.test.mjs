// Bacheca e Deck builder in pausa per chi non è owner (#1592): «in pausa» finché l'interruttore dell'owner non dice
// esplicitamente il contrario, un documento ciascuno. Rossa senza il fix: il cancello non esisteva e le vedevano tutti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
const InPausa = require(join(ROOT, 'src', 'main', 'services', 'inPausa.js'));

// Un Firestore finto: `docs` è { 'config/bacheca': { openToAll } | null }, `giu` la rete assente.
function conFirestore(stato, fn) {
  const origFetch = global.fetch;
  const origAdmin = auth.isAdmin;
  const origToken = auth.getIdToken;
  const letture = [];
  const scritture = [];
  auth.isAdmin = () => !!stato.owner;
  auth.getIdToken = async () => 'token-owner';
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (stato.giu) throw new TypeError('fetch failed');
    const doc = u.split('/documents/')[1].split('?')[0];
    if (opts.method === 'PATCH') {
      scritture.push({ doc, url: u, body: JSON.parse(opts.body) });
      stato.docs[doc] = { openToAll: JSON.parse(opts.body).fields.openToAll.booleanValue };
      return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
    }
    letture.push(doc);
    const d = stato.docs[doc];
    if (!d) return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
    return { ok: true, status: 200, async json() { return { fields: { openToAll: { booleanValue: d.openToAll } } }; }, async text() { return ''; } };
  };
  return Promise.resolve()
    .then(() => fn({ letture, scritture }))
    .finally(() => {
      global.fetch = origFetch;
      auth.isAdmin = origAdmin;
      auth.getIdToken = origToken;
    });
}

const rileggiTutte = async () => {
  for (const n of InPausa.NOMI) await InPausa.cancello(n).rileggiOra();
};

test('#1592 — mai letto, documento assente o spento: in pausa per chi non è owner, una per una', async () => {
  assert.deepEqual(InPausa.NOMI, ['bacheca', 'mazzi']);
  for (const n of InPausa.NOMI) assert.equal(InPausa.cancello(n).stato().visible, false, 'mai letto = in pausa');
  await conFirestore({ docs: {} }, async ({ letture }) => {
    await rileggiTutte();
    assert.deepEqual(InPausa.aperti(), { bacheca: false, mazzi: false });
    assert.deepEqual(letture.sort(), ['config/bacheca', 'config/mazzi']);
  });
  await conFirestore({ docs: { 'config/bacheca': { openToAll: true }, 'config/mazzi': { openToAll: false } } }, async () => {
    await rileggiTutte();
    assert.deepEqual(InPausa.aperti(), { bacheca: true, mazzi: false }, 'ognuna col suo interruttore');
  });
  await conFirestore({ docs: { 'config/bacheca': { openToAll: false } }, giu: false }, async () => {
    await rileggiTutte();
    assert.equal(InPausa.cancello('bacheca').visibile(), false);
  });
});

test('#1592 — l’owner le vede sempre, e non aspetta la prima lettura', async () => {
  await conFirestore({ docs: {}, owner: true }, async () => {
    for (const n of InPausa.NOMI) InPausa.cancello(n)._setAdesso(() => Date.now() + 365 * 24 * 3600 * 1000);
    const lento = global.fetch;
    const inAttesa = [];
    // Il server risponde solo quando la prova lo lascia andare.
    global.fetch = (...a) => new Promise((r) => inAttesa.push(() => r(lento(...a))));
    const t0 = Date.now();
    const s = await InPausa.statiSicuri();
    assert.ok(Date.now() - t0 < 1000, 'l’owner ha aspettato la lettura');
    assert.ok(inAttesa.length >= 1, 'la lettura per gli altri parte lo stesso');
    global.fetch = lento;
    for (const via of inAttesa) via();
    for (const n of InPausa.NOMI) { await InPausa.cancello(n).rileggiOra(); InPausa.cancello(n)._setAdesso(null); }
    assert.equal(s.bacheca.visible, true);
    assert.equal(s.mazzi.visible, true);
    assert.equal(s.bacheca.openToAll, false);
  });
});

test('#1592 — rete giù: resta l’ultima risposta del server, non si apre da sé', async () => {
  const stato = { docs: { 'config/mazzi': { openToAll: false } } };
  await conFirestore(stato, async () => {
    await rileggiTutte();
    stato.giu = true;
    assert.equal((await InPausa.cancello('mazzi').rileggiOra()).visible, false);
  });
});

test('#1592 — il gesto dell’owner scrive solo openToAll e updatedAt nel suo documento, e vale subito', async () => {
  const stato = { docs: {}, owner: true };
  await conFirestore(stato, async ({ scritture }) => {
    const cambi = [];
    const via = InPausa.suCambio((nome, s) => cambi.push([nome, s.openToAll]));
    try {
      const s = await InPausa.cancello('mazzi').impostaApertoATutti(true);
      assert.equal(s.openToAll, true);
      assert.equal(scritture.length, 1);
      assert.equal(scritture[0].doc, 'config/mazzi');
      assert.match(scritture[0].url, /updateMask\.fieldPaths=openToAll/);
      assert.match(scritture[0].url, /updateMask\.fieldPaths=updatedAt/);
      assert.deepEqual(Object.keys(scritture[0].body.fields).sort(), ['openToAll', 'updatedAt']);
      assert.ok(scritture[0].body.fields.updatedAt.timestampValue, 'updatedAt è un timestamp, come vogliono le regole');
      assert.deepEqual(cambi, [['mazzi', true]], 'chi ascolta (shell e home) lo sa subito');
      stato.owner = false;
      assert.deepEqual(InPausa.aperti(), { bacheca: false, mazzi: true }, 'aperta a tutti: la vede anche chi non è owner');
      await InPausa.cancello('bacheca').impostaApertoATutti(true).then(() => assert.fail('chi non è owner non scrive'), () => {});
      assert.equal(scritture.length, 1);
    } finally {
      via();
      stato.owner = true;
      await InPausa.cancello('mazzi').impostaApertoATutti(false);
    }
  });
  assert.throws(() => InPausa.cancello('redteam'), /sconosciuta/, 'un nome qualunque non apre niente');
  assert.equal(InPausa.valido('__proto__'), false);
});

test('#1592 — nelle prove sono aperte solo se la prova lo chiede, e mai fuori dalle prove', async () => {
  const prima = { env: process.env.NODE_ENV, aperte: process.env.FILO_TEST_IN_PAUSA_APERTE };
  try {
    await conFirestore({ docs: {} }, async ({ letture }) => {
      process.env.FILO_TEST_IN_PAUSA_APERTE = '1';
      process.env.NODE_ENV = 'production';
      await rileggiTutte();
      assert.deepEqual(InPausa.aperti(), { bacheca: false, mazzi: false }, 'fuori dalle prove la variabile non conta');
      assert.equal(letture.length, 2);
      process.env.NODE_ENV = 'test';
      await rileggiTutte();
      assert.deepEqual(InPausa.aperti(), { bacheca: true, mazzi: true });
      assert.equal(letture.length, 2, 'nelle prove aperte non si legge il server');
    });
  } finally {
    if (prima.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prima.env;
    if (prima.aperte === undefined) delete process.env.FILO_TEST_IN_PAUSA_APERTE; else process.env.FILO_TEST_IN_PAUSA_APERTE = prima.aperte;
    await conFirestore({ docs: {} }, rileggiTutte);
  }
});

test('#1592 — la frase della pausa del Deck builder è una sola, nel main e nella pagina', () => {
  const pagina = readFileSync(join(ROOT, 'src', 'pages', 'decks', 'pausa.html'), 'utf8');
  assert.ok(pagina.includes(`<p>${InPausa.FRASI_PAUSA.mazzi}</p>`), 'la pagina della pausa dice un’altra frase');
});

test('#1592 — le regole aprono in lettura e lasciano scrivere all’owner i soli due interruttori', () => {
  const regole = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  for (const doc of ['bacheca', 'mazzi']) {
    const blocco = regole.match(new RegExp(`match /config/${doc} \\{([\\s\\S]*?)\\n    \\}`))?.[1] || '';
    assert.match(blocco, /allow read: if true;/, `config/${doc} non si legge da chi non è owner`);
    assert.match(blocco, /allow create, update: if isAdmin\(\) && interruttoreValido\(request\.resource\.data\);/);
    assert.match(blocco, /allow delete: if isAdmin\(\);/);
  }
  assert.match(regole, /function interruttoreValido\(d\) \{\s*return d\.keys\(\)\.hasOnly\(\['openToAll', 'updatedAt'\]\)/);
});

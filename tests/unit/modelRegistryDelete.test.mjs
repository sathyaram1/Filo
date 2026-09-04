// Unit test — un modello integrato eliminato dall'editor "Modelli predefiniti"
// deve RESTARE eliminato dopo la riapertura.
//
// Regressione reale (feedback #365): l'admin elimina dei modelli dalla lista,
// salva, riapre il menu e i modelli sono di nuovo lì. Causa: la config
// effettiva rifonde SEMPRE il registry di build sotto quello remoto
// (`{ ...build, ...remoto }`), così ogni nickname integrato cancellato veniva
// re-iniettato dal layer di build. La cancellazione di un nickname NON di build
// funzionava già (nulla lo re-iniettava): la simmetria mancante era proprio i
// modelli integrati.
//
// Il fix: al salvataggio l'editor registra i nickname di build ASSENTI dal
// registry inviato in una lista `modelRegistryDeleted` (tombstone) sul doc
// remoto; get() li rimuove dopo il merge. I nickname integrati NON toccati
// restano (invariante dei nickname integrati: le catene di default che li citano risolvono).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));
const C = globalThis.SN_CONST;

// Stubba l'auth (nessun login reale nei test): un id token finto qualsiasi.
const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
const realGetIdToken = auth.getIdToken;

// FS Value → JS (specular a fromFsValue nello store): serve per decodificare il
// body della PATCH catturata quando ne rileggiamo i campi.
function fsToJs(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fsToJs);
  if ('mapValue' in val) {
    const out = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) out[k] = fsToJs(v);
    return out;
  }
  return null;
}

// Server Firestore finto: la PATCH su config/models fonde i campi nel doc; la GET
// li rilegge. Riproduce fedelmente il ciclo salva→rileggi che l'utente vive.
function withFakeFirestore(fn) {
  const realFetch = global.fetch;
  auth.getIdToken = async () => 'fake-admin-token';
  const serverModels = { fields: {} };
  global.fetch = async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    if (u.includes('config/models')) {
      if (method === 'PATCH') {
        const body = JSON.parse(opts.body);
        for (const [k, v] of Object.entries(body.fields || {})) serverModels.fields[k] = v;
        return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
      }
      return { ok: true, status: 200, async json() { return serverModels; }, async text() { return ''; } };
    }
    // Altri doc (secrets/automation): vuoti.
    return { ok: true, status: 200, async json() { return { fields: {} }; }, async text() { return ''; } };
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.fetch = realFetch; auth.getIdToken = realGetIdToken; });
}

test('un modello integrato eliminato NON riappare dopo la riapertura', async () => {
  await withFakeFirestore(async () => {
    // L'editor mostra build+remoto fusi; l'admin elimina la riga "kokoro" e salva:
    // arriva il registry completo SENZA "kokoro".
    const kept = { ...C.DEFAULT_MODEL_REGISTRY };
    delete kept.kokoro;
    const publicCfg = await Defaults.update({ modelRegistry: kept }, 'fake-admin-token');

    // Subito dopo il salvataggio (la config tornata all'editor): "kokoro" sparito…
    assert.ok(!('kokoro' in publicCfg.modelRegistry), '"kokoro" ancora presente subito dopo il salvataggio');
    // …ma gli altri nickname integrati non toccati restano (invariante dei nickname integrati).
    for (const nick of ['deepseek', 'deepseek-flash', 'gemma', 'claude']) {
      assert.ok(publicCfg.modelRegistry[nick], `nickname integrato "${nick}" sparito per errore`);
    }

    // Riapertura del menu = nuova lettura da Firestore (refresh + get).
    const reopened = await Defaults.refresh();
    assert.ok(!('kokoro' in reopened.modelRegistry), '"kokoro" riapparso dopo la riapertura (bug #365)');
    for (const nick of ['deepseek', 'deepseek-flash', 'gemma', 'claude']) {
      assert.ok(reopened.modelRegistry[nick], `nickname integrato "${nick}" perso dopo la riapertura`);
    }
  });
});

test('ri-aggiungere un modello eliminato lo fa ricomparire (auto-guarigione dei tombstone)', async () => {
  await withFakeFirestore(async () => {
    // Prima elimina "kokoro"…
    const withoutKokoro = { ...C.DEFAULT_MODEL_REGISTRY };
    delete withoutKokoro.kokoro;
    await Defaults.update({ modelRegistry: withoutKokoro }, 'fake-admin-token');
    let eff = await Defaults.refresh();
    assert.ok(!('kokoro' in eff.modelRegistry), 'precondizione: "kokoro" deve essere eliminato');

    // …poi l'admin lo ri-aggiunge dall'editor e salva: il registry inviato lo
    // contiene di nuovo, quindi esce dai tombstone.
    await Defaults.update({ modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY } }, 'fake-admin-token');
    eff = await Defaults.refresh();
    assert.ok(eff.modelRegistry.kokoro, '"kokoro" non è tornato dopo averlo ri-aggiunto (tombstone non guarito)');
  });
});

test('eliminare un modello custom (non di build) non tocca i tombstone dei build', async () => {
  await withFakeFirestore(async () => {
    // Registry con un nickname custom in più.
    const withCustom = { ...C.DEFAULT_MODEL_REGISTRY, mio: { provider: 'openrouter', model: 'vendor/mio' } };
    await Defaults.update({ modelRegistry: withCustom }, 'fake-admin-token');
    let eff = await Defaults.refresh();
    assert.ok(eff.modelRegistry.mio, 'precondizione: il modello custom deve essere salvato');

    // Elimina il custom, tenendo tutti i build.
    await Defaults.update({ modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY } }, 'fake-admin-token');
    eff = await Defaults.refresh();
    assert.ok(!('mio' in eff.modelRegistry), 'il modello custom eliminato è riapparso');
    // Nessun build è finito nei tombstone: ci sono ancora tutti.
    for (const nick of Object.keys(C.DEFAULT_MODEL_REGISTRY)) {
      assert.ok(eff.modelRegistry[nick], `nickname integrato "${nick}" perso eliminando un custom`);
    }
  });
});

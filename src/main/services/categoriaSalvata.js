// La categoria di una pagina salvata per dopo (#1545): cosa ne parte verso il modello. Dalla rete di casa e
// dall'incognito niente, da una pagina delicata il solo tipo scritto da Filo; accensione e spesa le guarda chi chiama.
// Prove: tests/unit/categoriaSalvataDelicate.test.mjs.
'use strict';

/**
 * `voce` la voce salvata { id, url, title, thumbnail }; `pagina` quello che la pagina ha mandato { description, excerpt }.
 * `chiedi({ action, payload, origin })` → { text }. Torna il risultato di categorize, o null se non è partito niente.
 */
async function categorizza(voce, pagina, {
  settings = null,
  chiedi,
  inIncognito = () => require('../shim/storage').inIncognito(),
  delicate = globalThis.SN_DELICATE,
  nome = (m) => globalThis.SN_PAGINE_DELICATE.nome(m),
  Categorizer = globalThis.SN_CATEGORIZER,
  SavedPages = globalThis.SN_SAVED_PAGES,
} = {}) {
  if (!voce || inIncognito()) return null;
  const fuori = await delicate.versoIlModello(voce.url, settings);
  if (fuori && fuori.casa) return null;
  // Una delicata si categorizza lo stesso: il tipo basta a metterla con la posta o con la banca.
  const tipo = fuori ? nome(fuori.motivo) : '';
  const page = tipo
    ? { tipo, thumbnail: voce.thumbnail }
    : {
      url: voce.url, title: voce.title,
      description: (pagina && pagina.description) || '', excerpt: (pagina && pagina.excerpt) || '',
      thumbnail: voce.thumbnail,
    };
  const origin = tipo ? '' : String(voce.url || '');
  const result = await Categorizer.categorize({
    page,
    invokeAI: ({ action, payload }) => chiedi({ action, payload, origin }),
  });
  if (!result || !result.category) return null;
  const list = await SavedPages.list();
  const idx = list.findIndex((p) => p.id === voce.id);
  if (idx >= 0) {
    list[idx].category = result.category.name;
    list[idx].categoryId = result.category.id;
    list[idx].categoryConfidence = result.confidence;
    await globalThis.chrome.storage.local.set({ [globalThis.SN_CONST.STORAGE_KEYS.SAVED_PAGES]: list });
  }
  return result;
}

module.exports = { categorizza };

// Logica PURA del client Scryfall (DECK-BUILDER-SPEC.md §13.2): costruzione
// query, semplificazione delle carte, parsing dei costi di mana, freschezza
// cache. Niente rete, niente storage — la parte I/O vive in
// src/main/services/scryfall.js. Unit test: tests/unit/scryfallQuery.test.mjs.

(function (global) {
  'use strict';

  const WUBRG = ['W', 'U', 'B', 'R', 'G'];

  // Codice identity per la sintassi Scryfall: ['U','R'] → 'UR' (ordine WUBRG),
  // [] → 'C' (incolore). Colori ignoti vengono scartati.
  function identityCode(colors) {
    const set = new Set((Array.isArray(colors) ? colors : []).map((c) => String(c).toUpperCase()));
    const code = WUBRG.filter((c) => set.has(c)).join('');
    return code || 'C';
  }

  // Vincola una query di ricerca alla color identity del commander (§4): ogni
  // ricerca dentro un mazzo è filtrata con `id<=…` AUTOMATICAMENTE. Se l'utente
  // ha già scritto un vincolo di identity a mano (sintassi ibrida §4: `id:`,
  // `id<=`, `identity…`), la sua query passa invariata — l'esplicito vince.
  function buildSearchQuery(userQuery, identity) {
    const q = String(userQuery || '').trim();
    if (!Array.isArray(identity)) return q;
    if (/(^|\s)(id|identity)\s*[:<>=]/i.test(q)) return q;
    return `${q} id<=${identityCode(identity)}`.trim();
  }

  // '{2}{U}{R}' → ['2','U','R']; stringa vuota/null → [].
  function parseManaCost(cost) {
    if (!cost) return [];
    const out = [];
    const re = /\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(String(cost)))) out.push(m[1]);
    return out;
  }

  // Riduce una carta dell'API Scryfall ai soli campi che l'app usa. Gestisce le
  // carte a due facce (image_uris/mana_cost sulle card_faces, non sulla radice).
  function simplifyCard(api) {
    if (!api || typeof api !== 'object' || !api.id) return null;
    const faces = Array.isArray(api.card_faces) ? api.card_faces : [];
    const front = faces[0] || {};
    const img = api.image_uris || front.image_uris || {};
    const manaCost = api.mana_cost != null && api.mana_cost !== ''
      ? api.mana_cost
      : faces.map((f) => f.mana_cost).filter(Boolean).join(' // ');
    const priceRaw = api.prices && api.prices.eur;
    const price = priceRaw == null ? null : Number(priceRaw);
    return {
      id: String(api.id),
      name: String(api.name || front.name || ''),
      manaCost: String(manaCost || ''),
      cmc: Number.isFinite(Number(api.cmc)) ? Number(api.cmc) : 0,
      typeLine: String(api.type_line || front.type_line || ''),
      colors: Array.isArray(api.colors) ? api.colors : (Array.isArray(front.colors) ? front.colors : []),
      colorIdentity: Array.isArray(api.color_identity) ? api.color_identity : [],
      image: String(img.normal || img.large || ''),
      artCrop: String(img.art_crop || ''),
      priceEur: Number.isFinite(price) ? price : null,
      legalCommander: !!(api.legalities && api.legalities.commander === 'legal'),
      scryfallUri: String(api.scryfall_uri || ''),
    };
  }

  // Freschezza di un'entry di cache con TTL. `fetchedAt` ISO o epoch ms.
  function isFresh(fetchedAt, ttlMs, now = Date.now()) {
    const t = typeof fetchedAt === 'string' ? Date.parse(fetchedAt) : Number(fetchedAt);
    if (!Number.isFinite(t)) return false;
    return now - t < ttlMs;
  }

  global.SN_SCRYFALL_Q = { WUBRG, identityCode, buildSearchQuery, parseManaCost, simplifyCard, isFresh };
})(typeof globalThis !== 'undefined' ? globalThis : self);

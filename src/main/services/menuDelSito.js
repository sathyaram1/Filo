// Il menu che un sito si disegna da sé (#975), dalla parte del main: il sito di chi parla, quante volte l'utente l'ha
// scelto dal menu di Filo, la proposta fatta una volta per sito, e l'elenco menuDelSito.siti delle impostazioni.
// Non disegna niente: la proposta la mostra la barra. Prove: tests/unit/menuDelSito.test.mjs.
'use strict';

// «Spesso»: alla terza volta che la voce ha aperto davvero il menu del sito.
const SOGLIA = 3;
const CHIAVE = 'menuDelSito';
const NOME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/;

function normalizza(host) {
  if (typeof host !== 'string') return '';
  const h = host.trim().toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
  if (!h || h.length > 253) return '';
  return NOME.test(h) || IPV6.test(h) ? h : '';
}

function sitoDi(url) {
  let u = null;
  try { u = new URL(String(url == null ? '' : url)); } catch (_) { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  return normalizza(u.hostname);
}

// Lo stesso confronto del content script: la voce vale per il sito e i suoi sottodomini.
function copre(voce, sito) {
  return typeof voce === 'string' && !!voce && (sito === voce || sito.endsWith(`.${voce}`));
}

function nellElenco(siti, sito) {
  return !!sito && Array.isArray(siti) && siti.some((d) => copre(d, sito));
}

// Togliendo si tolgono tutte le voci che coprono questo sito: dopo, qui il tasto destro apre il menu di Filo.
function elencoNuovo(siti, sito, attivo) {
  const prima = (Array.isArray(siti) ? siti : []).filter((x) => typeof x === 'string' && x);
  if (attivo) return nellElenco(prima, sito) ? prima : prima.concat(sito);
  return prima.filter((d) => !copre(d, sito));
}

function leggiStato(raw) {
  const scelte = Object.create(null);
  const proposti = [];
  if (raw && typeof raw === 'object') {
    if (raw.scelte && typeof raw.scelte === 'object') {
      for (const [k, v] of Object.entries(raw.scelte)) {
        const s = normalizza(k);
        const n = Math.floor(Number(v));
        if (s && n > 0) scelte[s] = n;
      }
    }
    if (Array.isArray(raw.proposti)) {
      for (const p of raw.proposti) {
        const s = normalizza(p);
        if (s && !proposti.includes(s)) proposti.push(s);
      }
    }
  }
  return { scelte, proposti };
}

// Una scelta in più per `sito`; `proponi` vale una volta sola per sito, e mai dove il menu del sito è già il primo.
function conUnaScelta(raw, sito, { giaPrimo = false } = {}) {
  const s = leggiStato(raw);
  s.scelte[sito] = (s.scelte[sito] || 0) + 1;
  const proponi = !giaPrimo && s.scelte[sito] >= SOGLIA && !s.proposti.includes(sito);
  if (proponi) s.proposti.push(sito);
  return { stato: { scelte: { ...s.scelte }, proposti: s.proposti }, proponi };
}

// Il magazzino si rilegge e si riscrive intero: le scritture in fila (patterns/chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md).
let coda = Promise.resolve();
function registraScelta(sito, opzioni) {
  const giro = coda.then(async () => {
    const S = globalThis.SN_STORAGE;
    const r = conUnaScelta(await S.getRaw(CHIAVE, {}), sito, opzioni);
    await S.setRaw(CHIAVE, r.stato);
    return r.proponi;
  });
  coda = giro.catch(() => {});
  return giro;
}

module.exports = {
  SOGLIA, CHIAVE, normalizza, sitoDi, nellElenco, elencoNuovo, leggiStato, conUnaScelta, registraScelta,
};

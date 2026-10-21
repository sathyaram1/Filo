// L'icona di un sito per la home e la chat (#848): la copia già vista in una scheda aperta, o quella che Filo tiene per le pagine
// salvate e archiviate (#1273); solo per un sito che Filo non ha fra le sue voci, /favicon.ico del sito stesso, senza cookie.
// Mai un servizio di icone di terzi. Prove: tests/unit/iconeSiti.test.mjs, tests/icone-dei-siti.spec.mjs.

'use strict';

const IconaScheda = require('./iconaScheda');
const Copie = require('./copieIcone');

// Oltre le prime tre copie per lo stesso sito c'è quasi sempre la stessa icona.
const MAX_COPIE = 3;
// Un sito che non ha dato un'icona si richiede dopo dieci minuti, non a ogni giro della home.
const RIPROVA_MS = 10 * 60 * 1000;
// Una home e le chat riaperte mostrano qualche decina di siti; oltre i cinquecento si dimenticano i più vecchi.
const MAX_RICORDATE = 500;
const IN_PARALLELO = 6;

const DATO_RE = /^data:image\//i;

function sitoDi(url) {
  try {
    const u = new URL(String(url || ''));
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.host) return null;
    const host = u.host.toLowerCase();
    return { host, origine: `${u.protocol}//${host}`, nome: host.replace(/^www\./, '') };
  } catch (_) { return null; }
}

// www.x.it e x.it sono lo stesso sito; due porte della stessa macchina no.
const stessoSito = (url, sito) => sitoDi(url)?.nome === sito.nome;

function copiaInScheda(sito, schede) {
  for (const t of schede || []) {
    if (t && DATO_RE.test(t.favicon || '') && stessoSito(t.url, sito)) return t.favicon;
  }
  return '';
}

// Le copie delle voci di quel sito, nell'ordine dell'elenco: mai un indirizzo di rete, che le voci non tengono più.
function copieDi(voci) {
  const out = [];
  for (const v of voci) {
    if (out.length >= MAX_COPIE) break;
    const f = v && typeof v.favicon === 'string' ? v.favicon : '';
    if (Copie.eLocale(f) && !out.includes(f)) out.push(f);
  }
  return out;
}

const Vecchie = () => require('./iconeVecchie');

function crea({
  adesso = () => Date.now(), iconaPer = IconaScheda.iconaPer, leggiCopia = Copie.comeDato,
  completaVoci = () => Vecchie().completa(), daChiedere = (v) => Vecchie().daChiedere(v),
} = {}) {
  const ricordate = new Map();
  const inCorso = new Map();
  let attivi = 0;
  const coda = [];
  const turno = () => new Promise((r) => { if (attivi < IN_PARALLELO) { attivi++; r(); } else coda.push(r); });
  const libera = () => { const dopo = coda.shift(); if (dopo) dopo(); else attivi--; };

  function ricorda(chiave, dato) {
    ricordate.delete(chiave);
    ricordate.set(chiave, { dato, scade: dato ? Infinity : adesso() + RIPROVA_MS });
    while (ricordate.size > MAX_RICORDATE) ricordate.delete(ricordate.keys().next().value);
  }

  // `schede`: quelle aperte nelle finestre dello stesso tipo; `voci()`: salvate e archiviate.
  // In incognito (`incognito: true`) non si ricorda niente: finita la finestra, non resta traccia dei siti chiesti.
  // `soloCopie`: l'indirizzo chiede l'OK prima di uscire, e il nome del sito può essere il dato; niente rete, solo copie già in casa.
  async function cercaIconaSito(url, { ses = null, schede = [], voci = async () => [], incognito = false, soloCopie = false } = {}) {
    const sito = sitoDi(url);
    if (!sito) return '';
    const vista = copiaInScheda(sito, schede);
    if (vista) return vista;
    const chiave = `${incognito ? 'i' : 'n'}|${sito.host}`;
    const nota = ricordate.get(chiave);
    if (nota && nota.dato) return nota.dato;
    const proprieDi = async () => {
      try { return (await voci()).filter((v) => v && stessoSito(v.url, sito)); } catch (_) { return []; }
    };
    const dallaCopia = async (lista) => {
      for (const c of copieDi(lista)) {
        const dato = await leggiCopia(c);
        if (dato) return dato;
      }
      return '';
    };
    let proprie = await proprieDi();
    // Un sito che Filo ha fra le sue voci mostra la loro copia. Una voce che non l'ha ancora la chiede una volta sola, dal
    // riordino delle icone (mai in incognito, né per una scheda passata da un proxy); poi resta la copia o il ripiego.
    if (proprie.length || soloCopie) {
      const dato = await dallaCopia(proprie);
      if (dato || soloCopie || incognito || !proprie.some((v) => daChiedere(v))) return dato;
      try { await completaVoci(); } catch (_) {}
      proprie = await proprieDi();
      return dallaCopia(proprie);
    }
    if (nota && nota.scade > adesso()) return nota.dato;
    if (inCorso.has(chiave)) return inCorso.get(chiave);
    const giro = (async () => {
      await turno();
      try {
        const { dato } = await iconaPer(ses, [`${sito.origine}/favicon.ico`], { cookie: false });
        if (!incognito) ricorda(chiave, dato || '');
        return dato || '';
      } catch (_) {
        return '';
      } finally {
        libera();
        inCorso.delete(chiave);
      }
    })();
    inCorso.set(chiave, giro);
    return giro;
  }

  return { cercaIconaSito };
}

module.exports = { crea, sitoDi, copieDi, copiaInScheda, ...crea(), MAX_COPIE, RIPROVA_MS };

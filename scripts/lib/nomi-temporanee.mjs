// I nomi delle cartelle temporanee delle prove: li danno le prove (tests/helpers/percorsi.mjs) e li riconosce chi ne
// toglie i resti, lì e in scripts/pulisci-disco.mjs. Niente effetti al caricamento: chi pulisce non apre una corsa.

// Perché c'è lo spazio: tests/helpers/percorsi.mjs.
export const SPAZIO = 'con spazio-';
export const PREFISSO_CORSA = 'filo-corsa-';
// Nessuna corsa di prove dura un giorno: più vecchia di così, una cartella col nome delle prove è un resto.
export const ORFANA_DOPO_MS = 24 * 60 * 60 * 1000;

// Il nome che danno le funzioni di tests/helpers/percorsi.mjs: il prefisso, poi i sei caratteri di mkdtemp.
export const NOME_DEI_TEST = new RegExp(`(${SPAZIO}|^${PREFISSO_CORSA})[A-Za-z0-9]{6}$`);

// I resti di prima di quella regola (#717, #1409): `filo-<parola>-` senza spazio e i sei caratteri, o la cartella di
// consegna di dispatch (dodici cifre esadecimali) chiesta da una prova per una radice finta. `filo-lavori`,
// `filo-strumenti-1`, `filo-copie` non hanno la coda casuale, e restano.
export const NOME_VECCHIO = /^filo-[a-z0-9]+(?:-[a-z0-9]+)*-(?:[A-Za-z0-9]{6}|[0-9a-f]{12})$/;

export const nomeDiProva = (nome) => NOME_DEI_TEST.test(nome) || NOME_VECCHIO.test(nome);

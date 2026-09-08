// Le formule che nei file di prova non si scrivono, e il posto dove stanno.
//
// PERCHÉ STANNO QUI E NON NEL FILE DELLA SENTINELLA
//   La sentinella legge tutti i file `*.test.mjs` e `*.spec.mjs` sotto
//   `tests/`. Se l'elenco stesse dentro uno di quelli, l'elenco sarebbe la
//   frase che vieta: la sentinella si accenderebbe su di sé, e per spegnerla
//   toccherebbe scrivere le formule storpiate — cioè nascondere il controllo
//   invece della cosa. Questo file non finisce nella camminata, e l'elenco
//   resta leggibile.
//
// DUE ELENCHI, DUE PORTATE
//   `TITOLI` vale sui soli titoli dei test, che si stampano a schermo a ogni
//   esecuzione della suite: lì non ci va nemmeno il vocabolario del giro,
//   perché chi verifica lancia la suite per mestiere e se lo troverebbe
//   davanti senza cercarlo.
//
//   `OVUNQUE` vale su TUTTE le righe, commenti compresi, ed è molto più
//   stretto: contiene solo le formule che dicono che a correggere è chi ha
//   appena verificato. Prima si fermava ai titoli, per una ragione scritta che
//   non regge: «dentro i file la spiegazione resta, quelli li apre solo chi ci
//   lavora». Chi ci lavora subito dopo è esattamente la persona che non deve
//   saperlo, e il file di uno strumento nomina il proprio file di prove —
//   quindi il passo è uno solo (feedback #565).

export const TITOLI = [
  /fase 2/i,
  /verificatore[^'"\n]{0,30}corregg/i,
  /stessa istanza/i,
  /si corregge/i,
  /si paga da cap/i,
  /da soli si ignorano/i,
];

export const OVUNQUE = [
  /verificatore[^'"\n]{0,30}corregg/i,
  // La stessa frase detta al contrario, o col sostantivo al posto del verbo:
  // «la consegna dallo STESSO verificatore», «del verificatore, non del
  // correttore». Guardare una faccia sola voleva dire non guardare
  // (feedback #565).
  /stess[oa][^.\n]{0,20}verificator/i,
  /corre(?:ttore|zione)(?:(?! chi )[^.\n]){0,40}verificator/i,
  /verificator(?:(?! chi )[^.\n]){0,40}corre(?:ttore|zione)/i,
  // Il « chi » in mezzo è la differenza fra la frase che svela («chi ha
  // criticato corregge») e quella che dice il contrario, elencando due ruoli
  // distinti («chi verifica E CHI corregge»): la seconda va lasciata stare.
  /chi (?:ha )?(?:verific|critic|scritto la critica)(?:(?! chi )[^.\n]){0,60}corregg/i,
  /corregg(?:(?! chi )[^.\n]){0,60}chi (?:ha )?(?:verific|critic|scritto la critica)/i,
  /stessa istanza/i,
  /(?:seconda fase|fase 2)[^.\n]{0,40}(?:la fa|la scrive|tocca a)/i,
];

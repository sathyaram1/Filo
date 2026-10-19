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
  // «rilievi da correggere» non dice chi corregge: la riga di FEEDBACK-STATES.md
  // che lo usa è legittima; «ha da correggere» invece lo dice (feedback #794).
  /verificatore[^'"\n]{0,30}(?<!(?<!\b(?:ho|hai|ha|hanno|avrà|avrai|avranno) )\bda )corregg/i,
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
  // Le forme tornate nel testo del ruolo, nei documenti e nell'intestazione
  // di dispatch (feedback #794).
  /\bti (?:manda|rimanda|chiede di|fa) (?:a )?corregg/i,
  /corregg\w* chi l[ioae] ha (?:scritt|trovat|registrat)/i,
  /chi l[ioae] ha (?:scritt|trovat|registrat)\w*(?:(?! chi )[^.\n]){0,30}corregg/i,
  /stess[oa] (?:agente|worker|sessione)(?:(?! chi )[^.\n]){0,40}(?:critic|verific)/i,
];

// Frasi che tengono ferme le formule: le prime le prendono, le seconde no.
export const ESEMPI = {
  vietati: [
    'il verificatore ha da correggere i suoi rilievi',
    'Se poi il server ti manda a correggere, una segnalazione ferma il lavoro',
    'i rilievi di una verifica: li corregge chi li ha scritti',
    'Con esito fix corregge lo stesso agente che ha scritto la critica',
  ],
  legittimi: [
    'critica del verificatore senza rilievi INTERNI da correggere',
    'chi verifica e chi corregge sono due ruoli',
  ],
};

// Quanto è più lenta, di quella su cui gli spec sono stati scritti, la macchina
// che li sta eseguendo.
//
// I tempi massimi della suite sono tarati sul PC dell'owner. Il runner di
// GitHub Actions è due o tre volte più lento, e con gli stessi numeri una
// manciata di spec falliva LÌ e solo lì: non perché il codice fosse rotto, ma
// perché cinque secondi per far comparire un avviso, su quella macchina, non
// bastano. Sono finite per mesi nella lista dei rossi noti, cioè in un posto
// dove il cancello smette di guardarle.
//
// Un tempo massimo non è il criterio del test: è la difesa contro un test
// piantato. Moltiplicarlo dove la macchina è più lenta tiene il criterio
// identico; lasciarlo fisso misura la macchina invece del codice.
//
// `playwright.config.js` lo applica ai tre tempi di serie (test, expect,
// azione). Questo file esiste per il quarto caso, quello che il config non può
// raggiungere: lo spec che scrive un tempo a mano perché ha bisogno di più del
// solito. Quello scrive `lento(20_000)`, non `20_000`.
//
// Un tempo scritto a mano UGUALE al valore di serie non va avvolto: va tolto,
// così se lo prende il config.

export const LENTEZZA = Math.min(10, Math.max(1, Number(process.env.FILO_TEST_LENTEZZA || 1) || 1));

/** Un tempo massimo scritto a mano, riportato alla velocità di questa macchina. */
export function lento(ms) {
  return Math.round(Number(ms || 0) * LENTEZZA);
}

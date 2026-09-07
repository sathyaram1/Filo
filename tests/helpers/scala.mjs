// Lo ZOOM DI SISTEMA simulato, in un posto solo.
//
// Perché esiste questo file. Lo schermo di chi sviluppa Filo sta al 125%,
// quello delle routine in cloud al 100%: `devicePixelRatio` parte da 1.25 e non
// da 1, e bastava quello a far divergere una manciata di spec di layout fra le
// due macchine. `FILO_TEST_SCALE=1.25` rimette quel fattore anche su Linux, ed è
// l'unico modo di rivedere quei rossi senza avere lo stesso schermo sotto mano.
//
// Sta qui e non nella fixture perché Filo si apre da più porte: la partenza
// comune (tests/fixtures/electron.mjs), una ventina di spec che chiamano
// `electron.launch` per conto proprio, e il pilota condiviso
// (tests/agent/driver.mjs) da cui passano la cattura composita e il comando con
// cui si GUARDA una modifica visiva. Chi importa la manopola dalla fixture si
// porta dietro anche `test`/`expect` di Playwright, che fuori da uno spec non
// servono e in un file di strumenti danno fastidio.
//
// Il valore si CONTROLLA. Sbagliarlo era muto: `FILO_TEST_SCALE=125` (il
// classico "125" al posto di "1.25") o una parola facevano girare la suite al
// 100% senza dire niente, e chi l'aveva lanciata credeva di aver provato una
// cosa che non aveva provato. Adesso un valore fuori posto ferma tutto subito.

const GREZZO = process.env.FILO_TEST_SCALE;

// Fattori plausibili per uno schermo vero. Windows offre 100/125/150/175/200%,
// macOS arriva a 3 sui Retina: sotto 0.5 e sopra 4 non è uno schermo, è un
// errore di battitura.
const MINIMO = 0.5;
const MASSIMO = 4;

function leggiScala(grezzo) {
  if (grezzo === undefined || grezzo === null || String(grezzo).trim() === '') return 0;
  const testo = String(grezzo).trim();
  const n = Number(testo);
  if (!Number.isFinite(n) || n < MINIMO || n > MASSIMO) {
    const forse = Number.isFinite(n) && n >= MINIMO * 100 && n <= MASSIMO * 100
      ? ` Forse intendevi ${n / 100}?`
      : '';
    throw new Error(
      `FILO_TEST_SCALE="${testo}" non è un fattore di scala valido: serve un numero fra ${MINIMO} e ${MASSIMO} `
      + `(1 = schermo al 100%, 1.25 = al 125%).${forse} `
      + 'Meglio fermarsi che girare al 100% facendoti credere di aver provato al 125%.',
    );
  }
  return n;
}

/** Fattore di scala chiesto, o 0 se nessuno. PURA: `leggiScala` è esportata per gli unit test. */
export { leggiScala };

export const SCALA = leggiScala(GREZZO);

/**
 * Argomenti da passare a `electron.launch({ args: [...argomentiScala, '.'] })`.
 * Vuoto quando la manopola non è accesa, così la riga resta identica in entrambi
 * i casi e nessuno deve ricordarsi un `if`.
 */
export const argomentiScala = SCALA ? [`--force-device-scale-factor=${SCALA}`] : [];

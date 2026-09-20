// Verifica #517 — giro 10, la parte deterministica del presidio.
//
// Due porte, tutte e due sulla stessa cosa: CHI decide se una frase è una
// promessa da verificare.
//
//   1. IL PRESIDIO SI SPEGNE QUANDO L'UTENTE NON HA USATO LE PAROLE GIUSTE.
//      Il giro 9 ha introdotto la regola «di cosa parla il pronome lo dice la
//      richiesta»: se nel messaggio dell'utente non compare una delle cose che
//      passano da uno strumento (sveglia, appunto, calendario, feedback…), la
//      conferma fatta col pronome non viene più guardata AFFATTO. In italiano
//      però si chiede una cosa senza nominarla: «non farmelo dimenticare»,
//      «mettilo da parte», «tienimelo a mente». Lì «te l'ho segnato» torna a
//      essere il fallimento muto della segnalazione, e la stessa scorciatoia
//      spegne anche la prova del titolo dell'appunto.
//      Il giro 3 aveva chiuso la conferma col pronome perché è «la forma più
//      probabile subito dopo la richiesta dell'utente»: adesso dipende dalle
//      parole che l'utente ha scelto.
//
//   2. IL TESTO CONSEGNATO DENTRO LA RISPOSTA, quando a raccontarlo è una
//      famiglia che sa dire di cosa parla. Il giro 9 ha chiuso «te l'ho tolta»
//      guardando la richiesta dell'utente; la stessa consegna detta con un
//      verbo del prendere nota — «ti ho segnato i punti principali», «ti ho
//      segnato le scadenze» — cade nella famiglia dell'appunto, che la
//      richiesta non la guarda mai. La risposta viene buttata, rifatta e poi
//      smentita.
//
// I test sono scritti per essere ROSSI finché le porte sono aperte.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.resolve(QUI, '..', '..', '..');

const sorgente = fs.readFileSync(path.join(RADICE, 'src/shared/azioniDichiarate.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function('globalThis', sorgente)(globalThis);
const D = globalThis.SN_AZIONI_DICHIARATE;

const STATO = (o = {}) => ({ orariSveglie: [], titoliAppunti: [], contiAzioni: {}, ...o });
// Lo stato come lo costruiscono le due chat quando l'utente ha scritto QUESTO.
const DOPO = (messaggio, o = {}) => STATO({
  domandaUtente: D.domandaSuCosaFatta(messaggio),
  richiestaAzione: D.richiestaDiAzione(messaggio),
  ...o,
});

test('la conferma col pronome resta guardata anche se l\'utente non ha nominato la cosa', () => {
  // La porta che il giro 9 ha aperto: in italiano si chiede una cosa senza
  // nominarla, e queste sono richieste di un promemoria a tutti gli effetti.
  const senzaNome = [
    'domani devo chiamare il dentista, non farmelo dimenticare',
    'fammi l\'elenco dei file e mettilo da parte',
    'tienimelo a mente per domani',
  ];
  for (const messaggio of senzaNome) {
    const fantasmi = D.rileva('Te l\'ho segnato.', new Set(), DOPO(messaggio));
    expect(fantasmi.length, `muto dopo «${messaggio}»`).toBe(1);
  }

  // …e la stessa cosa quando l'utente CHIEDE se è già stato fatto e non è mai
  // stato fatto niente. «L'hai mandata?» spegne la richiesta di azione, e con
  // lei tutto il controllo: la risposta «sì, te l'ho mandata» passa muta
  // anche senza nessuna azione, né adesso né prima.
  const domanda = DOPO('l\'hai mandata agli sviluppatori?');
  expect(D.rileva('Sì, te l\'ho mandata.', new Set(), domanda).length).toBe(1);
  expect(D.rileva('Sì, te l\'ho salvata.', new Set(), DOPO('hai salvato la lista della spesa?')).length).toBe(1);

  // Quello che il giro 9 voleva salvare deve restare salvo: un testo
  // consegnato dentro la risposta non è una promessa.
  const sulTesto = DOPO('nella frase «il gatto grigio dorme sul divano» togli la parola grigio');
  expect(D.rileva('Te l\'ho tolta.', new Set(), sulTesto).length).toBe(0);
  expect(D.rileva('Te l\'ho messa al plurale.', new Set(), sulTesto).length).toBe(0);
});

test('un appunto che esiste non zittisce una richiesta detta senza nominarla', () => {
  // Il giro 9 ha tolto al titolo di un appunto il potere di reggere una cosa
  // che l'utente ha CHIESTO adesso — ma solo quando la richiesta si riconosce
  // dalle parole. Chi la scrive senza nominarla ricade nella porta di prima:
  // basta tenere un file intitolato «spesa» e non si viene più avvisati.
  const stato = DOPO('non farmi dimenticare pane, uova e latte', { titoliAppunti: ['spesa'] });
  expect(D.rileva('Ti ho salvato l\'appunto con la lista della spesa.', new Set(), stato).length).toBe(1);
});

test('nell\'Aiuto la stessa porta è aperta', () => {
  const opzioni = { famiglie: D.FAMIGLIE_AIUTO };
  // Nel pannello Aiuto la segnalazione agli sviluppatori è l'azione
  // principale, e la si chiede anche senza chiamarla per nome.
  const senzaNome = DOPO('dillo a chi sviluppa l\'app: la barra in alto sparisce');
  expect(D.rileva('Te l\'ho mandata.', new Set(), senzaNome, opzioni).length).toBe(1);
  // …e la domanda su una cosa mai fatta.
  const domanda = DOPO('l\'hai mandata?');
  expect(D.rileva('Sì, te l\'ho mandata.', new Set(), domanda, opzioni).length).toBe(1);
});

test('le buste degli strumenti dei modelli con cui Filo parla sono formato interno', () => {
  const nomi = new Set(['SVEGLIA', 'SALVA_APPUNTO', 'INVIA_FEEDBACK']);
  // La busta dei DeepSeek, che sono i modelli predefiniti di Filo. Le barre
  // sono quelle larghe (U+FF5C), non la barra normale: la guardia scritta per
  // questa forma non può scattare mai.
  expect(D.formatoSospetto('<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>SVEGLIA\n```json\n{"time":"19:00"}\n```', nomi)).toBe(true);
  expect(D.formatoSospetto('Ti ho messo la sveglia alle 19.\n<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>SVEGLIA', nomi)).toBe(true);
  // La busta «harmony» dei modelli aperti di OpenAI.
  expect(D.formatoSospetto('<|channel|>commentary to=functions.SVEGLIA<|message|>{"time":"19:00"}', nomi)).toBe(true);
  // Le forme già chiuse nei giri prima restano chiuse.
  expect(D.formatoSospetto('<tool_call>{"name":"SVEGLIA","arguments":{}}</tool_call>', nomi)).toBe(true);
  expect(D.formatoSospetto('Ti ho messo la sveglia alle 19:00 per stasera.', nomi)).toBe(false);
});

test('un testo consegnato dentro la risposta non diventa «l\'appunto non c\'è»', () => {
  // L'utente incolla un contratto e chiede cosa conta: Filo glielo scrive
  // nella risposta. Nessuno strumento può aver scritto quelle righe.
  const sulDocumento = DOPO('leggi questo contratto e dimmi cosa c\'è di importante',
    { contiAzioni: {} });
  const conTesto = new Set(['CONTESTO_TESTO']);
  for (const frase of [
    'Ti ho segnato i punti principali.',
    'Ti ho segnato le scadenze e le penali.',
    'Ti ho appuntato le date che contano.',
  ]) {
    expect(D.rileva(frase, conTesto, sulDocumento).length, frase).toBe(0);
  }

  // E quello che deve restare visto: la stessa famiglia, quando l'utente
  // l'appunto lo ha chiesto davvero.
  const chiesto = DOPO('segnami la lista della spesa: pane, uova, latte');
  expect(D.rileva('Ti ho salvato l\'appunto con la lista della spesa.', new Set(), chiesto).length).toBe(1);
});

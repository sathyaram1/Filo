// Verifica #583, giro 4 — le porte che stanno ACCANTO a quelle chiuse.
//
// Questo lavoro ha spostato dentro Filo la lettura dei feedback e ha messo su
// quelle porte un controllo di provenienza: una pagina di un sito visitato
// bussa e si sente dire di no prima ancora che si guardi chi è loggato. Il
// giro 2 l'ha esteso alle porte che scrivono, il giro 3 alle altre porte del
// proprietario.
//
// Nello STESSO canale, e per due di loro nello stesso file, restano porte senza
// quel controllo:
//
//   · chi sei — un sito visitato chiede lo stato dell'accesso e riceve
//     ok: true con l'indirizzo email, l'identificativo e il «sì, qui c'è un
//     amministratore». È esattamente la domanda a cui le porte chiuse si
//     rifiutano di rispondere (rispondono identico che l'amministratore ci sia
//     o no): la risposta la dà la porta accanto, e senza credenziali;
//   · esci — un sito visitato fa uscire dall'account chi sta usando Filo. Su
//     quella macchina la posta delle segnalazioni smette di aprirsi e la
//     bacheca di tutti smette di aggiornarsi finché non rientra;
//   · vota, ritira il voto, riapri a pagamento — le tre porte della bacheca.
//     Sono quelle di un utente qualunque, non del proprietario: chiedono solo
//     «hai una sessione?», e con una sessione aperta un sito visitato vota al
//     posto suo, gli cancella il voto e gli spende i crediti per riaprire un
//     fix, aprendo a suo nome una segnalazione col testo che vuole.
//
// La prova è ROSSA oggi: dice cosa dovrebbe rispondere ognuna di quelle porte a
// un sito visitato. Diventa verde quando il controllo di provenienza arriva
// anche lì. La guardia permanente delle porte già chiuse resta
// `tests/feedback-canali-origine.spec.mjs`.

import { test, expect } from './../../fixtures/electron.mjs';

const SITO = { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' };

test('un sito visitato non scopre chi sta usando Filo, e non lo fa uscire', async ({ app, shell }) => {
  void shell; // attende il boot: il dispatcher dev'essere montato

  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    const bussa = (m) => globalThis.SN_HANDLE_MESSAGE(m, S);
    return {
      chiSei: await bussa({ type: MSG.AUTH_STATUS }),
      esci: await bussa({ type: MSG.AUTH_SIGNOUT }),
    };
  }, SITO);

  // La porta che dice chi sei non deve rispondere a un sito visitato: la sua
  // risposta contiene l'email, l'identificativo Firebase e se su questa
  // macchina c'è chi gestisce i feedback — cioè la mappa per sapere dove
  // bussare.
  expect(out.chiSei.ok, 'un sito visitato riceve lo stato dell\'accesso').toBe(false);
  expect(String(out.chiSei.code || '')).toBe('forbidden');
  expect(out.chiSei.profile, 'il profilo non deve nemmeno comparire').toBeUndefined();
  expect(out.chiSei.isAdmin, 'un sito non deve sapere se qui c\'è un amministratore').toBeUndefined();
  expect(out.chiSei.uid).toBeUndefined();

  expect(out.esci.ok, 'un sito visitato fa uscire dall\'account chi sta usando Filo').toBe(false);
  expect(String(out.esci.code || '')).toBe('forbidden');
});

test('un sito visitato non vota, non ritira voti e non spende i crediti di chi usa Filo', async ({ app, shell }) => {
  void shell;

  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    const bussa = (m) => globalThis.SN_HANDLE_MESSAGE(m, S);
    return {
      vota: await bussa({ type: MSG.BOARD_CAST_VOTE, id: 'fb-uno', vote: 'works' }),
      ritira: await bussa({ type: MSG.BOARD_CLEAR_VOTE, id: 'fb-uno' }),
      riapri: await bussa({ type: MSG.BOARD_REOPEN, id: 'fb-uno', text: 'scritto da un sito' }),
    };
  }, SITO);

  for (const [porta, r] of Object.entries(out)) {
    expect(r.ok, `${porta}: un sito visitato non deve ottenere niente`).toBe(false);
    expect(
      String(r.code || ''),
      `${porta}: il rifiuto arriva perché qui non c'è nessuna sessione, non per la provenienza — su una macchina dove qualcuno è entrato la richiesta passerebbe`,
    ).toBe('forbidden');
  }
});

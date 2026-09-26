// Giro 2 di verifica del feedback #733 — «Filo per Linux non esce, e se il
// lavoro che lo costruisce fallisce nessuno lo viene a sapere».
//
// COSA PROVA
//   Il rimedio consegnato rende rumoroso il guasto: la meta' di piattaforma
//   che fallisce apre un feedback. Qui si guardano le due strade in cui resta
//   comunque muta o dice il falso.
//
//   Non apre Filo: non c'e' niente da cliccare. Sta qui, e non fra gli unit
//   test, perche' e' la memoria di QUESTO giro.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const YML = fs.readFileSync(path.join(RADICE, '.github', 'workflows', 'release.yml'), 'utf8');
const allarme = await import(path.join(RADICE, 'scripts', 'release-platform-alarm.mjs'));

const senzaCommenti = (s) => s.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');
const job = (nome) => {
  const dal = YML.search(new RegExp(`^ {2}${nome}:\\s*$`, 'm'));
  const resto = YML.slice(dal + 1);
  const fine = resto.search(/^ {2}[a-z][\w-]*:\s*$/m);
  return YML.slice(dal, fine >= 0 ? dal + 1 + fine : YML.length);
};
const passi = (testoJob) => testoJob.split(/^ {6}- name: /m).slice(1).map((corpo) => ({
  nome: corpo.split('\n')[0].trim(),
  corpo,
  id: (corpo.match(/^ {8}id: (\S+)$/m) || [])[1] || '',
}));

const PIATTAFORME = [['release-mac', 'Mac'], ['release-linux', 'Linux']];

// PORTA 1 — lo strumento che manda l'avviso sta dentro il codice del progetto,
// e nel lavoro il codice arriva solo al secondo passo. Se il lavoro si ferma
// prima (numero di versione sbagliato o dimenticato nell'avvio a mano, prelievo
// del codice fallito) il passo dell'avviso parte, non trova lo strumento e si
// limita a una riga di warning: uscita 0, corsa verde per il `continue-on-error`
// del lavoro, nessun feedback. E' esattamente il silenzio segnalato nel #733.
for (const [nomeJob, piattaforma] of PIATTAFORME) {
  test(`${piattaforma}: il guasto non resta muto nemmeno se il lavoro si ferma prima di avere il codice`, () => {
    const testo = senzaCommenti(job(nomeJob));
    const elenco = passi(testo);
    const iAllarme = elenco.findIndex((p) => /release-platform-alarm\.mjs/.test(p.corpo) && !/--attesi/.test(p.corpo));
    expect(iAllarme, 'manca il passo che a guasto apre il feedback').toBeGreaterThan(0);

    const iCheckout = elenco.findIndex((p) => /actions\/checkout/.test(p.corpo));
    expect(iCheckout, 'il lavoro non preleva il codice').toBeGreaterThanOrEqual(0);

    // Lo strumento arriva col codice: tutto quello che puo' fallire prima del
    // prelievo e' una finestra in cui l'avviso non parte. O quella finestra non
    // esiste (il prelievo e' il primo passo), o l'avviso deve avere una strada
    // che non dipende dal codice appena prelevato.
    const primaDelCodice = elenco.slice(0, iCheckout).map((p) => p.nome);
    const avvisoIndipendente = !/node scripts\/release-platform-alarm\.mjs\s*(\|\||$)/m
      .test(elenco[iAllarme].corpo);
    expect(
      primaDelCodice.length === 0 || avvisoIndipendente,
      `fra l'inizio del lavoro e il prelievo del codice c'e' ${primaDelCodice.join(', ')}: se si ferma li', lo strumento dell'avviso non e' ancora sul disco, il passo esce verde con un warning e la corsa resta verde. Nessuno sa niente, che e' il guasto del #733`,
    ).toBe(true);
  });

  // PORTA 2 — se l'avviso non viene consegnato (server giu', credenziale
  // rifiutata) il passo finisce comunque verde: `|| echo`. Chi apre la corsa
  // vede un passo verde chiamato «apri un feedback» e crede che il feedback ci sia.
  test(`${piattaforma}: un avviso NON consegnato non finisce verde`, () => {
    const elenco = passi(senzaCommenti(job(nomeJob)));
    const allarmePasso = elenco.find((p) => /release-platform-alarm\.mjs/.test(p.corpo) && !/--attesi/.test(p.corpo));
    expect(allarmePasso, 'manca il passo che a guasto apre il feedback').toBeTruthy();
    expect(
      /\|\|\s*echo/.test(allarmePasso.corpo),
      'il passo che apre il feedback inghiotte il proprio esito: se il feedback non parte, il passo resta verde e nessuno se ne accorge',
    ).toBe(false);
  });
}

// L'avviso racconta uno stato che non ha guardato. Quando il controllo finale
// non riesce nemmeno a leggere la pagina della versione, l'avviso deduce dai
// passi che tutti i file sono a posto: il titolo annuncia «manca» e non nomina
// niente, e due righe sotto dice che i file ci sono tutti. Chi lo prende in
// mano legge due cose che si contraddicono, e nel titolo un buco.
test('il titolo dell\'avviso non annuncia mai un elenco vuoto, e non contraddice il corpo', () => {
  const S = (o) => ({ outcome: o });
  for (const piattaforma of ['Mac', 'Linux']) {
    const { titolo, testo } = allarme.componiAllarme({
      piattaforma,
      versione: 'v0.2.229',
      repo: 'sathyaram1/Filo',
      passo: 'controllo',
      esecuzione: 'https://github.com/sathyaram1/Filo/actions/runs/123',
      mancanti: '',
      esiti: { build: S('success'), istruzioni: S('success'), controllo: S('failure') },
    });
    expect(titolo, `il titolo annuncia un elenco di file mancanti e non ne nomina nessuno: «${titolo}»`)
      .not.toMatch(/manca\s*$|manca\s+\(/);
    const diceIncompleta = /incompleta/.test(titolo);
    const diceTuttoAPosto = /risultano tutti nella release/.test(testo);
    expect(diceIncompleta && diceTuttoAPosto,
      `il titolo dice che la release e' incompleta e il corpo dice che i file ci sono tutti: «${titolo}»`).toBe(false);
  }
});

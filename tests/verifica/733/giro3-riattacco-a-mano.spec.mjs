// Giro 3 di verifica del feedback #733 — «Filo per Linux non esce, e se il
// lavoro che lo costruisce fallisce nessuno lo viene a sapere».
//
// COSA PROVA
//   I due giri precedenti hanno reso rumoroso il guasto e hanno aperto la
//   strada per rimettere a mano i file di una piattaforma su una versione gia'
//   uscita. Qui si guarda quella strada nuova: cosa ricostruisce davvero, e
//   cosa racconta l'avviso di una versione che non ha mai aperto.
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

const PIATTAFORME = [['release-mac', 'Mac', 'mac'], ['release-linux', 'Linux', 'linux']];

// PORTA 1 — riattaccando a mano, il pacchetto puo' avere dentro codice diverso
// da quello che gli utenti hanno gia' con lo stesso numero di versione.
//   L'etichetta della versione la piazza GitHub quando la versione viene resa
//   pubblica, e punta a dove sta il ramo principale IN QUEL MOMENTO: se durante
//   la costruzione per Windows (una decina di minuti) e' entrata una fusione,
//   l'etichetta sta su codice diverso da quello pubblicato — e mai provato per
//   quella versione. Lo dice il lavoro stesso, nel commento con cui spiega
//   perche' la strada automatica costruisce il COMMIT e non l'etichetta.
//   L'unica guardia presente confronta il numero scritto nel manifesto, che in
//   quel codice e' gia' lo stesso: passa senza accorgersi di niente.
for (const [nomeJob, piattaforma] of PIATTAFORME) {
  test(`${piattaforma}: riattaccando a mano si ricostruisce il codice davvero pubblicato`, () => {
    const elenco = passi(senzaCommenti(job(nomeJob)));
    const bersaglio = elenco.find((p) => p.id === 'bersaglio');
    expect(bersaglio, 'manca il passo che sceglie versione e codice').toBeTruthy();

    const dallEtichetta = /CODICE="\$CHIESTA"/.test(bersaglio.corpo);
    if (!dallEtichetta) return; // gia' si ricostruisce qualcosa di diverso dall'etichetta

    // Se il codice viene dall'etichetta, qualcuno deve confrontare i COMMIT:
    // il numero di versione non distingue due codici diversi che portano lo
    // stesso numero.
    const guardia = elenco.find((p) => p.id === 'versione');
    expect(guardia, 'manca la guardia sul codice ricostruito').toBeTruthy();
    expect(
      /rev-parse|target_commitish|sha|commit/i.test(guardia.corpo),
      `riattaccando a mano si costruisce l'etichetta della versione, e l'unico controllo confronta il numero scritto nel manifesto. Se fra la costruzione per Windows e la pubblicazione e' entrata una fusione, l'etichetta sta su codice diverso: quel numero li' e' gia' quello giusto, il controllo passa, e agli utenti di ${piattaforma} arriva un pacchetto con dentro codice diverso da quello di tutti gli altri con lo stesso numero`,
    ).toBe(true);
  });
}

// PORTA 2 — l'avviso racconta cosa manca in una versione che non ha aperto.
//   Quando il controllo finale non e' arrivato a leggere la pagina della
//   versione, l'avviso deduce i file persi da quali passi sono girati. Sulla
//   strada automatica la deduzione regge (la versione e' appena nata e non ha
//   ancora niente di questa piattaforma); sulla strada a mano no, perche' li'
//   la versione c'e' gia' e puo' avere gia' addosso una parte dei file.
test("l'avviso non dichiara perso quello che non ha guardato, quando si riattacca a mano", () => {
  // Primo guasto: era salito tutto tranne il foglietto. Si riprova a mano e
  // questa volta ci si ferma prima ancora di costruire.
  const esiti = {
    strumento: { outcome: 'success' },
    riparo: { outcome: 'success' },
    bersaglio: { outcome: 'success' },
    checkout: { outcome: 'success' },
    node: { outcome: 'success' },
    dipendenze: { outcome: 'success' },
    versione: { outcome: 'success' },
    bake: { outcome: 'failure' },
  };
  const { titolo, testo } = allarme.componiAllarme({
    piattaforma: 'Linux',
    versione: 'v0.2.229',
    passo: allarme.passoFallito(esiti),
    esecuzione: 'https://esempio/1',
    repo: 'sathyaram1/Filo',
    esiti,
    aMano: true,
  });
  expect(
    `${titolo}\n${testo}`,
    "il programma e il manifesto degli aggiornamenti erano gia' attaccati a quella versione dal tentativo di prima: l'avviso li da' per persi e annuncia un download a vuoto che a vuoto non e'",
  ).not.toMatch(/risponde 404/);
});

test("l'avviso non descrive il contenuto di una versione che non esiste", () => {
  // Numero sbagliato nella casella dell'avvio a mano: il prelievo del codice
  // non trova l'etichetta e il lavoro muore li'. Nessuna versione con quel
  // numero e' mai esistita, e l'avviso ne elenca i file mancanti.
  const esiti = {
    strumento: { outcome: 'success' },
    riparo: { outcome: 'success' },
    bersaglio: { outcome: 'success' },
    checkout: { outcome: 'failure' },
  };
  const { titolo, testo } = allarme.componiAllarme({
    piattaforma: 'Linux',
    versione: 'v0.2.999',
    passo: allarme.passoFallito(esiti),
    esecuzione: 'https://esempio/2',
    repo: 'sathyaram1/Filo',
    esiti,
    aMano: true,
  });
  expect(
    `${titolo}\n${testo}`,
    "il lavoro non e' mai arrivato a guardare la versione (l'etichetta non esiste), eppure l'avviso ne elenca i file mancanti e annuncia un download a vuoto",
  ).not.toMatch(/risponde 404/);
});

// PORTA 3 — la casella del numero di versione, riempita da sola, fa partire
// tutt'altro: una pubblicazione nuova, con un'ora e un quarto di prove e, se
// sul ramo principale c'e' del nuovo, una versione in piu'. Chi voleva
// riattaccare i file ha dimenticato una spunta e ottiene il contrario.
test('scrivere il numero senza spuntare la piattaforma non fa partire una pubblicazione nuova', () => {
  const suite = senzaCommenti(job('suite'));
  expect(
    suite,
    "la casella del numero di versione, riempita da sola, non ferma niente: parte la batteria di prove e dietro a lei una pubblicazione nuova, cioe' l'opposto di quello che si voleva",
  ).toMatch(/ripubblica_versione/);
});

test('il numero della versione si accetta anche scritto con la V maiuscola', () => {
  const bersaglio = passi(senzaCommenti(job('release-linux'))).find((p) => p.id === 'bersaglio');
  expect(bersaglio).toBeTruthy();
  expect(
    bersaglio.corpo,
    "spazi incollati per sbaglio e la «v» dimenticata sono perdonati, una V maiuscola no: diventa «vV0.2.229», il prelievo non trova niente e il giro e' a vuoto",
  ).toMatch(/\[Vv\]|tr '\[:upper:\]'|tolower/);
});

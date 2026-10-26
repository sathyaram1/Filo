// Verifica #1589 giro 17. r1: un codice che non apre niente sparisce se la frase nomina una cosa che si apre (ingresso, wifi, dispositivo, allarme, ritiro).
import { test, expect } from '../../fixtures/electron.mjs';
import { leggiInChat } from './giro17-aiuto.mjs';

test('r1 i codici di prodotto, evento, ordine, errore e il CAP arrivano al modello anche accanto a una parola dell\'aprire', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Scheda prodotto', `<h1>Scheda prodotto</h1>
    <p>Videocitofono smart Wi-Fi, codice prodotto 48291375</p>
    <p>Codice evento 739204 - Teatro alla Scala, ingresso principale</p>
    <p>Codice ordine 482913: ritiro in negozio entro il 30/11</p>
    <p>Codice errore 4829 sul dispositivo</p>
    <p>Codice impianto 48291 (allarme)</p>
    <p>Il codice postale dell'ingresso è 20121</p>`, 'dalla pagina Scheda prodotto: qual è il codice prodotto?');
  expect(mandato, 'la pagina è stata letta').toContain('Scheda prodotto');
  for (const s of ['48291375', '739204', '482913', 'errore 4829', '48291 (allarme)', '20121']) expect(mandato, s).toContain(s);
});

// Verifica #1589 giro 19. r1: il CVV arriva al modello quando l'etichetta ha una parentesi, una parola in più o la cella.
import { test, expect } from '../../fixtures/electron.mjs';
import { leggiInChat } from './giro19-aiuto.mjs';

test('r1 il CVV di una carta virtuale non arriva al modello, qualunque sia la forma della sua etichetta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Carta virtuale', `<h1>Carta virtuale</h1>
    <p>Codice di sicurezza (CVV): 847</p>
    <p>CVV code: 739</p>
    <p>Il codice CVV della carta è 615</p>
    <table><tr><td>Titolare</td><td>Mario Rossi</td></tr><tr><td>CVV</td><td>592</td></tr></table>`, 'dalla pagina Carta virtuale: riassumi');
  expect(mandato, 'la pagina è stata letta').toContain('Mario Rossi');
  expect(mandato).not.toMatch(/\(CVV\): 847/);
  expect(mandato).not.toMatch(/CVV code: 739/);
  expect(mandato).not.toMatch(/carta è 615/);
  expect(mandato).not.toMatch(/CVV\W{0,6}592/);
});

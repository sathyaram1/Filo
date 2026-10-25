// Verifica #1589 giro 16. r4: nella tabella dell'account (etichetta, valore, bottone) la riga dopo la password perde l'etichetta.
import { test, expect } from '../../fixtures/electron.mjs';
import { leggiInChat } from './giro16-aiuto.mjs';

test('r4 nella tabella dell\'account l\'etichetta della riga sotto la password arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Il tuo account', `<h1>Il tuo account</h1>
    <table>
      <tr><td>Nome</td><td>Mario Rossi</td><td><button>Modifica</button></td></tr>
      <tr><td>Password</td><td>••••••••</td><td><button>Modifica</button></td></tr>
      <tr><td>Telefono</td><td>333 123 4567</td><td><button>Modifica</button></td></tr>
    </table>`, 'dalla pagina Il tuo account: come cambio il numero di telefono?');
  expect(mandato, 'la pagina è stata letta').toContain('Il tuo account');
  expect(mandato).toMatch(/Telefono\\t333 123 4567|Telefono[^\\]{0,6}333 123 4567/);
});

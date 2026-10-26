// Verifica #1589 giro 18. r3: con la password a puntini sulla sua riga, la parola della riga sotto viene presa per la password.
import { test, expect } from '../../fixtures/electron.mjs';
import { leggiInChat } from './giro18-aiuto.mjs';

test('r3 nella tabella dell\'account l\'etichetta della riga sotto la password arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Il tuo account', `<h1>Il tuo account</h1>
    <table>
      <tr><td>Nome</td><td>Mario Rossi</td><td><button>Modifica</button></td></tr>
      <tr><td>Password</td><td>••••••••</td><td><button>Modifica</button></td></tr>
      <tr><td>Telefono</td><td>333 123 4567</td><td><button>Modifica</button></td></tr>
    </table>`, 'dalla pagina Il tuo account: come cambio il numero di telefono?');
  expect(mandato, 'la pagina è stata letta').toContain('Il tuo account');
  expect(mandato).toMatch(/Telefono[^\\]{0,6}333 123 4567/);
});

test('r3 con la password a puntini su una riga, la riga sotto arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Sicurezza account', `<h1>Sicurezza account</h1>
    <div>Password <span>••••••••</span></div>
    <div>Notifiche</div>
    <div>Password <button>Modifica</button></div>
    <div>Verifica in due passaggi</div>`, 'dalla pagina Sicurezza account: cosa posso cambiare?');
  expect(mandato, 'la pagina è stata letta').toContain('Sicurezza account');
  expect(mandato).toContain('Notifiche');
  expect(mandato).toContain('Verifica in due passaggi');
});

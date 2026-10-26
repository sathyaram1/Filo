// Verifica #1589 giro 18. r3: con la password a puntini o un bottone sulla riga dell'etichetta, la parola della riga sotto viene presa per la password.
import { test, expect } from '../../fixtures/electron.mjs';
import { leggiInChat } from './giro18-aiuto.mjs';

test('r3 con la password a puntini o un bottone sulla riga dell\'etichetta, la riga sotto arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Sicurezza account', `<h1>Sicurezza account</h1>
    <div>Password <span>••••••••</span></div>
    <div>Notifiche</div>
    <div>Password <button>Modifica</button></div>
    <div>Sicurezza</div>`, 'dalla pagina Sicurezza account: cosa posso cambiare?');
  expect(mandato, 'la pagina è stata letta').toContain('Sicurezza account');
  expect(mandato).toContain('Notifiche');
  expect(mandato).toMatch(/Modifica(?:\\n)+Sicurezza/);
});

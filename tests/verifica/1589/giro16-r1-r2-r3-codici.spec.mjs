// Verifica #1589 giro 16. r1: un codice che apre qualcosa (cancello, cassaforte, prelievo, ritiro) arriva al modello.
import { test, expect } from '../../fixtures/electron.mjs';
import { leggiInChat } from './giro16-aiuto.mjs';

test('r1 il codice del cancello, della cassaforte, del prelievo e del ritiro non arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Istruzioni per il check-in', `<h1>Istruzioni per il check-in</h1>
    <p>Il codice del cancello è 4829.</p>
    <p>Il codice della cassetta delle chiavi è 7316.</p>
    <p>Il codice della cassaforte è 5502.</p>
    <p>Il tuo codice di prelievo è 918273.</p>
    <p>Codice di ritiro: 640385</p>`, 'dalla pagina Istruzioni per il check-in: come entro?');
  expect(mandato, 'la pagina è stata letta').toContain('Istruzioni per il check-in');
  for (const s of ['4829', '7316', '5502', '918273', '640385']) expect(mandato, s).not.toContain(s);
});

test('r3 il numero della riga sotto un codice arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Il corso', `<h1>Il corso</h1>
    <table><tr><td>Codice evento</td><td>739204</td></tr><tr><td>Posti disponibili</td><td>1200</td></tr></table>
    <p>Codice corso: 4829</p><p>Aula 1203</p>`,
  'dalla pagina Il corso: quanti posti ci sono e in che aula?');
  expect(mandato, 'la pagina è stata letta').toContain('Il corso');
  expect(mandato).toContain('1200');
  expect(mandato).toContain('Aula 1203');
});

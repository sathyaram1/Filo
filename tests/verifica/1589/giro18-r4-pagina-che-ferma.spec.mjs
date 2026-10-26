// Verifica #1589 giro 18. r4: una pagina con la parola password seguita da una lunga fila di spazi ferma Filo mentre il pavimento la legge.
import { test, expect } from '../../fixtures/electron.mjs';
import { leggiInChat } from './giro18-aiuto.mjs';

test('r4 una pagina con password e una lunga fila di spazi si legge in pochi secondi', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const inizio = Date.now();
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Pagina lunga', `<h1>Pagina lunga</h1>
    <pre>password${' '.repeat(40_000)}x</pre>`, 'dalla pagina Pagina lunga: riassumi');
  expect(mandato, 'la pagina è stata letta').toContain('Pagina lunga');
  expect(Date.now() - inizio).toBeLessThan(15_000);
});

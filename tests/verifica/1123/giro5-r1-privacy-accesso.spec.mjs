// #1123 giro 5 — la pagina Privacy di Filo deve dire dove si fa adesso l'accesso con Google.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 la pagina Privacy non dice più che l\'accesso Google si apre nel browser', async ({ openTab }) => {
  const page = await openTab('filo://transparency/transparency.html?doc=privacy');
  const testo = await page.locator('body').innerText();
  expect(testo, 'la pagina Privacy si è aperta').toContain('portachiavi del sistema');
  expect(testo).not.toContain('L\'accesso Google si apre nel browser');
});

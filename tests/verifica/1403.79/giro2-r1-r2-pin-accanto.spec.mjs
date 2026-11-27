// Verifica #1403.79 giro 2: il secondo PIN dopo un complemento del primo; i numeri che non sono PIN restano al modello.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';

async function manda(app, pagina, frasi, controlla) {
  const pagine = pagina;
  let risposte = 0;
  for (const riga of frasi) {
    const prima = (await chiamateAlModello(app)).length;
    await chiedi(pagine, `${riga[0]} (prova)`);
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20_000 }).toBeGreaterThan(prima);
    const mandato = JSON.stringify((await chiamateAlModello(app)).slice(prima));
    expect(mandato, `«${riga[0]}» è arrivata al modello`).toContain('(prova)');
    controlla(mandato, riga);
    risposte += 1;
    await expect(pagine.locator('.dash-bubble-filo', { hasText: 'RICEVUTO' })).toHaveCount(risposte, { timeout: 20_000 });
  }
}

test('r1 il secondo PIN non arriva al modello quando il primo ha un complemento prima della congiunzione o della virgola', async ({ app }) => {
  test.setTimeout(120_000);
  const pagina = await home(app);
  await modelloFinto(app, [{ text: 'RICEVUTO' }]);
  try {
    await manda(app, pagina, [
      ['Il pin è 4829 per la carta e 1234 per il telefono', '4829', '1234'],
      ['I miei pin: 4830 per la carta, 1235 per il telefono', '4830', '1235'],
      ['Il pin è 4831 sulla carta vecchia e 1236 su quella nuova', '4831', '1236'],
      ['Il pin è 4832 (quello nuovo) e 1237 (quello vecchio)', '4832', '1237'],
      ['Il pin è 4833 e quello della SIM, che uso poco, è 1238', '4833', '1238'],
    ], (mandato, [frase, primo, secondo]) => {
      expect.soft(mandato, `«${frase}»: il primo PIN`).not.toContain(primo);
      expect.soft(mandato, `«${frase}»: il secondo PIN`).not.toContain(secondo);
    });
  } finally {
    await ripristina(app);
  }
});

test('r2 un numero che non è un PIN, detto dopo il PIN nella stessa frase, arriva al modello', async ({ app }) => {
  test.setTimeout(120_000);
  const pagina = await home(app);
  await modelloFinto(app, [{ text: 'RICEVUTO' }]);
  try {
    await manda(app, pagina, [
      ['Il pin è 4829, il conto costa 1873 euro al mese', '4829', '1873'],
      ['Il pin è 4830 e l\'ho cambiato nel 2017', '4830', '2017'],
      ['il pin è 4831 e la pagina è 7319', '4831', '7319'],
      ['Il pin è 4832 e ho 1288 euro sul conto', '4832', '1288'],
    ], (mandato, [frase, pin, numero]) => {
      expect.soft(mandato, `«${frase}»: il PIN`).not.toContain(pin);
      expect.soft(mandato, `«${frase}»: il numero che non è un PIN`).toContain(numero);
    });
  } finally {
    await ripristina(app);
  }
});

// Verifica #1403.79 giro 2: le porte del giro 1 ri-provate (secondo PIN dopo parole, un trattino, un punto e virgola o un a capo).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';

const FRASI = [
  ['Il pin è 4829 e 1234', '4829', '1234'],
  ['I pin sono 4830 e 1235', '4830', '1235'],
  ['Il pin del bancomat è 4831 e quello della SIM è 1236', '4831', '1236'],
  ['Il pin è 4832 e il secondo è 1237', '4832', '1237'],
  ['Il pin è 4833 e anche 1238', '4833', '1238'],
  ['pin: 4834; 1239', '4834', '1239'],
  ['pin: 4835 - 1240', '4835', '1240'],
  ['Il pin è 4836\ne 1241', '4836', '1241'],
  ['PIN carta 4837, telefono 1242', '4837', '1242'],
  ['il pin è il 4838 o il 1243', '4838', '1243'],
];

test('il secondo PIN detto nella stessa frase non arriva al modello, con parole, un trattino o un a capo in mezzo', async ({ app }) => {
  test.setTimeout(150_000);
  const pagina = await home(app);
  await modelloFinto(app, [{ text: 'RICEVUTO' }]);
  try {
    for (let k = 0; k < FRASI.length; k++) {
      const [frase, primo, secondo] = FRASI[k];
      const prima = (await chiamateAlModello(app)).length;
      await chiedi(pagina, `${frase} (prova)`);
      await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20_000 }).toBeGreaterThan(prima);
      const mandato = JSON.stringify((await chiamateAlModello(app)).slice(prima));
      expect(mandato, `«${frase}» è arrivata al modello`).toContain('(prova)');
      expect.soft(mandato, `«${frase}»: il primo PIN`).not.toContain(primo);
      expect.soft(mandato, `«${frase}»: il secondo PIN`).not.toContain(secondo);
      await expect(pagina.locator('.dash-bubble-filo', { hasText: 'RICEVUTO' })).toHaveCount(k + 1, { timeout: 20_000 });
    }
  } finally {
    await ripristina(app);
  }
});

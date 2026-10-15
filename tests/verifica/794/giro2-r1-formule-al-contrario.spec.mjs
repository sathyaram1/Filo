// Verifica #794 giro 2: le formule vietate prendono anche le frasi dette nell'ordine inverso.
import { test, expect } from '@playwright/test';
import { OVUNQUE } from '../../helpers/formule-vietate.mjs';
import { AL_CONTRARIO, LEGITTIME } from './frasi-giro2.mjs';

test('r1 le frasi dette al contrario accendono la sentinella, quelle legittime no', () => {
  const sfuggite = AL_CONTRARIO.filter((f) => !OVUNQUE.some((r) => r.test(f)));
  const prese = LEGITTIME.filter((f) => OVUNQUE.some((r) => r.test(f)));
  expect({ sfuggite, prese }).toEqual({ sfuggite: [], prese: [] });
});

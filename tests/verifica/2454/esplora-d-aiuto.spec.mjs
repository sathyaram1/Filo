import { test, expect } from '@playwright/test';
import { uno } from './aiuto-solo-ramo.mjs';

test('usa un aiuto che solo il ramo ha', () => { expect(uno).toBe(1); });

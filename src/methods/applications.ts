import { defineMethod } from '../bitrix.js';

export const applicationList = defineMethod<Record<string, unknown>>(
  { type: 'object' },
  async () => [],
);

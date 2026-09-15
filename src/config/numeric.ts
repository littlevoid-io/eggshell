import { z } from 'zod';

export const positiveInt = (label: string): z.ZodNumber =>
  z.number().int(`${label} must be an integer`).positive(`${label} must be a positive number`);

export const positiveIntMs = (label: string): z.ZodNumber =>
  z
    .number()
    .int(`${label} must be an integer number of milliseconds`)
    .positive(`${label} must be a positive number of milliseconds`);

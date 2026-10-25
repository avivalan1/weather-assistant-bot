import { z } from 'zod';

/**
 * Local wall-clock time as Open-Meteo returns it with a `timezone` parameter,
 * e.g. "2026-10-24T18:00". Validating the exact shape keeps markup or garbage out
 * of replies and keeps plain string comparison chronological.
 */
export const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

/** Local calendar date, e.g. "2026-10-24". */
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

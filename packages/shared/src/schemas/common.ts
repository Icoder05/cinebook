import { z } from 'zod';

export const uuid = z.string().uuid({ message: 'Must be a valid id' });
export const idParam = z.object({ id: uuid });
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

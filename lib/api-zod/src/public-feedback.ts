import { z } from 'zod';

export const publicFeedbackInput = z.object({
  type: z.enum(['CONTACT', 'FEEDBACK']),
  email: z.string().trim().max(254).email(),
  message: z.string().trim().min(1).max(10_000).refine(value => !value.includes('\0'), 'Invalid message'),
}).strict();

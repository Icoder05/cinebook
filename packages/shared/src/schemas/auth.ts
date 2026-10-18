import { z } from 'zod';

export const nameField = z.string().trim().min(2, 'Name is too short').max(60, 'Name is too long');
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email')
  .max(254);
export const phoneField = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');
export const passwordField = z
  .string()
  .min(8, 'At least 8 characters')
  .max(72, 'At most 72 characters')
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/\d/, 'Include a number');

export const signupSchema = z.object({
  name: nameField,
  email: emailField,
  phone: phoneField,
  password: passwordField,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password').max(72),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z
  .object({ name: nameField, phone: phoneField })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

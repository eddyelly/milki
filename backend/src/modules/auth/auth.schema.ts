import { z } from 'zod';

/** Tanzanian mobile numbers, normalised to E.164: 0712 345 678 / 255712345678 / +255712345678 → +255712345678. */
export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s()-]/g, ''))
  .transform((s) => (s.startsWith('0') ? `+255${s.slice(1)}` : s.startsWith('255') ? `+${s}` : s))
  .pipe(z.string().regex(/^\+255[67]\d{8}$/, 'Enter a valid Tanzanian mobile number, e.g. 0712 345 678.'));

/** NIDA numbers are 20 digits, usually written YYYYMMDD-XXXXX-XXXXX-XX. */
export const nidaSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{20}$/, 'Enter your 20-digit NIDA number.'));

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and at least one number.');

export const registerSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter your full name.').max(120),
  phone: phoneSchema,
  email: z.email('Enter a valid email address.').toLowerCase().optional(),
  nida: nidaSchema,
  password: passwordSchema,
  preferredLanguage: z.enum(['en', 'sw']).default('en'),
});

export const loginSchema = z.object({
  /** Phone number or email. */
  identifier: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(128),
});

export const otpSchema = z.object({
  challengeId: z.string().min(10).max(64),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export const resendSchema = z.object({ challengeId: z.string().min(10).max(64) });

export const refreshSchema = z.object({ refreshToken: z.string().min(20).optional() });

/** Re-authentication for T3 actions: password, or an OTP sent via POST /auth/reauth/otp. */
export const reauthSchema = z.union([
  z.object({ password: z.string().min(1).max(128) }),
  z.object({ challengeId: z.string().min(10).max(64), code: z.string().regex(/^\d{6}$/) }),
]);

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OtpInput = z.infer<typeof otpSchema>;
export type ReauthInput = z.infer<typeof reauthSchema>;

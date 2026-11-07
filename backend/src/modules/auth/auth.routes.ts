import { Router } from 'express';
import { requireAuth } from '../../core/auth';
import { validate } from '../../core/http';
import { authLimiter } from '../../core/rate-limit';
import * as c from './auth.controller';
import { loginSchema, otpSchema, reauthSchema, refreshSchema, registerSchema, resendSchema } from './auth.schema';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), c.register);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), c.login);
authRouter.post('/otp/verify', authLimiter, validate({ body: otpSchema }), c.verifyOtp);
authRouter.post('/otp/resend', authLimiter, validate({ body: resendSchema }), c.resend);
authRouter.post('/refresh', validate({ body: refreshSchema }), c.refresh);
authRouter.post('/logout', validate({ body: refreshSchema }), c.logout);
authRouter.get('/me', requireAuth, c.me);
authRouter.post('/reauth/otp', requireAuth, authLimiter, c.reauthOtp);
authRouter.post('/reauth', requireAuth, authLimiter, validate({ body: reauthSchema }), c.reauth);

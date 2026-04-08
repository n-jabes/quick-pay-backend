import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getEnv } from '../../config/env';
import { asyncHandler } from '../../middleware/async-handler';
import { requireAuth } from '../../middleware/require-auth';
import {
  changePasswordSchema,
  loginSchema,
  parseBody,
  resendOtpSchema,
  verifyOtpSchema,
} from './auth.schemas';
import * as authService from './auth.service';

const env = getEnv();

export const authLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRouter = Router();

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    req.body = parseBody(loginSchema, req.body);
    await authService.login(req, res);
  }),
);

authRouter.post(
  '/verify-otp',
  authLimiter,
  asyncHandler(async (req, res) => {
    req.body = parseBody(verifyOtpSchema, req.body);
    await authService.verifyOtp(req, res);
  }),
);

authRouter.post(
  '/resend-otp',
  authLimiter,
  asyncHandler(async (req, res) => {
    req.body = parseBody(resendOtpSchema, req.body);
    await authService.resendOtp(req, res);
  }),
);

authRouter.post(
  '/refresh',
  authLimiter,
  asyncHandler(async (req, res) => {
    await authService.refresh(req, res);
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await authService.logout(req, res);
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    await authService.meAuthenticated(req, res);
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    req.body = parseBody(changePasswordSchema, req.body);
    await authService.changePassword(req, res);
  }),
);

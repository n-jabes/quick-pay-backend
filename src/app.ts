import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import pinoHttp from 'pino-http';
import { getEnv } from './config/env';
import { getLogger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { asyncHandler } from './middleware/async-handler';
import {
  authLimiter,
  authRouter,
} from './modules/auth/auth.routes';
import {
  loginSchema,
  parseBody,
  resendOtpSchema,
  verifyOtpSchema,
} from './modules/auth/auth.schemas';
import * as authService from './modules/auth/auth.service';

export function createApp(): express.Application {
  const env = getEnv();
  const app = express();

  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger: getLogger(),
      autoLogging: {
        ignore: (req) => req.url === '/health',
      },
    }),
  );
  app.use(morgan('combined'));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const prefix = env.API_PREFIX.replace(/\/$/, '');

  app.use(`${prefix}/auth`, authRouter);

  // Frontend compatibility (Next.js calls these at API root)
  app.post(
    '/login',
    authLimiter,
    asyncHandler(async (req, res) => {
      req.body = parseBody(loginSchema, req.body);
      await authService.login(req, res);
    }),
  );
  app.post(
    '/verifyOtp',
    authLimiter,
    asyncHandler(async (req, res) => {
      req.body = parseBody(verifyOtpSchema, req.body);
      await authService.verifyOtp(req, res);
    }),
  );
  app.post(
    '/resend-otp',
    authLimiter,
    asyncHandler(async (req, res) => {
      req.body = parseBody(resendOtpSchema, req.body);
      await authService.resendOtp(req, res);
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

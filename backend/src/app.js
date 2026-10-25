import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from './domain.js';
import { authentication } from './auth.js';
import { registerCatalogue } from './catalogue.js';
import { registerSales } from './sales.js';

export function buildApp(db, options) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !== options.origin
    )
      return next(new AppError(403, 'Request origin is not allowed'));
    next();
  });
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests; try again later' },
    }),
  );
  app.use(express.json({ limit: '128kb' }));
  app.use(cookieParser());
  app.get('/health', async (request, response) => {
    await db.query('SELECT 1');
    response.json({ status: 'ok' });
  });
  const security = authentication(db, options);
  security.register(app);
  registerCatalogue(app, db, security);
  registerSales(app, db, security);
  app.use((request, response) => response.status(404).json({ error: 'Page not found' }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof z.ZodError)
      return response
        .status(400)
        .json({
          error: 'Invalid input',
          details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        });
    if (error instanceof AppError)
      return response.status(error.statusCode).json({ error: error.message });
    if (error.code === '23505')
      return response.status(409).json({ error: 'A record with that value already exists' });
    if (['23503', '23001'].includes(error.code))
      return response.status(400).json({ error: 'Related record is unavailable or still in use' });
    if (['23514', '23502', '22003'].includes(error.code))
      return response.status(400).json({ error: 'A value is outside the supported limits' });
    if (['40001', '40P01'].includes(error.code))
      return response.status(409).json({ error: 'The record changed; retry the same request' });
    if (error.status >= 400 && error.status < 500)
      return response.status(error.status).json({ error: 'Invalid request' });
    if (options.logger)
      console.error('Request failed', {
        method: request.method,
        path: request.path,
        code: error.code ?? 'INTERNAL',
      });
    response.status(500).json({ error: 'Request could not be completed' });
  });
  return app;
}

import express from 'express';
import cors from 'cors';
import joinRoutes from './routes/join.routes';
import selectRoutes from './routes/select.routes';
import sessionRoutes from './routes/session.routes';
import resultsRoutes from './routes/results.routes';
import logsRoutes from './routes/logs.routes';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;

export function createApp() {
  const app = express();

  // Cần thiết để getClientIp đọc đúng X-Forwarded-For khi chạy sau Railway/Render proxy
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: FRONTEND_ORIGIN, // KHÔNG dùng '*' vì mọi request ghi dữ liệu đi qua đây
      credentials: true,
    })
  );
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

  app.use('/api', joinRoutes);
  app.use('/api', selectRoutes);
  app.use('/api', sessionRoutes);
  app.use('/api', resultsRoutes);
  app.use('/api', logsRoutes);

  // Handler lỗi chung - phòng khi có lỗi không được catch ở route
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[unhandled error]', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

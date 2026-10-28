import type { Middleware } from './middleware.types.ts';

const health: Middleware = (app) => {
  if (!app) return;
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
};

export default health;

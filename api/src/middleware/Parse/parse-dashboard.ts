import ParseDashboard from 'parse-dashboard';
import type { RequestHandler } from 'express';
import type { Middleware } from '../middleware.types.ts';
import type { DashboardConfig } from './parse-dashboard.types.ts';

/**
 * Creates Parse Dashboard and returns Express middleware to mount
 * (e.g. `app.use('/dashboard', parseDashboard({ ... }))`).
 */
const dashboard = ({
  appId,
  masterKey,
  serverURL,
  appName = 'Productivity Tracker',
}: DashboardConfig): RequestHandler => {
  return new ParseDashboard({
    apps: [
      {
        appId,
        appName,
        masterKey,
        serverURL,
      },
    ],
  });
};

const parseDashboard: Middleware = (app) => {
  if (!app) return;

  const {
    APP_ID,
    DASHBOARD_ENABLED = 'true',
    MASTER_KEY,
    PORT = '1337',
    SERVER_URL = `http://localhost:${PORT}/parse`,
  } = process.env;

  if (DASHBOARD_ENABLED !== 'true') return;

  if (!APP_ID || !MASTER_KEY) {
    console.error('Parse Dashboard needs APP_ID and MASTER_KEY in .env.');
    return;
  }

  Hook.register('started', () =>
    console.log(
      `Parse Dashboard running at ${String(SERVER_URL).replace('/parse', '/dashboard')}`,
    ),
  );

  app.use(
    '/dashboard',
    dashboard({
      appId: APP_ID,
      masterKey: MASTER_KEY,
      serverURL: SERVER_URL,
    }),
  );
};

export default parseDashboard;

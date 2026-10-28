// parse-dashboard ships without TypeScript types; this covers what we use.
declare module 'parse-dashboard' {
  import type { RequestHandler } from 'express';

  interface DashboardApp {
    appId: string;
    masterKey: string;
    serverURL: string;
    appName?: string;
  }

  interface DashboardOptions {
    apps: DashboardApp[];
    users?: { user: string; pass: string }[];
  }

  interface DashboardSettings {
    allowInsecureHTTP?: boolean;
  }

  const ParseDashboard: new (
    options: DashboardOptions,
    settings?: DashboardSettings,
  ) => RequestHandler;

  export default ParseDashboard;
}

// Types for the Parse Dashboard middleware (parse-dashboard.ts). The
// 'parse-dashboard' package's own types are declared in
// parse-dashboard.module.d.ts.

// Settings for the dashboard's single app.
export interface DashboardConfig {
  appId: string;
  appName?: string;
  masterKey: string;
  serverURL: string;
}

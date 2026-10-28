import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import parseDashboard from '../src/middleware/Parse/parse-dashboard.ts';

describe('parse-dashboard middleware', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('APP_ID', 'test-app');
    vi.stubEnv('MASTER_KEY', 'test-master-key');
  });

  it('mounts the dashboard at /dashboard when enabled', async () => {
    const app = express();
    await parseDashboard(app);

    const res = await request(app).get('/dashboard/');

    expect(res.status).toBe(200);
  });

  it('does not mount when DASHBOARD_ENABLED is not "true"', async () => {
    vi.stubEnv('DASHBOARD_ENABLED', 'false');
    const app = express();
    await parseDashboard(app);

    const res = await request(app).get('/dashboard/');

    expect(res.status).toBe(404);
  });

  it('does not mount and logs an error without APP_ID or MASTER_KEY', async () => {
    vi.stubEnv('MASTER_KEY', '');
    const app = express();
    await parseDashboard(app);

    const res = await request(app).get('/dashboard/');

    expect(res.status).toBe(404);
    expect(console.error).toHaveBeenCalled();
  });
});

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import health from '../src/middleware/health.ts';

describe('health middleware', () => {
  it('responds to GET /health with status ok', async () => {
    const app = express();
    await health(app);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

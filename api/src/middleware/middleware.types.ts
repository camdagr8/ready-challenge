import type { Application } from 'express';

/**
 * Shape of a middleware file in this folder: its default export receives the Express
 * app and can register routes or mount other middleware (sync or async).
 */
export type Middleware = (app: Application) => void | Promise<void>;

import type { Server } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Application } from 'express';
import { ParseServer } from 'parse-server';
import type {
  PagesOptions,
  ParseServerOptions,
} from 'parse-server/types/Options/index.js';
import type { Middleware } from '../middleware.types.ts';

const cloudEntry = pathToFileURL(
  path.join(import.meta.dirname, '../../cloud/index.ts'),
).href;

// Classes whose changes are pushed to LiveQuery subscribers. Subscribers
// only receive objects their ACL and the class's CLP let them read.
const LIVE_QUERY_CLASSES = ['Summary', 'Task'];

// parse-server's bundled types lag behind its runtime: `cloud` is typed as a
// string only, `maintenanceKey` is marked required (it's optional), and a
// few newer options are missing.
type Options = Omit<
  ParseServerOptions,
  'cloud' | 'pages' | 'maintenanceKey'
> & {
  cloud: string | ((parse: typeof Parse) => unknown);
  maintenanceKey?: string;
  pages?: PagesOptions & { encodePageParamHeaders?: boolean };
  readOnlyMasterKeyIps?: string[];
  allowAggregationForReadOnlyMasterKey?: boolean;
  requestComplexity?: {
    includeDepth?: number;
    includeCount?: number;
    subqueryDepth?: number;
    queryDepth?: number;
    graphQLDepth?: number;
    graphQLFields?: number;
    batchRequestLimit?: number;
  };
  protectedFieldsOwnerExempt?: boolean;
  protectedFieldsTriggerExempt?: boolean;
  protectedFieldsSaveResponseExempt?: boolean;
  installation?: { duplicateDeviceTokenActionEnforceAuth?: boolean };
};

interface ServerConfig {
  appId: string;
  masterKey: string;
  databaseURI: string;
  serverURL: string;
}

/**
 * Creates and starts Parse Server, returning Express middleware to mount
 * (e.g. `app.use('/parse', await parseServer({ ... }))`).
 */
const server = async ({
  appId,
  masterKey,
  databaseURI,
  serverURL,
}: ServerConfig): Promise<Application> => {
  const options: Options = {
    appId,
    masterKey,
    databaseURI,
    serverURL,
    // Passed as a function so Cloud Code is always loaded with import(),
    // whether the API is started through npm or with `node` directly.
    // Parse Server sets the global `Parse` first and awaits this.
    cloud: () => import(cloudEntry),
    // Only the master key (server / dashboard) can create new classes
    allowClientClassCreation: false,

    // Opt in now to defaults that change in future Parse Server versions
    // (also silences the startup deprecation warnings)
    fileUpload: { allowedFileUrlDomains: [] },
    pages: { encodePageParamHeaders: true },
    readOnlyMasterKeyIps: ['127.0.0.1', '::1'],
    allowAggregationForReadOnlyMasterKey: false,
    requestComplexity: {
      includeDepth: 10,
      includeCount: 100,
      subqueryDepth: 10,
      queryDepth: 10,
      graphQLDepth: 20,
      graphQLFields: 200,
      batchRequestLimit: 100,
    },
    protectedFieldsOwnerExempt: false,
    protectedFieldsTriggerExempt: true,
    protectedFieldsSaveResponseExempt: false,
    installation: { duplicateDeviceTokenActionEnforceAuth: true },
    enableLiveQueryClassLevelPermissionRoles: true,
    liveQuery: { classNames: LIVE_QUERY_CLASSES },
  };

  // The named export is a factory that returns the server instance.
  const srv = ParseServer(options as ParseServerOptions);

  await srv.start();

  // Attach the LiveQuery WebSocket server to the API's HTTP server, which
  // bootstrap.ts creates and passes to beforeStart. Clients connect to the
  // same host and path as the API, over ws:// or wss://.
  Hook.register(
    'beforeStart',
    async ({ httpServer }: { httpServer: Server }) => {
      await ParseServer.createLiveQueryServer(
        httpServer,
        { appId, masterKey, serverURL },
        options as ParseServerOptions,
      );
    },
  );

  return srv.app;
};

const parseServer: Middleware = async (app) => {
  if (!app) return;

  const {
    APP_ID,
    DATABASE_URI,
    MASTER_KEY,
    PORT = '1337',
    SERVER_URL = `http://localhost:${PORT}/parse`,
  } = process.env;

  if (!APP_ID || !MASTER_KEY || !DATABASE_URI) {
    console.error(
      'Missing APP_ID, MASTER_KEY or DATABASE_URI. Copy .env.example to .env and fill it in.',
    );
    return;
  }

  Hook.register('started', () =>
    console.log(`Parse Server running at ${SERVER_URL}`),
  );

  app.use(
    '/parse',
    await server({
      appId: APP_ID,
      masterKey: MASTER_KEY,
      serverURL: SERVER_URL,
      databaseURI: DATABASE_URI,
    }),
  );
};

export default parseServer;

import type ParseNode from 'parse/node';
import type { HookSDK } from '../lib/Hook/hook.types.ts';

declare global {
  // Set by Parse Server before Cloud Code is loaded.
  var Parse: typeof ParseNode;

  // Set when src/lib/Hook/hook.ts is imported (first thing in src/index.ts).
  var Hook: HookSDK;

  namespace NodeJS {
    interface ProcessEnv {
      ADMIN_PASSWORD?: string;
      ANTHROPIC_API_KEY?: string;
      APP_ID?: string;
      DASHBOARD_ENABLED?: string;
      DATABASE_URI?: string;
      MASTER_KEY?: string;
      PORT?: string;
      SERVER_URL?: string;
      SUMMARY_MODEL?: string;
    }
  }
}

// Sets the global Hook before anything else loads.
import './lib/Hook/hook.ts';
import bootstrap from './bootstrap.ts';

await Hook.run('init', {});
await bootstrap();

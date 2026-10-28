// Runs before each test file. The server sets the global Hook by importing
// src/lib/Hook/hook.ts first (see src/index.ts); tests don't load
// src/index.ts, so this does the same for them.
import '../src/lib/Hook/hook.ts';

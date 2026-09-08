import { spawn } from 'node:child_process';
import { PNPM_COMMAND } from './lib/toolchain.mjs';

// Run only through the delivery-verify sandbox. Its isolated network namespace
// makes loopback private to this command; this does not grant runner-host access.
// Codex clears NO_PROXY when starting a command, so set it in the child here.
const loopback = 'localhost,127.0.0.1,::1';
const child = spawn(PNPM_COMMAND, ['test'], {
  cwd: process.cwd(), stdio:'inherit', windowsHide:true,
  env:{...process.env, NO_PROXY:loopback, no_proxy:loopback},
});
child.on('error', () => { console.error('Could not start the repository test command.'); process.exitCode = 2; });
child.on('close', (code) => { process.exitCode = code ?? 1; });

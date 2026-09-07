/** Internal recovery must be a failure exit so ON_FAILURE supervisors restart it. */
export function createGracefulRestartController(signal: () => void, forceExit: () => void) {
  let restartRequested = false;
  return {
    exitCode: (): 0 | 1 => restartRequested ? 1 : 0,
    request: (): void => {
      if (restartRequested) return;
      // Set intent before SIGTERM can invoke the graceful shutdown handler.
      restartRequested = true;
      try { signal(); } catch { forceExit(); }
    },
  };
}

const restart = createGracefulRestartController(
  () => { process.kill(process.pid, 'SIGTERM'); },
  () => { process.exit(1); },
);
export const requestGracefulRestart = restart.request;
export const requestedShutdownExitCode = restart.exitCode;

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DESKTOP_ENV_PATH) {
    const { ensureBackupService } = await import('./lib/project-backup-service');
    ensureBackupService();
  }
}

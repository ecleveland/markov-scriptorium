// Query keys for the Muniment Room. Everything nests under `archiveKeys.all`.

export const archiveKeys = {
  all: ['archive'] as const,
  backups: () => ['archive', 'backups'] as const,
}

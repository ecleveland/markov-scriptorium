import { ApiError } from '../api'

/**
 * What to show when an import call fails. The backend's own reason when it gave
 * one (a 422 detail, say), since "try again" misleads for input it will reject
 * again.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.detail) return err.detail
  return 'The scriptorium could not be reached. Please try again.'
}

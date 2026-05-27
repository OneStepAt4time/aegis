// src/boot/boot-auth.ts — Bootstrap facade for auth setup
// Extract point for future setupAuth extraction. Currently re-exports the
// existing implementation to keep server.ts imports stable while we iterate.

export { setupAuth, pruneAuthFailLimits, pruneIpRateLimits, requestKeyMap } from '../middleware/auth-setup.js';

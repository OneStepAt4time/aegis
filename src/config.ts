/**
 * config.ts — Thin re-export wrapper.
 *
 * All config logic has been split into domain-specific modules under src/config/:
 *   - config/auth.ts     — auth & security settings
 *   - config/channels.ts — Telegram & webhook settings
 *   - config/server.ts   — HTTP server settings
 *   - config/sessions.ts — session lifecycle settings
 *   - config/budgets.ts  — rate limiting, alerting, misc budgets
 *   - config/index.ts    — merged schemas, Config interface, loadConfig()
 *
 * This file preserves backward compatibility for all existing imports.
 * Issue #4232.
 */

export {
  SYSTEM_TENANT,
  fullConfigSchema,
  computeStallThreshold,
  readConfigFile,
  serializeConfigFile,
  writeConfigFile,
  loadConfig,
  getConfig,
  findConfigFilePath,
  loadSpecificConfigFile,
  reloadAllowedWorkDirs,
  watchConfigFile,
  authConfigSchema,
  channelConfigSchema,
  serverConfigSchema,
  sessionConfigSchema,
  budgetConfigSchema,
  type Config,
  type AuthConfig,
  type ChannelConfig,
  type ServerConfig,
  type SessionConfig,
  type BudgetConfig,
} from './config/index.js';

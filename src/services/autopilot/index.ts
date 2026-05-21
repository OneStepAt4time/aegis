/**
 * services/autopilot/index.ts — Public API for the autopilot module.
 */

export { AutopilotService, computeNextRun, interpolateTemplate, getTemplateVariables } from './service.js';
export type {
  AutopilotRecord,
  AutopilotTriggerRecord,
  AutopilotRunRecord,
  CreateAutopilotParams,
  UpdateAutopilotParams,
  CreateTriggerParams,
  AutopilotRunFilters,
  AutopilotStatus,
  ExecutionMode,
  TriggerKind,
  WebhookProvider,
  TemplateVariables,
} from './types.js';

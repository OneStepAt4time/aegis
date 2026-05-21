/**
 * services/squad/index.ts — Public API for the squad module.
 */

export { SquadService } from './service.js';
export type {
  SquadRecord,
  SquadMemberRecord,
  CreateSquadParams,
  UpdateSquadParams,
  AddSquadMemberParams,
  SquadMemberRole,
  MemberType,
} from './types.js';

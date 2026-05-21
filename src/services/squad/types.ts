/**
 * services/squad/types.ts — Squad domain types.
 *
 * Ported from Multica's squad model. A squad is a team of agents
 * with a leader that coordinates work distribution.
 */

/** Squad member role. */
export type SquadMemberRole = 'leader' | 'worker';

/** Member type. */
export type MemberType = 'agent';

/** Squad record. */
export interface SquadRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  instructions: string;
  leaderId: string;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  tenantId: string | null;
  ownerKeyId: string | null;
}

/** Squad member record. */
export interface SquadMemberRecord {
  id: string;
  squadId: string;
  memberType: MemberType;
  memberId: string;
  role: SquadMemberRole;
  createdAt: Date;
}

/** Create squad params. */
export interface CreateSquadParams {
  name: string;
  description?: string;
  instructions?: string;
  leaderId: string;
  memberIds?: string[];
  tenantId?: string;
  ownerKeyId?: string;
}

/** Update squad params. */
export interface UpdateSquadParams {
  name?: string;
  description?: string;
  instructions?: string;
  leaderId?: string;
}

/** Add member params. */
export interface AddSquadMemberParams {
  squadId: string;
  memberId: string;
  role: SquadMemberRole;
}

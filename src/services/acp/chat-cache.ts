import type { AcpEventJsonValue } from './event-store.js';
import type { AcpSessionScope } from './types.js';

export type AcpChatSnapshotMessage = Record<string, AcpEventJsonValue>;
export type AcpChatTokenUsage = Record<string, AcpEventJsonValue>;
export type AcpChatSnapshotMetadata = Record<string, AcpEventJsonValue>;

export interface AcpChatSnapshotRecord extends AcpSessionScope {
  sessionId: string;
  transcriptId: string;
  snapshotId: string;
  /** Monotonically increases within one tenant/owner/session chat cache stream. */
  snapshotSeq: number;
  fromEventSeq: number;
  toEventSeq: number;
  createdAt: Date;
  messages: AcpChatSnapshotMessage[];
  tokenUsage?: AcpChatTokenUsage;
  metadata?: AcpChatSnapshotMetadata;
}

export interface AcpSaveChatSnapshotInput extends AcpSessionScope {
  sessionId: string;
  transcriptId: string;
  fromEventSeq: number;
  toEventSeq: number;
  messages: AcpChatSnapshotMessage[];
  tokenUsage?: AcpChatTokenUsage;
  metadata?: AcpChatSnapshotMetadata;
}

export interface AcpGetChatSnapshotInput extends AcpSessionScope {
  sessionId: string;
  transcriptId: string;
  atOrBeforeEventSeq?: number;
}

export interface AcpChatCache {
  save(input: AcpSaveChatSnapshotInput): Promise<AcpChatSnapshotRecord>;
  getLatest(input: AcpGetChatSnapshotInput): Promise<AcpChatSnapshotRecord | null>;
}

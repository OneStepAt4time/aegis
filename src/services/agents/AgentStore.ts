import type { SerializedAgentProfile } from './types.js';

export interface AgentStore {
  /** Load all serialized profiles from the backing store. */
  loadAgents(): Promise<SerializedAgentProfile[]>;

  /** Save the whole set of serialized profiles (optional, store may ignore). */
  saveAgents(profiles: SerializedAgentProfile[]): Promise<void>;

  /** Get a single serialized profile by id. */
  getAgent(id: string): Promise<SerializedAgentProfile | undefined>;

  /** Insert or update a serialized profile. */
  putAgent(profile: SerializedAgentProfile): Promise<void>;

  /** Delete a serialized profile. */
  deleteAgent(id: string): Promise<void>;

  /** List all profile ids. */
  listAgentIds(): Promise<string[]>;
}

export default AgentStore;

export interface SessionRepo<T = any> {
  save(session: T): Promise<void>;
  load(id: string): Promise<T | null>;
}

export class SessionPersistenceService<T = any> implements SessionRepo<T> {
  // Placeholder implementation — to be wired to JsonFileStore/Postgres in follow-ups
  constructor(private readonly store: { save: (s: T) => Promise<void>; load: (id: string) => Promise<T | null> }) {}

  async save(session: T): Promise<void> {
    return this.store.save(session);
  }

  async load(id: string): Promise<T | null> {
    return this.store.load(id);
  }
}

export default SessionPersistenceService;

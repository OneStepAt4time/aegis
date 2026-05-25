import { SessionPersistenceService } from '../../services/session/persistence';

describe('SessionPersistenceService scaffold', () => {
  it('is constructible and exposes save/load', async () => {
    const stub = { save: async () => {}, load: async () => null };
    const svc = new SessionPersistenceService(stub);
    expect(typeof svc.save).toBe('function');
    expect(typeof svc.load).toBe('function');
  });
});

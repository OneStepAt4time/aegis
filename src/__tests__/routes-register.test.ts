import { registerRoutes } from '../../services/api/routes/index';

describe('routes.register scaffold', () => {
  it('exports registerRoutes function', () => {
    expect(typeof registerRoutes).toBe('function');
  });
});

import { describe, it, expect } from 'vitest';
import { registerRoutes } from '../services/api/routes/index.js';

describe('routes.register scaffold', () => {
  it('exports registerRoutes function', () => {
    expect(typeof registerRoutes).toBe('function');
  });
});

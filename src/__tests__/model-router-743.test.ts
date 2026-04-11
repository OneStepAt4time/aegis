/**
 * model-router-743.test.ts — Unit tests for Issue #743: Tiered Model Routing.
 *
 * Tests: scoreTaskComplexity, scoreToTier, routeTask, MODEL_TIERS.
 */

import { describe, it, expect } from 'vitest';
import {
  scoreTaskComplexity,
  scoreToTier,
  routeTask,
  MODEL_TIERS,
  type ModelTier,
} from '../model-router.js';

// ── scoreToTier() ────────────────────────────────────────────────────

describe('Issue #743: scoreToTier boundaries', () => {
  it('0 → fast', () => { expect(scoreToTier(0)).toBe('fast'); });
  it('30 → fast', () => { expect(scoreToTier(30)).toBe('fast'); });
  it('31 → standard', () => { expect(scoreToTier(31)).toBe('standard'); });
  it('50 → standard', () => { expect(scoreToTier(50)).toBe('standard'); });
  it('70 → standard', () => { expect(scoreToTier(70)).toBe('standard'); });
  it('71 → power', () => { expect(scoreToTier(71)).toBe('power'); });
  it('100 → power', () => { expect(scoreToTier(100)).toBe('power'); });
});

// ── scoreTaskComplexity() keyword signals ────────────────────────────

describe('Issue #743: scoreTaskComplexity — keyword signals', () => {
  it('security keyword raises score to power tier', () => {
    const { score, reasoning } = scoreTaskComplexity(
      'fix security vulnerability in auth',
      [],
      '',
    );
    expect(score).toBeGreaterThan(70);
    expect(reasoning.some(r => r.includes('security'))).toBe(true);
  });

  it('typo keyword lowers score to fast tier', () => {
    const { score, reasoning } = scoreTaskComplexity(
      'fix typo in README',
      [],
      '',
    );
    expect(score).toBeLessThanOrEqual(30);
    expect(reasoning.some(r => r.includes('typo'))).toBe(true);
  });

  it('docs label lowers score to fast tier', () => {
    const { score } = scoreTaskComplexity('update changelog', ['docs'], '');
    expect(score).toBeLessThanOrEqual(20);
  });

  it('feature keyword produces standard tier', () => {
    const { score } = scoreTaskComplexity('add new feature for API', [], '');
    expect(score).toBeGreaterThan(30);
    expect(score).toBeLessThanOrEqual(70);
  });
});

describe('Issue #743: scoreTaskComplexity — label overrides', () => {
  it('security label overrides to power regardless of title', () => {
    const { score } = scoreTaskComplexity('update readme', ['security'], '');
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('chore label pushes to fast tier', () => {
    const { score } = scoreTaskComplexity('do something important', ['chore'], '');
    expect(score).toBeLessThanOrEqual(20);
  });

  it('P0 label elevates to power tier', () => {
    const { score } = scoreTaskComplexity('fix something small', ['P0'], '');
    expect(score).toBeGreaterThanOrEqual(72);
  });

  it('P1 label elevates to power tier', () => {
    const { score } = scoreTaskComplexity('fix something', ['P1'], '');
    expect(score).toBeGreaterThanOrEqual(72);
  });

  it('P3 label caps at standard tier', () => {
    const { score } = scoreTaskComplexity('complex migration task', ['P3'], '');
    expect(score).toBeLessThanOrEqual(55);
  });

  it('reasoning array is never empty', () => {
    const { reasoning } = scoreTaskComplexity('some generic task', [], '');
    expect(reasoning.length).toBeGreaterThan(0);
  });
});

describe('Issue #743: scoreTaskComplexity — score clamped to 0–100', () => {
  it('score never exceeds 100', () => {
    const { score } = scoreTaskComplexity(
      'critical security auth vulnerability migration',
      ['security', 'P0', 'critical'],
      'security auth cryptography encryption injection',
    );
    expect(score).toBeLessThanOrEqual(100);
  });

  it('score never goes below 0', () => {
    const { score } = scoreTaskComplexity(
      'typo docs documentation chore',
      ['docs', 'chore'],
      'typo whitespace comment',
    );
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ── routeTask() ──────────────────────────────────────────────────────

describe('Issue #743: routeTask() output structure', () => {
  it('returns tier, model, score, reasoning', () => {
    const decision = routeTask({ title: 'add new feature', labels: [], description: '' });
    expect(decision).toHaveProperty('tier');
    expect(decision).toHaveProperty('model');
    expect(decision).toHaveProperty('score');
    expect(decision).toHaveProperty('reasoning');
    expect(typeof decision.score).toBe('number');
    expect(Array.isArray(decision.reasoning)).toBe(true);
  });

  it('model matches MODEL_TIERS for the returned tier', () => {
    const decision = routeTask({ title: 'fix typo in docs', labels: ['docs'] });
    expect(decision.model).toBe(MODEL_TIERS[decision.tier as ModelTier]);
  });

  it('security task routes to power tier', () => {
    const decision = routeTask({ title: 'fix security injection vulnerability' });
    expect(decision.tier).toBe('power');
  });

  it('typo fix routes to fast tier', () => {
    const decision = routeTask({ title: 'fix typo in README', labels: ['docs'] });
    expect(decision.tier).toBe('fast');
  });

  it('labels default to [] when not provided', () => {
    expect(() => routeTask({ title: 'any task' })).not.toThrow();
  });

  it('description defaults to empty string when not provided', () => {
    expect(() => routeTask({ title: 'any task', labels: ['P2'] })).not.toThrow();
  });
});

// ── MODEL_TIERS ──────────────────────────────────────────────────────

describe('Issue #743: MODEL_TIERS configuration', () => {
  it('has fast, standard, and power entries', () => {
    expect(MODEL_TIERS).toHaveProperty('fast');
    expect(MODEL_TIERS).toHaveProperty('standard');
    expect(MODEL_TIERS).toHaveProperty('power');
  });

  it('all tier values are non-empty strings', () => {
    for (const [, model] of Object.entries(MODEL_TIERS)) {
      expect(typeof model).toBe('string');
      expect(model.length).toBeGreaterThan(0);
    }
  });
});

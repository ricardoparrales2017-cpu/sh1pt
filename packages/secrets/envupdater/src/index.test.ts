import { describe, it, expect } from 'vitest';
import envupdater from './index.js';

describe('envupdater', () => {
  it('should have the correct adapter id', () => {
    expect(envupdater.id).toBe('secrets-envupdater');
  });

  it('should have a label', () => {
    expect(envupdater.label).toBe('envupdater');
  });

  it('should expose connect, pull, push functions', () => {
    expect(typeof envupdater.connect).toBe('function');
    expect(typeof envupdater.pull).toBe('function');
    expect(typeof envupdater.push).toBe('function');
  });

  it('should have setup steps', () => {
    expect(envupdater.setup).toBeDefined();
    expect(envupdater.setup?.type).toBe('manual');
  });
});

import { describe, expect, it } from 'vitest';
import { getTracer, initTelemetry, withSpan } from '../telemetry.js';

describe('Telemetry', () => {
  it('initializes without error when disabled', () => {
    expect(() => initTelemetry({ serviceName: 'test', enabled: false })).not.toThrow();
  });

  it('getTracer returns a tracer', () => {
    const tracer = getTracer('test-tracer');
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe('function');
  });

  it('withSpan executes function and returns result', async () => {
    const result = await withSpan('test', 'test-span', async () => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('withSpan propagates errors', async () => {
    await expect(
      withSpan('test', 'error-span', async () => {
        throw new Error('test error');
      })
    ).rejects.toThrow('test error');
  });

  it('withSpan passes span to function', async () => {
    let spanReceived = false;
    await withSpan('test', 'span-check', async (span) => {
      spanReceived = span !== undefined;
    });
    expect(spanReceived).toBe(true);
  });
});

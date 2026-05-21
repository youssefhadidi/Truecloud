/** @format */

// USD per million tokens. Cache reads = 10% of input, cache writes = 125% of input.
const PRICING = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
};

const FALLBACK = { input: 3.0, output: 15.0 };

export function getPricing(model) {
  return PRICING[model] || FALLBACK;
}

export function computeCost(model, usage) {
  const p = getPricing(model);
  const input = usage?.input_tokens || 0;
  const output = usage?.output_tokens || 0;
  const cacheRead = usage?.cache_read_input_tokens || 0;
  const cacheWrite = usage?.cache_creation_input_tokens || 0;
  const PER_M = 1_000_000;
  return (
    (input * p.input) / PER_M +
    (output * p.output) / PER_M +
    (cacheWrite * p.input * 1.25) / PER_M +
    (cacheRead * p.input * 0.1) / PER_M
  );
}

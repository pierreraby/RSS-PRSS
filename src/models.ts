import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModelV2 } from '@openrouter/ai-sdk-provider';

// Check API key (injected via secrets.sh)
if (!process.env.OPENROUTER_API_KEY) {
  throw new Error('OPENROUTER_API_KEY not defined. Use secrets.sh or export it manually.');
}

// Init OpenRouter
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

// Grok model with reasoning (for deep analysis, e.g., summaries)
export const g4f_reasoning: LanguageModelV2 = openrouter('x-ai/grok-4-fast', {
  extraBody: {
    temperature: 0.0,
    max_tokens: 500,
    stream: false,
    reasoning: { enabled: true },  // Toggle for chain-of-thought
    provider: {
      order: ['xai'],
      allow_fallbacks: false,
      data_collection: 'deny',
      sort: 'price'
    }
  }
});

// Grok model without reasoning (for fast rankings, low-latency)
export const g4f_no_reasoning: LanguageModelV2 = openrouter('x-ai/grok-4-fast', {
  extraBody: {
    temperature: 0.0,
    max_tokens: 500,
    stream: false,
    reasoning: { enabled: false },
    provider: {
      order: ['xai'],
      allow_fallbacks: false,
      data_collection: 'deny',
      sort: 'price'
    }
  }
});

// Map for CLI (e.g., --model 'grok-no-reasoning' via commander)
export const modelMap = {
  'g4f-reasoning': g4f_reasoning,
  'g4f-no-reasoning': g4f_no_reasoning,
} as const;

// Default for direct usage (import { defaultModel } from './models')
export const defaultModel = g4f_reasoning;
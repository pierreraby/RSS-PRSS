import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModelV2 } from '@openrouter/ai-sdk-provider';

export interface Endpoint {
  name: string;
  model_name?: string;
  context_length?: number;
  pricing?: Record<string, string | number>;
  provider_name?: string;
  tag?: string;
  quantization?: string;
  max_completion_tokens?: number;
  max_prompt_tokens?: number | null;
  supported_parameters?: string[];
  status?: number;
  uptime_last_30m?: number;
  supports_implicit_caching?: boolean;
  [key: string]: any;
}

export interface OpenRouterModelData {
  id?: string;
  name?: string;
  endpoints?: Endpoint[];
  [key: string]: any;
}

export interface OpenRouterResponse {
  data?: OpenRouterModelData;
  endpoints?: Endpoint[];
  [key: string]: any;
}

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

export const gpt120_reasoning: LanguageModelV2 = openrouter('openai/gpt-oss-120b', {
  extraBody: {
    temperature: 0.0,
    max_tokens: 500,
    stream: false,
    reasoning: { effort: 'high' },  // set effort level for reasoning
    provider: {
      order: ['novita/bf16', 'gmicloud/bf16'],
      allow_fallbacks: false,
      data_collection: 'deny',
      sort: 'price'
    }
  }
});

export const gpt120_no_reasoning: LanguageModelV2 = openrouter('openai/gpt-oss-120b', {
  extraBody: {
    temperature: 0.0,
    max_tokens: 500,
    stream: false,
    reasoning: { enabled: false },
    provider: {
      order: ['novita/bf16', 'gmicloud/bf16'],
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
  'gpt120-reasoning': gpt120_reasoning,
  'gpt120-no-reasoning': gpt120_no_reasoning,
} as const;

// Default for direct usage (import { defaultModel } from './models')
export const defaultModel = g4f_reasoning;

// Utility: fetch the smallest provider context window for a given model key.
// Relocated from `src/getContext.ts` so callers can import from `./models`.
export async function getContext(modelKey: string) {
  const model = modelMap[modelKey as keyof typeof modelMap];
  if (!model) {
    throw new Error(`Model "${modelKey}" not found in modelMap.`);
  }

  // The concrete model object provided by the SDK contains a `settings`
  // property at runtime, but the SDK's TypeScript type doesn't expose it.
  // Cast to `any` for this runtime-only inspection to satisfy the compiler.
  const modelProvider = (model as any).settings?.extraBody?.provider;
  const baseUrl = `https://openrouter.ai/api/v1/models/${model.modelId}/endpoints`

  const response = await fetch(baseUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch model details: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as OpenRouterResponse;

  // The API returns an object with a `data` wrapper (e.g. { data: { endpoints: [...] } })
  // or sometimes the endpoints may be at the top level. Accept both formats.
  const endpoints: Endpoint[] | undefined = Array.isArray(data.data?.endpoints)
    ? data.data!.endpoints
    : Array.isArray(data.endpoints)
    ? data.endpoints
    : undefined;

  if (!endpoints) {
    throw new Error('No endpoints array found in model details response');
  }

  // Map the requested provider order to actual context lengths, validating presence.
  const providerContextLengths: number[] = modelProvider.order.map((provider: string) => {
    const endpoint = endpoints.find((ep: Endpoint) => ep.tag === provider);
    if (!endpoint) {
      throw new Error(`No endpoint found for provider: ${provider}`);
    }
    if (typeof endpoint.context_length !== 'number') {
      throw new Error(`Endpoint for provider ${provider} has no numeric context_length`);
    }
    return endpoint.context_length;
  });

  const smallestContextXWindow = Math.min(...providerContextLengths);

  return smallestContextXWindow;
}

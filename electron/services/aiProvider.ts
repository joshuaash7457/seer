import { AIProviderType } from '../../src/types/seer';

export interface AIConfig {
  provider: AIProviderType;
  ollamaBaseUrl: string;
  ollamaModel: string;
  openCodeZenBaseUrl?: string;
  openCodeZenModel?: string;
  cloudModel: string;
  cloudApiKey?: string;
}

export const BUILTIN_OPENCODE_ZEN_MODELS: string[] = [
  'gpt-5.5',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-haiku-4-5',
  'gemini-3.5-flash',
  'gemini-3.1-pro',
  'deepseek-v4.1-flash',
  'glm-5.3',
  'kimi-k2.6',
  'qwen3.6-plus',
  'big-pickle',
  'nemotron-3-ultra-free',
  'mimo-v2.5-free',
];

export function stripOpenCodePrefix(modelId: string): string {
  return (modelId || '').trim().replace(/^opencode\//i, '');
}

export type OpenCodeZenProtocol = 'responses' | 'messages' | 'gemini' | 'chat_completions';

export function resolveOpenCodeZenProtocol(rawModelId: string): OpenCodeZenProtocol {
  const m = stripOpenCodePrefix(rawModelId).toLowerCase();
  if (
    m.startsWith('claude-') ||
    m === 'qwen3.5-plus' ||
    m === 'qwen3.6-plus' ||
    m.startsWith('qwen3.7-') ||
    m === 'qwen3.8-flash'
  ) {
    return 'messages';
  }
  if (m.startsWith('gemini-')) {
    return 'gemini';
  }
  if (m.startsWith('gpt-') || m.startsWith('grok-') || m.startsWith('muse-')) {
    return 'responses';
  }
  return 'chat_completions';
}

export function parseOpenCodeZenModelsPayload(data: unknown): string[] {
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) items = obj.data;
    else if (Array.isArray(obj.models)) items = obj.models;
  }

  const ids: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const rawId = String(rec.id || rec.model || '').trim();
    if (!rawId) continue;
    const cleanId = stripOpenCodePrefix(rawId);
    if (cleanId && !ids.includes(cleanId)) {
      ids.push(cleanId);
    }
  }
  return ids;
}

export async function listOpenCodeZenModels(
  baseUrl?: string,
  apiKey?: string
): Promise<string[]> {
  const cleanUrl = (baseUrl || 'https://opencode.ai/zen/v1').replace(/\/+$/, '');
  const modelsUrl = cleanUrl.endsWith('/models') ? cleanUrl : `${cleanUrl}/models`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  const key = apiKey || process.env.OPENCODE_API_KEY || '';
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  try {
    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return BUILTIN_OPENCODE_ZEN_MODELS;
    }
    const payload = await res.json();
    const parsed = parseOpenCodeZenModelsPayload(payload);
    return parsed.length > 0 ? parsed : BUILTIN_OPENCODE_ZEN_MODELS;
  } catch {
    return BUILTIN_OPENCODE_ZEN_MODELS;
  }
}

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const cleanUrl = (baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const res = await fetch(`${cleanUrl}/api/tags`, {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Ollama server returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models || []).map((m) => m.name);
}

async function callOpenCodeZen(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const apiKey = config.cloudApiKey || process.env.OPENCODE_API_KEY || '';
  const baseUrl = (config.openCodeZenBaseUrl || 'https://opencode.ai/zen/v1').replace(/\/+$/, '');
  const model = stripOpenCodePrefix(config.openCodeZenModel || config.cloudModel || 'gpt-5.5');
  const protocol = resolveOpenCodeZenProtocol(model);

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    authHeaders.Authorization = `Bearer ${apiKey}`;
  }

  if (protocol === 'messages') {
    const res = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        temperature: 0.1,
        system: systemPrompt,
        messages: [{ role: 'user', content: `${userPrompt}\n\nRespond ONLY with raw valid JSON.` }],
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenCode Zen (/messages) error (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text || '';
  }

  if (protocol === 'gemini') {
    const res = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        ...(apiKey ? { 'x-goog-api-key': apiKey } : {}),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenCode Zen (Gemini) error (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (protocol === 'responses') {
    const res = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: `${userPrompt}\n\nRespond ONLY with valid JSON.`,
        text: { format: { type: 'json_object' } },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        output_text?: string;
        output?: Array<{ content?: Array<{ text?: string }> }>;
        choices?: Array<{ message?: { content?: string } }>;
      };
      if (data.output_text) return data.output_text;
      const fromOutput = data.output?.[0]?.content?.[0]?.text;
      if (fromOutput) return fromOutput;
      const fromChoices = data.choices?.[0]?.message?.content;
      if (fromChoices) return fromChoices;
    }
    // Fall through to /chat/completions if /responses is not used by a proxy or model variant
  }

  const chatRes = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${userPrompt}\n\nRespond ONLY with valid JSON.` },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!chatRes.ok) {
    const errText = await chatRes.text();
    throw new Error(
      `OpenCode Zen (/chat/completions) error (${chatRes.status}): ${errText.slice(0, 200)}`
    );
  }
  const chatData = (await chatRes.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return chatData.choices?.[0]?.message?.content || '';
}

export async function generateJsonCompletion<T>(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T> {
  let rawResponseText = '';

  if (config.provider === 'opencode-zen') {
    rawResponseText = await callOpenCodeZen(config, systemPrompt, userPrompt);
  } else if (config.provider === 'ollama') {
    const cleanUrl = (config.ollamaBaseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    const model = config.ollamaModel || 'llama3.1:8b';
    const res = await fetch(`${cleanUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        format: 'json',
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        options: {
          temperature: 0.1,
        },
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama error (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    rawResponseText = data.message?.content || '';
  } else if (config.provider === 'openai') {
    if (!config.cloudApiKey) throw new Error('OpenAI API key is not configured in Settings.');
    const model = config.cloudModel || 'gpt-4o-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.cloudApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    rawResponseText = data.choices?.[0]?.message?.content || '';
  } else if (config.provider === 'anthropic') {
    if (!config.cloudApiKey) throw new Error('Anthropic API key is not configured in Settings.');
    const model = config.cloudModel || 'claude-3-5-sonnet-latest';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.cloudApiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        temperature: 0.1,
        system: systemPrompt,
        messages: [{ role: 'user', content: `${userPrompt}\n\nRespond ONLY with raw valid JSON.` }],
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ text?: string }>;
    };
    rawResponseText = data.content?.[0]?.text || '';
  } else if (config.provider === 'gemini') {
    if (!config.cloudApiKey) throw new Error('Gemini API key is not configured in Settings.');
    const model = config.cloudModel || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(config.cloudApiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    rawResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  return parseJsonFromLlm<T>(rawResponseText);
}

export function parseJsonFromLlm<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
  }
  return JSON.parse(cleaned) as T;
}

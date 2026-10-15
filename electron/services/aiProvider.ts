import { AIProviderType } from '../../src/types/seer';

export interface AIConfig {
  provider: AIProviderType;
  ollamaBaseUrl: string;
  ollamaModel: string;
  cloudModel: string;
  cloudApiKey?: string;
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

export async function generateJsonCompletion<T>(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T> {
  let rawResponseText = '';

  if (config.provider === 'ollama') {
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

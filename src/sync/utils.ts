import type { PluginInput } from '@opencode-ai/plugin';

type Client = PluginInput['client'];

// Unwraps a response object, returning the data or null if an error occurred.
export function unwrapData<T>(response: unknown): T | null {
  if (!response || typeof response !== 'object') return null;
  const maybeError = (response as { error?: unknown }).error;
  if (maybeError) return null;
  if ('data' in response) {
    const data = (response as { data?: T }).data;
    if (data !== undefined) return data;
    return null;
  }
  return response as T;
}

// Extracts text content from an AI response object.
export function extractTextFromResponse(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;

  const parts =
    (response as { parts?: Array<{ type: string; text?: string }> }).parts ??
    (response as { info?: { parts?: Array<{ type: string; text?: string }> } }).info?.parts ??
    [];

  const textPart = parts.find((part) => part.type === 'text' && part.text);
  return textPart?.text?.trim() ?? null;
}

// Falls back to the main model if small_model is not configured.
export async function resolveSmallModel(
  client: Client
): Promise<{ providerID: string; modelID: string } | null> {
  try {
    const response = await client.config.get();
    const config = unwrapData<{ small_model?: string; model?: string }>(response);
    if (!config) return null;

    const modelValue = config.small_model ?? config.model;
    if (!modelValue) return null;

    const [providerID, modelID] = modelValue.split('/', 2);
    if (!providerID || !modelID) return null;
    return { providerID, modelID };
  } catch {
    return null;
  }
}

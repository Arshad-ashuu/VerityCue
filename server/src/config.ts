import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

// The .env lives at the repo root, not in server/, so resolve it relative to this file.
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Keys are optional: when absent we authenticate with Entra ID via DefaultAzureCredential. */
export const config = {
  port: Number(process.env.PORT ?? 3978),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  openAi: {
    endpoint: required('AZURE_OPENAI_ENDPOINT'),
    apiKey: optional('AZURE_OPENAI_API_KEY'),
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21',
    chatDeployment: required('AZURE_OPENAI_CHAT_DEPLOYMENT'),
    detectDeployment:
      optional('AZURE_OPENAI_DETECT_DEPLOYMENT') ?? required('AZURE_OPENAI_CHAT_DEPLOYMENT'),
    embeddingDeployment: required('AZURE_OPENAI_EMBEDDING_DEPLOYMENT'),
  },
  speech: {
    key: optional('AZURE_SPEECH_KEY'),
    region: required('AZURE_SPEECH_REGION'),
    /** Required for keyless Speech auth: the full ARM id of the Speech / AI Services resource. */
    resourceId: optional('AZURE_SPEECH_RESOURCE_ID'),
  },
  /** How many recent utterances are kept as context per meeting. */
  transcriptWindow: 12,
};

export const COGNITIVE_SERVICES_SCOPE = 'https://cognitiveservices.azure.com/.default';

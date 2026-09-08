import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { AzureOpenAI } from 'openai';
import { COGNITIVE_SERVICES_SCOPE, config } from './config.js';

/** Shared so the Speech token route reuses the same cached credential. */
export const credential = new DefaultAzureCredential();

/**
 * Caches the bearer token until it nears expiry. Without this, DefaultAzureCredential
 * falls through to the Azure CLI and spawns `az` on every request — about 3s each.
 */
export const getAccessToken = getBearerTokenProvider(credential, COGNITIVE_SERVICES_SCOPE);

export const usingEntraId = !config.openAi.apiKey;

export const openai = new AzureOpenAI({
  endpoint: config.openAi.endpoint,
  apiVersion: config.openAi.apiVersion,
  ...(config.openAi.apiKey
    ? { apiKey: config.openAi.apiKey }
    : { azureADTokenProvider: getAccessToken }),
});

export const ANSWER_MODEL = config.openAi.chatDeployment;
/** A small model is plenty for classification and keeps the hot path fast. */
export const DETECT_MODEL = config.openAi.detectDeployment;
export const EMBEDDING_MODEL = config.openAi.embeddingDeployment;

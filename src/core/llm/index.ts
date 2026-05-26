import { ClaudeAdapter } from "./claude";
import { ClaudeCliAdapter } from "./claude-cli";
import { ClaudeOAuthAdapter } from "./claude-oauth";
import { GeminiAdapter } from "./gemini";
import { OllamaAdapter } from "./ollama";
import { OpenAIAdapter } from "./openai";
import { llmRegistry } from "./registry";

llmRegistry.register(new ClaudeAdapter());
llmRegistry.register(new ClaudeOAuthAdapter());
llmRegistry.register(new ClaudeCliAdapter());
llmRegistry.register(new OpenAIAdapter());
llmRegistry.register(new GeminiAdapter());
llmRegistry.register(new OllamaAdapter());

export type { LLMAdapter, LLMProfile, LLMRequest, LLMResponse } from "@/types/llm";
export { ClaudeCliAdapter } from "./claude-cli";
export * from "./oauth";
export { llmRegistry };

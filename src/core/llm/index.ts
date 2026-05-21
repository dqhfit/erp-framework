import { llmRegistry } from "./registry";
import { ClaudeAdapter } from "./claude";
import { ClaudeOAuthAdapter } from "./claude-oauth";
import { ClaudeCliAdapter } from "./claude-cli";
import { OpenAIAdapter } from "./openai";
import { GeminiAdapter } from "./gemini";
import { OllamaAdapter } from "./ollama";

llmRegistry.register(new ClaudeAdapter());
llmRegistry.register(new ClaudeOAuthAdapter());
llmRegistry.register(new ClaudeCliAdapter());
llmRegistry.register(new OpenAIAdapter());
llmRegistry.register(new GeminiAdapter());
llmRegistry.register(new OllamaAdapter());

export { llmRegistry };
export * from "./oauth";
export { ClaudeCliAdapter } from "./claude-cli";
export type { LLMAdapter, LLMRequest, LLMResponse, LLMProfile } from "@/types/llm";

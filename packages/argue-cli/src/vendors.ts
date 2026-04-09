export interface VendorPreset {
  protocol: "openai-compatible" | "anthropic-compatible";
  apiKeyEnv?: string;
  baseUrl?: string;
}

export const VENDOR_PRESETS: Record<string, VendorPreset> = {
  anthropic: {
    protocol: "anthropic-compatible",
    apiKeyEnv: "ANTHROPIC_API_KEY"
  },
  openai: {
    protocol: "openai-compatible",
    apiKeyEnv: "OPENAI_API_KEY"
  },
  groq: {
    protocol: "openai-compatible",
    apiKeyEnv: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1"
  },
  together: {
    protocol: "openai-compatible",
    apiKeyEnv: "TOGETHER_API_KEY",
    baseUrl: "https://api.together.xyz/v1"
  },
  mistral: {
    protocol: "openai-compatible",
    apiKeyEnv: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1"
  },
  deepseek: {
    protocol: "openai-compatible",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com/v1"
  }
};

export function getVendorNames(): string[] {
  return Object.keys(VENDOR_PRESETS);
}

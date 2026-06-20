declare module "tokenshrink" {
  interface CompressOptions {
    domain?: "auto" | "code" | "medical" | "legal" | "business";
    forceStrategy?: string;
    tokenizer?: (text: string) => number;
  }

  interface CompressResult {
    compressed: string;
    rosetta: string;
    compressedBody: string;
    original: string;
    stats: {
      originalWords: number;
      compressedWords: number;
      rosettaWords: number;
      totalCompressedWords: number;
      originalTokens: number;
      compressedTokens: number;
      rosettaTokens: number;
      totalCompressedTokens: number;
      ratio: number;
      tokensSaved: number;
      dollarsSaved: number;
      strategy: string;
      domain: string;
      confidence: number;
      replacementCount: number;
      patternCount: number;
      tokenizerUsed: string;
    };
  }

  export function compress(text: string, options?: CompressOptions): CompressResult;
}

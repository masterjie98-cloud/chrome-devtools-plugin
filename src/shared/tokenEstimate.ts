export function estimateTextTokens(value: string): number {
  let asciiChars = 0;
  let nonAsciiChars = 0;
  for (const character of value) {
    if (character.codePointAt(0)! <= 0x7f) {
      asciiChars += 1;
    } else {
      nonAsciiChars += 1;
    }
  }
  return Math.ceil(asciiChars / 4 + nonAsciiChars + 1);
}

export function estimateTokensFromCharacterCount(
  characterCount: number,
  sampleText = "",
): number {
  const normalizedCount = Math.max(0, Math.floor(characterCount));
  if (!sampleText) {
    return Math.ceil(normalizedCount / 4);
  }
  const sampleCharacters = Array.from(sampleText).length;
  if (sampleCharacters === 0) {
    return Math.ceil(normalizedCount / 4);
  }
  const sampleTokens = estimateTextTokens(sampleText);
  return Math.ceil((normalizedCount * sampleTokens) / sampleCharacters);
}

export function formatEstimatedTokenCount(tokenCount: number): string {
  const normalized = Math.max(0, Math.round(tokenCount));
  if (normalized >= 1_000_000) {
    return `${formatCompactNumber(normalized / 1_000_000)}m tokens`;
  }
  if (normalized >= 1_000) {
    return `${formatCompactNumber(normalized / 1_000)}k tokens`;
  }
  return `${normalized} tokens`;
}

function formatCompactNumber(value: number): string {
  return value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

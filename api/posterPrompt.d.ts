export interface BuildPosterPromptInput {
  genre: string;
  mood: string;
  lighting: string;
  composition: string;
  title: string;
  subtitle?: string;
}

export function buildPosterPrompt(input: BuildPosterPromptInput): string;
export function buildSafePosterPrompt(input: BuildPosterPromptInput): string;
export function buildStandalonePosterPrompt(input: BuildPosterPromptInput): string;

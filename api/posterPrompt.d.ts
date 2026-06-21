export interface BuildPosterPromptInput {
  genre: string;
  mood: string;
  lighting: string;
  composition: string;
  title: string;
  subtitle?: string;
}

export function buildPosterPrompt(input: BuildPosterPromptInput): string;

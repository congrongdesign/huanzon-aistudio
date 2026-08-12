export type GenerationCase = {
  id: string;
  category: string;
  title: string;
  description: string;
  prompt: string;
  aspectRatio: string;
  count: number;
  tags?: string[];
  stylePackId?: string;
  referenceHint?: string;
  coverImage?: string;
  sourceFileName?: string;
  slideCount?: number;
  slides?: Array<{
    id: string;
    pageNumber: number;
    title: string;
    imageUrl: string;
    fileName?: string;
  }>;
  importWarnings?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type GenerationStylePack = {
  id: string;
  name: string;
  category: string;
  description: string;
  promptSuffix: string;
  palette: string[];
  tags: string[];
  referenceImages?: string[];
  trainingStatus?: "idle" | "trained";
  trainingSummary?: string;
  trainedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export const GENERATION_STYLE_PACKS: GenerationStylePack[] = [];

export const GENERATION_CASES: GenerationCase[] = [];

export function getGenerationStylePack(id?: string | null) {
  if (!id) return null;
  return GENERATION_STYLE_PACKS.find((pack) => pack.id === id) || null;
}

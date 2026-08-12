export type PlatformSkillId = string;

export type PlatformSkillCard = {
  id: PlatformSkillId;
  name: string;
  subtitle: string;
  description: string;
  sourceUrl: string;
  sourceRepo: string;
  category: 'ppt' | 'image' | 'workflow';
  statusLabel: string;
  inputTypes: string[];
  outputTypes: string[];
  highlights: string[];
  limitations: string[];
  runHint: string;
  defaultPrompt: string;
  customSkillSteps: Array<{ type: string; config: Record<string, unknown>; id: string }>;
};

export const PLATFORM_SKILL_LIBRARY: PlatformSkillCard[] = [];

export function getPlatformSkill(id: string): PlatformSkillCard | null {
  return PLATFORM_SKILL_LIBRARY.find((skill) => skill.id === id) || null;
}

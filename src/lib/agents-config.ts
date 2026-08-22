export type AssistantType = 'permit' | 'student' | 'lawyer';

export const ALL_AGENTS: AssistantType[] = ['permit', 'student', 'lawyer'];

/**
 * Agents that are switched off for now. Their cards and tabs stay visible but
 * locked ("Disabled") instead of being removed, so the lineup still reads the
 * same when they are turned back on.
 */
export const DISABLED_AGENTS: AssistantType[] = ['permit', 'lawyer'];

/** Where everything lands while the others are disabled. */
export const DEFAULT_AGENT: AssistantType = 'student';

export const isAgentDisabled = (id?: string | null): boolean =>
  !!id && DISABLED_AGENTS.includes(id as AssistantType);

/** Coerces a stored or incoming agent id to one that is still enabled. */
export const resolveAgent = (id?: string | null): AssistantType =>
  id && ALL_AGENTS.includes(id as AssistantType) && !isAgentDisabled(id)
    ? (id as AssistantType)
    : DEFAULT_AGENT;

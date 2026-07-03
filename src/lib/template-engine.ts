/**
 * template-engine.ts
 * Fills {name}, {district}, {university}, {issue}, {timeframe} in response strings.
 * Port of backend/smart_router/template_engine.py
 */

export interface TemplateVars {
  name?: string;       // user's name or "there"
  district?: string;   // Istanbul district
  university?: string; // university name
  issue?: string;      // legal/permit issue
  timeframe?: string;  // e.g. "2-3 weeks"
  [key: string]: string | undefined;
}

/** Fill {placeholder} tokens safely. Missing keys → empty string. */
export function render(template: string, vars: TemplateVars): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

/** Build a variables dict from known context */
export function buildVars(
  userName?: string,
  district?: string,
  university?: string,
  issue?: string,
): TemplateVars {
  return {
    name: userName || 'there',
    district: district || '',
    university: university || '',
    issue: issue || '',
  };
}

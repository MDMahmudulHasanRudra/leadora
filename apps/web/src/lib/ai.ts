import { ApiError } from './api-client';

export const ACTION_LABELS: Record<string, string> = {
  CALL_NOW: 'Call now',
  SEND_PRICING: 'Send pricing',
  OFFER_DEMO: 'Offer a demo',
  FOLLOW_UP_LATER: 'Follow up later',
  NURTURE: 'Nurture',
  ESCALATE_TO_MANAGER: 'Escalate to a manager',
  DISQUALIFY: 'Disqualify',
};

const SETTINGS_FIXABLE = new Set(['AI_DISABLED', 'AI_FEATURE_DISABLED', 'AI_NOT_CONFIGURED', 'AI_BUDGET_EXCEEDED']);

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * AI errors in plain words, plus whether an admin can fix it in Settings → AI.
 * `feature` names the switched-off feature, e.g. "Lead analysis".
 */
export function explainAiError(err: unknown, canConfigure: boolean, feature: string): { message: string; settingsLink: boolean } {
  if (!(err instanceof ApiError)) return { message: 'The AI request could not be completed. Please try again.', settingsLink: false };
  const where = canConfigure ? ' in Settings → AI' : '. Ask an admin';
  const message = (() => {
    switch (err.code) {
      case 'AI_PLATFORM_DISABLED':
        return 'AI is switched off for this installation. Your server administrator can enable it (ENABLE_AI).';
      case 'AI_DISABLED':
        return `AI is turned off${canConfigure ? '. Turn it on in Settings → AI.' : '. Ask an admin to turn it on.'}`;
      case 'AI_FEATURE_DISABLED':
        return `${feature} is turned off${where}.`;
      case 'AI_NOT_CONFIGURED':
        return canConfigure ? err.message : `${err.message} (ask an admin)`;
      case 'AI_BUDGET_EXCEEDED':
        return `This month’s AI budget is used up${where}.`;
      case 'AI_INVALID_OUTPUT':
        return 'The AI returned an unusable answer twice, so nothing was changed. Try again.';
      default:
        return err.message;
    }
  })();
  return { message, settingsLink: canConfigure && SETTINGS_FIXABLE.has(err.code) };
}

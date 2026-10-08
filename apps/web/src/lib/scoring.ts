/** Short labels for score breakdowns; the settings page gets full labels from the API. */
export const RULE_SHORT_LABELS: Record<string, string> = {
  business_email: 'Business email',
  has_phone: 'Phone on file',
  budget_stated: 'Budget stated',
  product_inquiry: 'Messaged us',
  pricing_inquiry: 'Asked about pricing',
  demo_request: 'Asked for a demo',
  replied_within_24h: 'Replied within 24h',
  no_response_after_followups: 'No response to follow-ups',
};

export const temperatureLabel = (t: string | null) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : '');

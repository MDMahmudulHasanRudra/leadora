import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combineScore, computeRuleScore, DEFAULT_SCORING, type LeadFacts, resolveScoringConfig, temperatureFor } from './rules';

const H = 3_600_000;
const t0 = new Date('2026-10-01T10:00:00Z').getTime();
const at = (hours: number) => new Date(t0 + hours * H);

const facts = (over: Partial<LeadFacts> = {}): LeadFacts => ({
  email: null,
  phone: null,
  budget: null,
  notes: null,
  messages: [],
  completedFollowupsAt: [],
  ...over,
});

const keys = (f: LeadFacts) => computeRuleScore(f, DEFAULT_SCORING).matched.map((m) => m.key);

test('an empty lead scores zero', () => {
  assert.deepEqual(computeRuleScore(facts(), DEFAULT_SCORING), { score: 0, matched: [] });
});

test('business email counts, free-mail does not', () => {
  assert.deepEqual(keys(facts({ email: 'ceo@acme.com.bd' })), ['business_email']);
  assert.deepEqual(keys(facts({ email: 'someone@gmail.com' })), []);
  assert.deepEqual(keys(facts({ email: 'someone@YAHOO.com' })), []);
});

test('pricing and demo intent are read from inbound messages and notes, in English and Bangla', () => {
  const inbound = (text: string) => ({ direction: 'INBOUND' as const, at: at(0), text });
  assert.deepEqual(keys(facts({ messages: [inbound('What is the price for 300 units?')] })), ['product_inquiry', 'pricing_inquiry']);
  assert.deepEqual(keys(facts({ messages: [inbound('দাম কত?')] })), ['product_inquiry', 'pricing_inquiry']);
  assert.deepEqual(keys(facts({ notes: 'Asked for a demo next week' })), ['demo_request']);
  // Our own outbound pricing does not count as the customer's intent.
  assert.deepEqual(keys(facts({ messages: [{ direction: 'OUTBOUND', at: at(0), text: 'Here is our price list' }] })), []);
});

test('a reply within 24h of our message scores; a slow reply does not', () => {
  const quick = facts({
    messages: [
      { direction: 'OUTBOUND', at: at(0), text: 'Hello' },
      { direction: 'INBOUND', at: at(5), text: 'Hi' },
    ],
  });
  assert.ok(keys(quick).includes('replied_within_24h'));
  const slow = facts({
    messages: [
      { direction: 'OUTBOUND', at: at(0), text: 'Hello' },
      { direction: 'INBOUND', at: at(30), text: 'Hi' },
    ],
  });
  assert.ok(!keys(slow).includes('replied_within_24h'));
});

test('two or more unanswered touches since the last reply count against the lead', () => {
  const f = facts({
    messages: [
      { direction: 'INBOUND', at: at(0), text: 'interested' },
      { direction: 'OUTBOUND', at: at(1), text: 'details' },
    ],
    completedFollowupsAt: [at(-5), at(48)],
  });
  const r = computeRuleScore(f, DEFAULT_SCORING);
  assert.ok(r.matched.some((m) => m.key === 'no_response_after_followups' && m.points === -15));
});

test('score is clamped to 0..100 and respects disabled rules and custom points', () => {
  const config = resolveScoringConfig({ rules: { business_email: { enabled: true, points: 90 }, has_phone: { enabled: false, points: 5 }, budget_stated: { enabled: true, points: 30 } } });
  assert.equal(computeRuleScore(facts({ email: 'a@acme.com', phone: '+8801711000000', budget: 5000 }), config).score, 100);
  const negative = resolveScoringConfig({ rules: { no_response_after_followups: { enabled: true, points: -40 } } });
  assert.equal(computeRuleScore(facts({ completedFollowupsAt: [at(1), at(2)] }), negative).score, 0);
});

test('final score blends rule and AI scores by weight; no AI score means rules only', () => {
  assert.equal(combineScore(40, null, DEFAULT_SCORING), 40);
  assert.equal(combineScore(40, 90, DEFAULT_SCORING), 65);
  assert.equal(combineScore(40, 90, resolveScoringConfig({ ruleWeight: 1, aiWeight: 3 })), 78);
  assert.equal(combineScore(40, 90, resolveScoringConfig({ aiWeight: 0 })), 40);
});

test('temperature uses the organization thresholds', () => {
  assert.equal(temperatureFor(80, DEFAULT_SCORING), 'HOT');
  assert.equal(temperatureFor(79, DEFAULT_SCORING), 'WARM');
  assert.equal(temperatureFor(49, DEFAULT_SCORING), 'COLD');
  assert.equal(temperatureFor(70, resolveScoringConfig({ hotThreshold: 70, warmThreshold: 40 })), 'HOT');
});

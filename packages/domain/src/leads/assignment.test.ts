import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ruleMatches } from './assignment';

const facts = { sourceType: 'WEBSITE', country: 'BD', tags: ['VIP', 'Dhaka'], priority: 'HIGH' };

test('an empty condition set matches everything', () => {
  assert.equal(ruleMatches({ conditions: {} }, facts), true);
});

test('every present condition must match (AND), any value within one (OR)', () => {
  assert.equal(ruleMatches({ conditions: { sourceTypes: ['CSV', 'WEBSITE'], countries: ['BD'] } }, facts), true);
  assert.equal(ruleMatches({ conditions: { sourceTypes: ['WEBSITE'], countries: ['IN'] } }, facts), false);
});

test('tag matching is case-insensitive and needs only one tag', () => {
  assert.equal(ruleMatches({ conditions: { tags: ['vip', 'chattogram'] } }, facts), true);
  assert.equal(ruleMatches({ conditions: { tags: ['wholesale'] } }, facts), false);
});

test('a country condition does not match a lead without a country', () => {
  assert.equal(ruleMatches({ conditions: { countries: ['BD'] } }, { sourceType: 'CSV' }), false);
});

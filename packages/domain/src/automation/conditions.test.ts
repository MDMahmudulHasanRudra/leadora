import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateConditions, renderTemplate } from './conditions';

const facts = {
  'lead.temperature': 'HOT',
  'lead.score': 82,
  'lead.source': 'WEBSITE',
  'lead.tags': ['VIP', 'wholesale'],
  'lead.owner': null,
  'lead.budget': 50000,
  'message.text': 'What is your PRICE for 300 units?',
};

test('every condition must hold (AND), case-insensitively', () => {
  assert.equal(evaluateConditions([], facts), true);
  assert.equal(
    evaluateConditions(
      [
        { field: 'lead.temperature', op: 'eq', value: 'hot' },
        { field: 'lead.score', op: 'gte', value: 80 },
        { field: 'lead.source', op: 'in', value: ['WEBSITE', 'FACEBOOK'] },
      ],
      facts,
    ),
    true,
  );
  assert.equal(evaluateConditions([{ field: 'lead.temperature', op: 'eq', value: 'HOT' }, { field: 'lead.score', op: 'gt', value: 90 }], facts), false);
});

test('operators cover lists, numbers, text, tags and emptiness', () => {
  const ok = (field: string, op: string, value?: unknown) => evaluateConditions([{ field, op, value }], facts);
  assert.equal(ok('lead.source', 'not_in', 'EMAIL,MANUAL'), true);
  assert.equal(ok('lead.budget', 'lt', 100000), true);
  assert.equal(ok('message.text', 'contains', 'price'), true);
  assert.equal(ok('message.text', 'not_contains', 'refund'), true);
  assert.equal(ok('lead.tags', 'contains', 'vip'), true);
  assert.equal(ok('lead.tags', 'contains', 'retail'), false);
  assert.equal(ok('lead.owner', 'is_empty'), true);
  assert.equal(ok('lead.score', 'is_not_empty'), true);
  // A missing number never satisfies a comparison.
  assert.equal(ok('lead.country', 'gt', 1), false);
});

test('templates fill known values and blank unknown ones', () => {
  assert.equal(renderTemplate('New hot lead {{ lead.fullName }} ({{lead.score}}){{nope}}', { 'lead.fullName': 'Tanha', 'lead.score': 88 }), 'New hot lead Tanha (88)');
});

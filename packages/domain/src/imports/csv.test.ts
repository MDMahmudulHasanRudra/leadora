import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainError } from '../errors';
import { escapeCsvCell, importMappingSchema, inspectCsv, suggestMapping, toCsv } from './csv';

test('escapeCsvCell neutralizes spreadsheet formulas', () => {
  assert.equal(escapeCsvCell('=SUM(A1)'), `"'=SUM(A1)"`);
  assert.equal(escapeCsvCell('+880171'), `"'+880171"`);
  assert.equal(escapeCsvCell('-1'), `"'-1"`);
  assert.equal(escapeCsvCell('@cmd'), `"'@cmd"`);
  assert.equal(escapeCsvCell('say "hi"'), `"say ""hi"""`);
});

test('toCsv quotes every cell', () => {
  assert.equal(toCsv([['a', 'b,c']]), '"a","b,c"\r\n');
});

test('suggestMapping matches common header names case-insensitively', () => {
  assert.deepEqual(suggestMapping(['Full Name', 'Mobile Number', 'EMAIL', 'Designation', 'Whatever']), {
    fullName: 'Full Name',
    email: 'EMAIL',
    phone: 'Mobile Number',
    jobTitle: 'Designation',
  });
});

test('inspectCsv rejects duplicate headers and strips a BOM', () => {
  assert.deepEqual(inspectCsv('﻿Name,Email\nA,a@x.test\n').headers, ['Name', 'Email']);
  assert.throws(() => inspectCsv('Name,name\nA,B\n'), (e: unknown) => e instanceof DomainError && e.code === 'INVALID_CSV');
});

test('importMappingSchema requires a name and a contact column', () => {
  assert.equal(importMappingSchema.safeParse({ fullName: 'Name', phone: 'Mobile' }).success, true);
  assert.equal(importMappingSchema.safeParse({ fullName: 'Name' }).success, false);
  assert.equal(importMappingSchema.safeParse({ email: 'Email' }).success, false);
  assert.equal(importMappingSchema.safeParse({ fullName: 'Name', email: 'E', bogus: 'X' }).success, false);
});

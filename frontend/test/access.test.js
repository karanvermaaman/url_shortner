import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLimit,accessStatus,passwordDigest} from '../src/access.js';
test('limits are optional or bounded positive integers',()=>{assert.equal(parseLimit(''),null);assert.equal(parseLimit('3'),3);for(const value of ['0','-2','1.5','abc','1000001'])assert.throws(()=>parseLimit(value));});
test('expiry and exhausted limits block access',()=>{assert.equal(accessStatus({expires:'2020-01-01'}),'expired');assert.equal(accessStatus({maxAccesses:2,accesses:2}),'exhausted');assert.equal(accessStatus({maxAccesses:2,accesses:1}),'available');assert.equal(accessStatus({}),'available');});
test('cooldown allows access at the boundary',()=>{const link={lastAccess:new Date(1000).toISOString(),cooldownSeconds:30};assert.equal(accessStatus(link,30999),'cooldown');assert.equal(accessStatus(link,31000),'available');});
test('password digest is repeatable and distinguishes passwords and salts',async()=>{const a=await passwordDigest('secret123','salt');assert.equal(a,await passwordDigest('secret123','salt'));assert.notEqual(a,await passwordDigest('wrong','salt'));assert.notEqual(a,await passwordDigest('secret123','other'));});

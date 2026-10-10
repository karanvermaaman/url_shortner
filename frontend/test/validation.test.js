import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateUrl} from '../src/validation.js';
test('valid URLs preserve query and fragments',()=>assert.equal(validateUrl(' https://example.com/a?q=1#hi '),'https://example.com/a?q=1#hi'));
test('unsafe protocols and credential URLs are rejected',()=>{for(const url of ['javascript:alert(1)','data:text/html,test','file:///tmp/x','https://user:pass@example.com','not a url','http://localhost'])assert.throws(()=>validateUrl(url));});
test('excessive URL length is rejected',()=>assert.throws(()=>validateUrl('https://example.com/'+ 'a'.repeat(4096))));

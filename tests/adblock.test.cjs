const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('the adblock module merges the SMZDM filters and omits the JD CDN rule', () => {
  const module = fs.readFileSync(path.join(__dirname, '../modules/adblock.sgmodule'), 'utf8');
  const rules = module.match(/^(?:DOMAIN-SUFFIX|DOMAIN),.*$/gm);

  assert.equal(rules.length, 14);
  assert(rules.every(rule => rule.endsWith(',REJECT')));
  assert.deepEqual(rules.slice(0, 4), [
    'DOMAIN-SUFFIX,pangolin-sdk-toutiao.com,REJECT',
    'DOMAIN-SUFFIX,pangolin-sdk-toutiao1.com,REJECT',
    'DOMAIN-SUFFIX,pangolin-sdk-toutiao-b.com,REJECT',
    'DOMAIN,sdk.adhuanxiao.com,REJECT'
  ]);
  assert(!module.includes('dgstatic.jd.com'));

  assert(module.includes('[Map Local]\n'));
  const scripts = module.split('\n').filter(line => line.includes('script-path='));
  assert.equal(scripts.length, 13);
  assert(scripts.every(line => line.includes('type=http-response,') && line.includes('/Scripts/smzdm/')));
  assert.equal(new Set(scripts.map(line => line.split(' = ', 1)[0])).size, scripts.length);

  const hostname = module.match(/^hostname = %APPEND% (.+)$/m)[1];
  assert.deepEqual(hostname.split(', '), [
    'homepage-api.smzdm.com', 'haojia-api.smzdm.com', 'app-api.smzdm.com', 'user-api.smzdm.com',
    'article-api.smzdm.com', 'qianbao.smzdm.com', 's-api.smzdm.com', 'haojia.m.smzdm.com'
  ]);
});

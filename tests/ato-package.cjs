const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist/ato/babelian');
const manifest=JSON.parse(fs.readFileSync(path.join(out,'babelian-module.json'),'utf8'));
assert.equal(manifest.version,require('../package.json').version);assert.equal(manifest.module,'babelian');
assert.equal(Object.keys(manifest.files).length,65);assert.equal(manifest.storage.documentVersion,1);assert.equal(manifest.storage.mappingVersion,2);
assert.equal(manifest.optionalTranslation.sendsImages,false);assert.equal(manifest.optionalTranslation.credentials,'omit');
for(const [file,record] of Object.entries(manifest.files)){
  assert(/^(index\.html|assets\/[a-z0-9-]+\.png)$/.test(file));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex'),record.sha256);
}
const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
for(const id of ['ocr-preview','ocr-rebox','ocr-inspection','ocr-results','ocr-translate-toggle','ocr-translate-panel'])assert(html.includes('id="'+id+'"'));
assert(!html.includes('data:image/png;base64,'));assert(html.includes('Copyright (c) 2017 Derek Anderson'));
assert(html.indexOf('id="ocr-inspection"')<html.indexOf('id="ocr-results"'));
assert(html.includes('"mode":"ato"'));assert(html.includes('credentials:\'omit\''));
console.log('PASS ATO package: all latest features, unchanged storage contract, opt-in text-only translation, code/artwork separation, versioned 65-file integrity manifest.');

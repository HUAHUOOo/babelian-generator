// Explicit maintainer-only data refresh; normal build/test never uses the network.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
async function get(url){
 const response=await fetch(url,{headers:{'User-Agent':'babelian-generator-vocabulary-import'},signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error(`Vocabulary download failed: HTTP ${response.status}`);
 return Buffer.from(await response.arrayBuffer());
}
(async()=>{
 const ref=process.argv[2];if(!ref)throw Error('Pass a reviewed upstream commit SHA or master explicitly.');
 const commit=JSON.parse((await get('https://api.github.com/repos/keredson/wordninja/commits/'+encodeURIComponent(ref))).toString()).sha;
 if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid upstream revision');
 const base=`https://raw.githubusercontent.com/keredson/wordninja/${commit}/`;
 const [data,license]=await Promise.all([get(base+'wordninja/wordninja_words.txt.gz'),get(base+'LICENSE')]);
 const words=zlib.gunzipSync(data).toString();if(words.length<100000||!license.toString().includes('MIT License'))throw Error('Unexpected vocabulary format or license');
 const root=path.resolve(__dirname,'../src');
 fs.writeFileSync(path.join(root,'english-words.txt.gz'),data);fs.writeFileSync(path.join(root,'wordninja-LICENSE.txt'),license);
 const provenance={upstream:'https://github.com/keredson/wordninja',commit,source:base+'wordninja/wordninja_words.txt.gz',sha256:crypto.createHash('sha256').update(data).digest('hex'),license:'MIT',description:'Frequency-ranked English word data. No upstream executable code imported.'};
 fs.writeFileSync(path.join(root,'english-words-source.json'),JSON.stringify(provenance,null,2)+'\n');
 console.log(provenance);
})().catch(error=>{console.error(error.message);process.exitCode=1;});

const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
const start=src.indexOf('var data = ')+'var data = '.length;
let depth=0,i=start,inStr=false,esc=false,q='';
for(;i<src.length;i++){const c=src[i];
 if(inStr){ if(esc){esc=false;continue} if(c==='\\'){esc=true;continue} if(c===q){inStr=false} continue}
 if(c==='"'||c==="'"){inStr=true;q=c;continue}
 if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0){i++;break}}}
const data=JSON.parse(src.slice(start,i));
fs.writeFileSync('gtm-data.json',JSON.stringify(data,null,1));
const r=data.resource;
console.log(Object.keys(r));
const show=(x)=>JSON.stringify(x);
console.log('macros',r.macros.length,'tags',r.tags.length,'predicates',r.predicates.length,'rules',r.rules.length);
r.macros.forEach((m,i)=>{ if(['__aev','__v','__e','__u','__c','__f'].includes(m.function)) console.log('M'+i,show(m).slice(0,200));});

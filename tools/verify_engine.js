const fs=require('fs');const P=require('../js/engine.js');
const data=JSON.parse(fs.readFileSync(process.argv[2]||'data/p1.json','utf8'));
const wb=new P.Workbook(data); wb.debug=true;
let n=0,bad=0,per={};const samples=[];
for(const sh of wb.sheets){for(const [k,cell] of sh.cells){if(!cell.f)continue;n++;
  let v=wb.get(sh,cell.r,cell.c); if(P.isRange(v)) v=wb.scalar(v);
  let c=cell.cached; 
  const norm=x=>x===undefined||x===null||x===''?'':(x instanceof P.XErr?x.code:(typeof x==='number'?Math.round(x*1e9)/1e9:x));
  let a=norm(v), b=norm(c);
  if(typeof b==='boolean'&&typeof a!=='boolean'){}
  if(a!==b){bad++;per[sh.name]=(per[sh.name]||0)+1; if(samples.length<25)samples.push([sh.name,P.numToCol(cell.c)+cell.r,cell.f.slice(0,110),a,b]);}
}}
console.log('formulas',n,'mismatch',bad);console.log(per);for(const s of samples)console.log(JSON.stringify(s));

#!/usr/bin/env node
/**
 * fix_edamame_legume.js — Hugo audit (pruebas vecinas).
 * "Edamame" y "Mixbeans edamame & soja" estaban en dairy (other_dairy/
 * aged_cheese) → daban basura (Mini york, Relleno fajitas). Edamame es soja
 * verde = legumbre. Reclasificar a legumes/carbs. Idempotente.
 */
const fs=require("fs"),path=require("path");
const DB=path.join(__dirname,"..","database.json");
const APPLY=process.argv.includes("--apply");
const db=JSON.parse(fs.readFileSync(DB,"utf8"));
const t=db.filter(f=>/edamame/i.test(f.name||"")&&f.category==="dairy");
for(const f of t){
  if(f.subgroup_prev===undefined)f.subgroup_prev=f.subgroup||null;
  if(f.category_prev===undefined)f.category_prev=f.category||null;
  if("dairy_subfamily" in f) delete f.dairy_subfamily;
  f.subgroup="legumes"; f.category="carbs"; f.clean_carb=true;
}
console.log(`edamame reclasificados: ${t.length}`);
t.forEach(f=>console.log("  -> legumes/carbs  "+f.name));
if(APPLY&&t.length){fs.copyFileSync(DB,DB+".preedamame.bak");fs.writeFileSync(DB,JSON.stringify(db,null,2));console.log("APPLIED");}else console.log("DRY-RUN");

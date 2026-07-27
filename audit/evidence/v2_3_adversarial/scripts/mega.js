const {buildEngine,familyFirst,visibleOrder}=require(process.env.SP+"/uiharness.js");
const fs=require("fs");
const Q=JSON.parse(fs.readFileSync(process.env.SP+"/queries.json","utf8"));
const RAW=/\b(crud[oa]s?|fresc[oa]s?|sin\s+cocer|en\s+seco|sec[oa]s?)\b/i;
const COOKED=/\b(cocid[oa]s?|hervid[oa]s?|asad[oa]s?|plancha|parrilla|frit[oa]s?|guisad[oa]s?|estofad[oa]s?|al\s+horno|al\s+vapor|escalfad[oa]s?|tostad[oa]s?|salteado|rehogad[oa]s?)\b/i;
const FOREIGN=/\b(amb|beguda|naturalny|noix|houmous|gaspacho|olives|quefir|with|and|milk|cheese|yogurt natural|macarrons|espirals|vegetals)\b/i;
const SEEDOIL=/aceite de (palma|algod[oó]n|germen|soja|girasol|colza|coco|ma[ií]z|s[eé]samo|lino|cacahuete|grano de uva|nuez)/i;
const DEF=f=>({fats:15,fat:15,dairy:150,vegetables:200,fruits:150,protein:150}[f.category]||70);
const AMTS={fats:[10,15],fat:[10,15],dairy:[125,200],vegetables:[150,250],fruits:[120,200],protein:[100,150],carbs:[60,100],other:[60,100]};
(async()=>{
const e=buildEngine(process.argv[2],process.argv[3]);
const D={noSearch:[],rawCooked:[],famFirst:[],pctInv:[],dup:[],bigPortion:[],seedOil:[],foreign:[],
  zeroReal:[],kcalDrift:[],cookedOrigin:[],noHousehold:0,cards:0,preferredCards:0,uglyName:[],lowDiv:[]};
let n=0;
for(const q of Q){
  const res=e.getLocalSearchResults(q);
  if(!res.length){D.noSearch.push(q);continue;}
  const o=res[0];
  const amts=AMTS[o.category]||[70,150];
  for(const amt of amts){
    let a;try{a=await e.calculateAlternatives(o,amt,{usageMode:"any"});}catch(x){continue;}
    n++;
    const vis=visibleOrder(o,a);
    const t10=vis.slice(0,10);
    D.cards+=t10.length;
    D.preferredCards+=t10.filter(c=>c.premiumChoiceGuidance&&c.premiumChoiceGuidance.level==="preferred").length;
    if(a.intercambios.length===0)D.zeroReal.push(`${q}→${o.name} (${amt}g)`);
    if(familyFirst(o,a)&&a.intercambios.length>0){
      const firstReal=vis.findIndex(c=>c._block==="intercambio");
      D.famFirst.push(`${q}→${o.name} (${amt}g): 1er intercambio real en posición ${firstReal+1}`);
    }
    // origen cocinado cuando existe versión cruda del mismo alimento
    if(COOKED.test(o.name))D.cookedOrigin.push(`${q} → ${o.name}`);
    const m=t10.map(c=>c.matchDisplay!=null?c.matchDisplay:c.matchScore);
    for(let i=0;i<m.length-1;i++)if(m[i]<m[i+1]-4){D.pctInv.push(`${q}(${amt}g) #${i+1}=${m[i]}% sobre #${i+2}=${m[i+1]}%`);break;}
    const oRaw=RAW.test(o.name)&&!COOKED.test(o.name),oCook=COOKED.test(o.name);
    for(const [i,c] of t10.slice(0,5).entries()){
      const cRaw=RAW.test(c.name)&&!COOKED.test(c.name),cCook=COOKED.test(c.name);
      if((oRaw&&cCook)||(oCook&&cRaw))D.rawCooked.push(`${o.name}(${amt}g) #${i+1} → ${c.name} ${c.equivalentAmount}g`);
      if(c.equivalentAmount>=350)D.bigPortion.push(`${o.name}(${amt}g) #${i+1} → ${c.name} ${c.equivalentAmount}g`);
      if(SEEDOIL.test(c.name))D.seedOil.push(`${o.name}(${amt}g) #${i+1} → ${c.name}`);
      if(FOREIGN.test(c.name))D.foreign.push(`${o.name}(${amt}g) #${i+1} → ${c.name}`);
      if(/\bs\/e\b|sin especificar|parte s\/e/i.test(c.name))D.uglyName.push(`${o.name} #${i+1} → ${c.name}`);
      const ok=(o.calories*amt/100)||1, ck=c.macros.calories;
      if(ck>ok*1.35)D.kcalDrift.push(`${o.name}(${amt}g,${Math.round(ok)}kcal) #${i+1} → ${c.name} ${c.equivalentAmount}g = ${Math.round(ck)}kcal (+${Math.round(100*(ck/ok-1))}%)`);
    }
    for(let i=0;i<Math.min(4,t10.length);i++){const A=t10[i],B=t10[i+1];if(!B)break;
      if(Math.abs(A.protein-B.protein)<0.2&&Math.abs(A.carbs-B.carbs)<0.2&&Math.abs(A.fat-B.fat)<0.2)
        D.dup.push(`${o.name}: #${i+1} ${A.name} ≡ #${i+2} ${B.name}`);}
    const clusters=new Set(t10.slice(0,5).map(c=>(c.subgroup||"")+"|"+(c.premiumContext||"")));
    if(clusters.size<=1&&t10.length>=5)D.lowDiv.push(`${o.name}(${amt}g): TOP5 con un solo tipo (${[...clusters][0]})`);
  }
}
const u=a=>[...new Set(a)];
console.log("=== BARRIDO "+process.argv[4]+" — "+Q.length+" consultas, "+n+" escenarios (2 cantidades/alimento) ===\n");
const rows=[["Consultas sin ningún resultado",u(D.noSearch).length],
["Escenarios con 0 intercambios reales",u(D.zeroReal).length],
["Marcas antes que intercambio real",u(D.famFirst).length],
["Inversión de % visible (>4 pts) en TOP10",u(D.pctInv).length],
["Cruce crudo↔cocinado en TOP5",u(D.rawCooked).length],
["Origen cocinado elegido por defecto",u(D.cookedOrigin).length],
["Duplicados macro adyacentes en TOP5",u(D.dup).length],
["Porciones ≥350 g en TOP5",u(D.bigPortion).length],
["Aceites de semilla/tropical en TOP5",u(D.seedOil).length],
["Nombres no castellanos en TOP5",u(D.foreign).length],
["Nombres ilegibles (s/e) en TOP5",u(D.uglyName).length],
["Deriva calórica >+35% en TOP5",u(D.kcalDrift).length],
["TOP5 sin diversidad (un solo tipo)",u(D.lowDiv).length]];
rows.forEach(r=>console.log("  "+String(r[1]).padStart(5)+"  "+r[0]));
console.log("\n  Tarjetas TOP10 analizadas: "+D.cards+" | con etiqueta 'Elección prioritaria': "+D.preferredCards+" ("+(100*D.preferredCards/D.cards).toFixed(1)+"%)");
const dump=(t,arr,k)=>{const x=u(arr);console.log("\n───── "+t+" ("+x.length+") ─────");x.slice(0,k).forEach(l=>console.log("  "+l));};
dump("CONSULTAS SIN RESULTADO",D.noSearch,60);
dump("ORIGEN COCINADO POR DEFECTO (el programa pesa en CRUDO)",D.cookedOrigin,40);
dump("CRUDO↔COCINADO EN TOP5",D.rawCooked,30);
dump("ACEITES DE SEMILLA/TROPICAL EN TOP5",D.seedOil,25);
dump("DERIVA CALÓRICA >+35%",D.kcalDrift,30);
dump("NOMBRES NO CASTELLANOS EN TOP5",D.foreign,20);
dump("PORCIONES ≥350 g",D.bigPortion,25);
dump("SIN DIVERSIDAD EN TOP5",D.lowDiv,20);
dump("0 INTERCAMBIOS REALES",D.zeroReal,40);
fs.writeFileSync(process.env.SP+"/defects_"+process.argv[4]+".json",JSON.stringify(Object.fromEntries(Object.entries(D).map(([k,v])=>[k,Array.isArray(v)?u(v):v])),null,1));
})();

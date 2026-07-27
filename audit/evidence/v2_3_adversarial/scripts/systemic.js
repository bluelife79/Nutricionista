const {buildEngine,familyFirst,visibleOrder}=require(process.env.SP+"/uiharness.js");
const ROOT=process.argv[2],DB=process.argv[3],LABEL=process.argv[4];
const RAW=/\b(crud[oa]s?|fresc[oa]s?|en\s+seco|sin\s+cocer)\b/i;
const COOKED=/\b(cocid[oa]s?|hervid[oa]s?|asad[oa]s?|plancha|parrilla|frit[oa]s?|guisad[oa]s?|estofad[oa]s?|al\s+horno|al\s+vapor|escalfad[oa]s?|tostad[oa]s?|salteado)\b/i;
const DEF_AMT=f=>{const c=f.category;if(c==="fats")return 15;if(c==="dairy")return 150;
 if(c==="vegetables")return 200;if(c==="fruits")return 150;if(c==="protein")return 150;return 80;};
(async()=>{
 const e=buildEngine(ROOT,DB);
 const core=e.foods.filter(f=>f.exchange_scope&&f.exchange_scope.status==="exchange_core");
 const stats={n:0,ff:0,rawCooked:[],fatAnchorMeat:[],bigPortion:[],dupTop:[],matchClamp:{},
   selfSynonym:[],top3NonPreferred:0,zeroInter:0,famFirstBuriesInter:[]};
 for(const o of core){
   const amt=DEF_AMT(o);
   let a;try{a=await e.calculateAlternatives(o,amt,{usageMode:"any"});}catch(err){continue;}
   stats.n++;
   const vis=visibleOrder(o,a);
   const ff=familyFirst(o,a);
   if(ff){stats.ff++;
     if(a.intercambios.length>0) stats.famFirstBuriesInter.push(o.name);}
   if(a.intercambios.length===0) stats.zeroInter++;
   const top10=vis.slice(0,10);
   // raw origin -> cooked candidate (or reverse) within top5
   const oRaw=RAW.test(o.name)&&!COOKED.test(o.name), oCook=COOKED.test(o.name);
   for(const [i,c] of top10.slice(0,5).entries()){
     const cRaw=RAW.test(c.name)&&!COOKED.test(c.name), cCook=COOKED.test(c.name);
     if((oRaw&&cCook)||(oCook&&cRaw))
       stats.rawCooked.push(`${o.name} (${amt}g) #${i+1} -> ${c.name} ${c.equivalentAmount}g`);
   }
   // meat/fish origin anchored on fat
   if(o.category==="protein"&&o.macro_profile==="fat")
     stats.fatAnchorMeat.push(`${o.name} P${o.protein} G${o.fat} -> #1 ${top10[0]?top10[0].name+" "+top10[0].equivalentAmount+"g":"-"}`);
   // portions > 350g in top5
   for(const [i,c] of top10.slice(0,5).entries())
     if(c.equivalentAmount>=350) stats.bigPortion.push(`${o.name}(${amt}g) #${i+1} ${c.name} ${c.equivalentAmount}g`);
   // near-duplicate macros adjacent in top5
   for(let i=0;i<Math.min(4,top10.length);i++){
     const A=top10[i],B=top10[i+1];if(!B)break;
     if(Math.abs(A.protein-B.protein)<0.15&&Math.abs(A.carbs-B.carbs)<0.15&&Math.abs(A.fat-B.fat)<0.15&&A.name!==B.name)
       stats.dupTop.push(`${o.name}: #${i+1} ${A.name} == #${i+2} ${B.name}`);
   }
   // match clamp frequency
   for(const c of top10){const m=c.matchDisplay!=null?c.matchDisplay:c.matchScore;stats.matchClamp[m]=(stats.matchClamp[m]||0)+1;}
   // top3 with non-preferred guidance
   if(top10.slice(0,3).some(c=>c.premiumChoiceGuidance&&c.premiumChoiceGuidance.level!=="preferred")) stats.top3NonPreferred++;
 }
 const p=(x)=>Array.isArray(x)?x.length:x;
 console.log("### "+LABEL+" — orígenes core evaluados:",stats.n);
 console.log("familia-primero:",stats.ff,`(${(100*stats.ff/stats.n).toFixed(1)}%)`);
 console.log("  de ellos con intercambios reales enterrados:",stats.famFirstBuriesInter.length);
 console.log("sin ningún intercambio real:",stats.zeroInter);
 console.log("crudo<->cocinado en TOP5:",p(stats.rawCooked));
 console.log("proteína anclada en GRASA:",p(stats.fatAnchorMeat));
 console.log("porciones >=350g en TOP5:",p(stats.bigPortion));
 console.log("duplicados macro adyacentes en TOP5:",p(stats.dupTop));
 console.log("orígenes con no-preferred en TOP3:",stats.top3NonPreferred);
 const clamps=Object.entries(stats.matchClamp).sort((a,b)=>b[1]-a[1]).slice(0,8);
 console.log("valores de match más repetidos en TOP10:",JSON.stringify(clamps));
 const dump=(t,arr,n)=>{console.log("\n--- "+t+" (muestra "+Math.min(n,arr.length)+"/"+arr.length+")");arr.slice(0,n).forEach(x=>console.log("   "+x));};
 dump("CRUDO<->COCINADO",stats.rawCooked,25);
 dump("PROTEINA ANCLADA EN GRASA",stats.fatAnchorMeat,25);
 dump("PORCIONES >=350g",stats.bigPortion,25);
 dump("DUPLICADOS ADYACENTES",stats.dupTop,25);
})();

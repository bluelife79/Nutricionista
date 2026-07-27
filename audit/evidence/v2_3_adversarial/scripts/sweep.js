const {buildEngine,familyFirst,visibleOrder}=require(process.env.SP+"/uiharness.js");
const ROOT=process.argv[2], DB=process.argv[3], LABEL=process.argv[4];
const CASES=[
 ["avena",60],["pan integral",60],["arroz",70],["pasta",70],["patata",200],["boniato",200],
 ["quinoa",60],["pollo",150],["pechuga de pollo",150],["pavo",150],["huevo",120],
 ["ternera",150],["carne picada",150],["merluza",150],["bacalao",150],["salmón",130],
 ["atún",80],["gambas",120],["tofu",150],["tempeh",120],["seitán",120],["garbanzos",150],
 ["lentejas",150],["leche",250],["yogur natural",125],["kéfir",200],["queso fresco batido",200],
 ["queso de Burgos",100],["mozzarella",80],["queso manchego",40],["aceite de oliva",10],
 ["aguacate",100],["nueces",30],["tahini",20],["hummus",60],["chocolate negro",25],
 ["manzana",150],["plátano",120],["brócoli",200],["gazpacho",250],["salmorejo",200],
 ["skyr",150],["requesón",100],["sardinas",80],["lomo de cerdo",150],["cuscús",60],
];
(async()=>{
 const e=buildEngine(ROOT,DB);
 const out=[];
 for(const [q,amt] of CASES){
   const res=e.getLocalSearchResults(q);
   if(!res||!res.length){out.push({q,amt,err:"SIN RESULTADOS DE BUSQUEDA"});continue;}
   const origin=res[0];
   let alt;
   try{alt=await e.calculateAlternatives(origin,amt,{usageMode:"any"});}
   catch(err){out.push({q,amt,origin:origin.name,err:"CRASH "+err.message});continue;}
   const vis=visibleOrder(origin,alt);
   out.push({q,amt,
     origin:`${origin.name} | ${origin.brand} | ${origin.source} | P${origin.protein} C${origin.carbs} G${origin.fat} ${origin.calories}kcal`,
     searchTop3:res.slice(0,3).map(f=>f.name+" ["+f.source+"]"),
     ff:familyFirst(origin,alt),
     counts:{inter:alt.intercambios.length,fam:alt.familia.length,prep:alt.preparados.length},
     top10:vis.slice(0,10).map((a,i)=>`${i+1}. [${a._block}] ${a.name} (${a.brand}/${a.source}) ${a.equivalentAmount}g P${a.macros.protein.toFixed(1)} C${a.macros.carbs.toFixed(1)} G${a.macros.fat.toFixed(1)} ${Math.round(a.macros.calories)}kcal m=${a.matchDisplay!=null?a.matchDisplay:a.matchScore}% ${(a.premiumChoiceGuidance&&a.premiumChoiceGuidance.level)||"?"}`)
   });
 }
 console.log("###### "+LABEL+" ######");
 for(const o of out){
   console.log("\n== "+o.q+" ("+o.amt+"g)");
   if(o.err){console.log("   !! "+o.err);continue;}
   console.log("   ORIGEN: "+o.origin);
   console.log("   busq: "+o.searchTop3.join(" || "));
   console.log("   familia-primero="+o.ff+"  n(int/fam/prep)="+o.counts.inter+"/"+o.counts.fam+"/"+o.counts.prep);
   o.top10.forEach(l=>console.log("   "+l));
 }
})();

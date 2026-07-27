/**
 * A/B de embeddings semánticos.
 * Mide el efecto REAL de SEMANTIC_EMBEDDINGS_ENABLED sobre el TOP visible.
 *
 * Uso:  SP=<ruta_scripts> node ab_embeddings.js <raiz_app> <database.json>
 * Salida: ab_embeddings_result.json + resumen por consola.
 *
 * Responde a la objeción legítima de que "35 % nominal" no equivale a
 * "35 % de efecto": mide dispersión real del score y cambios de orden visible.
 */
const {buildEngine,visibleOrder}=require((process.env.SP||__dirname)+"/uiharness.js");
const fs=require("fs");
const ROOT=process.argv[2], DB=process.argv[3]||"database.json";
const DEF=f=>({fats:15,fat:15,dairy:150,vegetables:200,fruits:150,protein:150}[f.category]||70);

(async()=>{
  const on=buildEngine(ROOT,DB);
  const off=buildEngine(ROOT,DB);
  off.window.SEMANTIC_EMBEDDINGS_ENABLED=false;   // única diferencia entre motores

  const core=on.foods.filter(f=>f.exchange_scope&&f.exchange_scope.status==="exchange_core");
  const R={n:0,top1:0,top3:0,top5:0,top10:0,spreads:[],changed:[]};

  for(const f of core){
    let a,b;
    try{
      a=await on.calculateAlternatives(f,DEF(f),{usageMode:"any"});
      b=await off.calculateAlternatives(f,DEF(f),{usageMode:"any"});
    }catch(e){continue;}
    const A=visibleOrder(f,a).slice(0,10), B=visibleOrder(f,b).slice(0,10);
    if(!A.length)continue;
    R.n++;
    const ida=A.map(c=>c.id), idb=B.map(c=>c.id);
    const eq=(x,y,k)=>JSON.stringify(x.slice(0,k))===JSON.stringify(y.slice(0,k));
    if(ida[0]!==idb[0])R.top1++;
    if(!eq(ida,idb,3)){R.top3++;
      R.changed.push({id:f.id,name:f.name,amount:DEF(f),
        con:A.slice(0,3).map(c=>c.name),sin:B.slice(0,3).map(c=>c.name)});}
    if(!eq(ida,idb,5))R.top5++;
    if(!eq(ida,idb,10))R.top10++;
    const sems=a.intercambios.slice(0,20).map(c=>c._semanticScore).filter(x=>typeof x==="number");
    if(sems.length>1)R.spreads.push(Math.max(...sems)-Math.min(...sems));
  }

  R.spreads.sort((x,y)=>x-y);
  const q=p=>R.spreads[Math.floor(R.spreads.length*p)];
  const out={
    origenes:R.n,
    cambia_top1:{n:R.top1,pct:+(100*R.top1/R.n).toFixed(1)},
    cambia_top3:{n:R.top3,pct:+(100*R.top3/R.n).toFixed(1)},
    cambia_top5:{n:R.top5,pct:+(100*R.top5/R.n).toFixed(1)},
    cambia_top10:{n:R.top10,pct:+(100*R.top10/R.n).toFixed(1)},
    dispersion_semantica:{mediana:+q(0.5).toFixed(3),p90:+q(0.9).toFixed(3),max:+R.spreads[R.spreads.length-1].toFixed(3)},
    aporte_efectivo_mediano:+(0.35*q(0.5)).toFixed(3),
    nota:"peso nominal 0.35; aporte efectivo = 0.35 x dispersion. El % de cambio de TOP es la metrica que importa para la usuaria.",
    // lista completa para la revisión ciega del nutricionista
    casos_para_revision_ciega:R.changed,
  };
  fs.writeFileSync((process.env.OUTDIR||".")+"/ab_embeddings_result.json",JSON.stringify(out,null,1));
  console.log("origenes:",out.origenes);
  console.log("cambia TOP1:",out.cambia_top1.pct+"%  TOP3:",out.cambia_top3.pct+"%  TOP5:",out.cambia_top5.pct+"%  TOP10:",out.cambia_top10.pct+"%");
  console.log("dispersion semantica:",JSON.stringify(out.dispersion_semantica),"→ aporte efectivo mediano",out.aporte_efectivo_mediano);
  console.log("casos exportados para revision ciega:",out.casos_para_revision_ciega.length);
})();

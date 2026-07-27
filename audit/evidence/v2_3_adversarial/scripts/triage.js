/**
 * Triaje de defectos: separa ERROR REAL de comportamiento intencionado.
 * Responde a la objeción: "algunas métricas son señales, no errores automáticos".
 * Uso: SP=<scripts> node triage.js <raiz_app> <database.json> <etiqueta>
 */
const {buildEngine,familyFirst,visibleOrder}=require((process.env.SP||__dirname)+"/uiharness.js");
const fs=require("fs");
const Q=JSON.parse(fs.readFileSync((process.env.SP||__dirname)+"/queries.json","utf8"));
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");

// Cocinar cambia el peso de forma material solo en estas categorías.
// La panadería ("pan tostado") y los frutos secos ("almendra tostada") son
// TIPOS DE PRODUCTO distintos, no estados de cocción: se excluyen a propósito.
const BASE_SENSIBLE=new Set(["protein","vegetables"]);
const COOK_TOKENS=/\b(cocid[oa]s?|hervid[oa]s?|asad[oa]s?|plancha|parrilla|frit[oa]s?|guisad[oa]s?|estofad[oa]s?|al horno|al vapor|escalfad[oa]s?)\b/i;
const RAW_TOKENS=/\b(crud[oa]s?|fresc[oa]s?)\b/i;
const BAKERY_TOASTED=/\b(pan|biscote|tostada|almendra|avellana|cacahuete|sésamo|sesamo|garbanzo)\b/i;
const DEF=f=>({fats:15,fat:15,dairy:150,vegetables:200,fruits:150,protein:150}[f.category]||70);

(async()=>{
const e=buildEngine(process.argv[2],process.argv[3]);
const ALL=e.foods;
const pub=f=>f.exchange_scope&&["exchange_core","reference_only"].includes(f.exchange_scope.status);
// contextos con pocos miembros → familia legítimamente cerrada
const ctxCount={};
ALL.filter(f=>f.exchange_scope&&f.exchange_scope.status==="exchange_core")
   .forEach(f=>{const c=(f.exchange_scope.context)||"?";ctxCount[c]=(ctxCount[c]||0)+1;});

const T={vacias:{exclusion:[],vocabulario:[],ausente:[]},
         sinIntercambio:{familiaCerrada:[],fallo:[]},
         diversidad:{correcto:[],monotoniaReal:[]},
         crudoCocinado:{basePeso:[],otroProblema:[]}};

for(const q of Q){
  const res=e.getLocalSearchResults(q);
  if(!res.length){
    const hitAny=ALL.filter(f=>norm(f.name).includes(norm(q)));
    if(hitAny.length&&hitAny.some(f=>!pub(f))&&!hitAny.some(pub))
      T.vacias.exclusion.push(q+" → existe pero no publicable ("+hitAny[0].name+")");
    else if(hitAny.some(pub))
      T.vacias.vocabulario.push(q+" → publicable pero inalcanzable ("+hitAny.find(pub).name+")");
    else T.vacias.ausente.push(q);
    continue;
  }
  const o=res[0];
  let a;try{a=await e.calculateAlternatives(o,DEF(o),{usageMode:"any"});}catch(x){continue;}
  const vis=visibleOrder(o,a), t5=vis.slice(0,5);

  if(a.intercambios.length===0){
    const ctx=(o.exchange_scope&&o.exchange_scope.context)||"?";
    if((ctxCount[ctx]||0)<6) T.sinIntercambio.familiaCerrada.push(`${q} → ${o.name} [ctx=${ctx}, solo ${ctxCount[ctx]||0} en core]`);
    else T.sinIntercambio.fallo.push(`${q} → ${o.name} [ctx=${ctx}, hay ${ctxCount[ctx]} en core]`);
  }

  // diversidad: solo es defecto si el motor TENÍA otros contextos y no los sacó
  const key=c=>(c.subgroup||"")+"|"+(c.premiumContext||"");
  const t5k=new Set(t5.map(key));
  const allk=new Set([...a.intercambios,...a.familia].map(key));
  if(t5.length>=5&&t5k.size<=1){
    if(allk.size>=3) T.diversidad.monotoniaReal.push(`${o.name}: TOP5 monotipo (${[...t5k][0]}) habiendo ${allk.size} tipos disponibles`);
    else T.diversidad.correcto.push(`${o.name}: TOP5 monotipo pero solo existen ${allk.size} tipo(s) — correcto`);
  }

  const oCook=COOK_TOKENS.test(o.name), oRaw=RAW_TOKENS.test(o.name)&&!oCook;
  for(const [i,c] of t5.entries()){
    const cCook=COOK_TOKENS.test(c.name), cRaw=RAW_TOKENS.test(c.name)&&!cCook;
    if(!((oRaw&&cCook)||(oCook&&cRaw)))continue;
    const line=`${o.name}(${DEF(o)}g) #${i+1} → ${c.name} ${c.equivalentAmount}g`;
    const sensible=BASE_SENSIBLE.has(o.category)&&BASE_SENSIBLE.has(c.category);
    const bakery=BAKERY_TOASTED.test(norm(o.name))||BAKERY_TOASTED.test(norm(c.name));
    if(sensible&&!bakery)T.crudoCocinado.basePeso.push(line);
    else T.crudoCocinado.otroProblema.push(line+"  [tipo de producto, no base de peso]");
  }
}
const u=a=>[...new Set(a)];
const P=(t,o)=>{console.log("\n### "+t);for(const [k,v] of Object.entries(o))console.log("   "+String(u(v).length).padStart(4)+"  "+k);};
console.log("=== TRIAJE "+process.argv[4]+" ===");
P("BÚSQUEDAS VACÍAS (bruto: "+u([...T.vacias.exclusion,...T.vacias.vocabulario,...T.vacias.ausente]).length+")",T.vacias);
P("SIN INTERCAMBIO REAL",T.sinIntercambio);
P("TOP5 MONOTIPO",T.diversidad);
P("CRUCE CRUDO/COCINADO",T.crudoCocinado);
const d=(t,a,k)=>{console.log("\n--- "+t+" ---");u(a).slice(0,k).forEach(x=>console.log("   "+x));};
d("VOCABULARIO: publicable pero inalcanzable (ERROR REAL)",T.vacias.vocabulario,25);
d("FALLO REAL de intercambio (no es familia cerrada)",T.sinIntercambio.fallo,20);
d("MONOTONÍA REAL (había alternativas y no salieron)",T.diversidad.monotoniaReal,15);
d("CONFLICTO DE BASE DE PESO (ERROR REAL)",T.crudoCocinado.basePeso,20);
fs.writeFileSync((process.env.OUTDIR||".")+"/triaje_"+process.argv[4]+".json",
  JSON.stringify(Object.fromEntries(Object.entries(T).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([kk,vv])=>[kk,u(vv)]))])),null,1));
})();

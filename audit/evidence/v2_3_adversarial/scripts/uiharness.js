"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");

function buildEngine(root, dbPath){
  const foods=JSON.parse(fs.readFileSync(dbPath,"utf8"));
  const silent={log(){},info(){},debug(){},warn(){},error(){}};
  const localFetch=(res)=>{
    const t=String(res);
    if(t==="assets/embeddings.bin"){const b=fs.readFileSync(path.join(root,t));
      const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
      return Promise.resolve({ok:true,arrayBuffer:async()=>ab});}
    if(t==="assets/embeddings_meta.json")return Promise.resolve({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(root,t),"utf8"))});
    return Promise.resolve({ok:false,status:404,arrayBuffer:async()=>null,json:async()=>({})});
  };
  // Fake DOM good enough for renderAutocomplete/searchFoods
  const mkEl=()=>({innerHTML:"",classList:{add(){},remove(){},toggle(){}},
    querySelectorAll:()=>[],querySelector:()=>null,style:{},dataset:{},
    addEventListener(){},appendChild(){},replaceChildren(){},textContent:""});
  const window={foodsDatabase:foods,SEMANTIC_EMBEDDINGS_ENABLED:true,
    RERANK_ENABLED:false,LLM_JUDGE_ENABLED:false,DIETARY_FILTERS:new Set(),
    location:{search:""}};
  const context={window,foodsDatabase:foods,
    document:{querySelector:()=>mkEl(),getElementById:()=>mkEl(),createElement:()=>mkEl()},
    fetch:localFetch,console:silent,AbortController,Int8Array,Map,Set,Promise,Date,Math,
    Number,String,Object,Array,JSON,URLSearchParams,setTimeout,clearTimeout,RegExp,
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}}};
  context.globalThis=context;
  vm.createContext(context);
  for(const f of ["js/exchange_groups.js","js/dietary_filters.js","js/premium_policy.js",
    "js/culinary_intent.js","js/exchange_scope.js","js/algorithm.js"]){
    vm.runInContext(fs.readFileSync(path.join(root,f),"utf8"),context,{filename:f});
  }
  const api={};
  for(const n of ["calculateAlternatives","getLocalSearchResults"]){
    try{api[n]=vm.runInContext(n,context);}catch(e){api[n]=null;}
  }
  return {foods,window,context,...api};
}

// ---- replica of index.html displayResults ordering ----
const _norm=s=>(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
const ROLE_FF=new Set(["snack","dessert"]);
const SUB_FF=new Set(["processed_meat","sweets_bakery"]);
const TOKEN_FF=["pan","tostada","biscote","pico","colin","avena","copos","cereales","muesli",
"granola","barrita","all-bran","all bran","corn flakes","fitness","special k","choco krispies",
"galleta","tortita","cracker","crujiente","jamon","jamón","chorizo","salchichon","salchichón",
"fuet","salchicha","hamburguesa","bacon","mortadela","pavo cocido","pollo cocido","fiambre",
"hummus","tahin","tahini","pate","paté","mermelada","confitura","compota","jalea","zumo",
"bebida vegetal","leche","horchata","yogur","yogurt","yoghurt","skyr","fage","quark","kefir",
"kéfir","huevo","tofu","tempeh","seitan","seitán","soja texturizada","heura","garbanzo",
"alubia cocida","lenteja cocida","judia cocida","judía cocida","aceitun","encurtido",
"pepinillo","chocolate","tableta"];

function familyFirst(origin, alternatives){
  const n=_norm(origin.name);
  const byClass=ROLE_FF.has(origin.culinary_role||"meal_dish")||origin.category==="dairy"||SUB_FF.has(origin.subgroup);
  const byTok=TOKEN_FF.some(t=>n.includes(_norm(t)));
  return (byClass||byTok) && alternatives.familia.length>=5;
}
// what the woman actually scrolls through, in order
function visibleOrder(origin,alt){
  const ff=familyFirst(origin,alt);
  const fam=alt.familia.map(a=>({...a,_block:"familia"}));
  const inter=alt.intercambios.map(a=>({...a,_block:"intercambio"}));
  const prep=alt.preparados.map(a=>({...a,_block:"preparado"}));
  // familia/preparados capped at 8 visible before "Ver más"
  const famV=fam.slice(0,8), prepV=prep.slice(0,8);
  return ff?[...famV,...inter,...prepV]:[...inter,...famV,...prepV];
}
module.exports={buildEngine,familyFirst,visibleOrder,_norm};

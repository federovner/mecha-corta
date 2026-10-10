/* Mecha Corta · núcleo compartido (servidor y navegador).
   Reglas, mapas, IA y simulación. Sin DOM: los efectos salen como eventos en G.ev. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MC=factory()})(typeof self!=='undefined'?self:this,function(){
'use strict';
let G=null;
function setG(g){G=g}
function emit(...a){if(G&&G.ev)G.ev.push(a)}
const SPD=p=>3.1+.55*p.speedLvl;
const FUSE=2.6, FLAME=0.6, SLIDE=7.5, FALL_DT=0.2, DROP_T=0.35, INF=Infinity;
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
const PU_TYPES=['bomb','fire','speed','kick','pierce','shield','life'];
const PU={
  bomb:{name:'+1 bomba',color:'#ff8a3d',w:30},
  fire:{name:'+1 alcance',color:'#ff4b5c',w:28},
  speed:{name:'Velocidad',color:'#33c4ff',w:16},
  kick:{name:'Patada',color:'#a46bff',w:8},
  pierce:{name:'Perforante',color:'#f5c400',w:5},
  shield:{name:'Escudo',color:'#2fe0a6',w:8},
  life:{name:'+1 vida',color:'#ff5fa2',w:4},
};
const PROFILES={
  cazador:{need:3,name:'Cazador',desc:'Persigue rivales y los acorrala.',react:.14,margin:.16,brick:.9,pick:.9,attack:1.6,trap:2.2,hunt:1.6,minBomb:.8,mistake:.01,chaos:0},
  tactico:{need:3,name:'Táctico',desc:'Calcula las rutas de escape del rival y las corta.',react:.12,margin:.18,brick:1,pick:1.2,attack:1.1,trap:3.6,hunt:.9,minBomb:.9,mistake:0,chaos:0},
  recolector:{need:2,name:'Recolector',desc:'Rompe bloques y acapara power-ups.',react:.15,margin:.2,brick:1.5,pick:2.3,attack:.6,trap:1.2,hunt:.25,minBomb:.8,mistake:.01,chaos:0},
  prudente:{need:4,name:'Prudente',desc:'Deja mucho margen y rara vez arriesga.',react:.15,margin:.42,brick:1.1,pick:1.2,attack:.5,trap:1.5,hunt:.15,minBomb:.9,mistake:0,chaos:0},
  caotico:{need:1,name:'Caótico',desc:'Impredecible: siembra bombas y presiona.',react:.2,margin:.05,brick:1,pick:1,attack:1.4,trap:1,hunt:1.2,minBomb:.5,mistake:.04,chaos:.18},
  novato:{need:1,name:'Novato',desc:'Reacciona tarde y a veces se encierra.',react:.38,margin:.06,brick:1,pick:1,attack:.7,trap:.4,hunt:.4,minBomb:.8,mistake:.08,chaos:.05},
};
const PROF_KEYS=Object.keys(PROFILES);
const DIFFS={facil:{name:'Fácil',react:1.9,mist:2.5,trap:.6},normal:{name:'Normal',react:1.3,mist:1.4,trap:.85},dificil:{name:'Difícil',react:1,mist:1,trap:1},experto:{name:'Experto',react:.7,mist:.25,trap:1.3}};
const COLORS=['#ffd447','#ff4d5a','#4da3ff','#3ddc84','#c86bff','#ff9f43','#2ee6d6','#ff6fb5','#a3e635','#8f8bff','#eef0f6','#c28a5c'];
const TOUR_LEN=3,PLACE=[10,7,5,4,3,2,1,0,0,0,0,0];
const NAMES=['Brasa','Chispa','Pólvora','Tizón','Ceniza','Bengala','Petardo','Fogata','Trueno','Cohete','Yesca'];

// ---------- themes & map generators ----------
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function blank(W,H,fill){const g=new Uint8Array(W*H).fill(fill);for(let x=0;x<W;x++){g[x]=1;g[(H-1)*W+x]=1}for(let y=0;y<H;y++){g[y*W]=1;g[y*W+W-1]=1}return g}
function genClassicSparse(W,H,r){const g=blank(W,H,0);for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){if(x%2===0&&y%2===0)g[y*W+x]=1;else if(r()<.55)g[y*W+x]=2}return g}
function genClassic(W,H,r){const g=blank(W,H,0);for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){if(x%2===0&&y%2===0)g[y*W+x]=1;else if(r()<.66)g[y*W+x]=2}return g}
function genFortress(W,H,r){
  const g=blank(W,H,0);
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){if(x%2===0&&y%2===0)g[y*W+x]=1;else if(r()<.45)g[y*W+x]=2}
  const rings=[3,6].filter(a=>W-1-2*a>=4&&H-1-2*a>=4);
  for(const a of rings){
    const x0=a,x1=W-1-a,y0=a,y1=H-1-a;
    const put=(x,y,k)=>{g[y*W+x]=(k%4===2)?2:1};
    for(let x=x0;x<=x1;x++){put(x,y0,x-x0);put(x,y1,x-x0)}
    for(let y=y0+1;y<y1;y++){put(x0,y,y-y0);put(x1,y,y-y0)}
  }
  return g;
}
function genMaze(W,H,r){
  const g=blank(W,H,1);
  const seen=new Uint8Array(W*H);const st=[[1,1]];seen[W+1]=1;g[W+1]=0;
  while(st.length){
    const [x,y]=st[st.length-1];
    const opts=DIRS.map(([dx,dy])=>[x+dx*2,y+dy*2,dx,dy]).filter(([nx,ny])=>nx>0&&ny>0&&nx<W-1&&ny<H-1&&!seen[ny*W+nx]);
    if(!opts.length){st.pop();continue}
    const [nx,ny,dx,dy]=opts[Math.floor(r()*opts.length)];
    seen[ny*W+nx]=1;g[ny*W+nx]=0;g[(y+dy)*W+x+dx]=0;st.push([nx,ny]);
  }
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;if(g[i]===1&&((x%2)!==(y%2))&&r()<.45)g[i]=0}
  for(let i=0;i<W*H;i++)if(g[i]===0&&r()<.42)g[i]=2;
  return g;
}
function genIslands(W,H,r){
  let g=blank(W,H,0);
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++)g[y*W+x]=r()<.4?1:0;
  for(let it=0;it<4;it++){
    const n=g.slice();
    for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
      let c=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx>0&&yy>0&&xx<W-1&&yy<H-1&&g[yy*W+xx]===1)c++}
      const i=y*W+x;n[i]=c>=5?1:c<=2?0:g[i];
    }
    g=n;
  }
  const inner=[];for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++)if(g[y*W+x]===1)inner.push(y*W+x);
  const cap=Math.floor((W-2)*(H-2)*.26);
  while(inner.length>cap){const k=Math.floor(r()*inner.length);g[inner[k]]=0;inner.splice(k,1)}
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;if(g[i]===0&&r()<.55)g[i]=2}
  return g;
}
function genArena(W,H,r){
  const g=blank(W,H,0),cx=W>>1,cy=H>>1;
  for(let y=1;y<=cy;y++)for(let x=1;x<=cx;x++){
    const v=(r()<.24&&(x+y)%2===0)?1:(r()<.62?2:0);
    for(const [xx,yy] of [[x,y],[W-1-x,y],[x,H-1-y],[W-1-x,H-1-y]])g[yy*W+xx]=v;
  }
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++)if(Math.abs(x-cx)+Math.abs(y-cy)<=2)g[y*W+x]=0;
  for(const [x,y] of [[cx-3,cy],[cx+3,cy],[cx,cy-3],[cx,cy+3]])if(x>0&&y>0&&x<W-1&&y<H-1)g[y*W+x]=1;
  return g;
}
function genDiagonal(W,H,r){
  const g=blank(W,H,0);
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
    const i=y*W+x;
    if((((x+y)%6===0)||((x-y+600)%6===0))&&((x*7+y*3)%5!==0))g[i]=1;else if(r()<.58)g[i]=2;
  }
  return g;
}
const THEMES=[
  {name:'Pradera',tag:'Rejilla clásica',gen:genClassic,sky:['#123323','#050f09'],floor:['#4f9d55','#47924d'],solid:['#c3cfd2','#8e9ea2','#6e7d82'],edge:'rgba(255,255,255,.35)',brick:['#e2854f','#b8613a','#93482a'],mortar:'rgba(255,226,190,.5)',deco:'grass'},
  {name:'Bastión',tag:'Murallas concéntricas',gen:genFortress,sky:['#2c2013','#100b05'],floor:['#d6b37c','#cca872'],solid:['#8d7f73','#685c52','#4e443d'],edge:'rgba(255,240,220,.25)',brick:['#b98648','#916533','#714d24'],mortar:'rgba(60,35,10,.5)',deco:'sand'},
  {name:'Cripta',tag:'Laberinto trenzado',gen:genMaze,sky:['#1c1433','#0a0716'],floor:['#463e62','#3f3859'],solid:['#7d5fc6','#58419a','#433076'],edge:'rgba(220,200,255,.35)',brick:['#5bd8c8','#38a89a','#297e74'],mortar:'rgba(8,40,40,.45)',deco:'cracks'},
  {name:'Glaciar',tag:'Islas de hielo',gen:genIslands,sky:['#14354e','#07162a'],floor:['#cfeaf6','#c2e2f1'],solid:['#f6fcff','#a9d4eb','#86bad8'],edge:'rgba(255,255,255,.8)',brick:['#8cb3df','#6b8fc5','#53729f'],mortar:'rgba(255,255,255,.55)',deco:'ice'},
  {name:'Volcán',tag:'Simetría en cuatro',gen:genArena,sky:['#2c0e06','#100402'],floor:['#3f2c29','#382724'],solid:['#5b534c','#3c3632','#2b2724'],edge:'rgba(255,140,60,.35)',brick:['#ff8b3b','#d4571e','#9e3a11'],mortar:'rgba(80,20,0,.5)',deco:'lava'},
  {name:'Neón',tag:'Celosía diagonal',gen:genDiagonal,sky:['#0c1031','#04061a'],floor:['#181d47','#151a3f'],solid:['#202c6b','#172152','#111842'],edge:'#3be7ff',brick:['#ff52ba','#cb378e','#962869'],mortar:'rgba(255,205,240,.45)',deco:'grid'},
  {name:'Fábrica',tag:'Rodillos',gen:genClassicSparse,sky:['#20262e','#0b0d11'],floor:['#5f6873','#58616c'],solid:['#e8b53c','#bb8c25','#916b19'],edge:'rgba(20,20,20,.55)',brick:['#8796a6','#6a7887','#525e6b'],mortar:'rgba(20,24,30,.55)',deco:'plates',special:'roller'},
  {name:'Rompecabezas',tag:'Piso deslizante',gen:genClassicSparse,sky:['#2b1d40','#120a20'],floor:['#f2c6de','#c6def1'],tiles:['#f7c4d8','#c4e2ff','#d3f4c4','#fff0b3','#e2cffd'],solid:['#6f4dbb','#523895','#3d2973'],edge:'rgba(255,255,255,.35)',brick:['#2ec4b6','#21998f','#18766d'],mortar:'rgba(0,40,40,.4)',deco:'tiles',special:'puzzle'},
];
function sizeFor(n){return n<=4?[13,11]:n<=8?[17,13]:[19,17]}
function spawnsFor(W,H){
  const cx=W>>1,cy=H>>1;let qx=Math.round(W/4);if(qx%2===0)qx++;let qy=Math.round(H/4);if(qy%2===0)qy++;
  return [[1,1],[W-2,H-2],[W-2,1],[1,H-2],[cx,1],[cx,H-2],[1,cy],[W-2,cy],[qx,qy],[W-1-qx,H-1-qy],[W-1-qx,qy],[qx,H-1-qy]];
}
function pickPU(r){let tot=0;for(const k of PU_TYPES)tot+=PU[k].w;let v=r()*tot;for(let k=0;k<PU_TYPES.length;k++){v-=PU[PU_TYPES[k]].w;if(v<=0)return k+1}return 1}
function buildMap(ti,W,H,seed,spawns){
  const r=mulberry32(seed*7919+ti*104729+W);
  const g=THEMES[ti].gen(W,H,r);
  const inside=(x,y)=>x>0&&y>0&&x<W-1&&y<H-1;
  for(const [sx,sy] of spawns){
    g[sy*W+sx]=0;
    for(const [dx,dy] of DIRS){
      if(inside(sx+dx,sy+dy))g[(sy+dy)*W+sx+dx]=0;
      if(inside(sx+2*dx,sy+2*dy)&&g[(sy+2*dy)*W+sx+2*dx]===2)g[(sy+2*dy)*W+sx+2*dx]=0;
    }
    let esc=false;
    for(const [dx,dy] of DIRS){
      if(!inside(sx+dx,sy+dy))continue;
      if(inside(sx+2*dx,sy+2*dy)&&g[(sy+2*dy)*W+sx+2*dx]===0)esc=true;
      for(const [px,py] of [[dy,dx],[-dy,-dx]])if(inside(sx+dx+px,sy+dy+py)&&g[(sy+dy+py)*W+sx+dx+px]===0)esc=true;
    }
    if(!esc)for(const [dx,dy] of DIRS)if(inside(sx+2*dx,sy+2*dy)){g[(sy+2*dy)*W+sx+2*dx]=0;break}
  }
  let lanes=[];
  if(THEMES[ti].special==='roller'){lanes=pickLanes(H,spawns);for(const y of lanes)for(let x=1;x<W-1;x++)g[y*W+x]=0}
  connect(g,W,H,spawns[0][1]*W+spawns[0][0]);
  const hidden=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++)if(g[i]===2&&r()<.3)hidden[i]=pickPU(r);
  const tile=new Uint8Array(W*H);if(THEMES[ti].tiles){const tr=mulberry32(seed+77);for(let i=0;i<W*H;i++)tile[i]=Math.floor(tr()*THEMES[ti].tiles.length)}
  return {grid:g,hidden,lanes,tile};
}
function pickLanes(H,spawns){
  const used=new Set(spawns.map(s=>s[1])),cand=[];for(let y=3;y<=H-4;y+=2)if(!used.has(y))cand.push(y);
  const near=(t,ex)=>cand.filter(y=>!ex.some(e=>Math.abs(e-y)<2)).sort((a,b)=>Math.abs(a-t)-Math.abs(b-t))[0];
  const out=[];const a=near(H/3,out);if(a!=null)out.push(a);const b=near(2*H/3,out);if(b!=null)out.push(b);return out;
}
function connect(g,W,H,start){
  const N=W*H,NB=[1,-1,W,-W];
  const interior=i=>{const x=i%W,y=(i/W)|0;return x>0&&y>0&&x<W-1&&y<H-1};
  for(let it=0;it<300;it++){
    const seen=new Uint8Array(N);const q=[start];seen[start]=1;
    for(let h=0;h<q.length;h++){const u=q[h];for(const d of NB){const v=u+d;if(!seen[v]&&g[v]!==1){seen[v]=1;q.push(v)}}}
    let missing=false;for(let i=0;i<N;i++)if(interior(i)&&g[i]!==1&&!seen[i]){missing=true;break}
    if(!missing)return;
    const dist=new Int32Array(N).fill(1e9),par=new Int32Array(N).fill(-1);const dq=[];
    for(const u of q){dist[u]=0;dq.push(u)}
    let target=-1;
    while(dq.length){
      const u=dq.shift();
      if(g[u]!==1&&!seen[u]){target=u;break}
      for(const d of NB){const v=u+d;if(!interior(v))continue;const c=g[v]===1?1:0;if(dist[u]+c<dist[v]){dist[v]=dist[u]+c;par[v]=u;c?dq.push(v):dq.unshift(v)}}
    }
    if(target<0)return;
    let c=target;while(c>=0&&dist[c]>0){if(g[c]===1)g[c]=0;c=par[c]}
  }
}
function spiral(W,H){
  const out=[];let x0=1,y0=1,x1=W-2,y1=H-2;
  while(x0<=x1&&y0<=y1){
    for(let x=x0;x<=x1;x++)out.push(y0*W+x);
    for(let y=y0+1;y<=y1;y++)out.push(y*W+x1);
    if(y1>y0)for(let x=x1-1;x>=x0;x--)out.push(y1*W+x);
    if(x1>x0)for(let y=y1-1;y>y0;y--)out.push(y*W+x0);
    x0++;y0++;x1--;y1--;
  }
  return out;
}
// ---------- helpers ----------
const cellOf=p=>Math.floor(p.y)*G.W+Math.floor(p.x);
function rebuildOcc(){G.bombOcc.fill(-1);G.bombs.forEach((b,k)=>{G.bombOcc[b.cy*G.W+b.cx]=k})}
function blastCells(cx,cy,range,pierce,occ){
  const W=G.W,out=[cy*W+cx];
  for(const [dx,dy] of DIRS){
    for(let k=1;k<=range;k++){
      const i=(cy+dy*k)*W+cx+dx*k,g=G.grid[i];
      if(g===1)break;
      out.push(i);
      if((g===2||g===3)&&!pierce)break;
      if(occ&&occ[i]>=0)break;
    }
  }
  return out;
}
function computeDanger(extra){
  const N=G.N,st=new Float32Array(N).fill(INF),en=new Float32Array(N).fill(-1);
  for(let i=0;i<N;i++)if(G.flame[i]>0){st[i]=0;en[i]=G.flame[i]}
  const bl=G.bombs.map(b=>({cx:b.cx,cy:b.cy,range:b.range,pierce:b.pierce,t:Math.max(0,b.t)}));
  if(extra)bl.push(Object.assign({},extra));
  const occ=new Int16Array(N).fill(-1);bl.forEach((b,k)=>{occ[b.cy*G.W+b.cx]=k});
  const blasts=bl.map(b=>blastCells(b.cx,b.cy,b.range,b.pierce,occ));
  let changed=true,it=0;
  while(changed&&it<=bl.length){changed=false;it++;
    for(let k=0;k<bl.length;k++)for(const c of blasts[k]){const j=occ[c];if(j>=0&&j!==k&&bl[j].t>bl[k].t){bl[j].t=bl[k].t;changed=true}}}
  for(let k=0;k<bl.length;k++){const t=bl[k].t;for(const c of blasts[k]){if(t<st[c])st[c]=t;if(t+FLAME>en[c])en[c]=t+FLAME}}
  if(G.special==='roller')rollerDanger(st,en);
  if(G.sudden){
    for(const d of G.drops){st[d.i]=Math.min(st[d.i],d.t);en[d.i]=INF}
    for(let q=0;q<14&&G.fallIdx+q<G.fallOrder.length;q++){const i=G.fallOrder[G.fallIdx+q];const t=Math.max(0,G.fallTimer)+q*FALL_DT+DROP_T;st[i]=Math.min(st[i],t);en[i]=INF}
  }
  return {st,en};
}
function bfs(p,D,margin,start,t0,block){
  const N=G.N,NB=G.NB,dist=new Int16Array(N).fill(-1),par=new Int16Array(N).fill(-1),arr=new Float32Array(N);
  const order=[start];dist[start]=0;arr[start]=t0;
  const st=1/SPD(p),half=st*.6;
  for(let h=0;h<order.length;h++){
    const u=order[h];
    for(let k=0;k<4;k++){
      const v=u+NB[k];
      if(dist[v]>=0||G.grid[v]!==0||G.bombOcc[v]>=0||v===block)continue;
      const a=arr[u]+st;
      if(a+half>D.st[v]-margin&&a-half<D.en[v]+margin)continue;
      dist[v]=dist[u]+1;par[v]=u;arr[v]=a;order.push(v);
    }
  }
  return {dist,par,arr,order};
}
function openness(i){let c=0;for(const d of G.NB)if(G.grid[i+d]===0&&G.bombOcc[i+d]<0)c++;return c}
function enemiesOf(p){return G.players.filter(q=>q!==p&&q.alive)}

// ---------- actions ----------
function freeFor(p,x,y){
  if(x<0||y<0||x>=G.W||y>=G.H)return false;
  const i=y*G.W+x;if(G.grid[i]!==0)return false;
  const j=G.bombOcc[i];if(j>=0&&!G.bombs[j].pass.has(p.id))return false;
  return true;
}
function bombFree(x,y){
  const i=y*G.W+x;if(G.grid[i]!==0||G.bombOcc[i]>=0)return false;
  for(const q of G.players)if(q.alive&&cellOf(q)===i)return false;
  return true;
}
function tryMove(p,dx,dy,dt){
  let dist=SPD(p)*dt;const horiz=dx!==0,dir=horiz?dx:dy;
  let main=horiz?p.x:p.y,side=horiz?p.y:p.x;
  const sideCell=Math.round(side-.5),off=side-(sideCell+.5),mainCell=Math.floor(main),fm=main-(mainCell+.5);
  const cf=(m,s)=>horiz?freeFor(p,m,s):freeFor(p,s,m);
  const frontFree=cf(mainCell+dir,sideCell);
  const ox=p.x,oy=p.y;
  if(frontFree||dir*fm<-1e-6){
    if(Math.abs(off)>1e-6){const a=Math.min(Math.abs(off),dist);side-=Math.sign(off)*a;dist-=a}
    if(dist>0){main+=dir*dist;if(!frontFree){const c=mainCell+.5;main=dir>0?Math.min(main,c):Math.max(main,c)}}
  }else{
    // kick
    const fx=horiz?mainCell+dir:sideCell,fy=horiz?sideCell:mainCell+dir;
    const j=(fx>=0&&fy>=0&&fx<G.W&&fy<G.H)?G.bombOcc[fy*G.W+fx]:-1;
    if(j>=0&&p.kick){const b=G.bombs[j];if(!b.slide&&!b.pass.has(p.id)&&bombFree(fx+(horiz?dir:0),fy+(horiz?0:dir))){b.slide=[horiz?dir:0,horiz?0:dir];emit('kick',p.id)}}
    // corner assist
    if(Math.abs(off)>.12){const s2=sideCell+Math.sign(off);if(cf(mainCell+dir,s2)&&cf(mainCell,s2)){const tgt=s2+.5;const a=Math.min(Math.abs(tgt-side),dist);side+=Math.sign(tgt-side)*a}}
  }
  if(horiz){p.x=main;p.y=side}else{p.y=main;p.x=side}
  p.face=[dx,dy];
  return Math.abs(p.x-ox)+Math.abs(p.y-oy)>1e-5;
}
function placeBomb(p){
  if(!p.alive||p.active>=p.bombsMax)return false;
  const i=cellOf(p);if(G.grid[i]!==0||G.bombOcc[i]>=0)return false;
  const cx=i%G.W,cy=(i/G.W)|0;const pass=new Set();
  for(const q of G.players)if(q.alive&&cellOf(q)===i)pass.add(q.id);
  G.bombs.push({id:++G.bombSeq,cx,cy,x:cx+.5,y:cy+.5,owner:p.id,range:p.range,pierce:p.pierce,t:FUSE,slide:null,pass,born:G.time});
  p.active++;rebuildOcc();emit('place',cx,cy,p.id);
  return true;
}
function explode(b){
  const k=G.bombs.indexOf(b);if(k<0)return;G.bombs.splice(k,1);
  const ow=G.players[b.owner];ow.active=Math.max(0,ow.active-1);
  rebuildOcc();
  const cells=blastCells(b.cx,b.cy,b.range,b.pierce,G.bombOcc);
  for(const i of cells){
    G.flame[i]=FLAME;G.flameOwner[i]=b.owner;
    if(G.grid[i]===2){G.grid[i]=3;G.burn[i]=FLAME;emit('brick',i)}
    if(G.pu[i]){G.pu[i]=0;emit('puburn',i)}
    const j=G.bombOcc[i];if(j>=0){const ob=G.bombs[j];if(ob.t>.07)ob.t=.07}
  }
  emit('boom',b.cx,b.cy,cells,b.owner);
}
function applyPU(p,t){
  const k=PU_TYPES[t-1];
  if(k==='bomb')p.bombsMax=Math.min(8,p.bombsMax+1);
  else if(k==='fire')p.range=Math.min(8,p.range+1);
  else if(k==='speed')p.speedLvl=Math.min(5,p.speedLvl+1);
  else if(k==='kick')p.kick=true;
  else if(k==='pierce')p.pierce=true;
  else if(k==='shield')p.shield=true;
  else if(k==='life')p.lives=Math.min(4,p.lives+1);
  if(k!=='life'&&k!=='shield')p.picks.push(t);
  emit('pick',p.id,t);
}
function hit(p,killer,force){
  if(!p.alive||G.endT>=0&&p.id===G.winnerId)return;
  if(!force&&p.invuln>0)return;
  if(!force&&p.shield){p.shield=false;p.invuln=1.3;emit('shield',p.id);return}
  p.alive=false;p.dead=0;p.deaths++;p.path=[];
  if(G.sudden)p.lives=0;else p.lives--;
  const k=killer!=null?G.players[killer]:null;
  emit('death',p.id,k?k.id:-1);
  if(k){if(k===p){k.kills--;k.selfK=(k.selfK||0)+1}else{k.kills++;k.streak=G.time-k.lastKill<4?k.streak+1:1;k.lastKill=G.time;if(k.streak>=2)emit('streak',k.id,k.streak)}}
  dropPicks(p);
  if(p.lives>0)p.respawnT=2.4;else{G.elim.push(p.id);emit('out',p.id)}
}
function dropPicks(p){
  const n=Math.min(2,p.picks.length);if(!n)return;
  const free=[];for(let i=0;i<G.N;i++)if(G.grid[i]===0&&!G.pu[i]&&G.bombOcc[i]<0&&G.flame[i]<=0&&G.danger.st[i]===INF)free.push(i);
  for(let k=0;k<n;k++){
    const t=p.picks.splice(Math.floor(Math.random()*p.picks.length),1)[0];const key=PU_TYPES[t-1];
    if(key==='bomb')p.bombsMax=Math.max(1,p.bombsMax-1);else if(key==='fire')p.range=Math.max(1,p.range-1);
    else if(key==='speed')p.speedLvl=Math.max(0,p.speedLvl-1);else if(key==='kick')p.kick=false;else if(key==='pierce')p.pierce=false;
    if(free.length){const i=free.splice(Math.floor(Math.random()*free.length),1)[0];G.pu[i]=t;G.puT[i]=G.time;G.puDrop[i]=0;emit('drop',i)}
  }
}
function respawn(p){
  const D=G.danger,en=enemiesOf(p);let best=-1,bs=-1e9;
  for(let i=0;i<G.N;i++){
    if(G.grid[i]!==0||G.bombOcc[i]>=0||D.st[i]!==INF)continue;
    const x=i%G.W,y=(i/G.W)|0;let md=10;
    for(const e of en)md=Math.min(md,Math.abs(e.x-.5-x)+Math.abs(e.y-.5-y));
    const s=md+(x===p.sx&&y===p.sy?2:0)+openness(i)*.4+Math.random()*.5;
    if(s>bs){bs=s;best=i}
  }
  if(best<0)best=p.sy*G.W+p.sx;
  p.x=best%G.W+.5;p.y=((best/G.W)|0)+.5;p.alive=true;p.invuln=2.6;p.path=[];p.thinkCD=.3;p.face=[0,1];
  emit('respawn',p.id);
}

// ---------- AI ----------
function puValue(p,t){
  switch(PU_TYPES[t-1]){
    case'bomb':return p.bombsMax<4?1.2:.5;case'fire':return p.range<4?1.2:.45;case'speed':return p.speedLvl<3?1.1:.25;
    case'kick':return p.kick?.1:.6;case'pierce':return p.pierce?.1:.8;case'shield':return p.shield?.2:1;case'life':return 1.5;
  }return .5;
}
function bricksHit(i,p,D){let n=0;const c=blastCells(i%G.W,(i/G.W)|0,p.range,p.pierce,G.bombOcc);for(const j of c)if(G.grid[j]===2&&D.st[j]===INF)n++;return n}
function inLine(a,b,range){
  const W=G.W,ax=a%W,ay=(a/W)|0,bx=b%W,by=(b/W)|0;
  if(ax!==bx&&ay!==by)return false;const d=Math.abs(ax-bx)+Math.abs(ay-by);if(d>range)return false;
  const sx=Math.sign(bx-ax),sy=Math.sign(by-ay);
  for(let k=1;k<d;k++){const g=G.grid[(ay+sy*k)*W+ax+sx*k];if(g!==0)return false}
  return true;
}
function bombValue(p,c,D){
  const prof=p.prof,cx=c%G.W,cy=(c/G.W)|0;
  const blast=blastCells(cx,cy,p.range,p.pierce,G.bombOcc);const bs=new Set(blast);
  let bricks=0,hits=0,trap=0,lostPU=0;
  for(const j of blast){if(G.grid[j]===2&&D.st[j]===INF)bricks++;if(G.pu[j])lostPU++}
  const D2=computeDanger({cx,cy,range:p.range,pierce:p.pierce,t:FUSE});
  for(const e of enemiesOf(p)){
    if(e.invuln>.8)continue;const ec=cellOf(e);
    if(bs.has(ec))hits++;
    if(Math.abs(ec%G.W-cx)+Math.abs(((ec/G.W)|0)-cy)<=p.range+3){
      const R=bfs(e,D2,0,ec,0,c);let ref=0;
      for(const v of R.order){if(D2.st[v]===INF){ref++;if(ref>3)break}}
      if(ref===0)trap+=1;else if(ref<=2)trap+=.4;else if(ref<=3&&bs.has(ec))trap+=.15;
    }
  }
  const R2=bfs(p,D2,prof.margin,c,0,-1);let escT=INF,refs=0;
  for(const v of R2.order)if(v!==c&&D2.st[v]===INF){if(!refs)escT=R2.arr[v];refs++;if(refs>=4)break}
  // a robust escape needs several refuges, or one rival could seal the corridor
  let need=prof.need||1;
  if(need>1){let close=false;for(const e of enemiesOf(p)){if(e.active>=e.bombsMax)continue;const ec=cellOf(e);if(Math.abs(ec%G.W-cx)+Math.abs(((ec/G.W)|0)-cy)<=3)close=true}if(!close)need=Math.min(need,2)}
  const escape=refs>=need;
  const score=prof.brick*bricks+prof.attack*hits*.8+prof.trap*G.diff.trap*trap*2-lostPU*prof.pick*.6;
  return {score,escape,escT,bricks,trap};
}
function goPath(p,R,target,goal){
  const path=[];let c=target;
  while(c>=0&&R.dist[c]>0){path.unshift(c);c=R.par[c]}
  p.path=path;p.goal=goal;p.planAt=G.time;p.stuck=0;
}
function think(p){
  const prof=p.prof,D=G.danger,me=cellOf(p),W=G.W;
  const react=prof.react*G.diff.react,mist=prof.mistake*G.diff.mist;
  p.thinkCD=.9+Math.random()*.5;
  const t0=(Math.abs(p.x-(me%W+.5))+Math.abs(p.y-(((me/W)|0)+.5)))/SPD(p);
  let R=bfs(p,D,prof.margin,me,t0,-1);
  // 1) flee
  if(D.st[me]<INF){
    let best=-1,bs=-1e9;
    const pick=()=>{for(const v of R.order){if(D.st[v]===INF){const s=-R.arr[v]*3+openness(v)*.35+Math.random()*.1;if(s>bs){bs=s;best=v}}}};
    pick();
    if(best<0&&prof.margin>0){R=bfs(p,D,0,me,t0,-1);pick()}
    if(best<0){for(const v of R.order){const s=Math.min(D.st[v],60)-R.arr[v];if(s>bs){bs=s;best=v}}}
    goPath(p,R,best,'flee');p.thinkCD=.35;return;
  }
  const canBomb=p.active<p.bombsMax;
  // 2) chaos
  if(prof.chaos&&Math.random()<prof.chaos*.5&&canBomb){
    const bv=bombValue(p,me,D);if(bv.escape){placeBomb(p);p.path=[];p.thinkCD=.03;return}
  }
  // 3) bomb here?
  if(canBomb&&!((p.bad.get(me)||0)>G.time)){
    const bv=bombValue(p,me,D);
    const ok=bv.escape||Math.random()<mist;
    if(bv.score>=prof.minBomb&&ok){placeBomb(p);p.path=[];p.goal='';p.thinkCD=.03;return}
    if(bv.score>=prof.minBomb)p.bad.set(me,G.time+2.5);
  }
  // 4) pick a destination
  const en=enemiesOf(p).filter(e=>e.invuln<1);const ecells=en.map(cellOf);
  let best=-1,bs=-1e9;
  for(const v of R.order){
    const d=R.dist[v];if(d>18)break;
    const safe=D.st[v]===INF;let s=0,any=false;
    const pu=G.pu[v];
    if(pu&&D.st[v]>R.arr[v]+.5){s+=prof.pick*puValue(p,pu)*5/(d+2);any=true}
    if(!safe&&!any)continue;
    if(safe&&canBomb&&!((p.bad.get(v)||0)>G.time)&&v!==me){
      const nb=bricksHit(v,p,D);if(nb)s+=prof.brick*nb*2.4/(d+3);
      for(const ec of ecells)if(inLine(v,ec,p.range))s+=prof.attack*2.4/(d+2);
    }
    if(ecells.length&&prof.hunt>0){
      let ed=99;const vx=v%W,vy=(v/W)|0;
      for(const ec of ecells)ed=Math.min(ed,Math.abs(ec%W-vx)+Math.abs(((ec/W)|0)-vy));
      s+=prof.hunt*1.3/(ed+1.5)*(canBomb?1:.3);
    }
    s+=openness(v)*.02+Math.random()*.04;
    if(v===me)s*=.6;
    if(s>bs){bs=s;best=v}
  }
  // 5) refine: evaluate real trap value of the best spots near rivals
  if(canBomb&&ecells.length&&prof.trap>0){
    const near=[];
    for(const v of R.order){const d=R.dist[v];if(d>7)break;if(D.st[v]!==INF||v===me||(p.bad.get(v)||0)>G.time)continue;
      const vx=v%W,vy=(v/W)|0;let ed=99;for(const ec of ecells)ed=Math.min(ed,Math.abs(ec%W-vx)+Math.abs(((ec/W)|0)-vy));
      if(ed<=p.range+2)near.push([ed+d*.5,v,d])}
    near.sort((a,b)=>a[0]-b[0]);
    for(const [,v,d] of near.slice(0,G.diff.trap>=1?6:3)){
      const bv=bombValue(p,v,D);if(!bv.escape||bv.trap<=0)continue;
      const s=prof.trap*G.diff.trap*bv.trap*3.2/(d+1)+Math.random()*.03;
      if(s>bs){bs=s;best=v}
    }
  }
  if(best<0||bs<.09){
    const opts=R.order.filter(v=>R.dist[v]>=2&&R.dist[v]<=6&&D.st[v]===INF);
    if(opts.length){goPath(p,R,opts[Math.floor(Math.random()*opts.length)],'wander');return}
    p.path=[];p.thinkCD=.4;return;
  }
  goPath(p,R,best,'go');
  if(!p.path.length)p.thinkCD=.4;
}
function botUpdate(p,dt){
  const D=G.danger,me=cellOf(p),prof=p.prof;
  const react=prof.react*G.diff.react;
  p.thinkCD-=dt;
  if(D.st[me]<INF&&p.goal!=='flee'&&p.thinkCD>react)p.thinkCD=react;
  if(p.path.length){
    const v=p.path[0];
    const tArr=(Math.abs(v%G.W+.5-p.x)+Math.abs(((v/G.W)|0)+.5-p.y))/SPD(p);
    const bad=G.grid[v]!==0||G.bombOcc[v]>=0||(D.st[v]-prof.margin<tArr+.25&&D.en[v]+prof.margin>tArr-.1);
    if(bad){
      const urgent=D.st[me]<INF;
      if(urgent)p.thinkCD=Math.min(p.thinkCD,p.goal==='flee'?0:react);else if(p.thinkCD>react)p.thinkCD=react;
      // instinct: never step into live fire
      if(G.flame[v]>0&&!(D.st[me]<=.05)){p.moving=false;if(p.thinkCD<=0)think(p);return}}
    if(G.time-p.planAt>1.6&&p.goal!=='flee'&&p.thinkCD>.1)p.thinkCD=.1;
  }else if(p.thinkCD>react*.6&&G.time-p.planAt>.25)p.thinkCD=Math.min(p.thinkCD,react*.6+.05);
  if(p.thinkCD<=0)think(p);
  // steer
  if(!p.path.length){p.moving=false;return}
  const v=p.path[0],tx=v%G.W+.5,ty=((v/G.W)|0)+.5;
  const ddx=tx-p.x,ddy=ty-p.y,step=SPD(p)*dt;
  if(Math.abs(ddx)<=step&&Math.abs(ddy)<=step){p.x=tx;p.y=ty;p.path.shift();p.moving=true;if(!p.path.length&&p.thinkCD>react*.5)p.thinkCD=react*.5;return}
  const moved=Math.abs(ddx)>Math.abs(ddy)?tryMove(p,Math.sign(ddx),0,dt):tryMove(p,0,Math.sign(ddy),dt);
  p.moving=moved;
  if(!moved){p.stuck+=dt;if(p.stuck>.35){p.path=[];p.thinkCD=0;p.stuck=0}}else p.stuck=0;
}

// ---------- special maps ----------
const ROLL_T0=6,ROLL_P=8.5,ROLL_WARN=1.6,ROLL_V=7;
function rollerState(g,t){
  if(!g||g.special!=='roller'||!g.lanes.length||g.sudden)return null;
  const k=Math.floor((t-ROLL_T0+ROLL_WARN)/ROLL_P);if(k<0)return null;
  const st=ROLL_T0+k*ROLL_P,lane=g.lanes[k%g.lanes.length],dir=Math.floor(k/g.lanes.length)%2?-1:1;
  if(t<st)return {k,lane,dir,warn:true,start:st};
  const d=(t-st)*ROLL_V;if(d>g.W-3)return null;
  return {k,lane,dir,warn:false,start:st,x:dir>0?1.5+d:g.W-1.5-d};
}
function rollerDanger(st,en){
  for(const dt0 of [0,ROLL_P]){
    const rs=rollerState(G,G.time+dt0+.01);if(!rs)continue;
    const s0=rs.start-G.time;if(s0>4.5)continue;
    for(let x=1;x<G.W-1;x++){const i=rs.lane*G.W+x,from=rs.dir>0?1.5:G.W-1.5,ta=s0+Math.abs(x+.5-from)/ROLL_V;if(ta<-.4)continue;
      st[i]=Math.min(st[i],Math.max(0,ta-.4));en[i]=Math.max(en[i],ta+.4)}
  }
}
function stepRoller(){
  const rs=rollerState(G,G.time);if(!rs||rs.warn)return;
  for(const p of G.players)if(p.alive&&Math.floor(p.y)===rs.lane&&Math.abs(p.x-rs.x)<.8)hit(p,null,true);
  for(const b of G.bombs)if(b.cy===rs.lane&&Math.abs(b.x-rs.x)<.8&&b.t>.05)b.t=.05;
  const i=rs.lane*G.W+Math.floor(rs.x);if(G.pu[i]){G.pu[i]=0;emit('puburn',i)}
}
const SHIFT_P=7,SHIFT_WARN=1.6;
function stepPuzzle(){
  if(G.special!=='puzzle'||G.sudden)return;
  if(G.shiftAt==null){G.shiftAt=8;G.shiftRng=mulberry32(G.seed+991)}
  if(!G.nextShift&&G.time>=G.shiftAt-SHIFT_WARN){
    const r=G.shiftRng,axis=r()<.5?'row':'col',max=axis==='row'?G.H-2:G.W-2;const lines=[];for(let v=1;v<=max;v+=2)lines.push(v);
    G.nextShift={axis,line:lines[Math.floor(r()*lines.length)],dir:r()<.5?-1:1};emit('shiftwarn',G.nextShift.axis,G.nextShift.line,G.nextShift.dir);
  }
  if(G.nextShift&&G.time>=G.shiftAt){const s=G.nextShift;applyShift(G,s.axis,s.line,s.dir);emit('shift',s.axis,s.line,s.dir);G.nextShift=null;G.shiftAt+=SHIFT_P}
}
function lineCells(g,axis,line){const out=[];if(axis==='row')for(let x=1;x<g.W-1;x++)out.push(line*g.W+x);else for(let y=1;y<g.H-1;y++)out.push(y*g.W+line);return out}
function rotateArrays(g,axis,line,dir,arrays){
  const c=lineCells(g,axis,line),L=c.length;
  for(const a of arrays){if(!a)continue;const v=c.map(i=>a[i]);for(let k=0;k<L;k++)a[c[((k+dir)%L+L)%L]]=v[k]}
}
function applyShift(g,axis,line,dir){
  rotateArrays(g,axis,line,dir,[g.grid,g.hidden,g.pu,g.puT,g.puDrop,g.flame,g.flameOwner,g.burn,g.tile]);
  const L=axis==='row'?g.W-2:g.H-2,wrap=v=>((v-1+dir)%L+L)%L+1;
  for(const b of g.bombs){if(axis==='row'&&b.cy===line){b.cx=wrap(b.cx);b.x=b.cx+.5;b.slide=null}else if(axis==='col'&&b.cx===line){b.cy=wrap(b.cy);b.y=b.cy+.5;b.slide=null}}
  for(const p of g.players){if(!p.alive)continue;
    if(axis==='row'&&Math.floor(p.y)===line){const c=Math.floor(p.x);p.x=wrap(c)+(p.x-c)}
    else if(axis==='col'&&Math.floor(p.x)===line){const c=Math.floor(p.y);p.y=wrap(c)+(p.y-c)}
    else continue;
    p.path=[];p.thinkCD=Math.min(p.thinkCD,.05)}
  if(g===G)rebuildOcc();
}
// ---------- simulation step ----------
const DV=[null,[-1,0],[1,0],[0,-1],[0,1]];
function drainInputs(p){const inp=G.inputs[p.id];if(inp&&inp.q.length){inp.ack=inp.q[inp.q.length-1][0];inp.q.length=0;inp.budget=0}}
function humanStep(p,dt){
  const inp=G.inputs[p.id]||(G.inputs[p.id]={q:[],dir:0,bomb:false,budget:0,ack:0});
  if(G.net){
    inp.budget=Math.min(.35,inp.budget+dt);let moved=false;
    while(inp.q.length&&inp.q[0][2]<=inp.budget+1e-6){
      const m=inp.q.shift();inp.budget-=m[2];
      if(m[1]){const v=DV[m[1]];moved=tryMove(p,v[0],v[1],m[2])||moved;p.face=[v[0],v[1]]}
      if(m[3])placeBomb(p);
      inp.ack=m[0];
    }
    if(inp.q.length>45)inp.q.splice(0,inp.q.length-45);
    p.moving=moved;
  }else{
    if(inp.dir){const v=DV[inp.dir];p.moving=tryMove(p,v[0],v[1],dt);p.face=[v[0],v[1]]}else p.moving=false;
    if(inp.bomb){inp.bomb=false;placeBomb(p)}
  }
}
function step(dt){
  G.time+=dt;
  if(G.done)return;
  if(G.countdown>0){G.countdown-=dt;for(const p of G.players)if(p.human)drainInputs(p);if(G.countdown<=0)emit('go');return}
  const W=G.W;
  const before=G.players.filter(p=>p.alive||p.lives>0);
  rebuildOcc();
  for(const b of G.bombs){
    if(b.slide){
      const [dx,dy]=b.slide;b.x+=dx*SLIDE*dt;b.y+=dy*SLIDE*dt;
      const cx=Math.floor(b.x),cy=Math.floor(b.y),cc=[cx+.5,cy+.5];
      const past=dx>0?b.x>=cc[0]:dx<0?b.x<=cc[0]:dy>0?b.y>=cc[1]:b.y<=cc[1];
      b.cx=cx;b.cy=cy;rebuildOcc();
      const nx=cx+dx,ny=cy+dy,body=G.players.some(q=>q.alive&&Math.abs(q.x-(nx+.5))<.95&&Math.abs(q.y-(ny+.5))<.95);
      if(past&&(!bombFree(nx,ny)||body)){b.x=cc[0];b.y=cc[1];b.slide=null}
    }
    b.t-=dt;
  }
  let again=true;while(again){again=false;for(const b of G.bombs)if(b.t<=0){explode(b);again=true;break}}
  for(let i=0;i<G.N;i++){
    if(G.flame[i]>0){G.flame[i]-=dt;if(G.flame[i]<0)G.flame[i]=0}
    if(G.grid[i]===3){G.burn[i]-=dt;if(G.burn[i]<=0){G.grid[i]=0;if(G.hidden[i]){G.pu[i]=G.hidden[i];G.puT[i]=G.time;G.puDrop[i]=0;G.hidden[i]=0;emit('drop',i)}}}
  }
  // sudden death
  if(!G.sudden&&G.time>=G.suddenAt+(G.demo?-60:0)){G.sudden=true;G.fallTimer=1.2;emit('sudden')}
  if(G.sudden&&G.endT<0){
    G.fallTimer-=dt;
    while(G.fallTimer<=0&&G.fallIdx<G.fallOrder.length){const i=G.fallOrder[G.fallIdx++];if(G.grid[i]!==1)G.drops.push({i,t:DROP_T});G.fallTimer+=FALL_DT}
    for(const d of G.drops){d.t-=dt;if(d.t<=0)land(d.i)}
    G.drops=G.drops.filter(d=>d.t>0);
  }
  // power-up rain: rarer at first, heavy near the end, biased to the centre
  G.puRain-=dt;
  if(G.puRain<=0){
    const f=Math.min(1,G.time/G.suddenAt);
    G.puRain=(G.sudden?1.3:11-8.5*f*f)*(.7+Math.random()*.6);
    rainPU();if(f>.7&&Math.random()<f-.5)rainPU();
  }
  stepPuzzle();stepRoller();
  rebuildOcc();
  G.danger=computeDanger(null);
  // players
  for(const p of G.players){
    if(!p.alive){p.dead+=dt;if(p.human)drainInputs(p);if(p.lives>0){p.respawnT-=dt;if(p.respawnT<=0)respawn(p)}continue}
    p.invuln=Math.max(0,p.invuln-dt);
    if(p.human)humanStep(p,dt);else botUpdate(p,dt);
  }
  // pass sets
  for(const b of G.bombs){const bi=b.cy*G.W+b.cx;for(const id of b.pass){const q=G.players[id];if(!q.alive||cellOf(q)!==bi)b.pass.delete(id)}
    for(const q of G.players)if(q.alive&&!b.pass.has(q.id)&&cellOf(q)===bi)b.pass.add(q.id)}
  // hits & pickups
  for(const p of G.players){
    if(!p.alive)continue;const c=cellOf(p);
    if(G.flame[c]>0)hit(p,G.flameOwner[c]);
    if(p.alive&&G.pu[c]){applyPU(p,G.pu[c]);G.pu[c]=0}
  }
  // end
  const left=G.players.filter(p=>p.alive||p.lives>0);
  if(G.endT<0&&left.length<=1){G.endT=1.8;G.winnerId=left.length?left[0].id:-1;
    if(!left.length&&before.length){const sc=p=>p.kills*100-p.deaths;const mk=Math.max(...before.map(sc));const top=before.filter(p=>sc(p)===mk);if(top.length===1)G.winnerId=top[0].id}if(left[0])left[0].invuln=99}
  if(G.endT>0){G.endT-=dt;if(G.endT<=0)endRound(false)}
}
function rainPU(force){
  let onFloor=0;for(let i=0;i<G.N;i++)if(G.pu[i])onFloor++;
  if(!force&&onFloor>=4+G.players.length)return;
  const D=G.danger,cx=G.W/2,cy=G.H/2,c=[];let tot=0;
  for(let i=0;i<G.N;i++){
    if(G.grid[i]!==0||G.pu[i]||G.bombOcc[i]>=0||G.flame[i]>0||D.st[i]!==INF)continue;
    const x=i%G.W+.5,y=((i/G.W)|0)+.5;const w=1/(1+.3*(Math.abs(x-cx)+Math.abs(y-cy)));c.push([i,w]);tot+=w;
  }
  if(!c.length)return;let r=Math.random()*tot;let i=c[c.length-1][0];
  for(const [j,w] of c){r-=w;if(r<=0){i=j;break}}
  G.pu[i]=pickPU(Math.random);G.puT[i]=G.time;G.puDrop[i]=1;emit('rain',i);
}
function land(i){
  G.grid[i]=1;G.hidden[i]=0;G.pu[i]=0;G.flame[i]=0;
  const j=G.bombOcc[i];if(j>=0){const b=G.bombs[j];G.bombs.splice(j,1);G.players[b.owner].active=Math.max(0,G.players[b.owner].active-1);rebuildOcc()}
  for(const p of G.players)if(p.alive&&cellOf(p)===i)hit(p,null,true);
  emit('land',i);
}

// ---------- round lifecycle ----------
function createGame(o){
  const n=o.slots.length;
  const [W,H]=sizeFor(n),N=W*H;
  const spawns=spawnsFor(W,H).slice(0,n);
  const m=buildMap(o.map,W,H,o.seed,spawns);
  const g={map:o.map,seed:o.seed,W,H,N,grid:m.grid,hidden:m.hidden,pu:new Uint8Array(N),puT:new Float64Array(N),puDrop:new Uint8Array(N),
    flame:new Float32Array(N),flameOwner:new Int8Array(N),burn:new Float32Array(N),bombOcc:new Int16Array(N).fill(-1),
    bombs:[],bombSeq:0,players:[],drops:[],time:0,countdown:o.demo?.2:2.4,sudden:false,
    suddenAt:n<=4?90:n<=8?110:130,puRain:6,round:o.round||0,fallOrder:spiral(W,H),fallIdx:0,fallTimer:0,elim:[],done:false,endT:-1,winnerId:-1,
    demo:!!o.demo,net:!!o.net,NB:[1,-1,W,-W],danger:null,diff:DIFFS[o.diff]||DIFFS.dificil,ev:[],inputs:{},result:null,
    special:THEMES[o.map].special||null,lanes:m.lanes,tile:m.tile,shiftAt:null,nextShift:null};
  o.slots.forEach((s,k)=>{
    const [sx,sy]=spawns[k];const pk=PROFILES[s.prof]?s.prof:PROF_KEYS[k%PROF_KEYS.length];
    g.players.push({id:k,human:!!s.human,name:s.name,color:s.color,profKey:pk,prof:PROFILES[pk],sx,sy,x:sx+.5,y:sy+.5,face:[0,1],moving:false,
      speedLvl:0,bombsMax:1,range:1,kick:false,pierce:false,shield:false,lives:2,streak:0,lastKill:-9,alive:true,dead:0,respawnT:0,invuln:0,
      kills:0,deaths:0,active:0,picks:[],path:[],goal:'',thinkCD:.2+Math.random()*.6,planAt:0,bad:new Map(),stuck:0});
  });
  const prev=G;G=g;g.danger=computeDanger(null);if(prev&&prev!==g)G=g;
  return g;
}
function endRound(early){
  if(G.done)return;G.done=true;
  const alive=G.winnerId>=0?[G.players[G.winnerId]]:G.players.filter(p=>p.alive||p.lives>0).sort((a,b)=>b.lives-a.lives||b.kills-a.kills);
  const order=[...new Set([...alive,...G.elim.slice().reverse().map(id=>G.players[id]),...G.players])].map(p=>p.id);
  G.result={order,draw:G.winnerId<0&&!early,winnerId:G.winnerId,early:!!early};
  emit('end');
}
// Predicted finish order, used when a round is ended early. Pairwise logistic model fitted on
// ~480 simulated rounds (63% pairwise accuracy on 159 held-out rounds; winner picked 39% vs 17% by chance).
const PRED={lives:.449,alive:.034,bombs:-.044,range:.019,speed:.236,kick:.118,pierce:.055,shield:.297,kills:.018,danger:-.015,suddenLives:-.054,
  prof:{tactico:.032,cazador:-.085,recolector:.159,prudente:.145,caotico:-.119,novato:-.132}};
function predictScore(p){
  const D=G.danger,inD=p.alive&&D&&D.st[cellOf(p)]<INF?1:0;
  return PRED.lives*p.lives+PRED.alive*(p.alive?1:0)+PRED.bombs*(p.bombsMax-1)+PRED.range*(p.range-1)+PRED.speed*p.speedLvl+PRED.kick*(p.kick?1:0)+PRED.pierce*(p.pierce?1:0)
    +PRED.shield*(p.shield?1:0)+PRED.kills*p.kills+PRED.danger*inD+PRED.suddenLives*(G.sudden?p.lives:0)+(PRED.prof[p.profKey]||0);
}
function endRoundPredicted(){
  if(G.done)return;
  const live=G.players.filter(p=>p.alive||p.lives>0);
  if(!live.length){endRound(false);return}
  const sc=new Map(live.map(p=>[p,predictScore(p)]));
  live.sort((a,b)=>sc.get(b)-sc.get(a));
  const Z=live.reduce((s,p)=>s+Math.exp(sc.get(p)),0),prob={};for(const p of live)prob[p.id]=Math.exp(sc.get(p))/Z;
  const order=[...new Set([...live,...G.elim.slice().reverse().map(id=>G.players[id]),...G.players])].map(p=>p.id);
  G.done=true;G.result={order,draw:false,winnerId:order[0],early:true,predicted:true,prob};
  emit('end');
}
function cheat(p,kind){
  if(!p||!G||G.done||G.countdown>0)return;
  if(kind==='rain'){for(let k=0;k<12;k++)rainPU(true)}
  else if(kind==='max'&&p.alive){p.bombsMax=8;p.range=8;p.speedLvl=5;p.kick=true;p.pierce=true;p.shield=true;emit('max',p.id)}
}
function setHuman(p,on,name){
  p.human=!!on;if(name)p.name=name;
  if(!on){p.path=[];p.thinkCD=.15;p.goal=''}
  if(G&&G.inputs)G.inputs[p.id]={q:[],dir:0,bomb:false,budget:0,ack:G.inputs[p.id]?G.inputs[p.id].ack:0};
}
// ---------- tournament ----------
function newTour(){return {round:0,pts:{},kills:{},wins:{}}}
function scoreRound(T,g){
  const r=g.result,gain={};
  r.order.forEach((id,k)=>{const p=g.players[id];gain[id]=(r.draw&&k===0?PLACE[1]:PLACE[k]||0)+2*p.kills;T.pts[id]=(T.pts[id]||0)+gain[id];T.kills[id]=(T.kills[id]||0)+p.kills});
  if(!r.draw)T.wins[r.order[0]]=(T.wins[r.order[0]]||0)+1;
  return gain;
}
function standings(T,ids){return ids.slice().sort((a,b)=>(T.pts[b]||0)-(T.pts[a]||0)||(T.wins[b]||0)-(T.wins[a]||0)||(T.kills[b]||0)-(T.kills[a]||0))}

return {FUSE,FLAME,SLIDE,FALL_DT,DROP_T,DIRS,DV,PU,PU_TYPES,PROFILES,PROF_KEYS,DIFFS,COLORS,NAMES,TOUR_LEN,PLACE,THEMES,
  sizeFor,spawnsFor,buildMap,setG,createGame,step,endRound,endRoundPredicted,cheat,rollerState,applyShift,rotateArrays,setHuman,tryMove,rebuildOcc,computeDanger,cellOf,SPD,
  newTour,scoreRound,standings};
});

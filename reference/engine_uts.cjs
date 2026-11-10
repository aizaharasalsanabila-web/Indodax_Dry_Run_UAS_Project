/* Ells'land A/B ATR4 — causal daily-bar engine, port of ab_journal_engine_v3.py.
   Orders/quantities fixed at prior close. Opens precede intraday stops.
   Initial ATR stop is FIXED; no trailing stop and no fixed profit target. */
const QuantEngine=(()=>{
let D,N,A;
const sum=xs=>xs.reduce((a,b)=>a+b,0),finite=Number.isFinite;
function prepare(data){
 D=data.dates;N=data.names;A={};
 const fields=['open','high','low','close','volume','ema20','rsi2','ema50','ema50','ema80','ema100','ema120','ema150','ema200','atr','slope','roc','mom','turn','adv','advvalue','warm','brk50','brk80','brk100','brk120','brk150','broken50','broken80','broken100','broken120','broken150','mom9','mark','returns'];
 for(const key of fields)A[key]=D.map(()=>new Float64Array(N.length).fill(NaN));
 if(data.arrays){for(const key of data.fields)A[key]=data.arrays[key].map(row=>Float64Array.from(row,v=>v===null?NaN:v));return {dates:D,names:N};}
 for(let k=0;k<N.length;k++){
  const rows=data.series[k],cl=rows.map(r=>r[4]),hi=rows.map(r=>r[2]),vol=rows.map(r=>r[5]),ema={20:[],50:[],80:[],100:[],120:[],150:[],200:[]},atr=[];let gain=0,loss=0;
  for(let t=0;t<rows.length;t++){
   const [i,o,h,l,c,v]=rows[t];A.open[i][k]=o;A.high[i][k]=h;A.low[i][k]=l;A.close[i][k]=c;A.volume[i][k]=v;
   for(const n of [20,50,80,100,120,150,200]){const alpha=2/(n+1);ema[n][t]=t?(1-alpha)*ema[n][t-1]+alpha*c:c;A['ema'+n][i][k]=ema[n][t];}
   if(t>0){const change=c-cl[t-1];gain=t===1?Math.max(change,0):.5*gain+.5*Math.max(change,0);loss=t===1?Math.max(-change,0):.5*loss+.5*Math.max(-change,0);}A.rsi2[i][k]=t>=2?(gain+loss>0?100*gain/(gain+loss):50):NaN;
   const tr=t?Math.max(h-l,Math.abs(h-cl[t-1]),Math.abs(l-cl[t-1])):h-l;atr[t]=t?.95*atr[t-1]+.05*tr:tr;A.atr[i][k]=atr[t];
   A.slope[i][k]=t>=20?ema[200][t]/ema[200][t-20]-1:NaN;A.roc[i][k]=t>=252?c/cl[t-252]-1:NaN;A.mom[i][k]=t>=252?cl[t-21]/cl[t-252]-1:NaN;A.warm[i][k]=t>=300?1:0;A.broken100[i][k]=t>0&&c<ema[100][t]&&cl[t-1]<ema[100][t-1]?1:0;
   if(t>=59){const turn=rows.slice(t-59,t+1).map(r=>r[4]*r[5]).sort((a,b)=>a-b);A.turn[i][k]=(turn[29]+turn[30])/2;}
   if(t>=19){let vtotal=0;for(let j=t-19;j<=t;j++)vtotal+=vol[j];A.adv[i][k]=vtotal/20;A.advvalue[i][k]=sum(rows.slice(t-19,t+1).map(r=>r[4]*r[5]))/20;}
   A.mom9[i][k]=t>=189?cl[t-21]/cl[t-189]-1:NaN;
   for(const period of [50,80,120,150])A['broken'+period][i][k]=t>0&&c<ema[period][t]&&cl[t-1]<ema[period][t-1]?1:0;
   for(const period of [50,80,100,120,150])if(t>=period){let max=-Infinity;for(let j=t-period;j<t;j++)max=Math.max(max,hi[j]);A['brk'+period][i][k]=max*1.005;}
  }
  let mark=NaN;for(let i=0;i<D.length;i++){const prev=mark;if(finite(A.close[i][k]))mark=A.close[i][k];A.mark[i][k]=mark;A.returns[i][k]=finite(prev)?mark/prev-1:NaN;}
 }
 return {dates:D,names:N};
}
function corr(i,k,j){let n=0,sx=0,sy=0;const xs=[],ys=[];for(let t=Math.max(0,i-59);t<=i;t++){const x=A.returns[t][k],y=A.returns[t][j];if(finite(x)&&finite(y)){xs.push(x);ys.push(y);sx+=x;sy+=y;n++;}}if(n<40)return 0;const mx=sx/n,my=sy/n;let xx=0,yy=0,xy=0;for(let t=0;t<n;t++){const x=xs[t]-mx,y=ys[t]-my;xx+=x*x;yy+=y*y;xy+=x*y;}return xx>0&&yy>0?xy/Math.sqrt(xx*yy):0;}
function tick(x){return x<200?1:x<500?2:x<2000?5:x<5000?10:25;}
function roundTick(x,buy){let y=x;for(let j=0;j<4;j++){const t=tick(y),z=(buy?Math.ceil(x/t-1e-10):Math.floor(x/t+1e-10))*t;if(Math.abs(y-z)<1e-8)return z;y=z;}return y;}
function fillPrice(raw,buy,cost=1){if(!cost)return raw;return Math.max(1,roundTick(raw+(buy?1:-1)*tick(raw)*cost,buy));}
const defaults={start:'2016-01-01',end:'2025-12-31',capital:1e9,risk:.015,totalrisk:.09,maxweight:.15,gross:.90,stopatr:4,cost:1,guard:true,modules:'AB',watchN:100,bTop:16,exitPeriod:100,breakPeriod:100,momentumMonths:12,brake:false,delay:0,exclude:[]};
function run(options={},progress=()=>{}){
 const c={...defaults,...options};
 if(!['AB','A','B'].includes(c.modules)||![50,80,100,120,150].includes(c.exitPeriod)||![50,80,100,120,150].includes(c.breakPeriod)||![9,12].includes(c.momentumMonths)||!Number.isInteger(c.bTop)||c.bTop<1||c.bTop>32||!(c.capital>0)||!(c.risk>0&&c.risk<=.03)||!(c.totalrisk>=c.risk&&c.totalrisk<=.12)||!(c.maxweight>0&&c.maxweight<=.2)||!(c.stopatr>=2&&c.stopatr<=6)||!(c.cost>=0&&c.cost<=3)||![0,1].includes(c.delay)||!Array.isArray(c.exclude))throw Error('Parameter strategi tidak valid.');
 const momKey=c.momentumMonths===9?'mom9':'mom',breakKey='brk'+c.breakPeriod,brokenKey='broken'+c.exitPeriod,excluded=new Set(c.exclude);
 const begin=D.findIndex(x=>x>=c.start);let n=D.findIndex(x=>x>c.end);if(n<0)n=D.length;if(begin<0||begin>=n)throw Error('Tidak ada sesi pada periode ini.');
 let settled=c.capital,receipts=[],buys=[],fees=0,spreads=0,highwater=c.capital;const pos=new Map(),sales=new Map(),cooldown=new Map(),equity=[],trades=[],events=[],plans=[];const buyFee=.0015*c.cost,sellFee=.0025*c.cost;
 function sell(k,i,raw,reason,stage){const p=pos.get(k),px=fillPrice(raw,false,c.cost);if(!(i>0&&p.q*px<=.05*A.advvalue[i-1][k]))return false;pos.delete(k);const exitFee=p.q*px*sellFee,exitSpread=p.q*(raw-px),net=p.q*px-exitFee;receipts.push({due:i+3,amount:net});sales.delete(k);cooldown.set(k,i);fees+=exitFee;spreads+=exitSpread;const pnl=net-p.spent;trades.push({id:N[k]+'_'+D[p.i]+'_'+p.m,ticker:N[k],module:p.m,entry_date:D[p.i],entry_time:'Open (jam tidak tersedia)',exit_date:D[i],exit_time:stage==='open'?'Open (jam tidak tersedia)':'Intraday stop (jam tidak tersedia)',q:p.q,lots:p.q/100,entry:p.fill,exit:px,entry_raw:p.raw,exit_raw:raw,entry_fee:p.entryFee,exit_fee:exitFee,entry_spread:p.entrySpread,exit_spread:exitSpread,cost:p.entryFee+exitFee+p.entrySpread+exitSpread,spent:p.spent,pnl,gross_pnl:p.q*(raw-p.raw),return_pct:pnl/p.spent*100,R_reference:pnl/p.initialrisk,holding_sessions:i-p.i,holding_days:(Date.parse(D[i])-Date.parse(D[p.i]))/864e5,reason,stage});events.push({date:D[i],stage,action:'sell',ticker:N[k],q:p.q,price:px,raw,reason});}

 for(let i=begin;i<n;i++){
  if((i-begin)%500===0)progress((i-begin)/(n-begin));
  const pending=[];for(const r of receipts){if(r.due<=i)settled+=r.amount;else pending.push(r);}receipts=pending;
  const op=A.open[i],feasible=k=>finite(op[k])&&op[k]>0&&A.volume[i][k]>0&&i>0&&A.volume[i-1][k]>0&&A.high[i-1][k]>A.low[i-1][k],sold=new Set();
  for(const [k,s]of sales)if(i>=s.due&&pos.has(k)&&feasible(k)){sell(k,i,op[k],s.reason,'open');sold.add(k);}
  for(const[k,p]of pos)if(feasible(k)&&op[k]<=p.stop){sell(k,i,op[k],'initial ATR gap stop','open');sold.add(k);}
  const duebuys=buys.filter(b=>b.due<=i);buys=buys.filter(b=>b.due>i);
  for(const o of duebuys){const k=o.k,q=o.q,px=fillPrice(op[k],true,c.cost);if(pos.has(k)||sold.has(k)||!feasible(k)||op[k]>o.limit||(o.m==='A'&&op[k]<o.level))continue;
   const entryFee=q*px*buyFee,entrySpread=q*(px-op[k]),spent=q*px+entryFee;if(spent>settled+1e-5)throw Error('Reservasi order melampaui kas settled.');settled-=spent;fees+=entryFee;spreads+=entrySpread;const dist=c.stopatr*o.atr;pos.set(k,{m:o.m,q,spent,fill:px,raw:op[k],entryFee,entrySpread,i,stop:px-dist,dist,initialrisk:q*dist});events.push({date:D[i],stage:'open',action:'buy',ticker:N[k],q,price:px,reason:o.m});}
  for(const[k,p]of pos)if(feasible(k)&&A.low[i][k]<=p.stop)sell(k,i,Math.min(op[k],p.stop),'initial ATR intraday stop','intraday');
  const mark=A.mark[i],value=sum([...pos].map(([k,p])=>p.q*mark[k])),unsettled=sum(receipts.map(r=>r.amount)),eq=settled+unsettled+value;
  if(settled < -1e-4||!finite(eq))throw Error('Rekonsiliasi kas tidak valid.');
  equity.push({date:D[i],equity:eq,settled_cash:settled,unsettled_cash:unsettled,stock_value:value,exposure:value/eq,positions:pos.size,fees_cumulative:fees,spread_cumulative:spreads,a_value:sum([...pos].filter(([,p])=>p.m==='A').map(([k,p])=>p.q*mark[k])),b_value:sum([...pos].filter(([,p])=>p.m==='B').map(([k,p])=>p.q*mark[k]))});
  const common=N.map((_,k)=>finite(A.close[i][k])&&A.warm[i][k]===1&&A.volume[i][k]>0&&finite(A.atr[i][k])&&A.atr[i][k]>0),count=common.filter(Boolean).length,breadth=count?common.filter((v,k)=>v&&A.close[i][k]>A.ema200[i][k]).length/count:0;
  const gross=c.guard?(breadth>=.5?c.gross:breadth>=.25?.45:0):c.gross;
  for(const[k,p]of pos)if(A[brokenKey][i][k]===1&&!sales.has(k))sales.set(k,{due:i+1+c.delay,reason:'two closes below trend MA'});
  const liquid=N.map((_,k)=>k).filter(k=>common[k]&&finite(A.turn[i][k])).sort((k,j)=>A.turn[i][j]-A.turn[i][k]||(N[k]<N[j]?-1:1));
  const allowed=new Set(liquid.slice(0,c.watchN).filter(k=>!excluded.has(N[k])));
  const monthly=i>0&&D[i].slice(0,7)!==D[i-1].slice(0,7),candidate=[],queued=new Set(buys.map(o=>o.k));
  const rankcmp=(key)=>(k,j)=>A[key][i][j]-A[key][i][k]||(N[k]<N[j]?-1:1);
  if(monthly&&c.modules.includes('B')){const ranks=N.map((_,k)=>k).filter(k=>common[k]&&allowed.has(k)&&A.turn[i][k]>=5e9&&A.close[i][k]>A.ema200[i][k]&&A.slope[i][k]>0&&finite(A[momKey][i][k])&&A[momKey][i][k]>0).sort(rankcmp(momKey));
   for(const k of ranks.slice(0,c.bTop))candidate.push({k,m:'B',score:A[momKey][i][k],level:0});}
  if(c.modules.includes('A')){const score=k=>A.roc[i][k]/(A.atr[i][k]/A.close[i][k]);const ranks=N.map((_,k)=>k).filter(k=>common[k]&&allowed.has(k)&&A.close[i][k]>A[breakKey][i][k]&&A.close[i][k]>A.ema50[i][k]&&A.ema50[i][k]>A.ema200[i][k]&&A.slope[i][k]>0&&A.roc[i][k]>0&&A.turn[i][k]>=5e8&&finite(score(k))).sort((k,j)=>score(j)-score(k)||(N[k]<N[j]?-1:1));for(const k of ranks)if(i-(cooldown.get(k)??-1000)>=10)candidate.push({k,m:'A',score:score(k),level:A[breakKey][i][k]});}
  let reserved=sum(buys.map(b=>b.reserved)),usedrisk=sum([...pos.values()].map(p=>p.initialrisk))+sum(buys.map(b=>b.risk)),newvalue=reserved;const counts={A:0,B:0};for(const p of pos.values())counts[p.m]++;for(const b of buys)counts[b.m]++;
  highwater=Math.max(highwater,eq);const accountDD=1-eq/highwater,riskScale=c.brake&&accountDD>=.15?.5:1;
  for(const entry of candidate){const k=entry.k,m=entry.m,limit=A.close[i][k]+A.atr[i][k],pricecap=fillPrice(limit,true,c.cost)*(1+buyFee),distance=c.stopatr*A.atr[i][k];
   if(pos.has(k)||queued.has(k)||counts[m]>=(m==='A'?6:8)||pos.size+buys.length>=12)continue;
   let shares=Math.min(c.maxweight*eq/pricecap,Math.max(0,settled-reserved)/pricecap,Math.max(0,gross*eq-value-newvalue)/pricecap,.01*A.adv[i][k],.05*A.advvalue[i][k]/pricecap,c.risk*riskScale*eq/(distance+pricecap*(buyFee+sellFee)+2*c.cost*tick(limit)),Math.max(0,c.totalrisk*riskScale*eq-usedrisk)/(distance+pricecap*(buyFee+sellFee)+2*c.cost*tick(limit)));
   if(c.guard&&shares>0){let linked=0;for(const[j,p]of pos)if(corr(i,k,j)>.75)linked+=p.q*mark[j];for(const b of buys)if(corr(i,k,b.k)>.75)linked+=b.reserved;shares=Math.min(shares,Math.max(0,.25*eq-linked)/pricecap);}
   const lot=100,q=Math.floor(shares/lot)*lot;if(q<lot)continue;
   const reserve=q*pricecap,risk=q*distance,o={...entry,q,atr:A.atr[i][k],limit,signal:i,due:i+1+c.delay,reserved:reserve,risk};buys.push(o);queued.add(k);reserved+=reserve;newvalue+=reserve;usedrisk+=risk;counts[m]++;plans.push({signal_date:D[i],due_index:i+1+c.delay,risk_scale:riskScale,ticker:N[k],module:m,q,limit,reference_sizing_distance:distance,actual_stop_distance:c.stopatr*A.atr[i][k],reserved:reserve,breadth});}
 }
 const last=n-1,latest=equity.at(-1),common=N.map((_,k)=>k).filter(k=>finite(A.close[last][k])&&A.warm[last][k]===1&&A.volume[last][k]>0&&A.atr[last][k]>0),breadth=common.length?common.filter(k=>A.close[last][k]>A.ema200[last][k]).length/common.length:0;
 const bRanks=common.filter(k=>A.turn[last][k]>=5e9&&A.close[last][k]>A.ema200[last][k]&&A.slope[last][k]>0&&A[momKey][last][k]>0).sort((k,j)=>A[momKey][last][j]-A[momKey][last][k]||(N[k]<N[j]?-1:1));
 const watch=N.map((ticker,k)=>{let seen=last;while(seen>=0&&!finite(A.close[seen][k]))seen--;return {ticker,k,close:A.mark[last][k],price_date:seen>=0?D[seen]:null,ema50:A.ema50[last][k],ema100:A.ema100[last][k],ema200:A.ema200[last][k],atr:A.atr[last][k],breakout:A[breakKey][last][k],distance:(A[breakKey][last][k]/A.close[last][k]-1)*100,mom:A[momKey][last][k]*100,rank:bRanks.includes(k)?bRanks.indexOf(k)+1:null,trend:A.close[last][k]>A.ema50[last][k]&&A.ema50[last][k]>A.ema200[last][k]&&A.slope[last][k]>0,eligible:common.includes(k),turn:A.turn[last][k],held:pos.has(k)};});
 const open=[...pos].map(([k,p])=>({ticker:N[k],k,module:p.m,q:p.q,entry_date:D[p.i],entry:p.fill,entry_fee:p.entryFee,entry_spread:p.entrySpread,spent:p.spent,stop:p.stop,close:A.mark[last][k],value:p.q*A.mark[last][k],pnl:p.q*A.mark[last][k]-p.spent,return_pct:(p.q*A.mark[last][k]/p.spent-1)*100,holding_sessions:last-p.i,exit_reason:sales.get(k)?.reason||null,price_date:watch[k].price_date}));
 const orders=[...sales].map(([k,s])=>({action:'JUAL',ticker:N[k],module:pos.get(k).m,q:pos.get(k).q,signal_date:D[last],limit:null,reason:s.reason})).concat(buys.map(b=>({action:'BELI',ticker:N[b.k],module:b.m,q:b.q,signal_date:D[b.signal],limit:b.limit,level:b.level,atr:b.atr,reason:b.m==='A'?'Breakout '+c.breakPeriod+' sesi':'Momentum bulanan top '+c.bTop})));
 return {config:c,equity,trades,events,plans,open,orders,watch,breadth,last_date:D[last],latest,source_asof:D.at(-1)};
}
function metrics(r,start=r.config.start,end=r.config.end){const e=r.equity.filter(x=>x.date>=start&&x.date<=end),prior=r.equity.filter(x=>x.date<start),initial=prior.length?prior.at(-1).equity:r.config.capital;if(!e.length)return null;
 const t=r.trades.filter(x=>x.exit_date>=start&&x.exit_date<=end),w=t.filter(x=>x.pnl>0),l=t.filter(x=>x.pnl<0);let peak=initial,dd=0,under=0,longest=0,episode=0;const episodes=[],rets=[];let previous=initial;for(const x of e){rets.push(x.equity/previous-1);previous=x.equity;peak=Math.max(peak,x.equity);const d=1-x.equity/peak;dd=Math.max(dd,d);if(d>1e-10){under++;episode=Math.max(episode,d);}else{if(episode)episodes.push(episode);episode=0;under=0;}longest=Math.max(longest,under);}if(episode)episodes.push(episode);
 const months=new Map();for(const x of e)months.set(x.date.slice(0,7),x.equity);let p=initial,hwm=initial;const monthly=[...months].map(([month,eq])=>{const v={month,equity:eq,return_pct:(eq/p-1)*100,record:eq>=hwm};p=eq;hwm=Math.max(hwm,eq);return v;});
 const gp=sum(w.map(x=>x.pnl)),gl=-sum(l.map(x=>x.pnl)),years=(Date.parse(end)-Date.parse(start))/864e5/365.25,final=e.at(-1).equity,mean=sum(rets)/rets.length,sd=Math.sqrt(sum(rets.map(x=>(x-mean)**2))/Math.max(1,rets.length-1)),avg=(xs,key)=>xs.length?sum(xs.map(x=>x[key]))/xs.length:0,sorted=t.map(x=>x.return_pct).sort((a,b)=>a-b),median=sorted.length?(sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2:0;
 let dailyPeak=initial,monthPeak=initial;const endDates=new Set([...months.keys()].map(m=>e.filter(x=>x.date.startsWith(m)).at(-1).date));for(const x of e){if(endDates.has(x.date)){const z=monthly.find(m=>m.month===x.date.slice(0,7));z.record=x.equity>=dailyPeak-1e-7;}dailyPeak=Math.max(dailyPeak,x.equity);}
 const mr=monthly.map(x=>x.return_pct/100),mm=sum(mr)/mr.length,msd=Math.sqrt(sum(mr.map(x=>(x-mm)**2))/Math.max(1,mr.length-1)),down=Math.sqrt(sum(mr.map(x=>Math.min(0,x)**2))/mr.length);let drought=0,maxDrought=0,streak=0,maxStreak=0;for(const x of monthly){drought=x.record?0:drought+1;maxDrought=Math.max(maxDrought,drought);}for(const x of t){streak=x.pnl<0?streak+1:0;maxStreak=Math.max(maxStreak,streak);}
 const annual=[...new Set(monthly.map(x=>x.month.slice(0,4)))].map(year=>({year,return_pct:(monthly.filter(x=>x.month.startsWith(year)).reduce((v,x)=>v*(1+x.return_pct/100),1)-1)*100})),allCosts=e.at(-1).fees_cumulative+(e.at(-1).spread_cumulative||0)-(prior.at(-1)?.fees_cumulative||0)-(prior.at(-1)?.spread_cumulative||0),grossProfit=final-initial+allCosts;
 return {avgwin_rp:avg(w,'pnl'),avgloss_rp:avg(l,'pnl'),expectancy:t.length?sum(t.map(x=>x.return_pct))/t.length:null,payoff:avg(l,'return_pct')?avg(w,'return_pct')/Math.abs(avg(l,'return_pct')):null,holding_days:avg(t,'holding_days'),trades_year:years>0?t.length/years:null,exposure_days:e.filter(x=>x.positions>0).length/e.length*100,calmar:dd&&years>0?((final/initial)**(1/years)-1)/dd:null,sortino:down?mm/down*Math.sqrt(12):null,spread:allCosts-(e.at(-1).fees_cumulative-(prior.at(-1)?.fees_cumulative||0)),total_cost:allCosts,cost_share:grossProfit>0?allCosts/grossProfit*100:null,record_pct:monthly.filter(x=>x.record).length/monthly.length*100,drought_months:maxDrought,loss_streak:maxStreak,annual,losing_years:annual.filter(x=>x.return_pct<0).length,top10_share:gp-gl>0?sum([...t].sort((a,b)=>b.pnl-a.pnl).slice(0,10).map(x=>x.pnl))/(gp-gl)*100:null,initial,final,cagr:years>0?((final/initial)**(1/years)-1)*100:0,return_pct:(final/initial-1)*100,dd:dd*100,pf:gl?gp/gl:null,wr:t.length?w.length/t.length*100:null,trades:t.length,avgwin:avg(w,'return_pct'),avgloss:avg(l,'return_pct'),holdwin:avg(w,'holding_sessions'),holdloss:avg(l,'holding_sessions'),avgreturn:avg(t,'return_pct'),median,avgdd:episodes.length?sum(episodes)/episodes.length*100:0,sharpe:msd?mm/msd*Math.sqrt(12):null,exposure:avg(e,'exposure')*100,fees:e.at(-1).fees_cumulative-(prior.at(-1)?.fees_cumulative||0),monthly,negative_months:monthly.filter(x=>x.return_pct<0).length,record_months:monthly.filter(x=>x.record).length,longest};
}
function series(k,start,end,breakPeriod=100){return D.map((date,i)=>({date,close:A.close[i][k],ema50:A.ema50[i][k],ema100:A.ema100[i][k],ema200:A.ema200[i][k],breakout:A['brk'+breakPeriod][i][k]})).filter(x=>x.date>=start&&x.date<=end&&finite(x.close));}
return {prepare,run,metrics,series,defaults,tick,roundTick,fillPrice};
})();
if(typeof module!=='undefined')module.exports=QuantEngine;

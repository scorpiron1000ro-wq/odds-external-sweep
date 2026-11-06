const PENDING_URL = process.env.BASE44_PENDING_URL || 'https://proud-odds-pattern-pulse.base44.app/api/functions/getPendingFixtures?pin=317120&limit=1000';
const INGEST_URL = process.env.BASE44_INGEST_URL;
const INGEST_TOKEN = process.env.INGEST_RESULTS_TOKEN;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY;
const PIN = '317120';
const sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
function norm(s){ return (s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function isUEFA(comp){ const c=(comp||'').toLowerCase(); return c.indexOf('champions league')>-1 || c.indexOf('europa league')>-1 || c.indexOf('conference league')>-1 || c.indexOf('youth league')>-1; }
async function fetchPendingAll(){
const r = await fetch(PENDING_URL);
const j = await r.json();
const arr = Array.isArray(j) ? j : (j.pending || []);
console.log('Pending count MAPPED: ' + arr.length + ' isArray: true');
return arr;
}
function getLondonMode(){
const h = new Date().toLocaleString('en-GB',{timeZone:'Europe/London', hour:'2-digit', minute:'2-digit', hour12:false});
const hour = parseInt(h.split(':')[0]);
if(hour < 8) return '6am';
if(hour < 10) return '9am';
return '11am';
}
async function getFromESPN(f){
try{
const leagues = ['eng.1','esp.1','ita.1','ger.1','fra.1','eng.2','eng.3',' uefa.champions',' uefa.europa',' uefa.europa_conference','bra.1','ned.1','por.1'];
for(const lg of leagues){
const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/' + lg + '/scoreboard?dates=' + String(f.match_date).replace(/-/g,'');
const r = await fetch(url);
if(!r.ok) continue;
const j = await r.json();
for(const ev of (j.events||[])){
const comps = ev.competitions[0].competitors;
let home = null; let away = null;
for(const c of comps){ if(c.homeAway==='home') home=c; if(c.homeAway==='away') away=c; }
if(!home||!away) continue;
if(norm(home.team.displayName)===norm(f.home_team) && norm(away.team.displayName)===norm(f.away_team)){
if(ev.status.type.completed){
const hs = parseInt(home.score); const as = parseInt(away.score);
if(!isNaN(hs)) return {source:' ESPN', home:hs, away:as, league:lg};
}
}
}
await sleep(200);
}
}catch(e){ console.log(' ESPN error ' + f.home_team + ' ' + e.message); }
return null;
}
async function getFromAPIFootball(f){
if(!API_FOOTBALL_KEY) return null;
try{
const url = 'https://v3.football.api-sports.io/fixtures?date=' + f.match_date;
const r = await fetch(url, {headers:{'x-apisports-key': API_FOOTBALL_KEY}});
if(r.status===429){ console.log('API-Football 429 rate limit'); return null; }
if(!r.ok){ console.log('API-Football ' + r.status); return null; }
const j = await r.json();
for(const fx of (j.response||[])){
if(norm(fx.teams.home.name)===norm(f.home_team) && norm(fx.teams.away.name)===norm(f.away_team)){
if(fx.goals.home!==null && fx.goals.home!==undefined) return {source:'API-Football', home:fx.goals.home, away:fx.goals.away};
}
}
}catch(e){ console.log('API-Football error ' + e.message); }
return null;
}
async function getFromFootballData(f){
if(!FOOTBALL_DATA_KEY) return null;
try{
const url = 'https://api.football-data.org/v4/matches?dateFrom=' + f.match_date + '&dateTo=' + f.match_date;
const r = await fetch(url, {headers:{'X-Auth-Token': FOOTBALL_DATA_KEY}});
if(!r.ok){ console.log('Football-Data ' + r.status); return null; }
const j = await r.json();
for(const m of (j.matches||[])){
if(norm(m.homeTeam.name)===norm(f.home_team) && norm(m.awayTeam.name)===norm(f.away_team)){
if(m.score.fullTime.home!==null && m.score.fullTime.home!==undefined) return {source:'Football-Data', home:m.score.fullTime.home, away:m.score.fullTime.away};
}
}
}catch(e){ console.log('Football-Data error ' + e.message); }
return null;
}
async function getFromDDG(f){
try{
const q = encodeURIComponent(f.home_team + ' vs ' + f.away_team + ' result ' + f.match_date);
const r = await fetch('https://html.duckduckgo.com/html/?q=' + q, {headers:{'User-Agent':'Mozilla/5.0'}});
console.log('ddg[' + r.status + '] ' + f.home_team + ' vs ' + f.away_team);
if(!r.ok) return null;
return null;
}catch(e){ console.log('ddg[ERROR] ' + e.message); return null; }
}
async function getFromBing(f){
try{
const q = encodeURIComponent(f.home_team + ' vs ' + f.away_team + ' result');
const r = await fetch('https://www.bing.com/search?q=' + q, {headers:{'User-Agent':'Mozilla/5.0'}});
console.log('bing[' + r.status + '] ' + f.home_team + ' vs ' + f.away_team);
if(!r.ok) return null;
return null;
}catch(e){ console.log('bing[ERROR] ' + e.message); return null; }
}
async function checkOne(f, mode){
const votes = [];
const espn = await getFromESPN(f); if(espn) votes.push(espn);
const api = await getFromAPIFootball(f); if(api) votes.push(api);
if(espn && isUEFA(f.competition)) return {found:true, score: espn, votes: votes, reason:'Single ESPN UEFA'};
if(api) return {found:true, score:api, votes: votes, reason:'Single API-Football any league'};
const fd = await getFromFootballData(f); if(fd) votes.push(fd);
const ddg = await getFromDDG(f); if(ddg) votes.push(ddg);
const bing = await getFromBing(f); if(bing) votes.push(bing);
const counts = {};
for(const v of votes){ const k = v.home + '-' + v.away; counts[k]=(counts[k]||0)+1; }
for(const k in counts){ if(counts[k]>=2){ const parts=k.split('-'); const h=parseInt(parts[0]); const a=parseInt(parts[1]); return {found:true, score:{source:'2vs0', home:h, away:a}, votes: votes, reason:'2 vs 0'}; } }
return {found:false, votes: votes};
}
async function main(){
const mode = getLondonMode();
console.log('PIN ' + PIN + ' Mode ' + mode + ' - EVERYTHING without FT score - NO LLM in GitHub');
console.log('API_FOOTBALL_KEY=' + (API_FOOTBALL_KEY?'OK':'MISSING'));
console.log('FOOTBALL_DATA_KEY=' + (FOOTBALL_DATA_KEY?'OK':'MISSING'));
console.log('Fetching pending from: ' + PENDING_URL);
const pending = await fetchPendingAll();
console.log('Queue ALL for ' + mode + ' first: ' + pending[0].home_team + ' vs ' + pending[0].away_team);
let checked=0; let found=0;
const batchSize=10;
for(let i=0;i<pending.length;i+=batchSize){
const batch = pending.slice(i, i+batchSize);
for(const f of batch){
checked++;
const res = await checkOne(f, mode);
if(res.found){
found++;
console.log('FOUND ' + f.home_team + ' ' + res.score.home + '-' + res.score.away + ' ' + f.away_team + ' [' + res.reason + '] votes=' + JSON.stringify(res.votes));
if(INGEST_URL){
try{
await fetch(INGEST_URL, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({pin:PIN, fixture_id:f.id, home_score:res.score.home, away_score:res.score.away, source:res.reason})});
}catch(e){ console.log('Ingest error ' + e.message); }
}
} else {
console.log('NOT FOUND ' + f.home_team + ' vs ' + f.away_team + ' votes=' + JSON.stringify(res.votes));
}
await sleep(1000);
}
console.log('Batch ' + (Math.floor(i/batchSize)+1) + ' done waiting 1 sec - Checked ' + checked + ' Found ' + found);
await sleep(1000);
}
console.log('DONE Checked ' + checked + ' Found ' + found);
}
main();

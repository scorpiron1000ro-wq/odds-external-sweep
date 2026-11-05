const PENDING_URL = process.env.BASE44_PENDING_URL || 'https://proud-odds-pattern-pulse.base44.app/functions/getPendingFixtures?pin=317120';
const INGEST_URL = process.env.BASE44_INGEST_URL;
const INGEST_TOKEN = process.env.INGEST_RESULTS_TOKEN;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const LLM_API_KEY = process.env.LLM_API_KEY;
const PIN = '317120';

function norm(f){
  return {
    id: f.id || f._id,
    home: (f.home_team || f.home || '').trim(),
    away: (f.away_team || f.away || '').trim(),
    date: f.match_date || f.date || f.fixture_date || ''
  };
}

async function fetchPendingAll(){
  const sep = PENDING_URL.includes('?') ? '&' : '?';
  const url = {PENDING_URL}{sep}limit=1000&pin=${PIN};
  console.log(Fetching pending from: ${url});
  const res = await fetch(url, { headers: { 'x-pin': PIN, 'X-PIN': PIN, 'pin': PIN } });
  const txt = await res.text();
  console.log(Raw preview: ${txt.slice(0,400)});
  let data;
  try{ data=JSON.parse(txt); }catch{ data=[]; }
  let batch = Array.isArray(data) ? data : (data.pending || data.fixtures || data.data || data.matches || []);
  if(!Array.isArray(batch)) batch=[];
  return batch;
}

function getLondonMode(){
  const h = parseInt(new Date().toLocaleString('en-GB',{timeZone:'Europe/London',hour:'numeric',hour12:false}));
  if(h>=5 && h<8) return '6am';
  if(h>=8 && h<10) return '9am';
  return '11am';
}

async function getFromAPI_Football(f){
  if(!API_FOOTBALL_KEY) return null;
  try{
    const d = new Date(f.date).toISOString().split('T')[0];
    const url = https://v3.football.api-sports.io/fixtures?date=${d};
    const r = await fetch(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } });
    const j = await r.json();
    if(!j.response) return null;
    const found = j.response.find(m =>
      m.teams.home.name.toLowerCase().includes(f.home.toLowerCase()) &&
      m.teams.away.name.toLowerCase().includes(f.away.toLowerCase())
    );
    if(found && found.goals.home!==null) return { home: found.goals.home, away: found.goals.away, source: 'apiFootball' };
  }catch(e){}
  return null;
}

async function getFromESPN(f){
  try{
    const d = new Date(f.date).toISOString().split('T')[0].replace(/-/g,'');
    const url = https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=${d};
    const r = await fetch(url);
    const j = await r.json();
    const ev = (j.events||[]).find(e => e.name.toLowerCase().includes(f.home.toLowerCase()) && e.name.toLowerCase().includes(f.away.toLowerCase()));
    if(ev && ev.competitions[0].status.type.completed){
      const comp = ev.competitions[0].competitors;
      const home = comp.find(c=>c.homeAway==='home')?.score;
      const away = comp.find(c=>c.homeAway==='away')?.score;
      if(home!==undefined) return { home: parseInt(home), away: parseInt(away), source: 'espn' };
    }
  }catch(e){}
  return null;
}

async function getFromLLM(f){
  if(!LLM_API_KEY) return null;
  try{
    const prompt = What was the FT score for {f.home} vs {f.away} on ${f.date}? Return JSON {"home":1,"away":2} or {"home":null};
    const r = await fetch(https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${LLM_API_KEY},{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{ parts:[{ text: prompt }] }] })
    });
    const j = await r.json();
    const txt = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const m = txt.match(/\{[^}]+\}/);
    if(m){ const o=JSON.parse(m[0]); if(o.home!==null) return { home:o.home, away:o.away, source:'llm' }; }
  }catch(e){}
  return null;
}

async function main(){
  const mode = getLondonMode();
  console.log(PIN {PIN} Mode {mode} - EVERYTHING without FT score - ${mode==='11am'?'Every method PLUS LLM':'Every method EXCEPT LLM'});
  const raw = await fetchPendingAll();
  const pending = raw.map(norm).filter(f=>f.home && f.away);
  console.log(Pending count MAPPED: ${pending.length} isArray: true);
  console.log(Queue ALL for {mode} first: {pending[0]?.home} vs {pending[0]?.away} {pending[0]?.date});
 
  let checked=0, found=0, apiUsed=0;
 
  for(let i=0;i<pending.length;i+=10){
    const batch = pending.slice(i,i+10);
    for(const f of batch){
      checked++;
      let results=[];
      const espn = await getFromESPN(f);
      if(espn) results.push(espn);
      const api = await getFromAPI_Football(f);
      if(api){ results.push(api); apiUsed++; }
      if(mode==='11am'){
        const llm = await getFromLLM(f);
        if(llm) results.push(llm);
      }
      if(results.length>=2){
        const agree = results.filter(r=>r.home===results[0].home && r.away===results[0].away);
        if(agree.length>=2){
          if(INGEST_URL){
            await fetch(INGEST_URL,{
              method:'POST',
              headers:{ 'Content-Type':'application/json', 'x-pin': PIN, 'Authorization': Bearer ${INGEST_TOKEN} },
              body: JSON.stringify({ pin: PIN, fixture_id: f.id, home_team: f.home, away_team: f.away, match_date: f.date, home_score: agree[0].home, away_score: agree[0].away, sources: agree })
            });
          }
          found++;
        }
      }
    }
    console.log(Batch {Math.floor(i/10)+1} done Waiting 80 sec - Checked {checked} Found ${found});
    if(i+10 < pending.length) await new Promise(r=>setTimeout(r,80000));
  }
 
  console.log(Done PIN {PIN} Mode {mode} Checked {checked} Found {found} API-Football {apiUsed}/100 Remaining {100-apiUsed});
 
  if(INGEST_URL){
    await fetch(INGEST_URL,{
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-pin': PIN, 'Authorization': Bearer ${INGEST_TOKEN} },
      body: JSON.stringify({ pin: PIN, summary: true, mode, checked, found, attempted: checked, apifootball_used: apiUsed })
    });
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });

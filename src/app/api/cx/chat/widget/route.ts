/**
 * Embeddable live chat widget: <script src="https://<host>/api/cx/chat/widget?c=<channelId>" async></script>
 * Renders a launcher + chat panel in a shadow root (no iframe, no cookies) and talks to
 * /api/cx/chat/<channelId> (polling every 3 s while open). `mode=page` renders the full-page chat used
 * by the hosted /chat/<channelId> page.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const channel = (url.searchParams.get("c") ?? "").replace(/[^a-zA-Z0-9-]/g, "");
  const mode = url.searchParams.get("mode") === "page" ? "page" : "widget";
  const js = `(()=>{${WIDGET}})();`.replace("__CHANNEL__", channel).replace("__MODE__", mode).replaceAll("__ORIGIN__", url.origin);
  return new Response(js, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
}

const WIDGET = String.raw`
const CH="__CHANNEL__",MODE="__MODE__",API="__ORIGIN__/api/cx/chat/"+CH,KEY="synapse-chat:"+CH;
if(!CH||window["__synapseChat_"+CH])return;window["__synapseChat_"+CH]=1;
const store={get(){try{return JSON.parse(localStorage.getItem(KEY)||"null")}catch(e){return null}},set(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}},clear(){try{localStorage.removeItem(KEY)}catch(e){}}};
let cfg=null,state=store.get(),open=MODE==="page",msgs=[],timer=null,lastType=0,unread=0,seen=0,sending=false;
const host=document.createElement("div");host.id="synapse-chat-"+CH;
if(MODE==="page"){host.style.cssText="position:fixed;inset:0;z-index:1"}else{host.style.cssText="position:fixed;right:20px;bottom:20px;z-index:2147483000"}
const root=host.attachShadow({mode:"open"});
const css=(c)=>":host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}"+
".l{width:56px;height:56px;border-radius:50%;border:0;background:"+c+";color:#fff;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;position:relative}"+
".l svg{width:26px;height:26px}.b{position:absolute;top:-2px;right:-2px;background:#dc2626;color:#fff;font-size:11px;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px}"+
".p{--bg:#fff;--fg:#111827;--mut:#6b7280;--bd:#e5e7eb;--in:#f3f4f6;background:var(--bg);color:var(--fg);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--bd)}"+
"@media (prefers-color-scheme:dark){.p{--bg:#111318;--fg:#f3f4f6;--mut:#9ca3af;--bd:#2a2e37;--in:#1c1f26}}"+
".w{position:absolute;right:0;bottom:70px;width:min(370px,calc(100vw - 40px));height:min(560px,calc(100vh - 110px));border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25)}"+
".f{position:absolute;inset:0;max-width:640px;margin:0 auto;border-radius:0}@media(min-width:700px){.f{inset:24px auto;left:0;right:0;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.12)}}"+
".h{background:"+c+";color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}.h b{font-size:15px;display:block}.h small{opacity:.85;font-size:12px}.h .x{margin-left:auto;background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}"+
".d{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px;background:#9ca3af}.d.on{background:#4ade80}"+
".m{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;font-size:14px;line-height:1.45}"+
".g{max-width:82%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}.g.a{background:var(--in);align-self:flex-start;border-bottom-left-radius:4px}.g.v{background:"+c+";color:#fff;align-self:flex-end;border-bottom-right-radius:4px}"+
".t{font-size:11px;color:var(--mut);align-self:flex-start}.t.r{align-self:flex-end}.ty{font-size:12px;color:var(--mut);font-style:italic;padding:0 14px 6px}"+
".c{border-top:1px solid var(--bd);padding:10px;display:flex;gap:8px;align-items:flex-end}.c textarea,.i{flex:1;resize:none;border:1px solid var(--bd);background:var(--bg);color:var(--fg);border-radius:10px;padding:9px 11px;font-size:14px;max-height:120px;outline:none}"+
".c textarea:focus,.i:focus{border-color:"+c+"}.s{background:"+c+";color:#fff;border:0;border-radius:10px;padding:0 14px;height:38px;font-size:14px;cursor:pointer;font-weight:600}.s:disabled{opacity:.5}"+
".st{padding:16px;display:flex;flex-direction:column;gap:10px;font-size:14px}.st p{margin:0;color:var(--mut);font-size:13px}.e{color:#dc2626;font-size:12.5px;padding:0 14px 6px}.pw{font-size:11px;color:var(--mut);text-align:center;padding:0 0 8px}.fl{color:inherit;text-decoration:underline;font-size:13px}";
function el(t,a,k){const e=document.createElement(t);if(a)for(const x in a){if(x==="class")e.className=a[x];else if(x==="text")e.textContent=a[x];else e.setAttribute(x,a[x])}(k||[]).forEach(z=>z&&e.appendChild(z));return e}
async function api(method,body,qs){const r=await fetch(API+(qs||""),{method,headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||"Error");e.status=r.status;throw e}return d}
let err="";
function render(){
  const c=(cfg&&cfg.config.color)||"#4f46e5";root.innerHTML="";root.appendChild(el("style",{text:css(c)}));
  if(MODE!=="page"){const l=el("button",{class:"l","aria-label":open?"Close chat":"Open chat"});l.innerHTML=open?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';if(unread&&!open)l.appendChild(el("span",{class:"b",text:String(unread)}));l.onclick=()=>{open=!open;if(open){unread=0;seen=msgs.length}render();schedule(0)};root.appendChild(l)}
  if(!open||!cfg)return;
  const p=el("div",{class:"p "+(MODE==="page"?"f":"w"),role:"dialog","aria-label":"Chat"});
  const hd=el("div",{class:"h"},[el("div",{},[el("b",{text:cfg.brand}),el("small",{},[el("span",{class:"d"+(cfg.agentsOnline?" on":"")}),document.createTextNode(cfg.agentsOnline?"We're online":"We'll reply as soon as we can")])])]);
  if(MODE!=="page"){const x=el("button",{class:"x","aria-label":"Close",text:"×"});x.onclick=()=>{open=false;render()};hd.appendChild(x)}
  p.appendChild(hd);
  const m=el("div",{class:"m"});m.appendChild(el("div",{class:"g a",text:cfg.config.greeting}));
  if(!cfg.agentsOnline&&!msgs.length&&cfg.config.offlineNote)m.appendChild(el("div",{class:"g a",text:cfg.config.offlineNote}));
  for(const x of msgs){const b=el("div",{class:"g "+(x.from==="agent"?"a":"v"),text:x.body});(x.files||[]).forEach(f=>{const a=el("a",{class:"fl",href:"__ORIGIN__"+f.path,target:"_blank",rel:"noopener",text:"\u{1F4CE} "+f.name});b.appendChild(el("br"));b.appendChild(a)});m.appendChild(b);m.appendChild(el("div",{class:"t"+(x.from==="agent"?"":" r"),text:(x.from==="agent"&&x.name?x.name+" · ":"")+new Date(x.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}))}
  p.appendChild(m);
  if(state&&state.agentTyping)p.appendChild(el("div",{class:"ty",text:"Agent is typing…"}));
  if(err)p.appendChild(el("div",{class:"e",text:err}));
  if(!state){
    const f=el("form",{class:"st"});f.appendChild(el("p",{text:"Tell us who you are so we can follow up."}));
    const n=el("input",{class:"i",placeholder:"Your name",maxlength:"80",autocomplete:"name","aria-label":"Your name"});const em=el("input",{class:"i",placeholder:cfg.config.askEmail?"Email (required)":"Email (optional)",type:"email",maxlength:"200",autocomplete:"email","aria-label":"Email"});
    const t=el("textarea",{class:"i",rows:"3",placeholder:"How can we help?","aria-label":"Message",maxlength:"5000"});const s=el("button",{class:"s",type:"submit",text:"Start chat"});
    [n,em,t,s].forEach(z=>f.appendChild(z));
    f.onsubmit=async(e)=>{e.preventDefault();if(sending)return;err="";if(cfg.config.askEmail&&!em.value.trim()){err="Please enter your email.";render();return}if(!t.value.trim()){err="Please type a message.";render();return}
      sending=true;s.disabled=true;try{const r=await api("POST",{action:"start",name:n.value,email:em.value,pageUrl:location.href});state={token:r.token};store.set(state);await api("POST",{action:"send",token:r.token,text:t.value});await poll()}catch(x){err=x.message;state=null;store.clear()}sending=false;render();schedule(0)};
    p.appendChild(f);
  }else{
    const c2=el("form",{class:"c"});const t=el("textarea",{rows:"1",placeholder:"Type your message…","aria-label":"Message",maxlength:"5000"});const s=el("button",{class:"s",type:"submit",text:"Send"});
    t.onkeydown=(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();c2.requestSubmit()}};t.oninput=()=>{lastType=Date.now()};
    c2.onsubmit=async(e)=>{e.preventDefault();const v=t.value.trim();if(!v||sending)return;sending=true;s.disabled=true;err="";msgs.push({from:"visitor",body:v,at:new Date().toISOString()});seen=msgs.length;t.value="";
      try{await api("POST",{action:"send",token:state.token,text:v});await poll()}catch(x){err=x.message;if(x.status===401){state=null;store.clear()}}sending=false;render();focusInput()};
    c2.appendChild(t);c2.appendChild(s);p.appendChild(c2);
  }
  p.appendChild(el("div",{class:"pw",text:"Chat powered by SynapseSEO CX"}));
  root.appendChild(p);m.scrollTop=m.scrollHeight;
}
function focusInput(){const t=root.querySelector(".c textarea");if(t)t.focus()}
async function poll(){if(!state)return;try{const typing=Date.now()-lastType<4000?"&typing=1":"";const r=await api("GET",null,"?token="+encodeURIComponent(state.token)+typing);const changed=r.messages.length!==msgs.length||!!r.agentTyping!==!!state.agentTyping;msgs=r.messages;state.agentTyping=r.agentTyping;if(open)seen=msgs.length;else unread=msgs.slice(seen).filter(x=>x.from==="agent").length;
  if(changed){const t=root.querySelector(".c textarea"),v=t&&t.value,foc=t&&root.activeElement===t;render();const t2=root.querySelector(".c textarea");if(t2&&v){t2.value=v}if(foc)focusInput()}}catch(x){if(x.status===401){state=null;store.clear();msgs=[];render()}}}
function schedule(ms){clearTimeout(timer);timer=setTimeout(async()=>{await poll();schedule(open?3000:15000)},ms)}
(async()=>{try{cfg=await api("GET")}catch(e){return}document.body.appendChild(host);if(state){await poll();seen=MODE==="page"?msgs.length:msgs.length}render();schedule(open?3000:15000)})();
`;

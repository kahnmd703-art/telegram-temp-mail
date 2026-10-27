/**
 * VibeMail Telegram Mini App — single-file starter
 * Requirements: Node.js 20+ (no npm packages required).
 *
 * Run:
 *   node telegram-temp-mail-server.js
 *
 * Configure with environment variables (or a .env file; parser below supports simple KEY=value):
 *   PORT=3000
 *   MAIL_API_BASE=https://api.mail.tm
 *   MAIL_DOMAINS=domain1.example,domain2.example,domain3.example
 *   REQUIRE_TELEGRAM_AUTH=false   # set true in production
 *   TELEGRAM_BOT_TOKEN=your_bot_token
 *
 * IMPORTANT:
 * - Set MAIL_DOMAINS to up to three REAL domains returned by your provider's /domains endpoint.
 * - Production deployments must use HTTPS, Telegram auth, persistent storage, rate limiting,
 *   and a provider whose terms allow your intended use.
 * - This single-file version uses in-memory sessions/mailboxes. It is easy to run, but not
 *   production-ready for multi-instance deployments or durable sessions until storage is added.
 * - The delete button removes the mailbox from this app session; provider-side deletion depends
 *   on provider support.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { URL } from "node:url";

function loadSimpleEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 1) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadSimpleEnv();

const PORT = Number(process.env.PORT || 3000);
const API_BASE = (process.env.MAIL_API_BASE || "https://api.mail.tm").replace(/\/+$/, "");
const DOMAIN_ALLOWLIST = (process.env.MAIL_DOMAINS || "")
  .split(",").map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 3);
const REQUIRE_TELEGRAM_AUTH = process.env.REQUIRE_TELEGRAM_AUTH === "true";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const sessions = new Map();

const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="theme-color" content="#111127"><title>VibeMail — Temporary Inbox</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
:root{color-scheme:dark;--muted:#a4a5c4;--text:#f7f6ff;--cyan:#50e6ff;--pink:#ff65c3;--violet:#9b78ff;--green:#53e6ad;--red:#ff6585}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 15% 0%,#25204d 0,transparent 45%),radial-gradient(ellipse at 100% 40%,#172e49 0,transparent 38%),#0d0d20;color:var(--text);font-family:'DM Sans',sans-serif;overflow-x:hidden}#particles{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:.7}.app{position:relative;z-index:1;width:min(100% - 28px,720px);margin:auto;padding:22px 0 28px}.top,.brand,.profile,.heading,.row,.address,.actions{display:flex;align-items:center}.top,.heading{justify-content:space-between}.brand{gap:11px}.mark{display:grid;place-items:center;width:43px;height:43px;border-radius:15px;background:linear-gradient(135deg,var(--cyan),var(--violet) 55%,var(--pink));color:#111127;font-size:23px;box-shadow:0 0 28px #8c72ff50}.brand strong{display:block;font:700 20px 'Space Grotesk';letter-spacing:-.6px}.brand small{display:block;font-size:9px;letter-spacing:1.8px;color:var(--muted);margin-top:3px}.profile{gap:9px;padding:6px 9px 6px 6px;border:1px solid #ffffff19;background:#ffffff08;border-radius:30px;max-width:57%}.avatar{width:38px;height:38px;border-radius:50%;border:2px solid #ffffff50;background:linear-gradient(135deg,var(--pink),var(--violet),var(--cyan));background-size:cover;background-position:center;color:#101027;font-weight:800;cursor:pointer;flex-shrink:0}.name{width:clamp(70px,24vw,135px);min-width:0;background:transparent;border:0;color:var(--text);font:600 12px 'DM Sans';outline:none}.hero{padding:38px 4px 24px}.eyebrow,.kicker{font-size:10px;font-weight:700;letter-spacing:1.8px;color:var(--cyan)}.eyebrow{display:flex;align-items:center;gap:8px}.dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 12px var(--green)}h1{font:700 clamp(38px,10vw,57px)/1.04 'Space Grotesk';letter-spacing:-2.4px;margin:16px 0 13px}h1 span{background:linear-gradient(90deg,var(--cyan),#a18aff 48%,var(--pink));background-clip:text;-webkit-background-clip:text;color:transparent}.hero p{color:var(--muted);line-height:1.65;font-size:14px;max-width:440px;margin:0}.panel{background:linear-gradient(135deg,rgba(34,32,68,.92),rgba(18,20,43,.9));border:1px solid #ffffff19;border-radius:23px;padding:20px;margin:0 0 15px;box-shadow:0 16px 50px #0002;backdrop-filter:blur(18px)}.heading{gap:12px;margin-bottom:20px}.panel h2,dialog h2{font:600 20px 'Space Grotesk';margin:5px 0 0;letter-spacing:-.5px}.spark{font-size:25px;color:var(--pink)}label{display:block;color:var(--muted);font-size:9px;letter-spacing:1.5px;font-weight:700;margin:0 0 8px}select{width:100%;background:#11112a;border:1px solid #ffffff20;border-radius:12px;color:var(--text);padding:13px;font:500 13px 'DM Sans';outline:none}.address{gap:8px;margin:12px 0;padding:12px 10px 12px 14px;background:#0b0c20;border:1px solid #ffffff12;border-radius:13px;min-height:51px}.address span{font-size:12px;overflow-wrap:anywhere;flex:1;color:#e7e5ff}.icon{border:0;border-radius:10px;background:#3f3b70;color:var(--cyan);width:35px;height:35px;font-size:20px;cursor:pointer}.row{gap:9px}.btn{border:0;border-radius:12px;padding:12px 15px;font:700 12px 'DM Sans';cursor:pointer;transition:transform .18s,filter .18s,opacity .18s;white-space:nowrap}.btn:active,.icon:active{transform:scale(.96)}.btn:disabled{opacity:.38;cursor:not-allowed}.primary{background:linear-gradient(100deg,#5ae6ff,#9b82ff 60%,#ff72c8);color:#101026}.danger{background:#ff66851c;color:#ff8aa3;border:1px solid #ff668533}.refresh{background:#52e6ad18;color:var(--green);border:1px solid #52e6ad35}.secondary{background:#ffffff12;color:var(--text)}.row .primary{flex:1}.status{font-size:11px;color:var(--muted);margin:12px 0 0;min-height:14px}.error{color:#ff8aa3!important}.success{color:var(--green)!important}.count{display:inline-grid;place-items:center;vertical-align:middle;margin-left:4px;min-width:23px;height:23px;padding:0 6px;border-radius:20px;background:#9b82ff25;color:#c8b8ff;font:700 11px 'DM Sans'}.messages,.history{display:grid;gap:9px}.empty{display:flex;align-items:center;flex-direction:column;text-align:center;padding:25px 10px;color:var(--muted)}.emptyicon{display:grid;place-items:center;width:53px;height:53px;border-radius:18px;background:linear-gradient(135deg,#50e6ff20,#ff65c320);color:var(--cyan);font-size:25px;margin-bottom:12px}.empty strong{font-size:13px;color:#e7e5ff;margin-bottom:6px}.empty span{font-size:11px;line-height:1.5;max-width:250px}.message{border:1px solid #ffffff12;background:#ffffff05;border-radius:14px;padding:13px;cursor:pointer;min-width:0}.mtop{display:flex;justify-content:space-between;gap:10px}.sender{font-weight:700;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.date,.muted{color:var(--muted);font-size:10px}.subject{font-size:12px;margin-top:7px;color:#e4e2ff;overflow-wrap:anywhere}.intro{font-size:11px;color:var(--muted);margin-top:5px;line-height:1.5;overflow-wrap:anywhere}.mini{border:1px solid #ffffff15;background:#ffffff09;color:var(--cyan);border-radius:9px;padding:7px 10px;font-size:10px;font-weight:700;cursor:pointer;margin-top:10px}.histitem{display:flex;align-items:center;gap:9px;padding:10px;border:1px solid #ffffff10;border-radius:12px}.histemail{flex:1;font-size:11px;overflow-wrap:anywhere;color:#e5e3ff}.histopen{border:0;background:#9b82ff22;color:#c5b6ff;border-radius:9px;padding:8px;font-size:10px;font-weight:700}.footer{display:flex;justify-content:center;align-items:center;gap:8px;color:#8586a7;font-size:10px;padding:15px 0}dialog{width:min(540px,calc(100% - 28px));max-height:85vh;overflow:auto;background:#191934;color:var(--text);border:1px solid #ffffff20;border-radius:20px;padding:24px;box-shadow:0 20px 80px #0009}dialog::backdrop{background:#050512c9;backdrop-filter:blur(5px)}.close{float:right;border:0;background:#ffffff12;color:white;border-radius:10px;width:31px;height:31px;font-size:22px}.bodytext{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;font-size:12px;color:#deddf6;border:1px solid #ffffff12;background:#0c0c20;padding:14px;border-radius:12px;margin:14px 0}.actions{gap:8px;flex-wrap:wrap}.actions .btn{flex:1}@media(min-width:600px){.app{padding-top:30px}.hero{padding-top:48px}.panel{padding:24px}}@media(prefers-reduced-motion:reduce){*{transition-duration:.01ms!important}}
</style></head>
<body><canvas id="particles"></canvas><main class="app">
<header class="top"><div class="brand"><div class="mark">✉</div><div><strong>VibeMail</strong><small>PRIVATE TEMP INBOX</small></div></div>
<div class="profile"><button id="avatar" class="avatar" aria-label="Upload profile picture">RC</button><input id="avatarFile" type="file" accept="image/*" hidden><input id="displayName" class="name" maxlength="32" value="Rafael Costa" aria-label="Display name"></div></header>
<section class="hero"><div class="eyebrow"><span class="dot"></span> YOUR DIGITAL INBOX</div><h1>Mail without<br><span>the noise.</span></h1><p>Create a temporary inbox in seconds. Your next verification code is one tap away.</p></section>
<section class="panel"><div class="heading"><div><span class="kicker">01 / CREATE</span><h2>Your email address</h2></div><span class="spark">✦</span></div><label for="domain">CHOOSE A DOMAIN</label><select id="domain"><option>Loading domains…</option></select><div class="address"><span id="email">Create an inbox to begin</span><button id="copyEmail" class="icon" aria-label="Copy email">⧉</button></div><div class="row"><button id="generate" class="btn primary">✦ Generate email</button><button id="delete" class="btn danger" disabled>Delete</button></div><p id="status" class="status">Connecting to email service…</p></section>
<section class="panel"><div class="heading"><div><span class="kicker">02 / INCOMING</span><h2>Your inbox <span id="count" class="count">0</span></h2></div><button id="refresh" class="btn refresh" disabled>↻ Refresh</button></div><div id="messages" class="messages"><div class="empty"><div class="emptyicon">✉</div><strong>Your inbox is quiet</strong><span>Generate an email address to start receiving messages.</span></div></div></section>
<section class="panel"><div class="heading"><div><span class="kicker">03 / RECENT</span><h2>Recent addresses</h2></div></div><div id="history" class="history"><p class="muted">No addresses created yet.</p></div></section>
<footer class="footer">✦ Made for Telegram · Keep your main inbox private</footer></main>
<dialog id="modal"><form method="dialog"><button class="close" aria-label="Close">×</button></form><div class="kicker">MESSAGE DETAILS</div><h2 id="modalSubject">Message</h2><p id="modalFrom" class="muted"></p><div id="modalBody" class="bodytext"></div><div class="actions"><button id="copyCode" class="btn primary" hidden>⧉ Copy verification code</button><button id="copyBody" class="btn secondary">Copy message text</button></div></dialog>
<script>
const tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();
const $=id=>document.getElementById(id);
const state={token:"",domains:[],boxes:[],active:null,messages:[],code:null,body:""};
const headers=()=>({"Content-Type":"application/json",...(state.token?{Authorization:"Bearer "+state.token}:{})});
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{...headers(),...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Request failed ("+r.status+")");return d}
function setStatus(s,kind=""){$("status").textContent=s;$("status").className="status "+kind}
function box(){return state.boxes.find(x=>x.id===state.active)||null}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function copy(text,button){if(!text)return;try{await navigator.clipboard.writeText(text)}catch{const t=document.createElement("textarea");t.value=text;t.style.position="fixed";t.style.opacity="0";document.body.append(t);t.select();const ok=document.execCommand("copy");t.remove();if(!ok){setStatus("Copy failed. Please copy manually.","error");return}}if(button){const old=button.textContent;button.textContent="Copied ✓";setTimeout(()=>button.textContent=old,1200)}setStatus("Copied to clipboard.","success")}
async function boot(){try{const c=await api("/api/config");state.domains=c.domains||[];$("domain").innerHTML=state.domains.length?state.domains.map(d=>\`<option value="\${esc(d)}">\${esc(d)}</option>\`).join(""):'<option value="">No available domains configured</option>';const s=await api("/api/session",{method:"POST",body:JSON.stringify({initData:tg?.initData||""})});state.token=s.token;if(!tg?.initDataUnsafe?.user?.first_name)$("displayName").value=s.firstName||"Rafael Costa";await loadBoxes();setStatus(state.domains.length?"Connected. Ready to create an inbox.":"No domains available. Configure real provider domains.",""+(state.domains.length?"success":"error"))}catch(e){setStatus(e.message,"error")}}
async function loadBoxes(){const d=await api("/api/emails");state.boxes=d.mailboxes||[];if(!state.boxes.some(x=>x.id===state.active))state.active=state.boxes[0]?.id||null;renderActive();if(state.active)await refresh(false)}
function renderActive(){$("email").textContent=box()?.address||"Create an inbox to begin";$("delete").disabled=!box();$("refresh").disabled=!box();$("copyEmail").disabled=!box();renderHistory()}
function renderHistory(){$("history").innerHTML=state.boxes.length?state.boxes.map(x=>\`<div class="histitem"><span class="histemail">\${esc(x.address)}</span><button class="histopen" data-open="\${esc(x.id)}">\${x.id===state.active?"Selected":"Open inbox"}</button></div>\`).join(""):'<p class="muted">No addresses created yet.</p>';document.querySelectorAll("[data-open]").forEach(b=>b.onclick=async()=>{state.active=b.dataset.open;state.messages=[];renderActive();await refresh()})}
async function generate(){if(!state.domains.length)return setStatus("No working domain configured. Check provider setup.","error");$("generate").disabled=true;setStatus("Creating your email address…");try{const d=await api("/api/emails",{method:"POST",body:JSON.stringify({domain:$("domain").value})});state.boxes.unshift(d.mailbox);state.active=d.mailbox.id;state.messages=[];renderActive();renderMessages();await refresh(false)}catch(e){setStatus(e.message,"error")}finally{$("generate").disabled=false}}
async function removeBox(){const b=box();if(!b||!confirm("Remove "+b.address+" from this app? Provider-side deletion depends on the service."))return;try{await api("/api/emails/"+encodeURIComponent(b.id),{method:"DELETE"});state.boxes=state.boxes.filter(x=>x.id!==b.id);state.active=state.boxes[0]?.id||null;state.messages=[];renderActive();renderMessages();setStatus("Address removed from this app.","success");if(state.active)await refresh(false)}catch(e){setStatus(e.message,"error")}}
async function refresh(show=true){const b=box();if(!b){state.messages=[];renderMessages();return}$("refresh").disabled=true;if(show)setStatus("Refreshing inbox…");try{const d=await api("/api/emails/"+encodeURIComponent(b.id)+"/messages");if(state.active!==b.id)return;state.messages=d.messages||[];renderMessages();setStatus("Inbox updated · "+state.messages.length+" message(s)","success")}catch(e){setStatus(e.message,"error")}finally{$("refresh").disabled=!box()}}
function renderMessages(){$("count").textContent=state.messages.length;if(!state.messages.length){$("messages").innerHTML='<div class="empty"><div class="emptyicon">✉</div><strong>Your inbox is quiet</strong><span>New messages appear here. Tap refresh to check again.</span></div>';return}$("messages").innerHTML=state.messages.map(m=>\`<article class="message" data-msg="\${esc(m.id)}" tabindex="0"><div class="mtop"><span class="sender">\${esc(m.name||m.from)}</span><span class="date">\${m.createdAt?esc(new Date(m.createdAt).toLocaleString()):""}</span></div><div class="subject">\${esc(m.subject)}</div><div class="intro">\${esc(m.intro)}</div><button class="mini" data-read="\${esc(m.id)}">Read message ↗</button></article>\`).join("");document.querySelectorAll("[data-read]").forEach(b=>b.onclick=e=>{e.stopPropagation();openMessage(b.dataset.read)});document.querySelectorAll("[data-msg]").forEach(c=>{c.onclick=()=>openMessage(c.dataset.msg);c.onkeydown=e=>{if(e.key==="Enter")openMessage(c.dataset.msg)}})}
async function openMessage(id){const b=box();if(!b)return;try{const m=await api("/api/emails/"+encodeURIComponent(b.id)+"/messages/"+encodeURIComponent(id));$("modalSubject").textContent=m.subject||"(No subject)";$("modalFrom").textContent="From: "+m.from+ (m.createdAt?" · "+new Date(m.createdAt).toLocaleString():"");state.body=m.text||m.intro||"No plain-text body.";state.code=m.code||null;$("modalBody").textContent=state.body;$("copyCode").hidden=!state.code;$("copyCode").textContent=state.code?"⧉ Copy code: "+state.code:"Copy verification code";$("modal").showModal()}catch(e){setStatus(e.message,"error")}}
$("generate").onclick=generate;$("delete").onclick=removeBox;$("refresh").onclick=()=>refresh();$("copyEmail").onclick=()=>box()&&copy(box().address,$("copyEmail"));$("copyCode").onclick=()=>state.code&&copy(state.code,$("copyCode"));$("copyBody").onclick=()=>copy(state.body,$("copyBody"));$("avatar").onclick=()=>$("avatarFile").click();$("avatarFile").onchange=()=>{const f=$("avatarFile").files?.[0];if(!f)return;if(!f.type.startsWith("image/")||f.size>3*1024*1024)return setStatus("Choose an image under 3 MB.","error");const r=new FileReader();r.onload=()=>{$("avatar").style.backgroundImage=\`url("\${r.result}")\`;$("avatar").textContent=""};r.readAsDataURL(f)};$("displayName").onchange=()=>{$("displayName").value=$("displayName").value.trim().slice(0,32)||"Rafael Costa"};
boot();
(()=>{const c=$("particles"),x=c.getContext("2d");if(!x)return;const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches,colors=["#50e6ff","#ff65c3","#9b78ff","#53e6ad","#ffcf70"];let w=0,h=0,p=[];function resize(){const d=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;c.width=w*d;c.height=h*d;c.style.width=w+"px";c.style.height=h+"px";x.setTransform(d,0,0,d,0,0);p=Array.from({length:Math.min(70,Math.floor(w/6))},()=>({x:Math.random()*w,y:Math.random()*h,r:.7+Math.random()*2,vx:(Math.random()-.5)*.35,vy:-.12-Math.random()*.3,color:colors[Math.floor(Math.random()*colors.length)],a:.25+Math.random()*.55}))}function draw(){x.clearRect(0,0,w,h);for(const q of p){x.globalAlpha=q.a;x.fillStyle=q.color;x.beginPath();x.arc(q.x,q.y,q.r,0,Math.PI*2);x.fill();if(!reduced){q.x+=q.vx;q.y+=q.vy;if(q.y< -8){q.y=h+8;q.x=Math.random()*w}if(q.x< -8)q.x=w+8;if(q.x>w+8)q.x=-8}}x.globalAlpha=1;if(!reduced)requestAnimationFrame(draw)}resize();draw();addEventListener("resize",()=>{resize();if(!reduced)requestAnimationFrame(draw)})})();
</script></body></html>`;

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 32_000) { reject(new Error("Request body too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}
async function provider(path, { method = "GET", token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000) });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text }; }
  if (!response.ok) { const e = new Error(data.detail || data.message || `Mail provider returned ${response.status}`); e.status = response.status; throw e; }
  return data;
}
async function domains() {
  const data = await provider("/domains?page=1");
  const available = (data["hydra:member"] || []).filter(d => d.isActive !== false && d.isPrivate !== true).map(d => String(d.domain).toLowerCase());
  return DOMAIN_ALLOWLIST.length ? DOMAIN_ALLOWLIST.filter(d => available.includes(d)).slice(0, 3) : available.slice(0, 3);
}
function verifyInitData(initData) {
  if (!BOT_TOKEN || !initData || initData.length > 10000) return null;
  const p = new URLSearchParams(initData), hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const authDate = Number(p.get("auth_date") || 0);
  if (!authDate || Math.abs(Date.now()/1000 - authDate) > 86400) return null;
  const check = [...p.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const expected = createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a,b)) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}
function sessionFor(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? sessions.get(h.slice(7)) : null;
}
function otpFrom(text = "") {
  const matches = String(text).match(/(?:^|\D)(\d{4,8})(?!\d)/g);
  return matches?.[0]?.replace(/\D/g, "") || null;
}
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;
  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }); return res.end(html);
  }
  if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true });
  if (req.method === "GET" && path === "/api/config") {
    try { return json(res, 200, { domains: await domains(), telegramAuthRequired: REQUIRE_TELEGRAM_AUTH }); }
    catch { return json(res, 502, { error: "Could not load domains from email provider." }); }
  }
  if (req.method === "POST" && path === "/api/session") {
    let body; try { body = await readBody(req); } catch { return json(res, 400, { error: "Invalid request body." }); }
    const user = body.initData ? verifyInitData(String(body.initData)) : null;
    if (REQUIRE_TELEGRAM_AUTH && !user) return json(res, 401, { error: "Telegram authentication failed. Open this app inside Telegram." });
    if (REQUIRE_TELEGRAM_AUTH && !BOT_TOKEN) return json(res, 500, { error: "Telegram bot token is not configured." });
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { userId: user?.id ? String(user.id) : `dev-${randomUUID()}`, firstName: user?.first_name || "Rafael Costa", boxes: new Map(), createdAt: Date.now() });
    return json(res, 200, { token, firstName: user?.first_name || "Rafael Costa" });
  }
  const session = sessionFor(req);
  if (path.startsWith("/api/") && path !== "/api/config" && !(req.method === "POST" && path === "/api/session") && !session) return json(res, 401, { error: "Session expired. Reopen the Mini App." });
  if (req.method === "GET" && path === "/api/domains") {
    try { return json(res, 200, { domains: await domains() }); } catch { return json(res, 502, { error: "Email provider unavailable." }); }
  }
  if (req.method === "GET" && path === "/api/emails") return json(res, 200, { mailboxes: [...session.boxes.values()].map(({id,address,domain,createdAt}) => ({id,address,domain,createdAt})) });
  if (req.method === "POST" && path === "/api/emails") {
    let body; try { body = await readBody(req); } catch { return json(res, 400, { error: "Invalid request body." }); }
    const domain = String(body.domain || "").toLowerCase();
    if (!domain || domain.length > 253) return json(res, 400, { error: "Choose a valid domain." });
    try {
      const available = await domains();
      if (!available.includes(domain)) return json(res, 400, { error: "This domain is not configured or currently available." });
      const address = `user${randomUUID().replaceAll("-", "").slice(0,14)}@${domain}`;
      const password = `${randomUUID()}-${randomUUID()}`;
      const account = await provider("/accounts", { method: "POST", body: { address, password } });
      const auth = await provider("/token", { method: "POST", body: { address, password } });
      if (!account.id || !auth.token) return json(res, 502, { error: "Provider did not return a valid mailbox." });
      const box = { id: account.id, address, domain, token: auth.token, createdAt: new Date().toISOString() };
      session.boxes.set(box.id, box);
      return json(res, 201, { mailbox: { id: box.id, address, domain, createdAt: box.createdAt } });
    } catch (e) { return json(res, e.status || 502, { error: e.message || "Could not create mailbox." }); }
  }
  const match = path.match(/^\/api\/emails\/([^/]+)(?:\/messages(?:\/([^/]+))?)?$/);
  if (match) {
    const id = decodeURIComponent(match[1]), messageId = match[2] ? decodeURIComponent(match[2]) : null;
    const box = session.boxes.get(id);
    if (!box) return json(res, 404, { error: "Mailbox not found in this session." });
    if (req.method === "DELETE" && !messageId && !path.includes("/messages")) {
      session.boxes.delete(id);
      return json(res, 200, { deleted: true, note: "Removed from this app session; provider-side deletion may not be supported." });
    }
    if (req.method === "GET" && path.endsWith("/messages") && !messageId) {
      try {
        const d = await provider("/messages?page=1", { token: box.token });
        const messages = (d["hydra:member"] || []).map(m => ({ id: m.id, from: m.from?.address || "Unknown sender", name: m.from?.name || "", subject: m.subject || "(No subject)", intro: m.intro || "", seen: Boolean(m.seen), createdAt: m.createdAt || null }));
        return json(res, 200, { messages });
      } catch (e) { return json(res, e.status || 502, { error: e.message || "Could not fetch inbox." }); }
    }
    if (req.method === "GET" && messageId) {
      try {
        const m = await provider(`/messages/${encodeURIComponent(messageId)}`, { token: box.token });
        const text = String(m.text || m.intro || "");
        return json(res, 200, { id: m.id, from: m.from?.address || "Unknown sender", subject: m.subject || "(No subject)", text, createdAt: m.createdAt || null, code: otpFrom(`${m.subject || ""}\n${text}`) });
      } catch (e) { return json(res, e.status || 502, { error: e.message || "Could not read message." }); }
    }
  }
  return json(res, 404, { error: "Not found." });
}
const server = createServer(async (req, res) => {
  try {
    // Basic same-origin protection for browser writes. Use HTTPS and an explicit trusted origin in production.
    if (["POST","DELETE","PUT","PATCH"].includes(req.method) && req.headers.origin) {
      const expected = process.env.PUBLIC_ORIGIN;
      if (expected && req.headers.origin !== expected) return json(res, 403, { error: "Origin not allowed." });
    }
    await route(req, res);
  } catch (e) {
    console.error("Request error:", e?.message || e);
    if (!res.headersSent) json(res, 500, { error: "Internal server error." });
  }
});
server.listen(PORT, () => console.log(`VibeMail running on http://localhost:${PORT}`));

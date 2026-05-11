import{k as N,a5 as q,d as C,r as n,j as e,Y as K,X as D,aS as E,ax as $}from"./index-BIevcIfQ.js";import{R as I}from"./radio-CG2pTgsz.js";import{G as O}from"./globe-CfjRD6a4.js";import{Z as P}from"./zap-Coz7ZfOx.js";import{U as L}from"./users-BGgmo81r.js";import{H as B}from"./heart-CivLr2YG.js";import{T as Y}from"./tv-F2glyA6Z.js";import{M as H}from"./message-square-BBBISs_C.js";import{M as z}from"./music-B5I2fSmk.js";import{M as G}from"./menu-B2U7sx6U.js";import{C as M}from"./chevron-right-DxZqTD8F.js";import{S as X}from"./search-B-6yBWX4.js";import{A as J}from"./arrow-right-DKQ3RBFS.js";import{E as F}from"./external-link-0SNfyMRn.js";import{C as V}from"./copy-Cp8KEdIf.js";const W=[["path",{d:"M12 7v14",key:"1akyts"}],["path",{d:"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",key:"ruj8y"}]],Q=N("book-open",W);const Z=[["path",{d:"m16 18 6-6-6-6",key:"eg8j8"}],["path",{d:"m8 6-6 6 6 6",key:"ppft3o"}]],ee=N("code",Z),te={GET:{bg:"bg-emerald-500/10",text:"text-emerald-400",border:"border-emerald-500/20"},POST:{bg:"bg-blue-500/10",text:"text-blue-400",border:"border-blue-500/20"},PUT:{bg:"bg-amber-500/10",text:"text-amber-400",border:"border-amber-500/20"},DELETE:{bg:"bg-red-500/10",text:"text-red-400",border:"border-red-500/20"}},ae={curl:"cURL",javascript:"JavaScript",python:"Python",swift:"Swift",kotlin:"Kotlin"},t="https://themegaradio.com",R=[{id:"overview",label:"Getting Started",icon:Q,items:[{id:"introduction",label:"Introduction"},{id:"authentication",label:"Authentication"},{id:"rate-limits",label:"Rate Limits"},{id:"errors",label:"Error Handling"}]},{id:"stations",label:"Stations",icon:I,items:[{id:"list-stations",label:"List Stations"},{id:"get-station",label:"Get Station"},{id:"popular-stations",label:"Popular Stations"},{id:"search-stations",label:"Search Stations"},{id:"nearby-stations",label:"Nearby Stations"},{id:"similar-stations",label:"Similar Stations"},{id:"random-station",label:"Random Station"},{id:"track-click",label:"Track Click"}]},{id:"discovery",label:"Discovery",icon:O,items:[{id:"list-genres",label:"List Genres"},{id:"genre-stations",label:"Genre Stations"},{id:"discoverable-genres",label:"Discoverable Genres"},{id:"list-countries",label:"List Countries"},{id:"list-languages",label:"List Languages"},{id:"trending",label:"Trending Stations"},{id:"community-favorites",label:"Community Favorites"},{id:"diverse-recommendations",label:"Recommendations"}]},{id:"streaming",label:"Streaming",icon:P,items:[{id:"resolve-stream",label:"Resolve Stream URL"},{id:"now-playing",label:"Now Playing"}]},{id:"user-auth",label:"Authentication",icon:L,items:[{id:"signup",label:"Sign Up"},{id:"web-login",label:"Web Login"},{id:"mobile-login",label:"Mobile Login"},{id:"google-login",label:"Google Sign-In"},{id:"apple-login",label:"Apple Sign-In"},{id:"current-user",label:"Current User"}]},{id:"user-data",label:"User Data",icon:B,items:[{id:"list-favorites",label:"List Favorites"},{id:"add-favorite",label:"Add Favorite"},{id:"remove-favorite",label:"Remove Favorite"},{id:"list-recently-played",label:"Recently Played"},{id:"add-recently-played",label:"Add Recently Played"},{id:"rate-station",label:"Rate a Station"},{id:"register-push-token",label:"Register Push Token"},{id:"unregister-push-token",label:"Unregister Push Token"}]},{id:"tv",label:"TV & Cast",icon:Y,items:[{id:"tv-init",label:"TV/Mobile Init"},{id:"tv-request-code",label:"TV: Request Code"},{id:"tv-poll-status",label:"TV: Poll Status"},{id:"tv-activate",label:"TV: Activate Device"},{id:"cast-create",label:"Cast: Create Session"},{id:"cast-command",label:"Cast: Send Command"}]},{id:"messaging",label:"Messaging",icon:H,items:[{id:"msg-conversations",label:"List Conversations"},{id:"msg-conversation",label:"Get Conversation"},{id:"msg-send",label:"Send Message"},{id:"msg-contacts",label:"List Contacts"},{id:"msg-unread",label:"Unread Count"},{id:"msg-search-users",label:"Search Users"},{id:"msg-online-status",label:"Online Status"},{id:"msg-upload-image",label:"Upload Image"},{id:"msg-websocket",label:"WebSocket (Real-time)"}]},{id:"misc",label:"Misc",icon:z,items:[{id:"translations",label:"App Translations"}]},{id:"sdks",label:"SDKs & Guides",icon:ee,items:[{id:"guide-javascript",label:"JavaScript / Web"},{id:"guide-react-native",label:"React Native"},{id:"guide-ios",label:"iOS (Swift)"},{id:"guide-android",label:"Android (Kotlin)"}]}];function U({text:a}){const[r,i]=n.useState(!1),l=n.useCallback(()=>{navigator.clipboard.writeText(a),i(!0),setTimeout(()=>i(!1),2e3)},[a]);return e.jsx("button",{onClick:l,className:"absolute top-3 right-3 p-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors","aria-label":"Copy",children:r?e.jsx($,{className:"w-3.5 h-3.5 text-emerald-400"}):e.jsx(V,{className:"w-3.5 h-3.5 text-slate-400"})})}function se({method:a}){const r=te[a];return e.jsx("span",{className:`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tracking-wider ${r.bg} ${r.text} border ${r.border}`,children:a})}function u({code:a,lang:r}){return e.jsxs("div",{className:"relative group rounded-lg bg-[#0d1117] border border-white/5 overflow-hidden",children:[r&&e.jsx("div",{className:"px-4 py-1.5 text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/5 font-medium",children:r}),e.jsx(U,{text:a}),e.jsx("pre",{className:"p-4 overflow-x-auto text-[13px] leading-relaxed",children:e.jsx("code",{className:"text-slate-300 font-mono",children:a})})]})}function ie({examples:a}){const r=Object.keys(a),[i,l]=n.useState(r[0]);return r.length===0?null:e.jsxs("div",{className:"rounded-lg bg-[#0d1117] border border-white/5 overflow-hidden",children:[e.jsx("div",{className:"flex border-b border-white/5 overflow-x-auto",children:r.map(m=>e.jsx("button",{onClick:()=>l(m),className:`px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors ${i===m?"text-white bg-white/5 border-b-2 border-blue-400":"text-slate-500 hover:text-slate-300"}`,children:ae[m]},m))}),e.jsxs("div",{className:"relative",children:[e.jsx(U,{text:a[i]||""}),e.jsx("pre",{className:"p-4 overflow-x-auto text-[13px] leading-relaxed",children:e.jsx("code",{className:"text-slate-300 font-mono",children:a[i]})})]})]})}function S({params:a,title:r}){return a.length?e.jsxs("div",{className:"mt-6",children:[e.jsx("h4",{className:"text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider",children:r}),e.jsx("div",{className:"border border-white/5 rounded-lg overflow-hidden",children:e.jsxs("table",{className:"w-full text-sm",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"bg-white/[0.02]",children:[e.jsx("th",{className:"text-left px-4 py-2.5 text-slate-400 font-medium text-xs uppercase tracking-wider",children:"Parameter"}),e.jsx("th",{className:"text-left px-4 py-2.5 text-slate-400 font-medium text-xs uppercase tracking-wider",children:"Type"}),e.jsx("th",{className:"text-left px-4 py-2.5 text-slate-400 font-medium text-xs uppercase tracking-wider",children:"Description"})]})}),e.jsx("tbody",{children:a.map((i,l)=>e.jsxs("tr",{className:l%2===0?"bg-transparent":"bg-white/[0.01]",children:[e.jsxs("td",{className:"px-4 py-3 font-mono text-[13px]",children:[e.jsx("span",{className:"text-sky-400",children:i.name}),i.required&&e.jsx("span",{className:"ml-1.5 text-[10px] text-red-400 font-sans font-medium",children:"required"}),i.default&&e.jsxs("span",{className:"ml-1.5 text-[10px] text-slate-500 font-sans",children:["= ",i.default]})]}),e.jsx("td",{className:"px-4 py-3 text-amber-300/80 font-mono text-[13px]",children:i.type}),e.jsx("td",{className:"px-4 py-3 text-slate-400",children:i.description})]},i.name))})]})})]}):null}function re({endpoint:a}){return e.jsxs("div",{id:a.id,className:"scroll-mt-20 mb-12",children:[e.jsxs("div",{className:"flex items-center gap-3 mb-3",children:[e.jsx(se,{method:a.method}),e.jsx("code",{className:"text-sm font-mono text-slate-300 bg-white/5 px-3 py-1 rounded-md",children:a.path})]}),e.jsx("h3",{className:"text-xl font-semibold text-white mb-2",children:a.title}),e.jsx("p",{className:"text-slate-400 leading-relaxed mb-6",children:a.description}),a.params&&e.jsx(S,{params:a.params,title:"Query Parameters"}),a.bodyParams&&e.jsx(S,{params:a.bodyParams,title:"Body Parameters"}),a.headers&&e.jsx(S,{params:a.headers,title:"Headers"}),a.notes&&a.notes.length>0&&e.jsx("div",{className:"mt-4 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20",children:e.jsxs("div",{className:"flex gap-3",children:[e.jsx(E,{className:"w-4 h-4 text-blue-400 shrink-0 mt-0.5"}),e.jsx("div",{className:"space-y-1",children:a.notes.map((r,i)=>e.jsx("p",{className:"text-blue-200/80 text-sm",children:r},i))})]})}),e.jsxs("div",{className:"mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4",children:[e.jsxs("div",{children:[e.jsx("h4",{className:"text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider",children:"Request"}),e.jsx(ie,{examples:a.codeExamples})]}),e.jsxs("div",{children:[e.jsx("h4",{className:"text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider",children:"Response"}),e.jsx(u,{code:a.responseExample,lang:"JSON"})]})]})]})}const oe=n.memo(()=>e.jsxs("div",{children:[e.jsxs("div",{className:"mb-12",children:[e.jsx("h1",{className:"text-4xl font-bold text-white mb-4",children:"Mega Radio API"}),e.jsx("p",{className:"text-lg text-slate-400 leading-relaxed max-w-2xl",children:"Access 40,000+ radio stations worldwide. Build radio apps, integrate live streaming, and create personalized listening experiences with our REST API."})]}),e.jsx("div",{className:"grid grid-cols-1 md:grid-cols-3 gap-4 mb-12",children:[{icon:I,title:"40,000+ Stations",desc:"Global radio stations with metadata, logos, and stream URLs"},{icon:P,title:"Real-time Streaming",desc:"HLS and direct stream resolution with now-playing metadata"},{icon:O,title:"57 Languages",desc:"Multilingual support with localized content and search"}].map(a=>e.jsxs("div",{className:"rounded-xl bg-white/[0.03] border border-white/5 p-5 hover:border-white/10 transition-colors",children:[e.jsx(a.icon,{className:"w-8 h-8 text-blue-400 mb-3"}),e.jsx("h3",{className:"text-white font-semibold mb-1",children:a.title}),e.jsx("p",{className:"text-sm text-slate-400",children:a.desc})]},a.title))}),e.jsx("h2",{className:"text-2xl font-bold text-white mb-4",children:"Base URL"}),e.jsx(u,{code:`${t}/api`,lang:"Base URL"}),e.jsxs("div",{className:"mt-8",children:[e.jsx("h2",{className:"text-2xl font-bold text-white mb-4",children:"Quick Start"}),e.jsx("p",{className:"text-slate-400 mb-4",children:"Get a demo API key and make your first request in seconds:"}),e.jsx(u,{code:`# 1. Get a free demo API key (valid 24h)
curl ${t}/api/api-keys/demo

# 2. Search for stations
curl -H "X-API-Key: YOUR_KEY" "${t}/api/stations?search=jazz&limit=5"

# 3. Get station details
curl -H "X-API-Key: YOUR_KEY" "${t}/api/station/bbc-radio-1"

# 4. Get stations by country (supports English, native, ISO-2, ISO-3 codes)
curl -H "X-API-Key: YOUR_KEY" "${t}/api/stations?country=Turkey&limit=10"
curl -H "X-API-Key: YOUR_KEY" "${t}/api/stations?country=DE&limit=10"
curl -H "X-API-Key: YOUR_KEY" "${t}/api/stations?country=AUT&limit=10"`,lang:"Quick Start"})]}),e.jsxs("div",{className:"mt-8",children:[e.jsx("h2",{className:"text-2xl font-bold text-white mb-4",children:"Country Filter Formats"}),e.jsxs("p",{className:"text-slate-400 mb-4",children:["The ",e.jsx("code",{className:"bg-white/5 px-1.5 py-0.5 rounded text-xs text-sky-400",children:"country"})," parameter accepts multiple formats across all endpoints:"]}),e.jsx("div",{className:"border border-white/5 rounded-xl overflow-hidden",children:e.jsxs("table",{className:"w-full text-sm",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"bg-white/[0.03]",children:[e.jsx("th",{className:"text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider",children:"Format"}),e.jsx("th",{className:"text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider",children:"Example"}),e.jsx("th",{className:"text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider",children:"Resolves To"})]})}),e.jsx("tbody",{children:[{format:"English Name",example:"Germany",resolves:"Germany"},{format:"ISO-2 Code",example:"DE",resolves:"Germany"},{format:"ISO-3 Code",example:"DEU",resolves:"Germany"},{format:"Native Name",example:"Deutschland",resolves:"Germany"},{format:"Turkish Name",example:"Almanya",resolves:"Germany"},{format:"Case-insensitive",example:"turkey, TURKEY, Turkey",resolves:"Turkey"},{format:"ASCII variant",example:"turkiye, Turkiye",resolves:"Turkey"}].map((a,r)=>e.jsxs("tr",{className:r%2===0?"":"bg-white/[0.01]",children:[e.jsx("td",{className:"px-5 py-3 text-white font-medium",children:a.format}),e.jsx("td",{className:"px-5 py-3 text-sky-400 font-mono text-[13px]",children:a.example}),e.jsx("td",{className:"px-5 py-3 text-slate-400",children:a.resolves})]},a.format))})]})})]})]})),ne=n.memo(()=>e.jsxs("div",{children:[e.jsx("h1",{className:"text-4xl font-bold text-white mb-4",children:"Authentication"}),e.jsx("p",{className:"text-lg text-slate-400 leading-relaxed mb-8",children:"All API requests require authentication via an API key. Include your key in every request using one of these methods:"}),e.jsx("div",{className:"space-y-4 mb-8",children:[{title:"X-API-Key Header (Recommended)",code:`curl -H "X-API-Key: mr_your_api_key" ${t}/api/stations`},{title:"Authorization Bearer",code:`curl -H "Authorization: Bearer mr_your_api_key" ${t}/api/stations`}].map(a=>e.jsxs("div",{children:[e.jsx("h3",{className:"text-white font-semibold mb-2",children:a.title}),e.jsx(u,{code:a.code})]},a.title))}),e.jsx("h2",{className:"text-2xl font-bold text-white mb-4",children:"Getting an API Key"}),e.jsxs("div",{className:"space-y-6",children:[e.jsxs("div",{className:"rounded-xl bg-white/[0.03] border border-white/5 p-6",children:[e.jsx("h3",{className:"text-lg font-semibold text-white mb-2",children:"Demo Key (Instant)"}),e.jsx("p",{className:"text-slate-400 mb-3",children:"Get a temporary key instantly. Valid for 24 hours, limited to 10 req/min. One per IP address."}),e.jsx(u,{code:`curl -X GET ${t}/api/api-keys/demo`})]}),e.jsxs("div",{className:"rounded-xl bg-white/[0.03] border border-white/5 p-6",children:[e.jsx("h3",{className:"text-lg font-semibold text-white mb-2",children:"Free Key (Register)"}),e.jsx("p",{className:"text-slate-400 mb-3",children:"Register for a permanent key with higher limits. 60 req/min, 1,000 requests/day."}),e.jsx(u,{code:`curl -X POST ${t}/api/api-keys/user/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "dev@example.com",
    "password": "securepassword",
    "name": "Your Name",
    "appName": "My Radio App",
    "appDescription": "A radio streaming app"
  }'`})]}),e.jsxs("div",{className:"rounded-xl bg-white/[0.03] border border-white/5 p-6",children:[e.jsx("h3",{className:"text-lg font-semibold text-white mb-2",children:"Developer Portal"}),e.jsx("p",{className:"text-slate-400 mb-3",children:"Manage your API keys, view usage statistics, and upgrade your plan."}),e.jsxs("a",{href:"/api-user",className:"inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 font-medium transition-colors",children:["Open Developer Portal ",e.jsx(F,{className:"w-4 h-4"})]})]})]})]})),le=n.memo(()=>e.jsxs("div",{children:[e.jsx("h1",{className:"text-4xl font-bold text-white mb-4",children:"Rate Limits"}),e.jsx("p",{className:"text-lg text-slate-400 leading-relaxed mb-8",children:"Rate limits protect the API from abuse and ensure fair usage. Limits vary by plan tier."}),e.jsx("div",{className:"border border-white/5 rounded-xl overflow-hidden mb-8",children:e.jsxs("table",{className:"w-full text-sm",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"bg-white/[0.03]",children:[e.jsx("th",{className:"text-left px-5 py-3.5 text-slate-400 font-semibold text-xs uppercase tracking-wider",children:"Plan"}),e.jsx("th",{className:"text-left px-5 py-3.5 text-slate-400 font-semibold text-xs uppercase tracking-wider",children:"Requests/Min"}),e.jsx("th",{className:"text-left px-5 py-3.5 text-slate-400 font-semibold text-xs uppercase tracking-wider",children:"Daily Quota"}),e.jsx("th",{className:"text-left px-5 py-3.5 text-slate-400 font-semibold text-xs uppercase tracking-wider",children:"Monthly Quota"}),e.jsx("th",{className:"text-left px-5 py-3.5 text-slate-400 font-semibold text-xs uppercase tracking-wider",children:"Price"})]})}),e.jsx("tbody",{children:[{plan:"Demo",rpm:"10",daily:"100",monthly:"500",price:"Free (24h)",color:"text-slate-300"},{plan:"Free",rpm:"60",daily:"1,000",monthly:"10,000",price:"Free",color:"text-emerald-400"},{plan:"Pro",rpm:"300",daily:"10,000",monthly:"100,000",price:"Contact us",color:"text-blue-400"},{plan:"Internal",rpm:"Unlimited",daily:"Unlimited",monthly:"Unlimited",price:"--",color:"text-purple-400"}].map((a,r)=>e.jsxs("tr",{className:r%2===0?"":"bg-white/[0.01]",children:[e.jsx("td",{className:`px-5 py-3.5 font-semibold ${a.color}`,children:a.plan}),e.jsx("td",{className:"px-5 py-3.5 text-slate-300 font-mono",children:a.rpm}),e.jsx("td",{className:"px-5 py-3.5 text-slate-300 font-mono",children:a.daily}),e.jsx("td",{className:"px-5 py-3.5 text-slate-300 font-mono",children:a.monthly}),e.jsx("td",{className:"px-5 py-3.5 text-slate-400",children:a.price})]},a.plan))})]})}),e.jsx("h2",{className:"text-2xl font-bold text-white mb-4",children:"Rate Limit Headers"}),e.jsx("p",{className:"text-slate-400 mb-4",children:"Every API response includes these headers so you can track your usage:"}),e.jsx(u,{code:`X-RateLimit-Limit: 60          # Max requests per minute
X-RateLimit-Remaining: 58      # Remaining requests this minute
X-RateLimit-Reset: 45          # Seconds until window resets
X-Daily-Remaining: 950         # Remaining daily quota`,lang:"Response Headers"}),e.jsx("div",{className:"mt-6 p-4 rounded-lg bg-amber-500/5 border border-amber-500/20",children:e.jsxs("div",{className:"flex gap-3",children:[e.jsx(E,{className:"w-5 h-5 text-amber-400 shrink-0 mt-0.5"}),e.jsxs("div",{children:[e.jsx("p",{className:"text-amber-200 font-medium text-sm",children:"Rate Limit Exceeded"}),e.jsxs("p",{className:"text-amber-200/60 text-sm mt-1",children:["When you exceed your rate limit, the API returns ",e.jsx("code",{className:"bg-white/5 px-1.5 py-0.5 rounded text-xs",children:"429 Too Many Requests"}),". Back off and retry after the reset window."]})]})]})})]})),de=n.memo(()=>e.jsxs("div",{children:[e.jsx("h1",{className:"text-4xl font-bold text-white mb-4",children:"Error Handling"}),e.jsx("p",{className:"text-lg text-slate-400 leading-relaxed mb-8",children:"The API uses conventional HTTP status codes. Errors include a JSON body with details."}),e.jsx("div",{className:"border border-white/5 rounded-xl overflow-hidden mb-8",children:e.jsxs("table",{className:"w-full text-sm",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"bg-white/[0.03]",children:[e.jsx("th",{className:"text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider",children:"Code"}),e.jsx("th",{className:"text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider",children:"Status"}),e.jsx("th",{className:"text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider",children:"Description"})]})}),e.jsx("tbody",{children:[{code:"200",status:"OK",desc:"Request succeeded",color:"text-emerald-400"},{code:"400",status:"Bad Request",desc:"Invalid parameters or missing required fields",color:"text-amber-400"},{code:"401",status:"Unauthorized",desc:"Missing or invalid API key / auth token",color:"text-red-400"},{code:"403",status:"Forbidden",desc:"API key lacks permission for this action",color:"text-red-400"},{code:"404",status:"Not Found",desc:"Resource not found",color:"text-amber-400"},{code:"429",status:"Too Many Requests",desc:"Rate limit or quota exceeded",color:"text-red-400"},{code:"500",status:"Internal Error",desc:"Server error -- please retry or contact support",color:"text-red-400"}].map((a,r)=>e.jsxs("tr",{className:r%2===0?"":"bg-white/[0.01]",children:[e.jsx("td",{className:`px-5 py-3 font-mono font-bold ${a.color}`,children:a.code}),e.jsx("td",{className:"px-5 py-3 text-white font-medium",children:a.status}),e.jsx("td",{className:"px-5 py-3 text-slate-400",children:a.desc})]},a.code))})]})}),e.jsx("h2",{className:"text-2xl font-bold text-white mb-4",children:"Error Response Format"}),e.jsx(u,{code:`{
  "error": "Station not found",
  "statusCode": 404
}`,lang:"JSON"})]})),g=[{id:"list-stations",method:"GET",path:"/api/stations",title:"List Stations",description:"Retrieve a paginated list of radio stations. Supports filtering by country, genre, language, tags, and more. The country parameter accepts English names, native names, Turkish names, ISO-2 codes (DE), and ISO-3 codes (DEU).",params:[{name:"page",type:"number",default:"1",description:"Page number for pagination"},{name:"limit",type:"number",default:"25",description:"Number of stations per page (max 100)"},{name:"country",type:"string",description:"Filter by country. Accepts: English (Germany), native (Deutschland), Turkish (Almanya), ISO-2 (DE), ISO-3 (DEU)"},{name:"state",type:"string",description:"Filter by state/region (e.g., 'Bavaria', 'Wien')"},{name:"genre",type:"string",description:"Filter by genre (e.g., 'rock', 'jazz', 'pop')"},{name:"tags",type:"string",description:"Filter by tags (partial match, e.g., 'electronic')"},{name:"language",type:"string",description:"Filter by language (e.g., 'english', 'turkish', 'german')"},{name:"search",type:"string",description:"Full-text search across station name, country, genre, and tags"},{name:"sort",type:"string",default:"votes",description:"Sort field: votes, az (A-Z), za (Z-A), newest, oldest"},{name:"order",type:"string",default:"desc",description:"Sort order: asc or desc"},{name:"excludeBroken",type:"boolean",default:"false",description:"Exclude stations that failed last health check"},{name:"minVotes",type:"number",default:"0",description:"Minimum vote count filter"},{name:"tv",type:"string",description:"Set to '1' for optimized TV/mobile response with fewer fields"},{name:"excludeStationIds",type:"string",description:"Comma-separated station IDs to exclude from results"}],notes:["The country param supports 219 countries in multiple name formats (English, native, Turkish, ISO-2, ISO-3).","When tv=1 is set, the response uses a slimmer projection optimized for TV/mobile apps."],responseExample:`{
  "stations": [
    {
      "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "name": "BBC Radio 1",
      "slug": "bbc-radio-1",
      "url": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
      "favicon": "https://cdn-radiotime-logos.tunein.com/s24939q.png",
      "country": "The United Kingdom Of Great Britain And Northern Ireland",
      "countrycode": "GB",
      "state": "",
      "language": "english",
      "genre": "pop",
      "tags": "pop,dance,electronic",
      "codec": "MP3",
      "bitrate": 128,
      "votes": 15234,
      "clickCount": 89421,
      "lastCheckOk": true,
      "hls": false,
      "logoAssets": { "webp256": "https://...", "status": "completed" }
    }
  ],
  "totalCount": 42150,
  "count": 42150,
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 42150,
    "pages": 1686
  }
}`,codeExamples:{curl:`# Filter by country (English name)
curl -H "X-API-Key: YOUR_KEY" \\
  "${t}/api/stations?country=Germany&genre=rock&limit=10"

# Filter by ISO-2 code
curl -H "X-API-Key: YOUR_KEY" \\
  "${t}/api/stations?country=DE&genre=rock&limit=10"

# Filter by ISO-3 code
curl -H "X-API-Key: YOUR_KEY" \\
  "${t}/api/stations?country=DEU&genre=rock&limit=10"

# Filter by Turkish name
curl -H "X-API-Key: YOUR_KEY" \\
  "${t}/api/stations?country=Almanya&genre=rock&limit=10"

# TV/Mobile optimized response
curl -H "X-API-Key: YOUR_KEY" \\
  "${t}/api/stations?country=TR&limit=20&tv=1"`,javascript:`const response = await fetch('${t}/api/stations?country=DE&genre=rock&limit=10', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const data = await response.json();
console.log(data.stations);       // Array of stations
console.log(data.totalCount);     // Total matching stations
console.log(data.pagination);     // { page, limit, total, pages }`,python:`import requests

response = requests.get(
    '${t}/api/stations',
    headers={'X-API-Key': 'YOUR_KEY'},
    params={
        'country': 'DE',       # or 'Germany', 'DEU', 'Deutschland'
        'genre': 'rock',
        'limit': 10
    }
)
data = response.json()
stations = data['stations']
total = data['totalCount']`,swift:`var components = URLComponents(string: "${t}/api/stations")!
components.queryItems = [
    URLQueryItem(name: "country", value: "DE"),
    URLQueryItem(name: "genre", value: "rock"),
    URLQueryItem(name: "limit", value: "10"),
    URLQueryItem(name: "tv", value: "1")
]
var request = URLRequest(url: components.url!)
request.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")`,kotlin:`val url = "${t}/api/stations?country=DE&genre=rock&limit=10&tv=1"
val request = Request.Builder()
    .url(url)
    .header("X-API-Key", "YOUR_KEY")
    .build()

val response = client.newCall(request).execute()
val json = JSONObject(response.body?.string() ?: "")
val stations = json.getJSONArray("stations")
val totalCount = json.getInt("totalCount")`}},{id:"get-station",method:"GET",path:"/api/station/:identifier",title:"Get Station Details",description:"Retrieve detailed information about a specific station by its slug or MongoDB ID. Returns full metadata including stream URL, logo assets, ratings, and localized AI descriptions.",params:[{name:"identifier",type:"string",required:!0,description:"Station slug (e.g., 'bbc-radio-1') or MongoDB ObjectId"}],responseExample:`{
  "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
  "name": "BBC Radio 1",
  "slug": "bbc-radio-1",
  "url": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
  "urlResolved": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
  "favicon": "https://cdn-radiotime-logos.tunein.com/s24939q.png",
  "logoAssets": {
    "webp256": "https://s3.amazonaws.com/megaradio/logos/bbc-radio-1-256.webp",
    "status": "completed"
  },
  "homepage": "https://www.bbc.co.uk/radio1",
  "country": "The United Kingdom Of Great Britain And Northern Ireland",
  "countrycode": "GB",
  "state": "",
  "tags": "pop,dance,electronic,bbc",
  "language": "english",
  "genre": "pop",
  "codec": "MP3",
  "bitrate": 128,
  "hls": false,
  "votes": 15234,
  "clickCount": 89421,
  "averageRating": 4.5,
  "totalRatings": 312,
  "lastCheckOk": true,
  "geoLat": 51.5074,
  "geoLong": -0.1278,
  "descriptions": {
    "en": "BBC Radio 1 is the BBC's popular music and youth culture station...",
    "tr": "BBC Radio 1, BBC'nin populer muzik ve genclik kulturu istasyonudur..."
  }
}`,codeExamples:{curl:`# By slug
curl -H "X-API-Key: YOUR_KEY" "${t}/api/station/bbc-radio-1"

# By MongoDB ID
curl -H "X-API-Key: YOUR_KEY" "${t}/api/station/64a1b2c3d4e5f6a7b8c9d0e1"`,javascript:`const response = await fetch('${t}/api/station/bbc-radio-1', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const station = await response.json();`,python:`response = requests.get(
    '${t}/api/station/bbc-radio-1',
    headers={'X-API-Key': 'YOUR_KEY'}
)
station = response.json()`,swift:`let url = URL(string: "${t}/api/station/bbc-radio-1")!
var request = URLRequest(url: url)
request.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")
let (data, _) = try await URLSession.shared.data(for: request)`,kotlin:`val request = Request.Builder()
    .url("${t}/api/station/bbc-radio-1")
    .header("X-API-Key", "YOUR_KEY")
    .build()`}},{id:"popular-stations",method:"GET",path:"/api/stations/popular",title:"Popular Stations",description:"Get the most popular stations globally or filtered by country/state. Sorted by a combination of votes and recent click trends. Uses precomputed data for fast response.",params:[{name:"country",type:"string",description:"Filter by country (supports all country formats: English, ISO-2, ISO-3, native, Turkish)"},{name:"state",type:"string",description:"Filter by state/region"},{name:"limit",type:"number",default:"20",description:"Number of stations to return (max 50)"},{name:"excludeBroken",type:"boolean",default:"false",description:"Exclude stations that failed health check"},{name:"tv",type:"string",description:"Set to '1' for TV/mobile optimized slim response"}],responseExample:`[
  {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "NRJ France",
    "slug": "nrj-france",
    "url": "https://stream.nrj.fr/nrj/nrj_mp3_128k",
    "favicon": "https://...",
    "country": "France",
    "countrycode": "FR",
    "genre": "pop",
    "tags": "pop,dance,hits",
    "codec": "MP3",
    "bitrate": 128,
    "votes": 28410,
    "clickCount": 145200,
    "lastCheckOk": true
  }
]`,codeExamples:{curl:`# Global popular
curl -H "X-API-Key: YOUR_KEY" "${t}/api/stations/popular?limit=10"

# Popular in Turkey (using ISO-2)
curl -H "X-API-Key: YOUR_KEY" "${t}/api/stations/popular?country=TR&limit=10"

# TV/Mobile optimized
curl -H "X-API-Key: YOUR_KEY" "${t}/api/stations/popular?country=DE&limit=20&tv=1"`,javascript:`const response = await fetch('${t}/api/stations/popular?country=TR&limit=10', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const popular = await response.json(); // Array of stations`,python:`response = requests.get(
    '${t}/api/stations/popular',
    headers={'X-API-Key': 'YOUR_KEY'},
    params={'country': 'TR', 'limit': 10}
)
popular = response.json()  # List of stations`}},{id:"search-stations",method:"GET",path:"/api/stations?search=:query",title:"Search Stations",description:"Full-text search across station names, country, genre, and tags. Combine with country, genre, and language filters for refined results. Genre-specific searches (e.g., 'jazz', 'rock') receive automatic relevance boosting.",params:[{name:"search",type:"string",required:!0,description:"Search query (e.g., 'jazz', 'bbc', 'classical piano')"},{name:"country",type:"string",description:"Narrow results to a specific country (all formats supported)"},{name:"genre",type:"string",description:"Narrow results to a specific genre"},{name:"language",type:"string",description:"Filter by language"},{name:"limit",type:"number",default:"25",description:"Number of results (max 100)"},{name:"page",type:"number",default:"1",description:"Page number for pagination"}],responseExample:`{
  "stations": [
    {
      "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "name": "WBGO Jazz 88.3",
      "slug": "wbgo-jazz-88-3",
      "url": "https://...",
      "favicon": "https://...",
      "tags": "jazz,blues,soul",
      "country": "The United States Of America",
      "countrycode": "US",
      "genre": "jazz",
      "votes": 5420
    }
  ],
  "totalCount": 847,
  "count": 847,
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 847,
    "pages": 34
  }
}`,codeExamples:{curl:`curl -H "X-API-Key: YOUR_KEY" \\
  "${t}/api/stations?search=jazz&country=US&limit=5"`,javascript:`const response = await fetch(
  '${t}/api/stations?search=jazz&country=US&limit=5',
  { headers: { 'X-API-Key': 'YOUR_KEY' } }
);
const { stations, totalCount, pagination } = await response.json();`,python:`response = requests.get(
    '${t}/api/stations',
    headers={'X-API-Key': 'YOUR_KEY'},
    params={'search': 'jazz', 'country': 'US', 'limit': 5}
)
results = response.json()`}},{id:"nearby-stations",method:"GET",path:"/api/stations/nearby",title:"Nearby Stations",description:"Find radio stations near a geographic location using latitude and longitude coordinates. Perfect for location-based discovery in mobile apps.",params:[{name:"lat",type:"number",required:!0,description:"Latitude coordinate (e.g., 41.0082)"},{name:"lng",type:"number",required:!0,description:"Longitude coordinate (e.g., 28.9784)"},{name:"radius",type:"number",default:"100",description:"Search radius in kilometers"},{name:"limit",type:"number",default:"20",description:"Max stations to return"}],responseExample:`[
  {
    "name": "Power FM Turkey",
    "slug": "power-fm-turkey",
    "country": "Turkey",
    "geoLat": 41.0082,
    "geoLong": 28.9784,
    "distance": 2.3,
    "votes": 8920
  }
]`,codeExamples:{curl:`curl -H "X-API-Key: YOUR_KEY" \\
  "${t}/api/stations/nearby?lat=41.0082&lng=28.9784&radius=50&limit=10"`,javascript:`navigator.geolocation.getCurrentPosition(async (pos) => {
  const { latitude, longitude } = pos.coords;
  const response = await fetch(
    \`${t}/api/stations/nearby?lat=\${latitude}&lng=\${longitude}&radius=50\`,
    { headers: { 'X-API-Key': 'YOUR_KEY' } }
  );
  const nearby = await response.json();
});`,swift:`import CoreLocation

let lat = location.coordinate.latitude
let lng = location.coordinate.longitude
let url = URL(string: "${t}/api/stations/nearby?lat=\\(lat)&lng=\\(lng)&radius=50")!
var request = URLRequest(url: url)
request.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")`}},{id:"similar-stations",method:"GET",path:"/api/stations/similar/:id",title:"Similar Stations",description:"Find stations similar to a given station based on genre, country, and tags. Useful for building 'You might also like' features.",params:[{name:"id",type:"string",required:!0,description:"Station ID (MongoDB ObjectId)"},{name:"limit",type:"number",default:"6",description:"Number of similar stations to return"}],responseExample:`[
  {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "Kiss FM UK",
    "slug": "kiss-fm-uk",
    "url": "https://...",
    "favicon": "https://...",
    "country": "The United Kingdom Of Great Britain And Northern Ireland",
    "tags": "dance,pop,electronic",
    "votes": 12500
  }
]`,codeExamples:{curl:`curl -H "X-API-Key: YOUR_KEY" \\
  "${t}/api/stations/similar/64a1b2c3d4e5f6a7b8c9d0e1?limit=5"`,javascript:`const response = await fetch(
  '${t}/api/stations/similar/STATION_ID?limit=5',
  { headers: { 'X-API-Key': 'YOUR_KEY' } }
);
const similar = await response.json();`}},{id:"random-station",method:"GET",path:"/api/stations/country-random",title:"Random Station",description:"Get a random radio station from a specific country using MongoDB $sample aggregation. The country parameter is required. Returns a single random station.",params:[{name:"country",type:"string",required:!0,description:"Country to pick a random station from (all formats supported: English, ISO-2, ISO-3, native, Turkish)"}],responseExample:`{
  "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
  "name": "Radio Nova",
  "slug": "radio-nova",
  "url": "https://...",
  "favicon": "https://...",
  "country": "Finland",
  "countrycode": "FI",
  "tags": "pop,rock",
  "votes": 3200,
  "lastCheckOk": true
}`,codeExamples:{curl:`# Random station from Turkey
curl -H "X-API-Key: YOUR_KEY" "${t}/api/stations/country-random?country=TR"

# Random station from Germany
curl -H "X-API-Key: YOUR_KEY" "${t}/api/stations/country-random?country=Germany"`,javascript:`const response = await fetch(
  '${t}/api/stations/country-random?country=TR',
  { headers: { 'X-API-Key': 'YOUR_KEY' } }
);
const randomStation = await response.json();`}},{id:"track-click",method:"POST",path:"/api/stations/:id/click",title:"Track Station Click",description:"Increment the click count for a station. Call this when a user starts playing a station to improve popularity rankings and trending data.",params:[{name:"id",type:"string",required:!0,description:"Station ID (MongoDB ObjectId)"}],responseExample:`{
  "success": true
}`,codeExamples:{curl:`curl -X POST -H "X-API-Key: YOUR_KEY" \\
  "${t}/api/stations/64a1b2c3d4e5f6a7b8c9d0e1/click"`,javascript:`await fetch('${t}/api/stations/STATION_ID/click', {
  method: 'POST',
  headers: { 'X-API-Key': 'YOUR_KEY' }
});`}}],y=[{id:"list-genres",method:"GET",path:"/api/genres/precomputed",title:"List Genres (Precomputed)",description:"Get precomputed genres with station counts. Supports pagination and search. Optionally filter by country to see genres available in a specific country. Results are cached for fast response.",params:[{name:"countryName",type:"string",description:"Filter genres by country (e.g., 'Germany', 'TR', 'DEU'). Defaults to 'global'."},{name:"country",type:"string",description:"Alias for countryName parameter"},{name:"page",type:"number",default:"1",description:"Page number for pagination"},{name:"limit",type:"number",default:"27",description:"Genres per page (max 200)"},{name:"search",type:"string",description:"Search genre name/slug"}],responseExample:`{
  "success": true,
  "data": [
    {
      "name": "Pop",
      "slug": "pop",
      "stationCount": 8520,
      "isDiscoverable": true
    },
    {
      "name": "Rock",
      "slug": "rock",
      "stationCount": 6210,
      "isDiscoverable": true
    }
  ],
  "genres": [...],
  "count": 850,
  "total": 850,
  "currentPage": 1,
  "page": 1,
  "perPage": 27,
  "limit": 27,
  "totalPages": 32,
  "computedAt": "2025-03-02T10:00:00Z",
  "countryName": "global"
}`,codeExamples:{curl:`# All genres globally
curl -H "X-API-Key: YOUR_KEY" "${t}/api/genres/precomputed"

# Genres in Germany
curl -H "X-API-Key: YOUR_KEY" "${t}/api/genres/precomputed?countryName=Germany"

# Search genres
curl -H "X-API-Key: YOUR_KEY" "${t}/api/genres/precomputed?search=rock&limit=10"`,javascript:`const response = await fetch('${t}/api/genres/precomputed?countryName=DE&limit=20', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const { data: genres, totalPages, count } = await response.json();`,python:`response = requests.get(
    '${t}/api/genres/precomputed',
    headers={'X-API-Key': 'YOUR_KEY'},
    params={'countryName': 'DE', 'limit': 20}
)
data = response.json()
genres = data['data']  # or data['genres']
total = data['count']`}},{id:"genre-stations",method:"GET",path:"/api/genres/:slug/stations",title:"Get Stations by Genre",description:"Get paginated stations for a specific genre by its slug. Optionally filter by country. Returns genre metadata alongside the station list.",params:[{name:"slug",type:"string",required:!0,description:"Genre slug (e.g., 'rock', 'jazz', 'electronic')"},{name:"country",type:"string",description:"Filter stations within this genre by country (all formats supported)"},{name:"page",type:"number",default:"1",description:"Page number"},{name:"limit",type:"number",default:"20",description:"Stations per page (max 100)"}],responseExample:`{
  "genre": {
    "name": "Rock",
    "slug": "rock",
    "stationCount": 6210
  },
  "stations": [
    {
      "_id": "...",
      "name": "Classic Rock FM",
      "slug": "classic-rock-fm",
      "url": "https://...",
      "favicon": "https://...",
      "country": "Germany",
      "tags": "rock,classic rock",
      "votes": 4500
    }
  ],
  "total": 6210,
  "page": 1,
  "pages": 311
}`,codeExamples:{curl:`# All rock stations
curl -H "X-API-Key: YOUR_KEY" "${t}/api/genres/rock/stations?limit=20"

# Rock stations in Turkey
curl -H "X-API-Key: YOUR_KEY" "${t}/api/genres/rock/stations?country=TR&limit=10"

# Jazz stations page 2
curl -H "X-API-Key: YOUR_KEY" "${t}/api/genres/jazz/stations?page=2&limit=20"`,javascript:`const response = await fetch(
  '${t}/api/genres/rock/stations?country=TR&limit=20',
  { headers: { 'X-API-Key': 'YOUR_KEY' } }
);
const { genre, stations, total, page, pages } = await response.json();`,python:`response = requests.get(
    '${t}/api/genres/rock/stations',
    headers={'X-API-Key': 'YOUR_KEY'},
    params={'country': 'TR', 'limit': 20}
)
data = response.json()
stations = data['stations']
genre_info = data['genre']`,swift:`let url = URL(string: "${t}/api/genres/rock/stations?country=TR&limit=20")!
var request = URLRequest(url: url)
request.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")
let (data, _) = try await URLSession.shared.data(for: request)`,kotlin:`val request = Request.Builder()
    .url("${t}/api/genres/rock/stations?country=TR&limit=20")
    .header("X-API-Key", "YOUR_KEY")
    .build()
val response = client.newCall(request).execute()`}},{id:"discoverable-genres",method:"GET",path:"/api/genres/discoverable",title:"Discoverable Genres",description:"Get featured/discoverable genres for the home page or genre discovery UI. Returns a curated subset of genres marked as discoverable, optionally filtered by country.",params:[{name:"country",type:"string",description:"Filter genres that have stations in this country"},{name:"limit",type:"number",default:"13",description:"Number of genres to return (max 50)"}],responseExample:`[
  {
    "name": "Pop",
    "slug": "pop",
    "isDiscoverable": true,
    "stationCount": 8520
  },
  {
    "name": "Rock",
    "slug": "rock",
    "isDiscoverable": true,
    "stationCount": 6210
  }
]`,codeExamples:{curl:`curl -H "X-API-Key: YOUR_KEY" "${t}/api/genres/discoverable?limit=10"

# Discoverable genres for Turkey
curl -H "X-API-Key: YOUR_KEY" "${t}/api/genres/discoverable?country=TR"`,javascript:`const response = await fetch('${t}/api/genres/discoverable?country=TR', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const genres = await response.json(); // Array of genre objects`}},{id:"list-countries",method:"GET",path:"/api/countries",title:"List Countries",description:"Get all countries that have radio stations. Use format=rich for detailed country info including localized names, flags, and station counts.",params:[{name:"format",type:"string",description:"Set to 'rich' for enriched data with station counts, localized names, and flags"}],responseExample:`// Default format (plain list)
[
  "Germany",
  "The United States Of America",
  "France",
  "Turkey"
]

// format=rich
[
  {
    "name": "Germany",
    "code": "DE",
    "stationCount": 3450,
    "flag": "...",
    "localizedNames": { "de": "Deutschland", "tr": "Almanya" }
  }
]`,codeExamples:{curl:`# Plain list
curl -H "X-API-Key: YOUR_KEY" "${t}/api/countries"

# Rich format with station counts
curl -H "X-API-Key: YOUR_KEY" "${t}/api/countries?format=rich"`,javascript:`// Plain list
const response = await fetch('${t}/api/countries', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const countries = await response.json();

// Rich format
const rich = await fetch('${t}/api/countries?format=rich', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
}).then(r => r.json());`}},{id:"list-languages",method:"GET",path:"/api/languages",title:"List Languages",description:"Get all languages available across radio stations with station counts.",responseExample:`[
  { "name": "english", "stationCount": 12500 },
  { "name": "german", "stationCount": 3200 },
  { "name": "turkish", "stationCount": 1800 },
  { "name": "spanish", "stationCount": 2900 }
]`,codeExamples:{curl:`curl -H "X-API-Key: YOUR_KEY" "${t}/api/languages"`,javascript:`const response = await fetch('${t}/api/languages', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const languages = await response.json();`}},{id:"trending",method:"GET",path:"/api/user-engagement/trending",title:"Trending Stations",description:"Get stations that are currently trending based on recent user engagement -- favorites, ratings, and click activity in the past 7 days.",params:[{name:"limit",type:"number",default:"100",description:"Number of trending stations"},{name:"country",type:"string",description:"Filter trending by country (all formats supported)"}],responseExample:`[
  {
    "_id": "...",
    "name": "Radio Energy",
    "slug": "radio-energy",
    "url": "https://...",
    "favicon": "https://...",
    "country": "Germany",
    "votes": 9800,
    "clickCount": 45000
  }
]`,codeExamples:{curl:`curl -H "X-API-Key: YOUR_KEY" "${t}/api/user-engagement/trending?limit=10"

# Trending in Turkey
curl -H "X-API-Key: YOUR_KEY" "${t}/api/user-engagement/trending?country=TR&limit=10"`,javascript:`const response = await fetch('${t}/api/user-engagement/trending?limit=10', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const trending = await response.json();`}},{id:"community-favorites",method:"GET",path:"/api/community-favorites",title:"Community Favorites",description:"Get stations most favorited by the community. Shows what real users love the most, optionally filtered by country.",params:[{name:"country",type:"string",description:"Filter by country (all formats supported)"}],responseExample:`[
  {
    "_id": "...",
    "name": "BBC Radio 1",
    "slug": "bbc-radio-1",
    "url": "https://...",
    "favicon": "https://...",
    "country": "The United Kingdom Of Great Britain And Northern Ireland",
    "favoriteCount": 523,
    "votes": 15234
  }
]`,codeExamples:{curl:`curl -H "X-API-Key: YOUR_KEY" "${t}/api/community-favorites?country=TR"`,javascript:`const response = await fetch('${t}/api/community-favorites?country=TR', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const favorites = await response.json();`}},{id:"diverse-recommendations",method:"GET",path:"/api/recommendations/diverse",title:"Diverse Recommendations",description:"Get a diverse mix of recommended stations sampled across different genres. Ensures variety in the results rather than clustering around one genre. Useful for 'Discover new stations' features.",params:[{name:"country",type:"string",description:"Filter by country (all formats supported)"},{name:"limit",type:"number",default:"20",description:"Number of stations (max 50)"}],responseExample:`{
  "stations": [
    {
      "_id": "...",
      "name": "Jazz FM",
      "slug": "jazz-fm",
      "genre": "jazz",
      "country": "The United Kingdom Of Great Britain And Northern Ireland"
    },
    {
      "_id": "...",
      "name": "Rock Antenne",
      "slug": "rock-antenne",
      "genre": "rock",
      "country": "Germany"
    }
  ],
  "total": 20
}`,codeExamples:{curl:`curl -H "X-API-Key: YOUR_KEY" "${t}/api/recommendations/diverse?limit=20"

# Diverse recommendations for Turkey
curl -H "X-API-Key: YOUR_KEY" "${t}/api/recommendations/diverse?country=TR&limit=15"`,javascript:`const response = await fetch('${t}/api/recommendations/diverse?limit=20', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const { stations } = await response.json();`}}],A=[{id:"resolve-stream",method:"GET",path:"/api/stream/resolve",title:"Resolve Stream URL",description:"Resolve a stream or playlist URL to its direct audio stream URL(s). Handles M3U, PLS, and HLS playlist parsing. Pass the station's stream URL to get the actual playable audio URLs. Essential for building reliable audio players.",params:[{name:"url",type:"string",required:!0,description:"Stream or playlist URL to resolve (the station's url or urlResolved field)"}],notes:["Pass the station's 'url' or 'urlResolved' field as the url parameter.","The resolver handles M3U, PLS, HLS playlists and HTTP redirects.","Returns one or more direct stream URLs as candidates."],responseExample:`{
  "originalUrl": "https://stream.example.com/playlist.m3u",
  "playlistType": "m3u",
  "candidates": [
    "https://stream.example.com/stream1.mp3",
    "https://stream.example.com/stream2.mp3"
  ]
}`,codeExamples:{curl:`# Resolve a station's stream URL
curl -H "X-API-Key: YOUR_KEY" \\
  "${t}/api/stream/resolve?url=https://stream.example.com/playlist.m3u"`,javascript:`// First get the station
const stationRes = await fetch('${t}/api/station/bbc-radio-1', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const station = await stationRes.json();

// Then resolve its stream URL
const streamRes = await fetch(
  \`${t}/api/stream/resolve?url=\${encodeURIComponent(station.url)}\`,
  { headers: { 'X-API-Key': 'YOUR_KEY' } }
);
const { candidates } = await streamRes.json();

const audio = new Audio(candidates[0]);
audio.play();`,swift:`// Resolve stream URL
let streamUrl = station.url.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!
let url = URL(string: "${t}/api/stream/resolve?url=\\(streamUrl)")!
var request = URLRequest(url: url)
request.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")

let (data, _) = try await URLSession.shared.data(for: request)
let result = try JSONDecoder().decode(StreamResolveResponse.self, from: data)
let directUrl = result.candidates.first!`}},{id:"now-playing",method:"GET",path:"/api/now-playing/:id",title:"Now Playing",description:"Get the currently playing track information for a station. Returns title, artist, and station info when available from the stream metadata. Accepts station slug or MongoDB ID.",params:[{name:"id",type:"string",required:!0,description:"Station slug (e.g., 'bbc-radio-1') or MongoDB ObjectId"}],responseExample:`{
  "title": "Blinding Lights",
  "artist": "The Weeknd",
  "station": "BBC Radio 1",
  "genre": "pop"
}`,codeExamples:{curl:`# By slug
curl -H "X-API-Key: YOUR_KEY" "${t}/api/now-playing/bbc-radio-1"

# By ID
curl -H "X-API-Key: YOUR_KEY" "${t}/api/now-playing/64a1b2c3d4e5f6a7b8c9d0e1"`,javascript:`const response = await fetch('${t}/api/now-playing/bbc-radio-1', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const nowPlaying = await response.json();
console.log(\`Now playing: \${nowPlaying.artist} - \${nowPlaying.title}\`);`}}],x=[{id:"signup",method:"POST",path:"/api/auth/signup",title:"Sign Up",description:"Create a new user account. Requires fullName, username, email, and password. Username must be 3-30 characters (alphanumeric, underscore, dot, hyphen). Password must be at least 8 characters.",bodyParams:[{name:"fullName",type:"string",required:!0,description:"User's full display name"},{name:"username",type:"string",required:!0,description:"Unique username (3-30 chars: a-z, 0-9, _, ., -)"},{name:"email",type:"string",required:!0,description:"Email address"},{name:"password",type:"string",required:!0,description:"Password (min 8 characters)"}],responseExample:`{
  "success": true,
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "username": "johndoe",
    "email": "john@example.com"
  }
}`,codeExamples:{curl:`curl -X POST "${t}/api/auth/signup" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fullName": "John Doe",
    "username": "johndoe",
    "email": "john@example.com",
    "password": "securepass123"
  }'`,javascript:`const response = await fetch('${t}/api/auth/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fullName: 'John Doe',
    username: 'johndoe',
    email: 'john@example.com',
    password: 'securepass123'
  })
});
const { user } = await response.json();`,swift:`let body: [String: Any] = [
    "fullName": "John Doe",
    "username": "johndoe",
    "email": "john@example.com",
    "password": "securepass123"
]
let jsonData = try JSONSerialization.data(withJSONObject: body)

var request = URLRequest(url: URL(string: "${t}/api/auth/signup")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = jsonData`,kotlin:`val body = JSONObject().apply {
    put("fullName", "John Doe")
    put("username", "johndoe")
    put("email", "john@example.com")
    put("password", "securepass123")
}

val request = Request.Builder()
    .url("${t}/api/auth/signup")
    .post(body.toString().toRequestBody("application/json".toMediaType()))
    .build()`}},{id:"web-login",method:"POST",path:"/api/auth/login",title:"Web Login",description:"Authenticate a user with email and password. For web clients, returns a session cookie. For mobile/TV clients, set deviceType to 'mobile' or 'tv' (or send X-Device-Type header) to receive a long-lived auth token (mrt_...) in the response.",bodyParams:[{name:"email",type:"string",required:!0,description:"User's email address"},{name:"password",type:"string",required:!0,description:"User's password"},{name:"deviceType",type:"string",description:"Device type: 'web' (default), 'mobile', or 'tv'. Mobile/TV returns an auth token."},{name:"deviceName",type:"string",description:"Device name for identification (e.g., 'iPhone 15', 'Samsung TV')"},{name:"rememberMe",type:"boolean",description:"Remember session for longer duration"}],headers:[{name:"X-Device-Type",type:"string",description:"Alternative to deviceType body param. Set to 'mobile' or 'tv' to receive auth token."}],notes:["For mobile apps: Set deviceType='mobile' or header X-Device-Type='mobile' to receive a token in the response.","For TV apps: Set deviceType='tv' to receive a token.","For web apps: Use credentials: 'include' to receive session cookie."],responseExample:`// Web response (session cookie set)
{
  "success": true,
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "email": "john@example.com",
    "avatar": "https://..."
  }
}

// Mobile/TV response (includes token)
{
  "success": true,
  "token": "mrt_a1b2c3d4e5f6...",
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "email": "john@example.com"
  }
}`,codeExamples:{curl:`# Web login (session cookie)
curl -X POST "${t}/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "john@example.com", "password": "secret"}'

# Mobile login (get auth token)
curl -X POST "${t}/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -H "X-Device-Type: mobile" \\
  -d '{"email": "john@example.com", "password": "secret"}'`,javascript:`// Web login
const response = await fetch('${t}/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ email: 'john@example.com', password: 'secret' })
});
const { user } = await response.json();`,swift:`let body: [String: Any] = [
    "email": "john@example.com",
    "password": "secret",
    "deviceType": "mobile"
]
let jsonData = try JSONSerialization.data(withJSONObject: body)

var request = URLRequest(url: URL(string: "${t}/api/auth/login")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = jsonData

let (data, _) = try await URLSession.shared.data(for: request)
let result = try JSONDecoder().decode(LoginResponse.self, from: data)
let token = result.token  // Store securely in Keychain`,kotlin:`val body = JSONObject().apply {
    put("email", "john@example.com")
    put("password", "secret")
    put("deviceType", "mobile")
}

val request = Request.Builder()
    .url("${t}/api/auth/login")
    .post(body.toString().toRequestBody("application/json".toMediaType()))
    .build()

val response = client.newCall(request).execute()
val token = JSONObject(response.body?.string() ?: "").getString("token")`}},{id:"mobile-login",method:"POST",path:"/api/auth/mobile/login",title:"Mobile Login (Dedicated)",description:"Dedicated mobile login endpoint. Always returns an auth token (mrt_...) for mobile clients. Alternative to using /api/auth/login with deviceType='mobile'. Accepts optional deviceType and deviceName.",bodyParams:[{name:"email",type:"string",required:!0,description:"User's email address"},{name:"password",type:"string",required:!0,description:"User's password"},{name:"deviceType",type:"string",default:"mobile",description:"Device type (default: 'mobile')"},{name:"deviceName",type:"string",description:"Device name for identification"}],responseExample:`{
  "success": true,
  "token": "mrt_a1b2c3d4e5f6...",
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "email": "john@example.com"
  }
}`,codeExamples:{curl:`curl -X POST "${t}/api/auth/mobile/login" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "john@example.com", "password": "secret"}'`,swift:`let body: [String: Any] = [
    "email": "john@example.com",
    "password": "secret"
]
let jsonData = try JSONSerialization.data(withJSONObject: body)

var request = URLRequest(url: URL(string: "${t}/api/auth/mobile/login")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = jsonData

let (data, _) = try await URLSession.shared.data(for: request)
let result = try JSONDecoder().decode(LoginResponse.self, from: data)
let token = result.token  // Store in Keychain`,kotlin:`val body = JSONObject().apply {
    put("email", "john@example.com")
    put("password", "secret")
}

val request = Request.Builder()
    .url("${t}/api/auth/mobile/login")
    .post(body.toString().toRequestBody("application/json".toMediaType()))
    .build()

val response = client.newCall(request).execute()
val token = JSONObject(response.body?.string() ?: "").getString("token")`}},{id:"google-login",method:"POST",path:"/api/auth/google",title:"Google Sign-In (Mobile)",description:"Authenticate with Google using an ID token from the Google Sign-In SDK. Verifies the token server-side using Google's auth library. Creates a new account or links to an existing one. Returns an auth token for mobile/TV use.",bodyParams:[{name:"idToken",type:"string",required:!0,description:"Google ID token from GoogleSignin.signIn()"},{name:"email",type:"string",description:"User's email (not used for linking - only token email is trusted)"},{name:"name",type:"string",description:"Fallback display name if not present in token"},{name:"googleId",type:"string",description:"Google user ID (not used - verified from token)"},{name:"platform",type:"string",default:"mobile",description:"'mobile' or 'tv'"}],headers:[{name:"X-Device-Type",type:"string",description:"Set to 'mobile' for mobile apps"}],notes:["The idToken is verified server-side using google-auth-library. Body email/googleId are NOT trusted for security.","If a user with this Google ID exists, they are logged in. If email matches an existing account, Google ID is linked.","New users are created automatically with emailVerified=true.","Suspended/inactive accounts are rejected with 403.","Token type (mobile/tv) is determined by the 'platform' body param, not X-Device-Type header."],responseExample:`{
  "success": true,
  "token": "mrt_a1b2c3d4e5f6...",
  "expiresIn": "90 days",
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "username": "user_1702234567890_abc123def",
    "email": "john@gmail.com",
    "role": "user",
    "avatar": "https://lh3.googleusercontent.com/..."
  }
}`,codeExamples:{curl:`curl -X POST "${t}/api/auth/google" \\
  -H "Content-Type: application/json" \\
  -H "X-Device-Type: mobile" \\
  -d '{
    "idToken": "GOOGLE_ID_TOKEN_FROM_SDK",
    "platform": "mobile"
  }'`,javascript:`import { GoogleSignin } from '@react-native-google-signin/google-signin';

const userInfo = await GoogleSignin.signIn();
const response = await fetch('${t}/api/auth/google', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Device-Type': 'mobile'
  },
  body: JSON.stringify({
    idToken: userInfo.idToken,
    platform: 'mobile'
  })
});
const { success, token, user } = await response.json();
// Store token securely (SecureStore, Keychain)`,swift:`// After Google Sign-In SDK returns idToken
let body: [String: Any] = [
    "idToken": googleIdToken,
    "platform": "mobile"
]
let jsonData = try JSONSerialization.data(withJSONObject: body)

var request = URLRequest(url: URL(string: "${t}/api/auth/google")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.setValue("mobile", forHTTPHeaderField: "X-Device-Type")
request.httpBody = jsonData

let (data, _) = try await URLSession.shared.data(for: request)
let result = try JSONDecoder().decode(AuthResponse.self, from: data)
// Store result.token in Keychain`,kotlin:`// After Google Sign-In SDK returns idToken
val body = JSONObject().apply {
    put("idToken", googleIdToken)
    put("platform", "mobile")
}

val request = Request.Builder()
    .url("${t}/api/auth/google")
    .header("X-Device-Type", "mobile")
    .post(body.toString().toRequestBody("application/json".toMediaType()))
    .build()

val response = client.newCall(request).execute()
val result = JSONObject(response.body?.string() ?: "")
val token = result.getString("token")
// Store token in EncryptedSharedPreferences`}},{id:"apple-login",method:"POST",path:"/api/auth/apple",title:"Apple Sign-In (Mobile)",description:"Authenticate with Apple using an identity token from Apple Sign-In. Verifies the JWT server-side using Apple's JWKS endpoint. Creates a new account or links to an existing one. Returns an auth token for mobile/TV use.",bodyParams:[{name:"identityToken",type:"string",required:!0,description:"Apple identity token (JWT) from AppleAuthentication.signInAsync()"},{name:"authorizationCode",type:"string",description:"Apple authorization code (reserved for future use)"},{name:"fullName",type:"object",description:"{ givenName, familyName } - Apple only provides this on FIRST sign-in"},{name:"email",type:"string",description:"User's email (not used for linking - only token email is trusted)"},{name:"user",type:"string",description:"Apple user identifier"},{name:"platform",type:"string",default:"mobile",description:"'mobile' or 'tv'"}],headers:[{name:"X-Device-Type",type:"string",description:"Set to 'mobile' for mobile apps"}],notes:["The identityToken JWT is verified against Apple's JWKS (https://appleid.apple.com/auth/keys).","Apple provides fullName and email ONLY on first sign-in. On subsequent sign-ins, these will be null.","Apple does NOT provide profile photos. New Apple-only accounts will have null avatar. Existing accounts linked via email may retain their previous avatar.","If user selects 'Hide My Email', a relay address (xxx@privaterelay.appleid.com) is used.","Audience is verified against APPLE_CLIENT_ID env var or defaults to com.visiongo.megaradio.","Suspended/inactive accounts are rejected with 403."],responseExample:`{
  "success": true,
  "token": "mrt_a1b2c3d4e5f6...",
  "expiresIn": "90 days",
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "username": "user_1702234567890_abc123def",
    "email": "john@icloud.com",
    "role": "user",
    "avatar": null
  }
}`,codeExamples:{curl:`curl -X POST "${t}/api/auth/apple" \\
  -H "Content-Type: application/json" \\
  -H "X-Device-Type: mobile" \\
  -d '{
    "identityToken": "APPLE_IDENTITY_TOKEN_JWT",
    "fullName": { "givenName": "John", "familyName": "Doe" },
    "platform": "mobile"
  }'`,javascript:`import * as AppleAuthentication from 'expo-apple-authentication';

const credential = await AppleAuthentication.signInAsync({
  requestedScopes: [
    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
    AppleAuthentication.AppleAuthenticationScope.EMAIL,
  ],
});

const response = await fetch('${t}/api/auth/apple', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Device-Type': 'mobile'
  },
  body: JSON.stringify({
    identityToken: credential.identityToken,
    authorizationCode: credential.authorizationCode,
    fullName: credential.fullName,
    email: credential.email,
    user: credential.user,
    platform: 'mobile'
  })
});
const { success, token, user } = await response.json();
// Store token securely`,swift:`// After ASAuthorizationAppleIDCredential is received
let body: [String: Any] = [
    "identityToken": String(data: credential.identityToken!, encoding: .utf8)!,
    "authorizationCode": String(data: credential.authorizationCode!, encoding: .utf8)!,
    "fullName": [
        "givenName": credential.fullName?.givenName ?? "",
        "familyName": credential.fullName?.familyName ?? ""
    ],
    "email": credential.email ?? "",
    "user": credential.user,
    "platform": "mobile"
]

var request = URLRequest(url: URL(string: "${t}/api/auth/apple")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONSerialization.data(withJSONObject: body)`,kotlin:`// After Apple Sign-In returns credentials
val body = JSONObject().apply {
    put("identityToken", appleIdentityToken)
    put("authorizationCode", appleAuthCode)
    put("fullName", JSONObject().apply {
        put("givenName", givenName)
        put("familyName", familyName)
    })
    put("platform", "mobile")
}

val request = Request.Builder()
    .url("${t}/api/auth/apple")
    .header("X-Device-Type", "mobile")
    .post(body.toString().toRequestBody("application/json".toMediaType()))
    .build()`}},{id:"current-user",method:"GET",path:"/api/auth/me",title:"Current User",description:"Get the currently authenticated user's profile. Works with both session cookies (web) and auth tokens (mobile). For mobile clients, you can also use /api/auth/mobile/me with a Bearer token.",notes:["Web: Uses session cookie (credentials: 'include').","Mobile: Uses Authorization: Bearer mrt_... header.","Alternative mobile endpoint: GET /api/auth/mobile/me"],responseExample:`{
  "authenticated": true,
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "username": "johndoe",
    "email": "john@example.com",
    "avatar": "https://...",
    "role": "user",
    "followersCount": 150,
    "followingCount": 89,
    "favoriteStationsCount": 24
  }
}`,codeExamples:{curl:`# With auth token
curl -H "Authorization: Bearer mrt_your_token" "${t}/api/auth/me"

# Mobile-specific endpoint
curl -H "Authorization: Bearer mrt_your_token" "${t}/api/auth/mobile/me"`,javascript:`// Web (session)
const response = await fetch('${t}/api/auth/me', {
  credentials: 'include'
});
const { user, authenticated } = await response.json();

// Mobile (token)
const mobileRes = await fetch('${t}/api/auth/me', {
  headers: { 'Authorization': 'Bearer mrt_your_token' }
});`}}],b=[{id:"list-favorites",method:"GET",path:"/api/user/favorites",title:"List User Favorites",description:"Get the authenticated user's favorite stations list. Supports sorting and pagination. Returns full station data with the date each station was favorited.",params:[{name:"sort",type:"string",default:"newest",description:"Sort order: newest, oldest, name"},{name:"page",type:"number",default:"1",description:"Page number"},{name:"limit",type:"number",default:"20",description:"Stations per page"}],headers:[{name:"Authorization",type:"string",required:!0,description:"Bearer mrt_your_token (mobile) or session cookie (web)"}],responseExample:`[
  {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "BBC Radio 1",
    "slug": "bbc-radio-1",
    "url": "https://...",
    "favicon": "https://...",
    "country": "The United Kingdom Of Great Britain And Northern Ireland",
    "genre": "pop",
    "votes": 15234,
    "favoritedAt": "2025-01-15T10:00:00Z"
  }
]`,codeExamples:{curl:`curl -H "Authorization: Bearer mrt_your_token" \\
  "${t}/api/user/favorites?sort=newest&limit=20"`,javascript:`const response = await fetch('${t}/api/user/favorites?sort=newest', {
  headers: { 'Authorization': 'Bearer mrt_your_token' }
});
const favorites = await response.json();`,swift:`var request = URLRequest(url: URL(string: "${t}/api/user/favorites?sort=newest")!)
request.setValue("Bearer \\(authToken)", forHTTPHeaderField: "Authorization")
let (data, _) = try await URLSession.shared.data(for: request)`}},{id:"add-favorite",method:"POST",path:"/api/user/favorites",title:"Add Favorite",description:"Add a station to the authenticated user's favorites list. Requires user authentication via session or auth token.",bodyParams:[{name:"stationId",type:"string",required:!0,description:"Station ID (MongoDB ObjectId) to favorite"}],headers:[{name:"Authorization",type:"string",required:!0,description:"Bearer mrt_your_token (mobile) or session cookie (web)"}],responseExample:`{
  "success": true,
  "message": "Station added to favorites"
}`,codeExamples:{curl:`curl -X POST "${t}/api/user/favorites" \\
  -H "Authorization: Bearer mrt_your_token" \\
  -H "Content-Type: application/json" \\
  -d '{"stationId": "64a1b2c3d4e5f6a7b8c9d0e1"}'`,javascript:`await fetch('${t}/api/user/favorites', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer mrt_your_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ stationId: 'STATION_ID' })
});`,swift:`var request = URLRequest(url: URL(string: "${t}/api/user/favorites")!)
request.httpMethod = "POST"
request.setValue("Bearer \\(authToken)", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONEncoder().encode(["stationId": stationId])`,kotlin:`val body = JSONObject().apply { put("stationId", "STATION_ID") }
val request = Request.Builder()
    .url("${t}/api/user/favorites")
    .header("Authorization", "Bearer $authToken")
    .post(body.toString().toRequestBody("application/json".toMediaType()))
    .build()`}},{id:"remove-favorite",method:"DELETE",path:"/api/user/favorites/:stationId",title:"Remove Favorite",description:"Remove a station from the authenticated user's favorites list.",params:[{name:"stationId",type:"string",required:!0,description:"Station ID to remove from favorites"}],headers:[{name:"Authorization",type:"string",required:!0,description:"Bearer mrt_your_token (mobile) or session cookie (web)"}],responseExample:`{
  "success": true,
  "message": "Station removed from favorites"
}`,codeExamples:{curl:`curl -X DELETE \\
  -H "Authorization: Bearer mrt_your_token" \\
  "${t}/api/user/favorites/64a1b2c3d4e5f6a7b8c9d0e1"`,javascript:`await fetch('${t}/api/user/favorites/STATION_ID', {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer mrt_your_token' }
});`}},{id:"list-recently-played",method:"GET",path:"/api/recently-played",title:"Recently Played",description:"Get the authenticated user's recently played stations, ordered by most recent. Returns up to 12 entries.",headers:[{name:"Authorization",type:"string",required:!0,description:"Bearer mrt_your_token (mobile) or session cookie (web)"}],responseExample:`[
  {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "BBC Radio 1",
    "slug": "bbc-radio-1",
    "url": "https://...",
    "favicon": "https://...",
    "country": "The United Kingdom Of Great Britain And Northern Ireland",
    "playedAt": "2025-03-02T22:30:00Z"
  }
]`,codeExamples:{curl:`curl -H "Authorization: Bearer mrt_your_token" "${t}/api/recently-played"`,javascript:`const response = await fetch('${t}/api/recently-played', {
  headers: { 'Authorization': 'Bearer mrt_your_token' }
});
const recentlyPlayed = await response.json();`}},{id:"add-recently-played",method:"POST",path:"/api/recently-played",title:"Add to Recently Played",description:"Record a station as recently played. The list maintains up to 12 entries with the most recent at the top. Duplicate entries are moved to the top.",bodyParams:[{name:"stationId",type:"string",required:!0,description:"Station ID (MongoDB ObjectId) that was played"}],headers:[{name:"Authorization",type:"string",required:!0,description:"Bearer mrt_your_token (mobile) or session cookie (web)"}],responseExample:`{
  "success": true
}`,codeExamples:{curl:`curl -X POST "${t}/api/recently-played" \\
  -H "Authorization: Bearer mrt_your_token" \\
  -H "Content-Type: application/json" \\
  -d '{"stationId": "64a1b2c3d4e5f6a7b8c9d0e1"}'`,javascript:`await fetch('${t}/api/recently-played', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer mrt_your_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ stationId: 'STATION_ID' })
});`}},{id:"rate-station",method:"POST",path:"/api/stations/:id/rate",title:"Rate a Station",description:"Submit a star rating (1-5) with an optional text comment for a station. Users can update their existing rating. Requires authentication.",bodyParams:[{name:"rating",type:"number",required:!0,description:"Star rating from 1 to 5"},{name:"comment",type:"string",description:"Optional review text (max 1000 characters, HTML stripped)"}],headers:[{name:"Authorization",type:"string",required:!0,description:"Bearer mrt_your_token (mobile) or session cookie (web)"}],responseExample:`{
  "success": true,
  "rating": {
    "rating": 5,
    "comment": "Amazing station!",
    "createdAt": "2025-03-02T22:00:00Z"
  },
  "stats": {
    "averageRating": 4.5,
    "totalRatings": 312,
    "ratingBreakdown": {
      "stars1": 5, "stars2": 8,
      "stars3": 25, "stars4": 89, "stars5": 185
    }
  }
}`,codeExamples:{curl:`curl -X POST "${t}/api/stations/STATION_ID/rate" \\
  -H "Authorization: Bearer mrt_your_token" \\
  -H "Content-Type: application/json" \\
  -d '{"rating": 5, "comment": "Amazing station!"}'`,javascript:`const response = await fetch('${t}/api/stations/STATION_ID/rate', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer mrt_your_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ rating: 5, comment: 'Amazing station!' })
});
const { stats } = await response.json();`}},{id:"register-push-token",method:"POST",path:"/api/user/push-token",title:"Register Push Token",description:"Register a device push notification token. Supports Expo, APNs (iOS), and FCM (Android) tokens. Authentication is optional -- if authenticated, the token is linked to the user account.",bodyParams:[{name:"token",type:"string",required:!0,description:"Push notification token from the device"},{name:"platform",type:"string",required:!0,description:"Platform: 'ios' or 'android'"},{name:"tokenType",type:"string",description:"Token type: 'expo', 'apns', or 'fcm'. Auto-detected if not specified."},{name:"deviceName",type:"string",description:"Device name for identification (e.g., 'iPhone 15 Pro')"},{name:"country",type:"string",description:"User's country for targeted notifications"},{name:"language",type:"string",description:"User's language preference"}],headers:[{name:"Authorization",type:"string",description:"Optional: Bearer mrt_your_token to link token to user account"}],responseExample:`{
  "success": true,
  "message": "Push token registered successfully"
}`,codeExamples:{curl:`curl -X POST "${t}/api/user/push-token" \\
  -H "Authorization: Bearer mrt_your_token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "token": "ExponentPushToken[xxxxx]",
    "platform": "ios",
    "tokenType": "expo",
    "deviceName": "iPhone 15 Pro",
    "country": "Turkey",
    "language": "tr"
  }'`,swift:`let body: [String: Any] = [
    "token": deviceToken,
    "platform": "ios",
    "tokenType": "apns",
    "deviceName": UIDevice.current.name,
    "country": "Turkey",
    "language": "tr"
]
var request = URLRequest(url: URL(string: "${t}/api/user/push-token")!)
request.httpMethod = "POST"
request.setValue("Bearer \\(authToken)", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONSerialization.data(withJSONObject: body)`,kotlin:`val body = JSONObject().apply {
    put("token", fcmToken)
    put("platform", "android")
    put("tokenType", "fcm")
    put("deviceName", Build.MODEL)
    put("country", "Turkey")
    put("language", "tr")
}
val request = Request.Builder()
    .url("${t}/api/user/push-token")
    .header("Authorization", "Bearer $authToken")
    .post(body.toString().toRequestBody("application/json".toMediaType()))
    .build()`}},{id:"unregister-push-token",method:"DELETE",path:"/api/user/push-token",title:"Unregister Push Token",description:"Deactivate a push notification token. The token is soft-deleted (marked inactive) rather than permanently removed. Call this when the user logs out or disables notifications.",bodyParams:[{name:"token",type:"string",required:!0,description:"Push notification token to deactivate"}],responseExample:`{
  "success": true,
  "message": "Push token deactivated"
}`,codeExamples:{curl:`curl -X DELETE "${t}/api/user/push-token" \\
  -H "Content-Type: application/json" \\
  -d '{"token": "ExponentPushToken[xxxxx]"}'`,javascript:`await fetch('${t}/api/user/push-token', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: 'ExponentPushToken[xxxxx]' })
});`}}],v=[{id:"tv-init",method:"GET",path:"/api/tv/init",title:"TV/Mobile App Initialization",description:"Single-request app startup endpoint. Returns popular stations, trending stations, genres, and countries in one response. Optimized for TV and mobile app cold start. Response is cached for 10 minutes.",params:[{name:"country",type:"string",description:"Country name for personalized results (all formats supported)"},{name:"countryCode",type:"string",description:"ISO-2 country code (e.g., 'TR', 'DE'). Alternative to country param."},{name:"limit",type:"number",default:"20",description:"Number of popular/trending stations per section"},{name:"genreLimit",type:"number",default:"13",description:"Number of genres to return"}],notes:["This endpoint is designed for app startup -- call it once when the app launches.","Response is cached server-side for 10 minutes for fast response.","Popular stations are deduplicated by normalized name."],responseExample:`{
  "popularStations": [
    {
      "_id": "...",
      "name": "Power FM",
      "slug": "power-fm",
      "url": "https://...",
      "favicon": "https://...",
      "country": "Turkey",
      "votes": 8920
    }
  ],
  "trendingStations": [
    {
      "_id": "...",
      "name": "Virgin Radio Turkey",
      "slug": "virgin-radio-turkey",
      "url": "https://...",
      "votes": 6500
    }
  ],
  "genres": [
    { "name": "Pop", "slug": "pop", "stationCount": 8520 },
    { "name": "Rock", "slug": "rock", "stationCount": 6210 }
  ],
  "countries": ["Germany", "Turkey", "France", "..."],
  "meta": {
    "country": "Turkey",
    "cachedAt": "2025-03-02T10:00:00Z"
  }
}`,codeExamples:{curl:`# Global init
curl -H "X-API-Key: YOUR_KEY" "${t}/api/tv/init"

# Init for Turkey
curl -H "X-API-Key: YOUR_KEY" "${t}/api/tv/init?country=Turkey&limit=30"

# Init with country code
curl -H "X-API-Key: YOUR_KEY" "${t}/api/tv/init?countryCode=TR&genreLimit=20"`,javascript:`const response = await fetch('${t}/api/tv/init?countryCode=TR', {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const {
  popularStations,
  trendingStations,
  genres,
  countries
} = await response.json();`,swift:`let url = URL(string: "${t}/api/tv/init?countryCode=TR&limit=30")!
var request = URLRequest(url: url)
request.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")

let (data, _) = try await URLSession.shared.data(for: request)
let initData = try JSONDecoder().decode(TVInitResponse.self, from: data)`,kotlin:`val request = Request.Builder()
    .url("${t}/api/tv/init?countryCode=TR&limit=30")
    .header("X-API-Key", "YOUR_KEY")
    .build()

val response = client.newCall(request).execute()
val json = JSONObject(response.body?.string() ?: "")
val popular = json.getJSONArray("popularStations")
val trending = json.getJSONArray("trendingStations")`}},{id:"tv-request-code",method:"POST",path:"/api/auth/tv/code",title:"TV: Request Login Code",description:"Generate a 6-digit login code for TV device authentication. Display this code on the TV screen for the user to enter on their mobile app. Netflix/YouTube-style device activation flow. Code expires in 10 minutes.",bodyParams:[{name:"deviceId",type:"string",required:!0,description:"Unique device identifier for the TV"},{name:"platform",type:"string",default:"other",description:"TV platform: 'tizen' (Samsung), 'webos' (LG), or 'other'"}],responseExample:`{
  "success": true,
  "code": "482915",
  "expiresIn": 600
}`,codeExamples:{curl:`curl -X POST "${t}/api/auth/tv/code" \\
  -H "Content-Type: application/json" \\
  -d '{"deviceId": "tv-unique-id-123", "platform": "tizen"}'`,kotlin:`val body = JSONObject().apply {
    put("deviceId", deviceId)
    put("platform", "tizen")
}

val request = Request.Builder()
    .url("${t}/api/auth/tv/code")
    .post(body.toString().toRequestBody("application/json".toMediaType()))
    .build()`}},{id:"tv-poll-status",method:"GET",path:"/api/auth/tv/code/:code/status",title:"TV: Poll Activation Status",description:"Poll from the TV device to check if the user has activated the login code from their mobile app. Poll every 2-3 seconds. When status is 'activated', the response includes an auth token for the TV to use.",params:[{name:"code",type:"string",required:!0,description:"The 6-digit code from the request step"},{name:"deviceId",type:"string",required:!0,description:"The same device ID used when requesting the code"}],notes:["Poll this endpoint every 2-3 seconds until status becomes 'activated'.","When activated, the response includes a long-lived auth token (90 days) for TV use.","If the code expires (10 min), status returns 'expired' with a 404."],responseExample:`// Pending (keep polling)
{
  "status": "pending"
}

// Activated (stop polling, save token)
{
  "status": "activated",
  "token": "mrt_tv_token...",
  "expiresIn": 7776000,
  "user": {
    "id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "displayName": "John Doe",
    "email": "john@example.com",
    "avatar": "https://..."
  }
}

// Expired
{
  "status": "expired",
  "message": "Code has expired"
}`,codeExamples:{curl:`curl "${t}/api/auth/tv/code/482915/status?deviceId=tv-unique-id-123"`,javascript:`const pollTVStatus = async (code, deviceId) => {
  const response = await fetch(
    \`${t}/api/auth/tv/code/\${code}/status?deviceId=\${deviceId}\`
  );
  const data = await response.json();
  if (data.status === 'activated') {
    console.log('TV logged in! Token:', data.token);
    // Store token for future API calls
  } else if (data.status === 'pending') {
    setTimeout(() => pollTVStatus(code, deviceId), 3000);
  } else {
    console.log('Code expired, request a new one');
  }
};`,kotlin:`suspend fun pollStatus(code: String, deviceId: String) {
    while (true) {
        val request = Request.Builder()
            .url("${t}/api/auth/tv/code/$code/status?deviceId=$deviceId")
            .build()
        val response = client.newCall(request).execute()
        val json = JSONObject(response.body?.string() ?: "")
        when (json.getString("status")) {
            "activated" -> {
                val token = json.getString("token")
                // Save token, navigate to home
                return
            }
            "expired" -> { /* Request new code */ return }
            else -> delay(3000)
        }
    }
}`}},{id:"tv-activate",method:"POST",path:"/api/auth/tv/activate",title:"TV: Activate Device (from Mobile)",description:"Called from the mobile app to activate a TV login code. The user enters the code displayed on their TV and submits it from the mobile app. Links the user's account to the TV device. Requires mobile auth (Bearer token or session).",bodyParams:[{name:"code",type:"string",required:!0,description:"6-digit code displayed on TV"}],headers:[{name:"Authorization",type:"string",required:!0,description:"Bearer mrt_your_token (mobile auth)"}],responseExample:`{
  "success": true,
  "deviceName": "Samsung TV",
  "deviceId": "tv-unique-id-123",
  "message": "Samsung TV successfully logged in as johndoe"
}`,codeExamples:{curl:`curl -X POST "${t}/api/auth/tv/activate" \\
  -H "Authorization: Bearer mrt_your_token" \\
  -H "Content-Type: application/json" \\
  -d '{"code": "482915"}'`,swift:`var request = URLRequest(url: URL(string: "${t}/api/auth/tv/activate")!)
request.httpMethod = "POST"
request.setValue("Bearer \\(authToken)", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONEncoder().encode(["code": tvCode])`,kotlin:`val body = JSONObject().apply { put("code", tvCode) }
val request = Request.Builder()
    .url("${t}/api/auth/tv/activate")
    .header("Authorization", "Bearer $authToken")
    .post(body.toString().toRequestBody("application/json".toMediaType()))
    .build()`}},{id:"cast-create",method:"POST",path:"/api/cast/session/create",title:"Cast: Create Session",description:"Create a Chromecast-style cast session to control playback on a remote device (TV, speaker). The mobile device becomes the controller.",bodyParams:[{name:"deviceType",type:"string",required:!0,description:"'mobile' for the controller device"},{name:"stationId",type:"string",description:"Optional: station to start playing immediately"}],headers:[{name:"Authorization",type:"string",required:!0,description:"Bearer mrt_your_token"}],responseExample:`{
  "sessionId": "cast_xyz789",
  "pairingCode": "319847",
  "wsUrl": "wss://themegaradio.com/ws/cast?session=cast_xyz789&role=mobile"
}`,codeExamples:{curl:`curl -X POST "${t}/api/cast/session/create" \\
  -H "Authorization: Bearer mrt_your_token" \\
  -H "Content-Type: application/json" \\
  -d '{"deviceType": "mobile"}'`,javascript:`const response = await fetch('${t}/api/cast/session/create', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer mrt_your_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ deviceType: 'mobile' })
});
const { sessionId, wsUrl } = await response.json();

const ws = new WebSocket(wsUrl);
ws.onopen = () => console.log('Connected to cast session');`}},{id:"cast-command",method:"POST",path:"/api/cast/command",title:"Cast: Send Command",description:"Send playback commands to the paired TV/receiver device. Commands are relayed in real-time via WebSocket to the active cast session.",bodyParams:[{name:"sessionId",type:"string",required:!0,description:"Cast session ID from the create step"},{name:"command",type:"string",required:!0,description:"Command: play, pause, resume, stop, change_station, volume_up, volume_down, set_volume"},{name:"data",type:"object",description:"Additional data for the command (e.g., { stationId: '...' } for change_station, { volume: 75 } for set_volume)"}],headers:[{name:"Authorization",type:"string",required:!0,description:"Bearer mrt_your_token"}],responseExample:`{
  "success": true,
  "command": "play",
  "sessionId": "cast_xyz789"
}`,codeExamples:{curl:`curl -X POST "${t}/api/cast/command" \\
  -H "Authorization: Bearer mrt_your_token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "cast_xyz789",
    "command": "change_station",
    "data": { "stationId": "STATION_ID" }
  }'`,javascript:`await fetch('${t}/api/cast/command', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer mrt_your_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    sessionId: 'cast_xyz789',
    command: 'change_station',
    data: { stationId: 'STATION_ID' }
  })
});`}}],ce=[{id:"translations",method:"GET",path:"/api/translations/:lang",title:"App Translations",description:"Get localized translation strings for the app UI. Supports 57 languages. Returns a key-value map of translation keys to localized strings.",params:[{name:"lang",type:"string",required:!0,description:"Language code (e.g., 'en', 'tr', 'de', 'fr', 'es', 'ja', 'ko', 'zh')"}],responseExample:`{
  "popular_stations": "Popular Stations",
  "trending": "Trending",
  "genres": "Genres",
  "countries": "Countries",
  "search_placeholder": "Search stations...",
  "now_playing": "Now Playing",
  "favorites": "Favorites",
  "recently_played": "Recently Played",
  "settings": "Settings"
}`,codeExamples:{curl:`# English
curl -H "X-API-Key: YOUR_KEY" "${t}/api/translations/en"

# Turkish
curl -H "X-API-Key: YOUR_KEY" "${t}/api/translations/tr"

# German
curl -H "X-API-Key: YOUR_KEY" "${t}/api/translations/de"`,javascript:`const lang = 'tr';
const response = await fetch(\`${t}/api/translations/\${lang}\`, {
  headers: { 'X-API-Key': 'YOUR_KEY' }
});
const translations = await response.json();`,swift:`let lang = Locale.current.language.languageCode?.identifier ?? "en"
let url = URL(string: "${t}/api/translations/\\(lang)")!
var request = URLRequest(url: url)
request.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")
let (data, _) = try await URLSession.shared.data(for: request)`,kotlin:`val lang = Locale.getDefault().language
val request = Request.Builder()
    .url("${t}/api/translations/$lang")
    .header("X-API-Key", "YOUR_KEY")
    .build()`}}],p=[{id:"msg-conversations",method:"GET",path:"/api/messages/conversations",title:"List Conversations",description:"Get a list of all conversations for the authenticated user, sorted by most recent. Returns the last message, unread count, partner info, and online status for each conversation. Limited to 50 most recent conversations.",notes:["Requires authentication (Bearer token or session).","Conversations are grouped by partner - one entry per unique chat partner.","Unread count shows messages from that partner you haven't read yet."],responseExample:`{
  "conversations": [
    {
      "partnerId": "64a1b2c3d4e5f6a7b8c9d0e1",
      "partner": {
        "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
        "username": "johndoe",
        "fullName": "John Doe",
        "avatar": "https://..."
      },
      "lastMessage": "Hey, are you listening to Jazz FM?",
      "lastMessageAt": "2026-03-10T15:30:00.000Z",
      "unreadCount": 2,
      "online": true
    }
  ]
}`,codeExamples:{curl:`curl -H "Authorization: Bearer mrt_your_token" \\
  "${t}/api/messages/conversations"`,javascript:`const response = await fetch('${t}/api/messages/conversations', {
  headers: { 'Authorization': 'Bearer ' + token }
});
const { conversations } = await response.json();`,swift:`var request = URLRequest(url: URL(string: "${t}/api/messages/conversations")!)
request.setValue("Bearer \\(token)", forHTTPHeaderField: "Authorization")
let (data, _) = try await URLSession.shared.data(for: request)`,kotlin:`val request = Request.Builder()
    .url("${t}/api/messages/conversations")
    .header("Authorization", "Bearer $token")
    .build()`}},{id:"msg-conversation",method:"GET",path:"/api/messages/conversation/:partnerId",title:"Get Conversation Messages",description:"Get messages in a conversation with a specific user. Returns messages in chronological order. Automatically marks received messages as read. Supports pagination with cursor-based loading.",params:[{name:"partnerId",type:"string",required:!0,description:"The user ID of the conversation partner (URL path)"},{name:"limit",type:"number",default:"50",description:"Number of messages to return (max 100) - query param"},{name:"before",type:"string",description:"Message ID cursor - load messages before this ID (for pagination) - query param"}],notes:["Requires authentication (Bearer token or session).","Messages from the partner are automatically marked as read when you fetch them.","The partner is notified via WebSocket that their messages were read (chat:read event).","Related new_message notifications from this partner are also marked as read."],responseExample:`{
  "messages": [
    {
      "_id": "64b2c3d4e5f6a7b8c9d0e1f2",
      "fromUserId": "64a1b2c3d4e5f6a7b8c9d0e1",
      "toUserId": "64a9b8c7d6e5f4a3b2c1d0e9",
      "content": "Hey, are you listening to Jazz FM?",
      "messageType": "text",
      "read": true,
      "createdAt": "2026-03-10T15:30:00.000Z"
    },
    {
      "_id": "64b2c3d4e5f6a7b8c9d0e1f3",
      "fromUserId": "64a9b8c7d6e5f4a3b2c1d0e9",
      "toUserId": "64a1b2c3d4e5f6a7b8c9d0e1",
      "content": "Yes! Great station!",
      "messageType": "text",
      "read": false,
      "createdAt": "2026-03-10T15:31:00.000Z"
    }
  ],
  "partner": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "username": "johndoe",
    "fullName": "John Doe",
    "avatar": "https://...",
    "online": true
  },
  "hasMore": false
}`,codeExamples:{curl:`# Get latest messages
curl -H "Authorization: Bearer mrt_your_token" \\
  "${t}/api/messages/conversation/PARTNER_ID?limit=50"

# Load older messages (pagination)
curl -H "Authorization: Bearer mrt_your_token" \\
  "${t}/api/messages/conversation/PARTNER_ID?limit=50&before=LAST_MESSAGE_ID"`,javascript:`// Get latest messages
const response = await fetch(
  '${t}/api/messages/conversation/' + partnerId + '?limit=50',
  { headers: { 'Authorization': 'Bearer ' + token } }
);
const { messages, partner, hasMore } = await response.json();

// Load more (pagination)
if (hasMore) {
  const oldestId = messages[0]._id;
  const older = await fetch(
    '${t}/api/messages/conversation/' + partnerId + '?before=' + oldestId,
    { headers: { 'Authorization': 'Bearer ' + token } }
  );
}`}},{id:"msg-send",method:"POST",path:"/api/messages/send",title:"Send Message",description:"Send a direct message to another user. You can only message users you follow or who follow you (mutual follow not required, one-way is enough). Messages are delivered in real-time via WebSocket and stored in the database.",bodyParams:[{name:"toUserId",type:"string",required:!0,description:"Recipient's user ID"},{name:"content",type:"string",required:!0,description:"Message text (max 2000 characters)"},{name:"messageType",type:"string",default:"text",description:"Message type: 'text', 'image', or 'emoji'"},{name:"imageUrl",type:"string",description:"Image URL (only used when messageType is 'image'). Upload via /api/messages/upload-image first."}],notes:["Requires authentication (Bearer token or session).","You can only message users you follow or who follow you.","Cannot send messages to yourself.","Message is delivered in real-time via WebSocket (chat:message event).","A notification is created for the recipient if they're not currently viewing the conversation.","Max message length: 2000 characters."],responseExample:`{
  "success": true,
  "message": {
    "_id": "64b2c3d4e5f6a7b8c9d0e1f4",
    "fromUserId": "64a9b8c7d6e5f4a3b2c1d0e9",
    "toUserId": "64a1b2c3d4e5f6a7b8c9d0e1",
    "content": "Hey, check out this station!",
    "messageType": "text",
    "read": false,
    "createdAt": "2026-03-10T16:00:00.000Z"
  }
}`,codeExamples:{curl:`curl -X POST "${t}/api/messages/send" \\
  -H "Authorization: Bearer mrt_your_token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "toUserId": "64a1b2c3d4e5f6a7b8c9d0e1",
    "content": "Hey, check out this station!",
    "messageType": "text"
  }'`,javascript:`const response = await fetch('${t}/api/messages/send', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    toUserId: partnerId,
    content: 'Hey, check out this station!',
    messageType: 'text'
  })
});
const { success, message } = await response.json();`,swift:`let body: [String: Any] = [
    "toUserId": partnerId,
    "content": "Hey, check out this station!",
    "messageType": "text"
]

var request = URLRequest(url: URL(string: "${t}/api/messages/send")!)
request.httpMethod = "POST"
request.setValue("Bearer \\(token)", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONSerialization.data(withJSONObject: body)`,kotlin:`val body = JSONObject().apply {
    put("toUserId", partnerId)
    put("content", "Hey, check out this station!")
    put("messageType", "text")
}

val request = Request.Builder()
    .url("${t}/api/messages/send")
    .header("Authorization", "Bearer $token")
    .post(body.toString().toRequestBody("application/json".toMediaType()))
    .build()`}},{id:"msg-contacts",method:"GET",path:"/api/messages/contacts",title:"List Contacts",description:"Get a list of users you can chat with. Returns all users you follow and who follow you, with their online status and follow relationship details.",notes:["Requires authentication.","Returns users from both your following list and your followers list.","Each contact includes iFollow (you follow them) and followsMe (they follow you) flags."],responseExample:`{
  "contacts": [
    {
      "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "username": "johndoe",
      "fullName": "John Doe",
      "avatar": "https://...",
      "iFollow": true,
      "followsMe": true,
      "online": false
    }
  ]
}`,codeExamples:{curl:`curl -H "Authorization: Bearer mrt_your_token" \\
  "${t}/api/messages/contacts"`,javascript:`const response = await fetch('${t}/api/messages/contacts', {
  headers: { 'Authorization': 'Bearer ' + token }
});
const { contacts } = await response.json();`}},{id:"msg-unread",method:"GET",path:"/api/messages/unread-count",title:"Unread Message Count",description:"Get the total number of unread messages for the authenticated user across all conversations. Useful for showing a badge on the messages tab.",responseExample:`{
  "count": 5
}`,codeExamples:{curl:`curl -H "Authorization: Bearer mrt_your_token" \\
  "${t}/api/messages/unread-count"`,javascript:`const response = await fetch('${t}/api/messages/unread-count', {
  headers: { 'Authorization': 'Bearer ' + token }
});
const { count } = await response.json();
// Show badge: count > 0`}},{id:"msg-search-users",method:"GET",path:"/api/messages/search-users",title:"Search Users to Chat",description:"Search for users you can start a conversation with. Only searches among your contacts (people you follow or who follow you). Minimum 2 characters required for search query.",params:[{name:"q",type:"string",required:!0,description:"Search query (min 2 characters). Searches username and fullName."}],responseExample:`{
  "users": [
    {
      "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "username": "johndoe",
      "fullName": "John Doe",
      "avatar": "https://...",
      "online": true
    }
  ]
}`,codeExamples:{curl:`curl -H "Authorization: Bearer mrt_your_token" \\
  "${t}/api/messages/search-users?q=john"`,javascript:`const response = await fetch(
  '${t}/api/messages/search-users?q=' + encodeURIComponent(query),
  { headers: { 'Authorization': 'Bearer ' + token } }
);
const { users } = await response.json();`}},{id:"msg-online-status",method:"GET",path:"/api/messages/online-status",title:"Online Status",description:"Check the online/offline status of multiple users at once. Pass a comma-separated list of user IDs. Returns a map of userId to boolean online status.",params:[{name:"userIds",type:"string",required:!0,description:"Comma-separated list of user IDs to check"}],responseExample:`{
  "status": {
    "64a1b2c3d4e5f6a7b8c9d0e1": true,
    "64a9b8c7d6e5f4a3b2c1d0e9": false
  }
}`,codeExamples:{curl:`curl -H "Authorization: Bearer mrt_your_token" \\
  "${t}/api/messages/online-status?userIds=USER_ID_1,USER_ID_2"`,javascript:`const userIds = ['id1', 'id2'].join(',');
const response = await fetch(
  '${t}/api/messages/online-status?userIds=' + userIds,
  { headers: { 'Authorization': 'Bearer ' + token } }
);
const { status } = await response.json();
// status['id1'] === true means online`}},{id:"msg-upload-image",method:"POST",path:"/api/messages/upload-image",title:"Upload Chat Image",description:"Upload an image to send in a chat message. Returns the image URL to use when sending a message with messageType='image'. Max file size: 5MB. Only image files are accepted.",bodyParams:[{name:"image",type:"file",required:!0,description:"Image file (multipart/form-data). Max 5MB. Supported: jpg, png, gif, webp."}],notes:["Use multipart/form-data encoding (not JSON).","After uploading, use the returned imageUrl in POST /api/messages/send with messageType='image'.","Max file size: 5MB."],responseExample:`{
  "imageUrl": "/uploads/chat/1709654321-a1b2c3d4e5f6.jpg"
}`,codeExamples:{curl:`curl -X POST "${t}/api/messages/upload-image" \\
  -H "Authorization: Bearer mrt_your_token" \\
  -F "image=@/path/to/photo.jpg"`,javascript:`const formData = new FormData();
formData.append('image', {
  uri: imageUri,
  type: 'image/jpeg',
  name: 'photo.jpg',
});

const response = await fetch('${t}/api/messages/upload-image', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token },
  body: formData
});
const { imageUrl } = await response.json();

// Now send the image as a message
await fetch('${t}/api/messages/send', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    toUserId: partnerId,
    content: 'Photo',
    messageType: 'image',
    imageUrl: imageUrl
  })
});`}},{id:"msg-websocket",method:"GET",path:"/ws/chat?ticket=TICKET",title:"WebSocket Connection (Real-time)",description:"Connect to the real-time messaging WebSocket for live message delivery, typing indicators, read receipts, and online status updates. First obtain a one-time ticket via GET /api/messages/ws-ticket, then connect to the WebSocket with that ticket.",notes:["Step 1: GET /api/messages/ws-ticket to get a one-time ticket (expires in 60 seconds).","Step 2: Connect to wss://themegaradio.com/ws/chat?ticket=TICKET","On connect, you receive a chat:connected event with your userId and online users list.","Send chat:ping periodically to keep the connection alive (server responds with chat:pong).","Send chat:typing { toUserId } when user is typing.","Send chat:read { fromUserId } to mark messages as read.","Send chat:active { withUserId } when user opens/closes a conversation (suppresses duplicate notifications).","Receive chat:message for new messages, chat:typing for typing indicators, chat:read for read receipts.","Receive chat:online_status for contact online/offline changes.","Receive notification:new_message for message notifications (when not viewing that conversation)."],responseExample:`// Events you RECEIVE:

// On connection
{ "type": "chat:connected", "userId": "YOUR_ID", "onlineUsers": ["id1", "id2"] }

// New message
{
  "type": "chat:message",
  "message": {
    "_id": "msg_id",
    "fromUserId": "sender_id",
    "toUserId": "your_id",
    "content": "Hello!",
    "messageType": "text",
    "read": false,
    "createdAt": "2026-03-10T16:00:00Z"
  },
  "sender": { "username": "johndoe", "fullName": "John Doe", "avatar": "..." }
}

// Typing indicator
{ "type": "chat:typing", "fromUserId": "sender_id" }

// Read receipt
{ "type": "chat:read", "byUserId": "reader_id" }

// Online status change
{ "type": "chat:online_status", "userId": "user_id", "online": true }

// Events you SEND:
// { "type": "chat:typing", "toUserId": "partner_id" }
// { "type": "chat:read", "fromUserId": "partner_id" }
// { "type": "chat:active", "withUserId": "partner_id" }  // opened conversation
// { "type": "chat:active", "withUserId": null }           // closed conversation
// { "type": "chat:ping" }                                  // keepalive`,codeExamples:{curl:`# Step 1: Get ticket
TICKET=$(curl -s -H "Authorization: Bearer mrt_your_token" \\
  "${t}/api/messages/ws-ticket" | jq -r '.ticket')

# Step 2: Connect (use wscat or similar tool)
wscat -c "wss://themegaradio.com/ws/chat?ticket=$TICKET"`,javascript:`// Step 1: Get ticket
const ticketRes = await fetch('${t}/api/messages/ws-ticket', {
  headers: { 'Authorization': 'Bearer ' + token }
});
const { ticket } = await ticketRes.json();

// Step 2: Connect WebSocket
const ws = new WebSocket('wss://themegaradio.com/ws/chat?ticket=' + ticket);

ws.onopen = () => console.log('Connected!');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'chat:connected':
      console.log('Online users:', data.onlineUsers);
      break;
    case 'chat:message':
      console.log('New message:', data.message.content);
      // Show message in UI
      break;
    case 'chat:typing':
      // Show typing indicator for data.fromUserId
      break;
    case 'chat:read':
      // Mark messages as read for data.byUserId
      break;
    case 'chat:online_status':
      // Update online status for data.userId
      break;
  }
};

// Send typing indicator
ws.send(JSON.stringify({ type: 'chat:typing', toUserId: partnerId }));

// Mark messages as read
ws.send(JSON.stringify({ type: 'chat:read', fromUserId: partnerId }));

// Keepalive ping every 30s
setInterval(() => ws.send(JSON.stringify({ type: 'chat:ping' })), 30000);`,swift:`// Step 1: Get ticket
var ticketReq = URLRequest(url: URL(string: "${t}/api/messages/ws-ticket")!)
ticketReq.setValue("Bearer \\(token)", forHTTPHeaderField: "Authorization")
let (ticketData, _) = try await URLSession.shared.data(for: ticketReq)
let ticket = try JSONDecoder().decode(TicketResponse.self, from: ticketData).ticket

// Step 2: Connect WebSocket
let wsURL = URL(string: "wss://themegaradio.com/ws/chat?ticket=\\(ticket)")!
let wsTask = URLSession.shared.webSocketTask(with: wsURL)
wsTask.resume()

// Receive messages
func receiveMessage() {
    wsTask.receive { result in
        switch result {
        case .success(let message):
            if case .string(let text) = message {
                // Parse JSON and handle event types
            }
            receiveMessage() // Continue listening
        case .failure(let error):
            print("WS error: \\(error)")
        }
    }
}
receiveMessage()`,kotlin:`// Step 1: Get ticket
val ticketReq = Request.Builder()
    .url("${t}/api/messages/ws-ticket")
    .header("Authorization", "Bearer $token")
    .build()
val ticketRes = client.newCall(ticketReq).execute()
val ticket = JSONObject(ticketRes.body?.string() ?: "").getString("ticket")

// Step 2: Connect WebSocket
val wsReq = Request.Builder()
    .url("wss://themegaradio.com/ws/chat?ticket=$ticket")
    .build()

client.newWebSocket(wsReq, object : WebSocketListener() {
    override fun onMessage(ws: WebSocket, text: String) {
        val data = JSONObject(text)
        when (data.getString("type")) {
            "chat:message" -> { /* Handle new message */ }
            "chat:typing" -> { /* Show typing indicator */ }
            "chat:read" -> { /* Update read status */ }
            "chat:online_status" -> { /* Update online status */ }
        }
    }
})`}}],T=n.memo(({guideId:a})=>{const i={"guide-javascript":{title:"JavaScript / Web Integration",lang:"JavaScript",code:`const API_KEY = 'YOUR_API_KEY';
const BASE = 'https://themegaradio.com/api';

async function fetchAPI(path, params = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
  return res.json();
}

// Search for stations (country accepts: English, ISO-2, ISO-3, native names)
const results = await fetchAPI('/stations', {
  search: 'jazz',
  country: 'DE',  // or 'Germany', 'DEU', 'Deutschland', 'Almanya'
  limit: '10'
});
console.log(results.stations);
console.log(results.pagination);

// Get genres for a specific country
const genres = await fetchAPI('/genres/precomputed', { countryName: 'TR' });
console.log(genres.data);

// Get stations by genre
const rockStations = await fetchAPI('/genres/rock/stations', {
  country: 'TR',
  limit: '20'
});
console.log(rockStations.stations);

// App startup (single request for all init data)
const initData = await fetchAPI('/tv/init', { countryCode: 'TR' });
console.log(initData.popularStations);
console.log(initData.trendingStations);
console.log(initData.genres);

// Resolve and play a stream
const station = results.stations[0];
const stream = await fetchAPI('/stream/resolve', {
  url: station.url
});
const audio = new Audio(stream.candidates[0]);
audio.play();

// Get now playing info (accepts slug or ID)
const np = await fetchAPI('/now-playing/' + station.slug);
console.log(\`Now: \${np.artist} - \${np.title}\`);`},"guide-react-native":{title:"React Native Integration",lang:"React Native",code:`import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import TrackPlayer from 'react-native-track-player';

const API_KEY = 'YOUR_API_KEY';
const BASE = 'https://themegaradio.com/api';

const api = async (path, params = {}) => {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'X-API-Key': API_KEY }
  });
  return res.json();
};

function RadioApp() {
  const [initData, setInitData] = useState(null);

  useEffect(() => {
    // Single init request for app startup
    api('/tv/init', { countryCode: 'TR', limit: '20' })
      .then(setInitData);
  }, []);

  const playStation = async (station) => {
    const stream = await api('/stream/resolve', { url: station.url });
    const directUrl = stream.candidates?.[0] || station.url;

    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: station._id,
      url: directUrl,
      title: station.name,
      artist: station.country,
      artwork: station.favicon
    });
    await TrackPlayer.play();

    // Track the click
    await fetch(BASE + '/stations/' + station._id + '/click', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY }
    });
  };

  if (!initData) return <Text>Loading...</Text>;

  return (
    <FlatList
      data={initData.popularStations}
      renderItem={({ item }) => (
        <TouchableOpacity onPress={() => playStation(item)}>
          <Text>{item.name}</Text>
          <Text>{item.country}</Text>
        </TouchableOpacity>
      )}
    />
  );
}`},"guide-ios":{title:"iOS (Swift) Integration",lang:"Swift",code:`import Foundation
import AVFoundation

class MegaRadioClient {
    private let apiKey: String
    private let baseURL = "https://themegaradio.com/api"
    private var player: AVPlayer?

    init(apiKey: String) {
        self.apiKey = apiKey
        try? AVAudioSession.sharedInstance().setCategory(
            .playback, mode: .default
        )
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    // App init - single request for startup data
    func getInitData(countryCode: String = "TR") async throws -> TVInitData {
        let url = URL(string: "\\(baseURL)/tv/init?countryCode=\\(countryCode)")!
        var request = URLRequest(url: url)
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(TVInitData.self, from: data)
    }

    // Search stations (country: English, ISO-2, ISO-3, native all work)
    func searchStations(
        query: String,
        country: String? = nil,
        limit: Int = 20
    ) async throws -> StationsResponse {
        var components = URLComponents(string: "\\(baseURL)/stations")!
        components.queryItems = [
            URLQueryItem(name: "search", value: query),
            URLQueryItem(name: "limit", value: "\\(limit)")
        ]
        if let country { components.queryItems?.append(
            URLQueryItem(name: "country", value: country)
        )}

        var request = URLRequest(url: components.url!)
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(StationsResponse.self, from: data)
    }

    // Get stations by genre (with optional country filter)
    func getGenreStations(
        slug: String, country: String? = nil, limit: Int = 20
    ) async throws -> GenreStationsResponse {
        var comps = URLComponents(string: "\\(baseURL)/genres/\\(slug)/stations")!
        comps.queryItems = [URLQueryItem(name: "limit", value: "\\(limit)")]
        if let country { comps.queryItems?.append(
            URLQueryItem(name: "country", value: country)
        )}
        var request = URLRequest(url: comps.url!)
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(GenreStationsResponse.self, from: data)
    }

    func play(station: Station) async throws {
        // Resolve the stream URL
        let streamUrl = station.url.addingPercentEncoding(
            withAllowedCharacters: .urlQueryAllowed
        )!
        let url = URL(string: "\\(baseURL)/stream/resolve?url=\\(streamUrl)")!
        var request = URLRequest(url: url)
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        let (data, _) = try await URLSession.shared.data(for: request)
        let result = try JSONDecoder().decode(StreamResolve.self, from: data)
        let directUrl = result.candidates.first ?? station.url

        let playerItem = AVPlayerItem(url: URL(string: directUrl)!)
        player = AVPlayer(playerItem: playerItem)
        player?.play()
    }
}`},"guide-android":{title:"Android (Kotlin) Integration",lang:"Kotlin",code:`import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import android.media.MediaPlayer

class MegaRadioClient(private val apiKey: String) {
    private val client = OkHttpClient()
    private val baseUrl = "https://themegaradio.com/api"
    private var mediaPlayer: MediaPlayer? = null

    // App init - single request for startup data
    suspend fun getInitData(countryCode: String = "TR"): JSONObject {
        val request = Request.Builder()
            .url("$baseUrl/tv/init?countryCode=$countryCode&limit=30")
            .header("X-API-Key", apiKey)
            .build()
        val response = client.newCall(request).execute()
        return JSONObject(response.body?.string() ?: "")
    }

    // Search stations (country: English, ISO-2, ISO-3, native all work)
    suspend fun searchStations(
        query: String,
        country: String? = null,
        limit: Int = 20
    ): JSONObject {
        val url = buildString {
            append("$baseUrl/stations?search=$query&limit=$limit")
            country?.let { append("&country=$it") }
        }
        val request = Request.Builder()
            .url(url)
            .header("X-API-Key", apiKey)
            .build()
        val response = client.newCall(request).execute()
        return JSONObject(response.body?.string() ?: "")
    }

    // Get stations by genre (with optional country filter)
    suspend fun getGenreStations(
        slug: String,
        country: String? = null,
        limit: Int = 20
    ): JSONObject {
        val url = buildString {
            append("$baseUrl/genres/$slug/stations?limit=$limit")
            country?.let { append("&country=$it") }
        }
        val request = Request.Builder()
            .url(url)
            .header("X-API-Key", apiKey)
            .build()
        val response = client.newCall(request).execute()
        return JSONObject(response.body?.string() ?: "")
    }

    suspend fun playStation(station: JSONObject) {
        // Resolve stream URL
        val stationUrl = station.getString("url")
        val request = Request.Builder()
            .url("$baseUrl/stream/resolve?url=$stationUrl")
            .header("X-API-Key", apiKey)
            .build()
        val response = client.newCall(request).execute()
        val json = JSONObject(response.body?.string() ?: "")
        val candidates = json.getJSONArray("candidates")
        val streamUrl = if (candidates.length() > 0)
            candidates.getString(0) else stationUrl

        mediaPlayer?.release()
        mediaPlayer = MediaPlayer().apply {
            setDataSource(streamUrl)
            prepareAsync()
            setOnPreparedListener { start() }
        }
    }
}`}}[a];return i?e.jsxs("div",{children:[e.jsx("h1",{className:"text-4xl font-bold text-white mb-4",children:i.title}),e.jsxs("p",{className:"text-lg text-slate-400 leading-relaxed mb-8",children:["Complete example showing how to integrate Mega Radio API into your ",i.lang," application."]}),e.jsx(u,{code:i.code,lang:i.lang})]}):e.jsx("div",{className:"text-slate-400",children:"Guide not found."})});function s({title:a,description:r,endpoints:i}){return e.jsxs("div",{children:[e.jsx("h1",{className:"text-4xl font-bold text-white mb-4",children:a}),e.jsx("p",{className:"text-lg text-slate-400 leading-relaxed mb-10",children:r}),i.map(l=>e.jsx(re,{endpoint:l},l.id))]})}function pe({activeId:a,onNavigate:r,searchQuery:i,onSearchChange:l,mobileOpen:m,onMobileClose:f}){const c=n.useMemo(()=>{if(!i)return R;const d=i.toLowerCase();return R.map(o=>({...o,items:o.items.filter(k=>k.label.toLowerCase().includes(d)||o.label.toLowerCase().includes(d))})).filter(o=>o.items.length>0)},[i]),w=e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"p-4 border-b border-white/5",children:[e.jsxs("a",{href:"/en",className:"flex items-center gap-2 mb-4",children:[e.jsx("div",{className:"w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center",children:e.jsx(I,{className:"w-4 h-4 text-white"})}),e.jsxs("div",{children:[e.jsx("div",{className:"text-white font-bold text-sm leading-none",children:"Mega Radio"}),e.jsx("div",{className:"text-[10px] text-slate-500 uppercase tracking-widest mt-0.5",children:"API Reference"})]})]}),e.jsxs("div",{className:"relative",children:[e.jsx(X,{className:"absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500"}),e.jsx("input",{type:"text",value:i,onChange:d=>l(d.target.value),placeholder:"Search docs...",className:"w-full bg-white/5 border border-white/5 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50 transition-colors"})]})]}),e.jsx("nav",{className:"flex-1 overflow-y-auto p-3 space-y-1",children:c.map(d=>e.jsxs("div",{className:"mb-3",children:[e.jsxs("div",{className:"flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold",children:[e.jsx(d.icon,{className:"w-3.5 h-3.5"}),d.label]}),d.items.map(o=>e.jsx("button",{onClick:()=>{r(o.id),f()},className:`w-full text-left px-3 py-1.5 rounded-md text-[13px] transition-colors ${a===o.id?"bg-blue-500/10 text-blue-400 font-medium":"text-slate-400 hover:text-white hover:bg-white/5"}`,children:o.label},o.id))]},d.id))}),e.jsx("div",{className:"p-4 border-t border-white/5",children:e.jsxs("a",{href:"/api-user",className:"flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 text-blue-400 text-sm font-medium hover:bg-blue-500/20 transition-colors",children:[e.jsx(K,{className:"w-4 h-4"}),"Developer Portal",e.jsx(J,{className:"w-3.5 h-3.5 ml-auto"})]})})]});return e.jsxs(e.Fragment,{children:[e.jsx("aside",{className:"hidden lg:flex flex-col w-[260px] h-screen sticky top-0 bg-[#0a0a14] border-r border-white/5 shrink-0",children:w}),m&&e.jsxs("div",{className:"lg:hidden fixed inset-0 z-50",children:[e.jsx("div",{className:"absolute inset-0 bg-black/60",onClick:f}),e.jsxs("aside",{className:"absolute left-0 top-0 bottom-0 w-[280px] bg-[#0a0a14] flex flex-col shadow-2xl",children:[e.jsx("div",{className:"flex items-center justify-end p-2 border-b border-white/5",children:e.jsx("button",{onClick:f,className:"p-2 text-slate-400 hover:text-white",children:e.jsx(D,{className:"w-5 h-5"})})}),w]})]})]})}const j={introduction:()=>e.jsx(oe,{}),authentication:()=>e.jsx(ne,{}),"rate-limits":()=>e.jsx(le,{}),errors:()=>e.jsx(de,{}),"list-stations":()=>e.jsx(s,{title:"Stations",description:"Browse, search, and discover radio stations from our database of 40,000+ stations worldwide. The country parameter supports English names, native names, Turkish names, ISO-2 codes (DE), and ISO-3 codes (DEU).",endpoints:g}),"get-station":()=>e.jsx(s,{title:"Stations",description:"Browse, search, and discover radio stations.",endpoints:g}),"popular-stations":()=>e.jsx(s,{title:"Stations",description:"Browse, search, and discover radio stations.",endpoints:g}),"search-stations":()=>e.jsx(s,{title:"Stations",description:"Browse, search, and discover radio stations.",endpoints:g}),"nearby-stations":()=>e.jsx(s,{title:"Stations",description:"Browse, search, and discover radio stations.",endpoints:g}),"similar-stations":()=>e.jsx(s,{title:"Stations",description:"Browse, search, and discover radio stations.",endpoints:g}),"random-station":()=>e.jsx(s,{title:"Stations",description:"Browse, search, and discover radio stations.",endpoints:g}),"track-click":()=>e.jsx(s,{title:"Stations",description:"Browse, search, and discover radio stations.",endpoints:g}),"list-genres":()=>e.jsx(s,{title:"Discovery",description:"Explore genres, countries, languages, trending stations, community favorites, and diverse recommendations. All country parameters support multiple formats.",endpoints:y}),"genre-stations":()=>e.jsx(s,{title:"Discovery",description:"Explore genres, countries, languages, and discover new content.",endpoints:y}),"discoverable-genres":()=>e.jsx(s,{title:"Discovery",description:"Explore genres, countries, languages, and discover new content.",endpoints:y}),"list-countries":()=>e.jsx(s,{title:"Discovery",description:"Explore genres, countries, languages, and discover new content.",endpoints:y}),"list-languages":()=>e.jsx(s,{title:"Discovery",description:"Explore genres, countries, languages, and discover new content.",endpoints:y}),trending:()=>e.jsx(s,{title:"Discovery",description:"Explore genres, countries, languages, and discover new content.",endpoints:y}),"community-favorites":()=>e.jsx(s,{title:"Discovery",description:"Explore genres, countries, languages, and discover new content.",endpoints:y}),"diverse-recommendations":()=>e.jsx(s,{title:"Discovery",description:"Explore genres, countries, languages, and discover new content.",endpoints:y}),"resolve-stream":()=>e.jsx(s,{title:"Streaming",description:"Resolve stream URLs and get real-time now-playing metadata for live radio playback.",endpoints:A}),"now-playing":()=>e.jsx(s,{title:"Streaming",description:"Resolve stream URLs and get real-time now-playing metadata.",endpoints:A}),signup:()=>e.jsx(s,{title:"User Authentication",description:"Create accounts, authenticate users via web sessions or mobile tokens. Supports separate web and mobile login flows.",endpoints:x}),"web-login":()=>e.jsx(s,{title:"User Authentication",description:"Authenticate users via web sessions or mobile tokens.",endpoints:x}),"mobile-login":()=>e.jsx(s,{title:"User Authentication",description:"Authenticate users via web sessions or mobile tokens.",endpoints:x}),"current-user":()=>e.jsx(s,{title:"User Authentication",description:"Authenticate users via web sessions or mobile tokens.",endpoints:x}),"list-favorites":()=>e.jsx(s,{title:"User Data",description:"Manage user favorites, recently played stations, ratings, and push notification tokens. All endpoints require authentication.",endpoints:b}),"add-favorite":()=>e.jsx(s,{title:"User Data",description:"Manage user favorites, recently played, and push tokens.",endpoints:b}),"remove-favorite":()=>e.jsx(s,{title:"User Data",description:"Manage user favorites, recently played, and push tokens.",endpoints:b}),"list-recently-played":()=>e.jsx(s,{title:"User Data",description:"Manage user favorites, recently played, and push tokens.",endpoints:b}),"add-recently-played":()=>e.jsx(s,{title:"User Data",description:"Manage user favorites, recently played, and push tokens.",endpoints:b}),"rate-station":()=>e.jsx(s,{title:"User Data",description:"Manage user favorites, recently played, and push tokens.",endpoints:b}),"register-push-token":()=>e.jsx(s,{title:"User Data",description:"Manage user favorites, recently played, and push tokens.",endpoints:b}),"unregister-push-token":()=>e.jsx(s,{title:"User Data",description:"Manage user favorites, recently played, and push tokens.",endpoints:b}),"tv-init":()=>e.jsx(s,{title:"TV & Cast",description:"TV/Mobile app initialization, device pairing, and cast session control. The TV init endpoint provides all startup data in a single request.",endpoints:v}),"tv-request-code":()=>e.jsx(s,{title:"TV & Cast",description:"TV device pairing and cast control.",endpoints:v}),"tv-poll-status":()=>e.jsx(s,{title:"TV & Cast",description:"TV device pairing and cast control.",endpoints:v}),"tv-activate":()=>e.jsx(s,{title:"TV & Cast",description:"TV device pairing and cast control.",endpoints:v}),"cast-create":()=>e.jsx(s,{title:"TV & Cast",description:"TV device pairing and cast control.",endpoints:v}),"cast-command":()=>e.jsx(s,{title:"TV & Cast",description:"TV device pairing and cast control.",endpoints:v}),"google-login":()=>e.jsx(s,{title:"User Authentication",description:"Authenticate users via web sessions, mobile tokens, or social login (Google, Apple).",endpoints:x}),"apple-login":()=>e.jsx(s,{title:"User Authentication",description:"Authenticate users via web sessions, mobile tokens, or social login (Google, Apple).",endpoints:x}),"msg-conversations":()=>e.jsx(s,{title:"Messaging",description:"Real-time direct messaging between users. Send messages, share images, get typing indicators and read receipts via WebSocket. Users can message anyone they follow or who follows them.",endpoints:p}),"msg-conversation":()=>e.jsx(s,{title:"Messaging",description:"Real-time direct messaging between users.",endpoints:p}),"msg-send":()=>e.jsx(s,{title:"Messaging",description:"Real-time direct messaging between users.",endpoints:p}),"msg-contacts":()=>e.jsx(s,{title:"Messaging",description:"Real-time direct messaging between users.",endpoints:p}),"msg-unread":()=>e.jsx(s,{title:"Messaging",description:"Real-time direct messaging between users.",endpoints:p}),"msg-search-users":()=>e.jsx(s,{title:"Messaging",description:"Real-time direct messaging between users.",endpoints:p}),"msg-online-status":()=>e.jsx(s,{title:"Messaging",description:"Real-time direct messaging between users.",endpoints:p}),"msg-upload-image":()=>e.jsx(s,{title:"Messaging",description:"Real-time direct messaging between users.",endpoints:p}),"msg-websocket":()=>e.jsx(s,{title:"Messaging",description:"Real-time direct messaging between users. Connect via WebSocket for live updates.",endpoints:p}),translations:()=>e.jsx(s,{title:"Misc",description:"Utility endpoints for app localization and other features.",endpoints:ce}),"guide-javascript":()=>e.jsx(T,{guideId:"guide-javascript"}),"guide-react-native":()=>e.jsx(T,{guideId:"guide-react-native"}),"guide-ios":()=>e.jsx(T,{guideId:"guide-ios"}),"guide-android":()=>e.jsx(T,{guideId:"guide-android"})};function Ie(){const[,a]=q("/api-docs/:category"),[,r]=C(),[i,l]=n.useState(""),[m,f]=n.useState(!1),c=a?.category||"introduction",w=n.useCallback(h=>{r(`/api-docs/${h}`),window.scrollTo(0,0)},[r]);n.useEffect(()=>{if(j[c]){const h=document.getElementById(c);h&&h.scrollIntoView({behavior:"smooth",block:"start"})}},[c]);const d=j[c]||j.introduction,o=R.find(h=>h.items.some(_=>_.id===c)),k=o?.items.find(h=>h.id===c);return e.jsxs("div",{className:"flex min-h-screen bg-[#0d0d1a] text-white",children:[e.jsx(pe,{activeId:c,onNavigate:w,searchQuery:i,onSearchChange:l,mobileOpen:m,onMobileClose:()=>f(!1)}),e.jsxs("main",{className:"flex-1 min-w-0",children:[e.jsx("header",{className:"sticky top-0 z-10 bg-[#0d0d1a]/80 backdrop-blur-xl border-b border-white/5",children:e.jsxs("div",{className:"flex items-center gap-3 px-6 py-3",children:[e.jsx("button",{onClick:()=>f(!0),className:"lg:hidden p-1.5 text-slate-400 hover:text-white",children:e.jsx(G,{className:"w-5 h-5"})}),o&&k&&e.jsxs("div",{className:"flex items-center gap-2 text-sm",children:[e.jsx("span",{className:"text-slate-500",children:o.label}),e.jsx(M,{className:"w-3.5 h-3.5 text-slate-600"}),e.jsx("span",{className:"text-white font-medium",children:k.label})]}),e.jsxs("div",{className:"ml-auto flex items-center gap-3",children:[e.jsx("a",{href:"/api-user",className:"text-xs text-slate-400 hover:text-white transition-colors",children:"Dashboard"}),e.jsx("a",{href:"/en",className:"text-xs text-slate-400 hover:text-white transition-colors",children:"Back to Radio"})]})]})}),e.jsx("div",{className:"max-w-4xl mx-auto px-6 py-10",children:e.jsx(d,{})}),e.jsx("footer",{className:"border-t border-white/5 mt-20",children:e.jsx("div",{className:"max-w-4xl mx-auto px-6 py-8 text-center",children:e.jsxs("p",{className:"text-sm text-slate-500",children:["Mega Radio API v1.0 -- Need help? Contact ",e.jsx("a",{href:"mailto:api@themegaradio.com",className:"text-blue-400 hover:text-blue-300",children:"api@themegaradio.com"})]})})})]})]})}export{Ie as default};

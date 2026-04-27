import { useState, useEffect } from "react";
import { api } from "../../lib/api";

const SCOPE_OPTIONS = [
  { value: "feed.read",   label: "feed.read",   description: "Query intelligence snapshots and summary data" },
  { value: "feed.export", label: "feed.export",  description: "Download full snapshot exports" },
];

const FREQUENCY_OPTIONS = [
  { value: "daily",   label: "Daily",   description: "Every day at 03:00 AEST" },
  { value: "weekly",  label: "Weekly",  description: "Every Monday at 03:00 AEST" },
  { value: "monthly", label: "Monthly", description: "1st of each month at 03:00 AEST" },
];

export default function Settings({ orgRole }) {
  const [tab, setTab] = useState("users");
  const isAdmin = orgRole === "org_admin";
  const tabs = [
    { id: "users",    label: "Users" },
    { id: "branding", label: "Branding" },
    ...(isAdmin ? [{ id: "api", label: "API & Push" }] : []),
  ];
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Portal <em>Settings</em></div>
          <div className="page-subtitle">User management, branding, and API access</div>
        </div>
      </div>
      <div className="page-body">
        <div style={{ display:"flex", gap:4, borderBottom:"1px solid var(--border)", marginBottom:28 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background:"transparent", border:"none", cursor:"pointer",
              padding:"10px 18px", fontSize:13, fontFamily:"var(--font-sans)",
              color: tab===t.id ? "var(--electric)" : "var(--text-dim)",
              borderBottom:`2px solid ${tab===t.id ? "var(--electric)" : "transparent"}`,
              marginBottom:-1, transition:"all 0.15s", fontWeight: tab===t.id ? 500 : 400,
            }}>{t.label}</button>
          ))}
        </div>
        {tab==="users"    && <UsersTab orgRole={orgRole} />}
        {tab==="branding" && <BrandingTab isAdmin={isAdmin} />}
        {tab==="api"      && <ApiTab />}
      </div>
    </div>
  );
}

function UsersTab({ orgRole }) {
  const [users,setUsers]=useState([]);const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");const [showInvite,setShowInvite]=useState(false);
  const isAdmin=orgRole==="org_admin";
  useEffect(()=>{ api("/org/users").then(d=>setUsers(d.users??[])).catch(err=>setError(err.message)).finally(()=>setLoading(false)); },[]);
  async function deactivateUser(id){
    if(!confirm("Remove this user's access? They can be re-invited later."))return;
    try{ await api(`/org/users/${id}`,{method:"PUT",body:{is_active:false}}); setUsers(p=>p.map(u=>u.id===id?{...u,org_active:false}:u)); }
    catch(err){setError(err.message);}
  }
  async function changeRole(id,org_role){
    try{ await api(`/org/users/${id}`,{method:"PUT",body:{org_role}}); setUsers(p=>p.map(u=>u.id===id?{...u,org_role}:u)); }
    catch(err){setError(err.message);}
  }
  if(loading)return<div className="loading-spinner">Loading users…</div>;
  const active=users.filter(u=>u.org_active); const inactive=users.filter(u=>!u.org_active);
  const rc={org_admin:"#3b82f6",org_analyst:"#10b981",org_reporter:"#f59e0b"};
  return(
    <div>
      {error&&<div className="alert alert-error" style={{marginBottom:16}}>{error}</div>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontSize:13,color:"var(--text-dim)"}}>{active.length} active user{active.length!==1?"s":""}{inactive.length>0?` · ${inactive.length} inactive`:""}</div>
        {isAdmin&&<button className="btn-action" onClick={()=>setShowInvite(true)}>+ Invite user</button>}
      </div>
      {showInvite&&<InviteForm onInvited={u=>{setUsers(p=>[...p,u]);setShowInvite(false);}} onCancel={()=>setShowInvite(false)}/>}
      <div style={{background:"var(--navy)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
        <table className="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th>Invited by</th>{isAdmin&&<th></th>}</tr></thead>
          <tbody>
            {active.map(u=>(
              <tr key={u.id}>
                <td style={{color:"var(--text)",fontWeight:500}}>{u.name}</td>
                <td style={{fontFamily:"var(--font-mono)",fontSize:12}}>{u.email}</td>
                <td>{isAdmin?(
                  <select value={u.org_role} onChange={e=>changeRole(u.id,e.target.value)} style={{background:"transparent",border:`1px solid ${rc[u.org_role]??"var(--border)"}`,borderRadius:6,color:rc[u.org_role]??"var(--text-dim)",fontFamily:"var(--font-mono)",fontSize:11,padding:"3px 8px",textTransform:"uppercase",letterSpacing:"0.05em",cursor:"pointer"}}>
                    <option value="org_admin">Admin</option><option value="org_analyst">Analyst</option><option value="org_reporter">Reporter</option>
                  </select>
                ):(
                  <span style={{fontSize:11,fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.05em",color:rc[u.org_role]??"var(--text-faint)",border:`1px solid ${rc[u.org_role]??"var(--border)"}`,borderRadius:6,padding:"2px 8px"}}>{u.org_role?.replace("org_","")}</span>
                )}</td>
                <td>{u.invite_accepted_at?<span className="status-pill active">Active</span>:<span className="status-pill running">Pending</span>}</td>
                <td style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-faint)"}}>{u.last_login?new Date(u.last_login).toLocaleDateString("en-AU",{day:"numeric",month:"short"}):"Never"}</td>
                <td style={{fontSize:12,color:"var(--text-faint)"}}>{u.invited_by_name??"—"}</td>
                {isAdmin&&<td><button className="btn-sm" onClick={()=>deactivateUser(u.id)} style={{width:"auto",padding:"4px 12px",color:"var(--error)",borderColor:"rgba(239,68,68,0.3)"}}>Remove</button></td>}
              </tr>
            ))}
            {!active.length&&<tr><td colSpan={isAdmin?7:6} style={{textAlign:"center",color:"var(--text-faint)",padding:"32px 0"}}>No active users.</td></tr>}
          </tbody>
        </table>
      </div>
      {inactive.length>0&&(
        <div style={{marginTop:24,opacity:0.6}}>
          <div style={{fontSize:12,color:"var(--text-faint)",fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10}}>Inactive</div>
          <div style={{background:"var(--navy)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
            <table className="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
              <tbody>{inactive.map(u=><tr key={u.id}><td>{u.name}</td><td style={{fontFamily:"var(--font-mono)",fontSize:12}}>{u.email}</td><td style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-faint)"}}>{u.org_role?.replace("org_","")}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function InviteForm({onInvited,onCancel}){
  const [name,setName]=useState("");const [email,setEmail]=useState("");const [role,setRole]=useState("org_analyst");
  const [loading,setLoading]=useState(false);const [error,setError]=useState("");const [inviteUrl,setInviteUrl]=useState("");
  async function handleSubmit(e){e.preventDefault();setError("");setLoading(true);
    try{const d=await api("/org/users/invite",{method:"POST",body:{name,email,org_role:role}});setInviteUrl(d.invite_url);onInvited({id:d.user_id,name,email,org_role:role,org_active:true,invite_accepted_at:null});}
    catch(err){setError(err.message);}finally{setLoading(false);}
  }
  if(inviteUrl)return(
    <div className="chart-card" style={{marginBottom:20,border:"1px solid rgba(16,185,129,0.3)"}}>
      <div className="alert alert-success" style={{marginBottom:12}}>Invite created for {email}. Share the link below — expires in 7 days.</div>
      <div style={{background:"var(--navy-deep)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 14px",fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-dim)",wordBreak:"break-all"}}>{window.location.origin}{inviteUrl}</div>
    </div>
  );
  return(
    <div className="chart-card" style={{marginBottom:20,border:"1px solid rgba(59,130,246,0.25)"}}>
      <div className="chart-title" style={{marginBottom:16}}>Invite New User</div>
      {error&&<div className="alert alert-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:12,alignItems:"end"}}>
          <div className="field" style={{marginBottom:0}}><label>Full Name</label><input type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="Jane Smith" required/></div>
          <div className="field" style={{marginBottom:0}}><label>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="jane@fund.com.au" required/></div>
          <div className="field" style={{marginBottom:0}}><label>Role</label>
            <select value={role} onChange={e=>setRole(e.target.value)} style={{width:"100%",background:"rgba(5,13,26,0.6)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text)",fontFamily:"var(--font-sans)",fontSize:15,padding:"12px 16px",outline:"none"}}>
              <option value="org_admin">Admin</option><option value="org_analyst">Analyst</option><option value="org_reporter">Reporter</option>
            </select>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button type="submit" className="btn-action" disabled={loading} style={{padding:"12px 18px"}}>{loading?"Inviting…":"Send invite"}</button>
            <button type="button" className="btn-sm" style={{width:"auto",padding:"12px 16px"}} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function BrandingTab({isAdmin}){
  const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");const [success,setSuccess]=useState("");
  const [displayName,setDisplayName]=useState("");const [shortName,setShortName]=useState("");const [primaryColor,setPrimaryColor]=useState("#1B3A6B");
  useEffect(()=>{
    api("/org/profile").then(d=>{setDisplayName(d.fund_org.display_name??"");setShortName(d.fund_org.short_name??"");setPrimaryColor(d.fund_org.primary_color??"#1B3A6B");})
      .catch(err=>setError(err.message)).finally(()=>setLoading(false));
  },[]);
  async function handleSave(e){e.preventDefault();setError("");setSuccess("");setSaving(true);
    try{await api("/org/branding",{method:"PUT",body:{display_name:displayName,short_name:shortName,primary_color:primaryColor}});setSuccess("Branding updated. Refresh the portal to see the sidebar colour change.");}
    catch(err){setError(err.message);}finally{setSaving(false);}
  }
  if(loading)return<div className="loading-spinner">Loading…</div>;
  return(
    <div style={{maxWidth:520}}>
      {error&&<div className="alert alert-error" style={{marginBottom:16}}>{error}</div>}
      {success&&<div className="alert alert-success" style={{marginBottom:16}}>{success}</div>}
      <div className="chart-card">
        <div className="chart-title" style={{marginBottom:4}}>Portal Branding</div>
        <div className="chart-subtitle">How your organisation appears in the Beacon portal and PDF reports</div>
        <form onSubmit={handleSave} style={{marginTop:16}}>
          <div className="field"><label>Display Name</label><input type="text" value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Australian Super" required disabled={!isAdmin}/></div>
          <div className="field"><label>Short Name <span style={{fontWeight:400,color:"var(--text-faint)",fontSize:11}}>(used in charts and PDF reports)</span></label><input type="text" value={shortName} onChange={e=>setShortName(e.target.value)} placeholder="AusSuper" disabled={!isAdmin}/></div>
          <div className="field">
            <label>Brand Colour <span style={{fontWeight:400,color:"var(--text-faint)",fontSize:11}}>(sidebar dot and accents)</span></label>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <input type="color" value={primaryColor} onChange={e=>setPrimaryColor(e.target.value)} disabled={!isAdmin} style={{width:48,height:42,border:"1px solid var(--border)",borderRadius:8,background:"var(--navy-deep)",cursor:isAdmin?"pointer":"not-allowed",padding:4}}/>
              <input type="text" value={primaryColor} onChange={e=>setPrimaryColor(e.target.value)} placeholder="#1B3A6B" disabled={!isAdmin} style={{flex:1,fontFamily:"var(--font-mono)"}}/>
              <div style={{width:32,height:32,borderRadius:"50%",background:primaryColor,border:"2px solid var(--border)",boxShadow:`0 0 10px ${primaryColor}80`,flexShrink:0}}/>
            </div>
          </div>
          {isAdmin&&<button type="submit" className="btn-primary" disabled={saving} style={{marginTop:8}}>{saving?"Saving…":"Save branding"}</button>}
        </form>
        {!isAdmin&&<div style={{marginTop:16,fontSize:12,color:"var(--text-faint)"}}>Contact your org admin to update branding settings.</div>}
      </div>
      <div style={{marginTop:16,fontSize:12,color:"var(--text-faint)",lineHeight:1.6}}>Custom domain, logo upload, and email branding available on request. Contact your account manager.</div>
    </div>
  );
}

function ApiTab(){
  const [profile,setProfile]=useState(null);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [section,setSection]=useState("keys");
  useEffect(()=>{api("/org/profile").then(d=>setProfile(d.fund_org)).catch(err=>setError(err.message)).finally(()=>setLoading(false));} ,[]);
  if(loading)return<div className="loading-spinner">Loading…</div>;
  if(error)return<div className="alert alert-error">{error}</div>;
  const subTabs=[{id:"keys",label:"API Keys"},{id:"push",label:"Push Export"},{id:"docs",label:"Integration Guide"}];
  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:24}}>
        {subTabs.map(t=>(
          <button key={t.id} onClick={()=>setSection(t.id)} style={{background:section===t.id?"rgba(59,130,246,0.1)":"transparent",border:`1px solid ${section===t.id?"rgba(59,130,246,0.3)":"var(--border)"}`,color:section===t.id?"var(--electric)":"var(--text-dim)",fontFamily:"var(--font-sans)",fontSize:13,padding:"7px 16px",borderRadius:8,cursor:"pointer",transition:"all 0.15s",fontWeight:section===t.id?500:400}}>{t.label}</button>
        ))}
      </div>
      {section==="keys"&&<ApiKeysSection apiEnabled={profile?.api_access_enabled}/>}
      {section==="push"&&<PushSection pushEnabled={profile?.push_export_enabled} profile={profile}/>}
      {section==="docs"&&<DocsSection/>}
    </div>
  );
}

function ApiKeysSection({apiEnabled}){
  const [keys,setKeys]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
  const [showCreate,setShowCreate]=useState(false);const [newKey,setNewKey]=useState(null);
  useEffect(()=>{
    if(!apiEnabled){setLoading(false);return;}
    api("/org/api-keys").then(d=>setKeys(d.api_keys??[])).catch(err=>setError(err.message)).finally(()=>setLoading(false));
  },[apiEnabled]);
  async function revokeKey(id,label){
    if(!confirm(`Revoke key "${label}"? Any integrations using this key will stop working immediately.`))return;
    try{await api(`/org/api-keys/${id}`,{method:"DELETE"});setKeys(p=>p.filter(k=>k.id!==id));}catch(err){setError(err.message);}
  }
  if(!apiEnabled)return(
    <div style={{maxWidth:520}}>
      <div className="chart-card" style={{border:"1px solid rgba(59,130,246,0.2)"}}>
        <div style={{fontSize:14,fontWeight:600,color:"var(--text)",marginBottom:8}}>API Access</div>
        <div style={{fontSize:13,color:"var(--text-dim)",lineHeight:1.6,marginBottom:12}}>API access enables your data team to query Beacon intelligence data directly from PowerBI, Tableau, or your data warehouse — without using the portal.</div>
        <div style={{fontSize:12,color:"var(--text-faint)"}}>Contact your account manager to enable API access for your organisation.</div>
      </div>
    </div>
  );
  if(loading)return<div className="loading-spinner">Loading API keys…</div>;
  const activeKeys=keys.filter(k=>k.is_active);
  return(
    <div>
      {error&&<div className="alert alert-error" style={{marginBottom:16}}>{error}</div>}
      {newKey&&(
        <div className="chart-card" style={{marginBottom:20,border:"1px solid rgba(245,158,11,0.4)"}}>
          <div style={{fontSize:13,fontWeight:600,color:"#fcd34d",marginBottom:8}}>⚠ Copy this key now — it will not be shown again</div>
          <div style={{background:"var(--navy-deep)",border:"1px solid var(--border)",borderRadius:8,padding:"12px 16px",fontFamily:"var(--font-mono)",fontSize:13,color:"var(--text)",wordBreak:"break-all"}}>{newKey}</div>
          <div style={{display:"flex",gap:8,marginTop:10}}>
            <button className="btn-sm" style={{width:"auto",padding:"6px 16px"}} onClick={()=>navigator.clipboard?.writeText(newKey)}>Copy</button>
            <button className="btn-sm" style={{width:"auto",padding:"6px 16px"}} onClick={()=>setNewKey(null)}>I've saved it</button>
          </div>
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontSize:13,color:"var(--text-dim)"}}>{activeKeys.length} active key{activeKeys.length!==1?"s":""}</div>
        <button className="btn-action" onClick={()=>setShowCreate(true)}>+ Generate key</button>
      </div>
      {showCreate&&<CreateKeyForm onCreated={(key,kd)=>{setKeys(p=>[kd,...p]);setNewKey(key);setShowCreate(false);}} onCancel={()=>setShowCreate(false)}/>}
      <div style={{background:"var(--navy)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
        <table className="data-table">
          <thead><tr><th>Label</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Expires</th><th></th></tr></thead>
          <tbody>
            {activeKeys.map(k=>(
              <tr key={k.id}>
                <td style={{color:"var(--text)",fontWeight:500}}>{k.label}</td>
                <td style={{fontFamily:"var(--font-mono)",fontSize:12}}>{k.key_prefix}…</td>
                <td>{(k.scopes||[]).map(s=><span key={s} style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--electric)",background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.2)",borderRadius:4,padding:"1px 6px",marginRight:4}}>{s}</span>)}</td>
                <td style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-faint)"}}>{k.last_used_at?new Date(k.last_used_at).toLocaleDateString("en-AU",{day:"numeric",month:"short"}):"Never"}</td>
                <td style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-faint)"}}>{k.expires_at?new Date(k.expires_at).toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"2-digit"}):"Never"}</td>
                <td><button className="btn-sm" onClick={()=>revokeKey(k.id,k.label)} style={{width:"auto",padding:"4px 12px",color:"var(--error)",borderColor:"rgba(239,68,68,0.3)"}}>Revoke</button></td>
              </tr>
            ))}
            {!activeKeys.length&&<tr><td colSpan={6} style={{textAlign:"center",color:"var(--text-faint)",padding:"32px 0"}}>No active API keys. Generate one to connect your data tools.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateKeyForm({onCreated,onCancel}){
  const [label,setLabel]=useState("");const [scopes,setScopes]=useState(["feed.read"]);
  const [expiresAt,setExpiresAt]=useState("");const [loading,setLoading]=useState(false);const [error,setError]=useState("");
  function toggleScope(s){setScopes(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s]);}
  async function handleSubmit(e){e.preventDefault();if(!scopes.length){setError("Select at least one scope.");return;}
    setError("");setLoading(true);
    try{const body={label,scopes};if(expiresAt)body.expires_at=new Date(expiresAt).toISOString();const d=await api("/org/api-keys",{method:"POST",body});onCreated(d.key,d.api_key);}
    catch(err){setError(err.message);}finally{setLoading(false);}
  }
  return(
    <div className="chart-card" style={{marginBottom:20,border:"1px solid rgba(59,130,246,0.25)"}}>
      <div className="chart-title" style={{marginBottom:16}}>Generate New API Key</div>
      {error&&<div className="alert alert-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="field"><label>Label <span style={{fontWeight:400,color:"var(--text-faint)",fontSize:11}}>(describe where this key will be used)</span></label><input type="text" value={label} onChange={e=>setLabel(e.target.value)} placeholder="PowerBI dashboard" required/></div>
        <div className="field"><label>Scopes</label>
          {SCOPE_OPTIONS.map(opt=>(
            <div key={opt.value} onClick={()=>toggleScope(opt.value)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",marginBottom:8,borderRadius:8,cursor:"pointer",background:scopes.includes(opt.value)?"rgba(59,130,246,0.08)":"var(--navy-deep)",border:`1px solid ${scopes.includes(opt.value)?"rgba(59,130,246,0.3)":"var(--border)"}`}}>
              <div style={{width:16,height:16,borderRadius:3,flexShrink:0,background:scopes.includes(opt.value)?"var(--electric)":"transparent",border:`2px solid ${scopes.includes(opt.value)?"var(--electric)":"var(--border)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"white",fontWeight:700}}>{scopes.includes(opt.value)?"✓":""}</div>
              <div><div style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--electric)"}}>{opt.label}</div><div style={{fontSize:12,color:"var(--text-faint)",marginTop:1}}>{opt.description}</div></div>
            </div>
          ))}
        </div>
        <div className="field"><label>Expiry date <span style={{fontWeight:400,color:"var(--text-faint)",fontSize:11}}>(optional)</span></label><input type="date" value={expiresAt} onChange={e=>setExpiresAt(e.target.value)} min={new Date().toISOString().split("T")[0]}/></div>
        <div style={{display:"flex",gap:8,marginTop:8}}>
          <button type="submit" className="btn-action" disabled={loading} style={{padding:"10px 20px"}}>{loading?"Generating…":"Generate key"}</button>
          <button type="button" className="btn-sm" onClick={onCancel} style={{width:"auto",padding:"10px 16px"}}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function PushSection({pushEnabled,profile}){
  const [endpointUrl,setEndpointUrl]=useState(profile?.push_endpoint_url??"");const [frequency,setFrequency]=useState(profile?.push_frequency??"monthly");
  const [saving,setSaving]=useState(false);const [testing,setTesting]=useState(false);
  const [error,setError]=useState("");const [success,setSuccess]=useState("");const [testResult,setTestResult]=useState(null);
  async function handleSave(e){e.preventDefault();setError("");setSuccess("");setSaving(true);
    try{await api("/org/push-config",{method:"PUT",body:{push_endpoint_url:endpointUrl,push_frequency:frequency}});setSuccess("Push configuration saved.");}
    catch(err){setError(err.message);}finally{setSaving(false);}
  }
  async function handleTest(){setError("");setTestResult(null);setTesting(true);
    try{const r=await api("/feed/push-test",{method:"POST"});setTestResult(r);}
    catch(err){setError(err.message);}finally{setTesting(false);}
  }
  if(!pushEnabled)return(
    <div style={{maxWidth:520}}>
      <div className="chart-card" style={{border:"1px solid rgba(59,130,246,0.2)"}}>
        <div style={{fontSize:14,fontWeight:600,color:"var(--text)",marginBottom:8}}>Push Export</div>
        <div style={{fontSize:13,color:"var(--text-dim)",lineHeight:1.6,marginBottom:12}}>Push export delivers intelligence snapshots automatically to your configured endpoint on a schedule — enabling automated ingestion into your data warehouse without polling the API.</div>
        <div style={{fontSize:12,color:"var(--text-faint)"}}>Contact your account manager to enable push export for your organisation.</div>
      </div>
    </div>
  );
  return(
    <div style={{maxWidth:560}}>
      {error&&<div className="alert alert-error" style={{marginBottom:16}}>{error}</div>}
      {success&&<div className="alert alert-success" style={{marginBottom:16}}>{success}</div>}
      {testResult&&(
        <div className={`alert ${testResult.success?"alert-success":"alert-error"}`} style={{marginBottom:16}}>
          <div style={{fontWeight:600,marginBottom:4}}>{testResult.success?"✓ Push delivered":"✗ Push failed"}</div>
          <div style={{fontSize:12}}>{testResult.message}</div>
          {testResult.statusCode&&<div style={{fontSize:11,fontFamily:"var(--font-mono)",marginTop:4,opacity:0.8}}>HTTP {testResult.statusCode} · Signed: {testResult.signedWith}</div>}
        </div>
      )}
      <div className="chart-card">
        <div className="chart-title" style={{marginBottom:4}}>Push Endpoint</div>
        <div className="chart-subtitle">Beacon will POST signed JSON payloads to this URL on the configured schedule</div>
        <form onSubmit={handleSave} style={{marginTop:16}}>
          <div className="field"><label>Endpoint URL</label><input type="url" value={endpointUrl} onChange={e=>setEndpointUrl(e.target.value)} placeholder="https://your-system.com/webhook/beacon"/></div>
          <div className="field"><label>Push frequency</label>
            <div style={{display:"flex",gap:10}}>
              {FREQUENCY_OPTIONS.map(opt=>(
                <div key={opt.value} onClick={()=>setFrequency(opt.value)} style={{flex:1,padding:"10px 14px",borderRadius:8,cursor:"pointer",background:frequency===opt.value?"rgba(59,130,246,0.08)":"var(--navy-deep)",border:`1px solid ${frequency===opt.value?"rgba(59,130,246,0.3)":"var(--border)"}`,transition:"all 0.15s"}}>
                  <div style={{fontSize:13,color:frequency===opt.value?"var(--electric)":"var(--text-dim)",fontWeight:frequency===opt.value?500:400}}>{opt.label}</div>
                  <div style={{fontSize:11,color:"var(--text-faint)",marginTop:2}}>{opt.description}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button type="submit" className="btn-action" disabled={saving} style={{padding:"10px 20px"}}>{saving?"Saving…":"Save configuration"}</button>
            {endpointUrl&&<button type="button" className="btn-sm" onClick={handleTest} disabled={testing} style={{width:"auto",padding:"10px 16px"}}>{testing?"Sending…":"Test push"}</button>}
          </div>
        </form>
        <div style={{marginTop:20,padding:"14px 16px",background:"var(--navy-deep)",borderRadius:8,border:"1px solid var(--border)"}}>
          <div style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-faint)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Payload signature</div>
          <div style={{fontSize:12,color:"var(--text-dim)",lineHeight:1.6}}>Each push is signed with HMAC-SHA256. Verify the <code style={{fontFamily:"var(--font-mono)",color:"var(--electric)",fontSize:11}}>X-Beacon-Signature</code> header on receipt to confirm authenticity.</div>
        </div>
      </div>
    </div>
  );
}

function DocsSection(){
  const baseUrl=window.location.origin;
  return(
    <div style={{maxWidth:640}}>
      <div className="chart-card" style={{marginBottom:16}}>
        <div className="chart-title" style={{marginBottom:12}}>Authentication</div>
        <div style={{fontSize:13,color:"var(--text-dim)",marginBottom:12}}>All API requests require an API key in the <code style={{fontFamily:"var(--font-mono)",color:"var(--electric)",fontSize:12}}>X-Beacon-Key</code> header.</div>
        <div style={{background:"var(--navy-deep)",border:"1px solid var(--border)",borderRadius:8,padding:"14px 16px",fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-dim)"}}>
          <span style={{color:"var(--text-faint)"}}>curl</span> {baseUrl}/api/feed/summary \<br/>
          &nbsp;&nbsp;-H <span style={{color:"#10b981"}}>"X-Beacon-Key: bkn_your_key_here"</span>
        </div>
      </div>
      {[
        {method:"GET",path:"/api/feed/meta",description:"Organisation metadata, available periods, and metric list.",params:[]},
        {method:"GET",path:"/api/feed/summary",description:"Latest period KPIs for all headline metrics, ALL cohort.",params:[{name:"period",desc:"Optional. Specific period label e.g. 2026-M04"}]},
        {method:"GET",path:"/api/feed/snapshots",description:"Queryable snapshot data. Supports filtering, pagination, and multi-period queries.",params:[
          {name:"period",desc:"Specific period (overrides period_from/period_to)"},
          {name:"period_from",desc:"Inclusive start of period range"},
          {name:"period_to",desc:"Inclusive end of period range"},
          {name:"cohort",desc:"Cohort ID: ALL, C1, C2, C3, C4, or C5"},
          {name:"metrics",desc:"Comma-separated metric names"},
          {name:"include_suppressed",desc:"true to include suppressed cells (default: false)"},
          {name:"limit",desc:"Max rows per page (default: 1000, max: 5000)"},
          {name:"offset",desc:"Pagination offset (default: 0)"},
        ]},
      ].map(ep=>(
        <div key={ep.path} className="chart-card" style={{marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--success)",background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:4,padding:"2px 8px"}}>{ep.method}</span>
            <span style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--text)"}}>{ep.path}</span>
          </div>
          <div style={{fontSize:13,color:"var(--text-dim)",marginBottom:ep.params.length?10:0}}>{ep.description}</div>
          {ep.params.length>0&&(
            <div style={{background:"var(--navy-deep)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
              {ep.params.map((p,i)=>(
                <div key={p.name} style={{display:"flex",gap:12,padding:"8px 14px",borderBottom:i<ep.params.length-1?"1px solid var(--border)":"none"}}>
                  <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--electric)",flexShrink:0,minWidth:160}}>{p.name}</span>
                  <span style={{fontSize:12,color:"var(--text-faint)"}}>{p.desc}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <div style={{fontSize:12,color:"var(--text-faint)",lineHeight:1.6,marginTop:8}}>All responses are JSON. Metric values are floats (0.0–1.0 for rates). Suppressed cells have <code style={{fontFamily:"var(--font-mono)",fontSize:11}}>metricValue: null</code> and <code style={{fontFamily:"var(--font-mono)",fontSize:11}}>suppressed: true</code>.</div>
    </div>
  );
}

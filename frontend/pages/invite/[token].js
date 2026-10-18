import {useEffect,useState} from "react";
import {useRouter} from "next/router";
import {useSession} from "next-auth/react";
import {api,getSession} from "../../lib/api";
import {showToast} from "../../lib/toast";
export default function InviteLanding(){
 const router=useRouter(),{status}=useSession(),{token}=router.query;
 const [info,setInfo]=useState(null),[error,setError]=useState(""),[joining,setJoining]=useState(false);
 useEffect(()=>{if(!router.isReady||!token)return;let alive=true;api.getInvite(token).then(v=>{if(alive)setInfo(v)}).catch(e=>{if(alive)setError(e.message||"This invitation is invalid or expired")});return()=>{alive=false}},[router.isReady,token]);
 async function join(){const user=getSession();if(!user){router.push("/login?next="+encodeURIComponent(router.asPath));return}setJoining(true);try{const g=await api.joinInvite(token,user.id);showToast("You joined the group successfully!");router.replace("/groups/"+g.id)}catch(e){setError(e.message||"Could not join group");showToast(e.message||"Could not join group","error")}finally{setJoining(false)}}
 return <div className="container"><div className="screen" style={{paddingTop:80}}><div className="card" style={{textAlign:"center",padding:28}}><div className="logo-hero">🔗</div><h1 style={{fontSize:22,marginBottom:12}}>Group invitation</h1>{error?<p className="error">{error}</p>:!info?<><div className="skeleton skeleton-card"/><p className="muted small">Checking invitation…</p></>:<><p className="muted">You’ve been invited to join</p><h2 style={{margin:"8px 0 20px"}}>{info.groupName}</h2><button className="btn-primary" onClick={join} disabled={joining}>{joining?"Joining…":"Join group"}</button></> }</div></div></div>
}
import { ShieldX } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";

export default function BlockedAccount() {
  const { profile, signOut } = useAuth();
  return (
    <main className="min-h-screen flex items-center justify-center p-5" style={{background:"#F1F3F7",fontFamily:"'Inter',sans-serif"}}>
      <section className="w-full max-w-sm rounded-3xl p-7 text-center" style={{background:"#fff",border:"1px solid rgba(16,24,40,.09)",boxShadow:"0 16px 40px rgba(16,24,40,.10)"}}>
        <div className="mx-auto mb-4 flex items-center justify-center rounded-full" style={{width:64,height:64,background:"rgba(181,67,58,.1)",color:"#B5433A"}}><ShieldX size={30}/></div>
        <h1 className="text-2xl font-bold mb-2" style={{fontFamily:"'Fredoka',sans-serif",color:"#1B2129"}}>Account blocked</h1>
        <p className="text-sm mb-2" style={{color:"rgba(27,33,41,.65)"}}>You cannot access ImBored while this account is blocked.</p>
        {profile?.blocked_reason && <p className="text-xs rounded-xl p-3 mb-5" style={{background:"rgba(181,67,58,.07)",color:"#8F352E"}}>{profile.blocked_reason}</p>}
        <button onClick={signOut} className="w-full rounded-full py-3 text-sm font-semibold" style={{background:"#1B2129",color:"#fff"}}>Sign out</button>
      </section>
    </main>
  );
}

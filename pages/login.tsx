import { signIn } from "next-auth/react";

export default function Login() {
  return (
    <main style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0b0b0c",color:"#fff",padding:"24px"}}>
      <div style={{textAlign:"center",maxWidth:360,width:"100%"}}>
        <h1 style={{marginBottom:16,fontWeight:800,letterSpacing:".02em"}}>Log in</h1>
        <p style={{opacity:.8,marginBottom:16}}>Meld je aan met je Huidpraktijkshop Google-account.</p>
        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          style={{padding:"10px 16px",borderRadius:10,border:"1px solid #2a2a2e",background:"#1b1b1f",color:"#e6e6eb",cursor:"pointer"}}
        >
          Sign in with Google
        </button>
      </div>
    </main>
  );
}

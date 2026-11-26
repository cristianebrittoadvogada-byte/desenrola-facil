(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.DESENROLA_AUTH_SESSION=api;
})(typeof globalThis!=="undefined"?globalThis:null,function(){
  function createAuthSession({getConfig,fetchImpl=(...args)=>globalThis.fetch(...args),onExpired=()=>{},safetyMarginMs=60_000}={}){
    let accessToken="";
    let refreshToken="";
    let expiresAt=0;
    let refreshPromise=null;
    function setSession(session={}){
      accessToken=String(session.access_token||"");
      refreshToken=String(session.refresh_token||"");
      const expiresIn=Number(session.expires_in);
      expiresAt=Number.isFinite(expiresIn)&&expiresIn>0?Date.now()+expiresIn*1000:0;
    }
    function clear(){accessToken="";refreshToken="";expiresAt=0}
    function getAccessToken(){return accessToken}
    async function refresh(){
      if(!refreshToken)throw new Error("Sua sessão expirou. Entre novamente no painel.");
      if(refreshPromise)return refreshPromise;
      refreshPromise=(async()=>{
        const config=getConfig();
        let response;
        try{
          response=await fetchImpl(config.url+"/auth/v1/token?grant_type=refresh_token",{
            method:"POST",
            headers:{"Content-Type":"application/json","apikey":config.key},
            body:JSON.stringify({refresh_token:refreshToken}),
          });
        }catch{
          throw new Error("Não foi possível renovar a sessão. Verifique a conexão e tente novamente.");
        }
        const data=await response.json().catch(()=>({}));
        if(!response.ok||!data.access_token||!data.refresh_token){
          if([400,401,403].includes(response.status)){clear();onExpired()}
          throw new Error(response.status===429
            ?"O Supabase limitou a renovação da sessão. Aguarde e tente novamente."
            :"Não foi possível renovar a sessão. Entre novamente no painel se ela tiver expirado.");
        }
        setSession(data);
        return data;
      })().finally(()=>{refreshPromise=null});
      return refreshPromise;
    }
    async function request(url,options={}){
      if(!accessToken)throw new Error("Entre novamente no painel para continuar.");
      const config=getConfig();
      if(refreshToken&&(!expiresAt||Date.now()>=expiresAt-safetyMarginMs))await refresh();
      const headers=new Headers(options.headers||{});
      headers.set("apikey",config.key);
      headers.set("Authorization","Bearer "+accessToken);
      return fetchImpl(url,{...options,headers});
    }
    return {setSession,clear,getAccessToken,refresh,request};
  }
  return {createAuthSession};
});


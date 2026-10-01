import crypto from "crypto";
import WebSocket from "ws";
export const runtime = "nodejs";

function authUrl(hostUrl:string,key:string,secret:string){
 const u=new URL(hostUrl),date=new Date().toUTCString();
 const origin=`host: ${u.host}\ndate: ${date}\nGET ${u.pathname} HTTP/1.1`;
 const signature=crypto.createHmac("sha256",secret).update(origin).digest("base64");
 const authorization=Buffer.from(`api_key="${key}",algorithm="hmac-sha256",headers="host date request-line",signature="${signature}"`).toString("base64");
 return `${hostUrl}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(u.host)}`;
}

export async function GET(){
 const appId=process.env.IFLYTEK_APP_ID,key=process.env.IFLYTEK_API_KEY,secret=process.env.IFLYTEK_API_SECRET;
 const endpoint="wss://tts-api-sg.xf-yun.com/v2/tts";
 const base={endpoint,env:{appId:Boolean(appId),apiKey:Boolean(key),apiSecret:Boolean(secret)}};
 if(!appId||!key||!secret)return Response.json({...base,ok:false,stage:"env",error:"iFlytek env is not configured"},{status:500});
 const started=Date.now();
 try{
  const ws=new WebSocket(authUrl(endpoint,key,secret),{handshakeTimeout:8000});
  const result=await new Promise<any>((resolve)=>{
   let settled=false;
   const finish=(x:any)=>{if(settled)return;settled=true;resolve(x)};
   const timer=setTimeout(()=>{try{ws.terminate()}catch{};finish({ok:false,stage:"timeout",elapsedMs:Date.now()-started,error:"WebSocket handshake timeout"})},10000);
   ws.on("open",()=>{clearTimeout(timer);finish({ok:true,stage:"handshake",elapsedMs:Date.now()-started})});
   ws.on("unexpected-response",async(_req,res)=>{
    clearTimeout(timer);let body="";try{body=(await new Promise<string>(r=>{let s="";res.setEncoding("utf8");res.on("data",c=>s+=c);res.on("end",()=>r(s));res.on("error",()=>r(s))}))}catch{}
    finish({ok:false,stage:"handshake",elapsedMs:Date.now()-started,httpStatus:res.statusCode,error:body.slice(0,500)||`HTTP ${res.statusCode}`});
   });
   ws.on("error",e=>{clearTimeout(timer);finish({ok:false,stage:"socket",elapsedMs:Date.now()-started,error:e.message,code:(e as NodeJS.ErrnoException).code||null})});
  });
  try{ws.close()}catch{}
  return Response.json({...base,...result},{status:result.ok?200:502});
 }catch(e){return Response.json({...base,ok:false,stage:"exception",elapsedMs:Date.now()-started,error:e instanceof Error?e.message:"unknown error"},{status:502})}
}
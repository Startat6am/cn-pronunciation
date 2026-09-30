import crypto from "crypto";
import WebSocket from "ws";

function authUrl(hostUrl:string,key:string,secret:string){
 const u=new URL(hostUrl),date=new Date().toUTCString();
 const origin=`host: ${u.host}\ndate: ${date}\nGET ${u.pathname} HTTP/1.1`;
 const signature=crypto.createHmac("sha256",secret).update(origin).digest("base64");
 const authorization=Buffer.from(`api_key="${key}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`).toString("base64");
 return `${hostUrl}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(u.host)}`;
}
export async function POST(req:Request){
 try{
  const {text}=await req.json();
  const appId=process.env.IFLYTEK_APP_ID,key=process.env.IFLYTEK_API_KEY,secret=process.env.IFLYTEK_API_SECRET;
  if(!appId||!key||!secret)return Response.json({error:"iFlytek env is not configured"},{status:500});
  if(typeof text!=="string"||!text.trim())return Response.json({error:"text is required"},{status:400});
  const ws=new WebSocket(authUrl("wss://tts-api.xfyun.cn/v2/tts",key,secret));
  const chunks:Buffer[]=[];
  const audio=await new Promise<Buffer>((resolve,reject)=>{
   const timer=setTimeout(()=>{ws.close();reject(new Error("TTS timeout"))},20000);
   ws.on("message",(raw)=>{
    try{const j=JSON.parse(raw.toString()); if(j.code){clearTimeout(timer);ws.close();reject(new Error(j.message||String(j.code)));return}
      if(j.data?.audio)chunks.push(Buffer.from(j.data.audio,"base64"));
      if(j.data?.status===2){clearTimeout(timer);ws.close();resolve(Buffer.concat(chunks));}
    }catch(e){clearTimeout(timer);ws.close();reject(e)}
   });
   ws.on("error",e=>{clearTimeout(timer);reject(e)});
   ws.on("open",()=>ws.send(JSON.stringify({common:{app_id:appId},business:{aue:"raw",auf:"audio/L16;rate=16000",vcn:"xiaoyan",tte:"UTF8",speed:50,volume:50,pitch:50,bgs:0},data:{status:2,text:Buffer.from(text).toString("base64")}})));
  });
  const wav=Buffer.alloc(44+audio.length);audio.copy(wav,44);
  wav.write("RIFF",0);wav.writeUInt32LE(36+audio.length,4);wav.write("WAVE",8);wav.write("fmt ",12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(audio.length,40);
  return new Response(wav,{headers:{"content-type":"audio/wav","cache-control":"no-store"}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:"TTS failed"},{status:502})}
}
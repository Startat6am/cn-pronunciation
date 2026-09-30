import crypto from "crypto";
import WebSocket from "ws";
function authUrl(hostUrl:string,key:string,secret:string){const u=new URL(hostUrl),date=new Date().toUTCString();const origin=`host: ${u.host}\ndate: ${date}\nGET ${u.pathname} HTTP/1.1`;const signature=crypto.createHmac("sha256",secret).update(origin).digest("base64");const authorization=Buffer.from(`api_key="${key}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`).toString("base64");return `${hostUrl}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(u.host)}`;}
function pcmFromWav(b:Buffer){if(b.toString("ascii",0,4)!=="RIFF"||b.toString("ascii",8,12)!=="WAVE")return b;let p=12;while(p+8<=b.length){const id=b.toString("ascii",p,p+4),n=b.readUInt32LE(p+4);if(id==="data")return b.subarray(p+8,p+8+n);p+=8+n;}throw new Error("Invalid WAV");}
export async function POST(req:Request){
 try{
  const form=await req.formData(),audio=form.get("audio"),text=String(form.get("text")||"");
  const appId=process.env.IFLYTEK_APP_ID,key=process.env.IFLYTEK_API_KEY,secret=process.env.IFLYTEK_API_SECRET;
  if(!appId||!key||!secret)return Response.json({error:"iFlytek env is not configured"},{status:500});
  if(!(audio instanceof File)||!text)return Response.json({error:"audio and text are required"},{status:400});
  const pcm=pcmFromWav(Buffer.from(await audio.arrayBuffer()));
  const ws=new WebSocket(authUrl("wss://ise-api.xfyun.cn/v2/open-ise",key,secret));
  const result=await new Promise<any>((resolve,reject)=>{
   const timer=setTimeout(()=>{ws.close();reject(new Error("ISE timeout"))},30000),parts:string[]=[];
   ws.on("message",raw=>{try{const j=JSON.parse(raw.toString());if(j.code){clearTimeout(timer);ws.close();reject(new Error(j.message||String(j.code)));return}if(j.data?.data)parts.push(Buffer.from(j.data.data,"base64").toString());if(j.data?.status===2){clearTimeout(timer);ws.close();resolve({raw:parts.join("")});}}catch(e){clearTimeout(timer);ws.close();reject(e)}});
   ws.on("error",e=>{clearTimeout(timer);reject(e)});
   ws.on("open",()=>{
    ws.send(JSON.stringify({common:{app_id:appId},business:{sub:"ise",ent:"cn_vip",category:text.length===1?"read_syllable":"read_word",cmd:"ssb",auf:"audio/L16;rate=16000",aue:"raw",plev:0,result_level:"complete",rst:"entirety",ise_unite:"1",extra_ability:"multi_dimension",text:Buffer.from(text).toString("base64")},data:{status:0,data:""}}));
    const size=1280;for(let i=0;i<pcm.length;i+=size)ws.send(JSON.stringify({data:{status:i+size>=pcm.length?2:1,data:pcm.subarray(i,i+size).toString("base64")}}));
   });
  });
  const raw=result.raw;const total=Number(raw.match(/(?:total_score|overall_score)[^0-9]*(\d+(?:\.\d+)?)/i)?.[1]||0);
  const phone=Number(raw.match(/phone_score[^0-9]*(\d+(?:\.\d+)?)/i)?.[1]||0);
  const tone=Number(raw.match(/tone_score[^0-9]*(\d+(?:\.\d+)?)/i)?.[1]||0);
  const syllables=[...raw.matchAll(/(?:char|content|word)[^]{0,180}?(?:score|total_score)[^0-9]*(\d+(?:\.\d+)?)/gi)].slice(0,20).map(m=>Number(m[1]));
  return Response.json({score:total,phoneScore:phone,toneScore:tone,syllables,raw:process.env.NODE_ENV==="development"?raw:undefined});
 }catch(e){return Response.json({error:e instanceof Error?e.message:"Assessment failed"},{status:502})}
}
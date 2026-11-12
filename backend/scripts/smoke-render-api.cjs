// Deployment verification. No tokens, cookies or passwords are printed.
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs'),{resolve}=require('node:path'),{createHash,randomBytes}=require('node:crypto')
const root=resolve(__dirname,'../..'),config=require('dotenv').parse(readFileSync(resolve(root,'backend/.env.render.production')))
const api=config.PUBLIC_API_URL.replace(/\/$/,''),origin=new URL(api).origin
if(new URL(api).protocol!=='https:')throw Error('HTTPS required')
const headers={'Content-Type':'application/json',Origin:origin,'X-Requested-With':'XMLHttpRequest'}
const call=async(path,body,extra={})=>fetch(api+path,{method:body===undefined?'GET':'POST',headers:{...headers,...extra},...body===undefined?{}:{body:JSON.stringify(body)},redirect:'error',signal:AbortSignal.timeout(20000)})
;(async()=>{
 const health=await call('/health');if(health.status!==200){console.log(JSON.stringify({ready:false,status:health.status}));process.exitCode=2;return}
 const status=await health.json();if(status.database!=='available')throw Error('Database unavailable')
 const verifier=randomBytes(64).toString('base64url'),state=randomBytes(32).toString('base64url')
 const login=await call('/auth/login',{email:config.ADMIN_EMAIL,password:config.ADMIN_PASSWORD,clientId:config.OAUTH_CLIENT_ID,codeChallenge:createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256',state,remember:false})
 if(login.status!==200)throw Error('Administrative login HTTP '+login.status)
 const authorization=await login.json();if(authorization.state!==state)throw Error('OAuth state mismatch')
 const exchange=await call('/auth/token',{grantType:'authorization_code',clientId:config.OAUTH_CLIENT_ID,authorizationCode:authorization.authorizationCode,codeVerifier:verifier})
 if(exchange.status!==200)throw Error('Token exchange HTTP '+exchange.status)
 const session=await exchange.json(),auth={Authorization:'Bearer '+session.accessToken,'X-Company-Id':config.SOURAD_CENTRAL_COMPANY_ID||'00000000-0000-4000-8000-000000000001'}
 const get=async(path)=>{const response=await call(path,undefined,auth);if(response.status!==200){const problem=await response.json();throw Error(path+' HTTP '+response.status+': '+String(problem.message).slice(0,200))}return response.json()}
 const me=await get('/auth/me'),units=await get('/hospital-units/admin'),physicians=await get('/physicians'),exams=await get('/exams')
 const unauthorized=await call('/hospital-units/admin')
 const cookie=exchange.headers.getSetCookie(),refresh=cookie.map(value=>value.split(';')[0]).join('; ')
 const report={ready:true,api,database:status.database,administrator:me.role==='ADMIN',unitCount:units.length,physicianCount:physicians.length,examCount:exams.total,authenticationRequired:unauthorized.status===401,secureCookie:cookie.some(value=>/;\s*Secure/i.test(value)&&/;\s*HttpOnly/i.test(value)),hsts:!!health.headers.get('strict-transport-security')}
 const logout=await call('/auth/logout',{}, {...auth,Cookie:refresh});report.logoutStatus=logout.status
 if(!report.administrator||!report.authenticationRequired||!report.secureCookie||!report.hsts)throw Error('Production verification failed')
 const target=resolve(root,'tmp/render-deploy');mkdirSync(target,{recursive:true});writeFileSync(resolve(target,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
})().catch(error=>{console.error(error.message);process.exitCode=1})

// Creates an ignored deployment file. Never prints secret values.
const {resolve}=require('node:path'),{readFileSync,writeFileSync,existsSync}=require('node:fs'),{randomBytes}=require('node:crypto')
const dotenv=require('dotenv'),root=resolve(__dirname,'../..'),base=dotenv.config({path:resolve(root,'backend/.env'),quiet:true}).parsed||{}
const target=resolve(root,'backend/.env.render.production'),previous=existsSync(target)?dotenv.parse(readFileSync(target)):{}
const api=new URL(process.argv[2]||'https://api-climbesoftrad.onrender.com')
if(api.protocol!=='https:')throw Error('HTTPS required')
const database=JSON.parse(readFileSync(resolve(root,'tmp/render-deploy/db.private.json'),'utf8'))
const config={}
for(const key of ['OAUTH_CLIENT_ID','JWT_ISSUER','JWT_AUDIENCE','ADMIN_EMAIL','CLOUDFLARE_R2_ENDPOINT','CLOUDFLARE_R2_BUCKET','CLOUDFLARE_R2_REGION','CLOUDFLARE_R2_ACCESS_KEY','CLOUDFLARE_R2_SECRET_KEY','OBJECT_STORAGE_FORCE_PATH_STYLE','CNPJA','DIRECTD_CFM_URL','DIRECTD_CFM_TOKEN','SOURAD_CENTRAL_COMPANY_ID','LEGACY_COMPANY_NAME'])if(base[key])config[key]=base[key]
Object.assign(config,{NODE_ENV:'production',NODE_VERSION:'24.11.1',DATABASE_URL:database.internalUrl,FRONTEND_ORIGIN:api.origin,PUBLIC_API_URL:api.origin+'/api/v1',ROUTER_PUBLIC_API_URL:api.origin+'/api/v1',SOURAD_WEB_URL:api.origin,
 COOKIE_SECURE:'true',COOKIE_SAME_SITE:'lax',TRUST_PROXY_HOPS:'1',PUBLIC_REGISTRATION_ENABLED:'false',SWAGGER_ENABLED:'false',GEMINI_RESEARCH_ENABLED:'false',
 JWT_PRIVATE_KEY_PATH:'/etc/secrets/jwt_private.pem',JWT_PUBLIC_KEY_PATH:'/etc/secrets/jwt_public.pem',
 ADMIN_PASSWORD:previous.ADMIN_PASSWORD||randomBytes(24).toString('base64url'),ROUTER_CREDENTIAL_SECRET:previous.ROUTER_CREDENTIAL_SECRET||randomBytes(32).toString('hex'),ROUTER_TLS_KEY_PATH:'',ROUTER_TLS_CERT_PATH:''})
for(const key of ['DATABASE_URL','OAUTH_CLIENT_ID','JWT_ISSUER','JWT_AUDIENCE','ADMIN_EMAIL','CLOUDFLARE_R2_ENDPOINT','CLOUDFLARE_R2_BUCKET','CLOUDFLARE_R2_ACCESS_KEY','CLOUDFLARE_R2_SECRET_KEY'])if(!config[key])throw Error('Required setting missing: '+key)
writeFileSync(target,Object.entries(config).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n',{mode:0o600})
console.log(JSON.stringify({prepared:true,file:target,variables:Object.keys(config).length,newDatabase:true,credentialsPrinted:false}))

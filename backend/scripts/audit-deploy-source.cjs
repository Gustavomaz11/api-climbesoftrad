// Verify the publishable Git file list without printing credential values.
const {execFileSync}=require('node:child_process')
const {readFileSync,statSync,existsSync}=require('node:fs')
const {resolve,extname}=require('node:path')
const root=resolve(__dirname,'../..')
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)
const environments=['backend/.env','backend/.env.render.production'].filter(file=>existsSync(resolve(root,file)))
  .map(file=>require('dotenv').parse(readFileSync(resolve(root,file))))
const secrets=environments.flatMap(environment=>Object.entries(environment).filter(([key,value])=>/PASSWORD|TOKEN|SECRET|API.*KEY|CNPJA/.test(key)&&value.length>=10).map(([,value])=>value))
const violations=[],largest=[],extensions={}
for(const file of new Set(files)){
  const absolute=resolve(root,file),entry=statSync(absolute)
  if(!entry.isFile())continue
  const size=entry.size
  const extension=extname(file).toLowerCase();extensions[extension]=(extensions[extension]||0)+1
  largest.push({file,bytes:size})
  if(/(^|\/)(\.env(?:\..*)?|secrets)(\/|$)/i.test(file)&&!file.endsWith('.example'))violations.push({file,reason:'credential path'})
  if(/\.(dcm|dicom|sqlite|db|dump|zip|pdf|msi|exe)$/i.test(file))violations.push({file,reason:'binary or generated data'})
  if(size<2*1024*1024){const content=readFileSync(absolute,'utf8');if(secrets.some(secret=>content.includes(secret)))violations.push({file,reason:'configured credential'})}
}
console.log(JSON.stringify({files:files.length,extensions,largest:largest.sort((a,b)=>b.bytes-a.bytes).slice(0,6),violations},null,2))
if(violations.length)process.exitCode=1

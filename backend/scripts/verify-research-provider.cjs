// This connectivity check creates its own geometric PNGs. It never reads exams.
require('dotenv').config({quiet:true})
require('reflect-metadata')
const sharp=require('sharp')
const {ConfigService}=require('@nestjs/config')
const {GeminiResearchClient}=require('../dist/modules/research-ai/gemini-research.client')
;(async()=>{
  const client=new GeminiResearchClient(new ConfigService({GEMINI_RESEARCH_ENABLED:true,GEMINI_API_KEY:process.env.GEMINI_API_KEY,GEMINI_RESEARCH_MODEL:process.env.GEMINI_RESEARCH_MODEL||'gemini-3.5-flash-lite'}))
  const images=[]
  for(let index=0;index<2;index++)images.push({id:`synthetic-image-${index+1}`,png:await sharp(Buffer.from(`<svg width="512" height="512"><rect width="512" height="512" fill="#111"/><ellipse cx="${220+index*60}" cy="250" rx="120" ry="150" fill="#aaa"/><circle cx="300" cy="210" r="25" fill="#eee"/></svg>`)).png().toBuffer()})
  const result=await client.analyze(images)
  console.log(JSON.stringify({source:'synthetic-geometric-pngs',model:client.model,imagesSent:images.length,imagesReviewed:result.imagesReviewed.length,imagesAssessed:result.imageAssessments.length,regions:result.findings.length,validated:true}))
})().catch(error=>{console.error(error instanceof Error?error.message:'RESEARCH_FAILED');process.exitCode=1})

// Minimal Node.js API starter. Demo site works without this server-side API.
// Production checklist: add PostgreSQL, authentication, validation, rate limiting,
// CSRF protection where applicable, audit logging, backups and HTTPS.
const express=require('express');const path=require('path');const app=express();const PORT=process.env.PORT||3000;
app.use(express.json({limit:'1mb'}));app.use(express.static(path.join(__dirname,'public')));
app.get('/api/health',(req,res)=>res.json({status:'ok',service:'Formal Electrical API'}));
app.post('/api/enquiries',(req,res)=>{const {name,email,message}=req.body||{};if(!name||!email||!message)return res.status(400).json({error:'Name, email and message are required'}); // TODO persist to database and notify authorised staff
res.status(201).json({message:'Enquiry received. Configure persistent storage and notifications before production.'});});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Formal E&M platform running at http://localhost:${PORT}`));
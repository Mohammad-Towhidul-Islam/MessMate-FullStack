import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../db.js';
import { auth } from '../middleware/auth.js';
const r=Router();
const loginSchema=z.object({email:z.string().email(),password:z.string().min(8)});
r.post('/login',async(req,res)=>{
 const parsed=loginSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({error:'Invalid input',details:parsed.error.flatten()});
 const user=await prisma.user.findUnique({where:{email:parsed.data.email},include:{mess:true,member:true}});
 if(!user || !user.active || !(await bcrypt.compare(parsed.data.password,user.passwordHash))) return res.status(401).json({error:'Email or password incorrect'});
 const token=jwt.sign({sub:user.id,messId:user.messId,role:user.role,name:user.name},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'8h'});
 res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role,mess:user.mess.name,memberId:user.member?.id}});
});
const registerSchema=z.object({name:z.string().min(2).max(80),email:z.string().email(),password:z.string().min(8),joinCode:z.string().min(4)});
r.post('/register',async(req,res)=>{
 const parsed=registerSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:'Invalid registration details',details:parsed.error.flatten()});
 const mess=await prisma.mess.findUnique({where:{joinCode:parsed.data.joinCode}});
 if(!mess)return res.status(400).json({error:'Invalid mess invite code'});
 if(await prisma.user.findUnique({where:{email:parsed.data.email}}))return res.status(409).json({error:'Email already registered'});
 const passwordHash=await bcrypt.hash(parsed.data.password,12);
 const user=await prisma.$transaction(async tx=>{
  const member=await tx.member.create({data:{messId:mess.id,name:parsed.data.name}});
  return tx.user.create({data:{messId:mess.id,name:parsed.data.name,email:parsed.data.email,passwordHash,role:'MEMBER',member:{connect:{id:member.id}}}});
 });
 const token=jwt.sign({sub:user.id,messId:user.messId,role:user.role,name:user.name},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'8h'});
 res.status(201).json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role,mess:mess.name}});
});
r.get('/me',auth,async(req,res)=>{const u=await prisma.user.findUnique({where:{id:req.user.sub},select:{id:true,name:true,email:true,role:true,mess:{select:{name:true}},member:{select:{id:true}}}});res.json({user:u});});
export default r;

import jwt from 'jsonwebtoken';
export function auth(req,res,next){
  const token = req.headers.authorization?.replace(/^Bearer\s+/i,'');
  if(!token) return res.status(401).json({error:'Authentication required'});
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({error:'Invalid or expired token'}); }
}
export const roles = (...allowed) => (req,res,next) =>
  allowed.includes(req.user?.role) ? next() : res.status(403).json({error:'Permission denied'});

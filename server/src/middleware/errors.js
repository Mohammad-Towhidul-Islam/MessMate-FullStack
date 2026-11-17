export function notFound(req,res){ res.status(404).json({error:'Route not found'}); }
export function errorHandler(err,req,res,next){
  console.error(err);
  if(err?.code === 'P2002') return res.status(409).json({error:'Duplicate record'});
  res.status(err.status || 500).json({error: err.expose ? err.message : 'Internal server error'});
}

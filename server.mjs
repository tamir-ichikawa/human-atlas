import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const port=Number(process.env.HUMAN_ATLAS_PORT||4318);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.gz':'application/gzip','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try{
    const raw=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=path.resolve(base,'.'+(raw==='/'?'/index.html':raw));
    if(!target.startsWith(base+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
    const info=await stat(target);if(!info.isFile())throw new Error('Not a file');
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    if(req.method==='HEAD'){res.end();return;}
    const stream=createReadStream(target);stream.on('error',()=>res.destroy());stream.pipe(res);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is already in use. Open http://127.0.0.1:${port} or set HUMAN_ATLAS_PORT.`:e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Human Atlas is ready: http://127.0.0.1:${port}\nLocal only. Press Ctrl+C to stop.`));

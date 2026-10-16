import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {join,normalize,extname} from 'node:path';
const root=new URL('.',import.meta.url).pathname;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/markdown; charset=utf-8'};
createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname.split('/').some(part=>part.startsWith('.') && part.length>1)){res.writeHead(403);res.end();return;}
    const file=join(root,normalize('/'+pathname));
    if(!file.startsWith(root)){res.writeHead(403);res.end();return;}
    const p=(await stat(file)).isDirectory()?join(file,'index.html'):file;
    const data=await readFile(p);
    res.writeHead(200,{'Content-Type':mime[extname(p)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(8000,'127.0.0.1',()=>console.log('LAST PROTOCOL lab: http://127.0.0.1:8000'));

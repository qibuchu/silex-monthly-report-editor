import fs from 'node:fs';
const authMode=process.env.REPORT_SERVICE_AUTH_MODE||'token';
const headers=authMode==='token'?{Authorization:'Bearer '+fs.readFileSync('/run/secrets/monthly_token','utf8').trim()}:{};
const response=await fetch('http://127.0.0.1:14320/api/health',{headers,signal:AbortSignal.timeout(4000)});
const value=await response.json();if(!response.ok||!value.editorAvailable||value.authMode!==authMode)process.exit(1);

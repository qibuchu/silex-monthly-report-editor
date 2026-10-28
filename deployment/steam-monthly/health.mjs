import fs from 'node:fs';
const token=fs.readFileSync('/run/secrets/monthly_token','utf8').trim();
const response=await fetch('http://127.0.0.1:14320/api/health',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(4000)});
const value=await response.json();if(!response.ok||!value.editorAvailable)process.exit(1);

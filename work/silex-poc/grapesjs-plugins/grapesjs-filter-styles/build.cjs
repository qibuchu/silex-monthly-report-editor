// The editor monorepo already supplies webpack. Building this source plugin
// must not require an unrelated global grapesjs-cli installation.
const webpack=require('webpack');
const path=require('node:path');
webpack({mode:'production',entry:path.join(__dirname,'src/index.js'),output:{path:path.join(__dirname,'dist'),filename:'index.js',library:{name:'grapesjsFilterStyles',type:'umd'},globalObject:'this'}},(error,stats)=>{
 if(error){console.error(error);process.exitCode=1;return;}
 console.log(stats.toString({colors:false,modules:false}));
 if(stats.hasErrors())process.exitCode=1;
});

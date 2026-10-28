// Build a standalone workbench importer from the same source as Silex.
const path=require('node:path');
const root=path.resolve(__dirname,'..'),editor=path.join(root,'work/silex-poc');
const webpack=require(path.join(editor,'node_modules/webpack'));
const base=require(path.join(editor,'webpack.config.js'));
webpack({mode:'production',context:editor,entry:path.join(editor,'editor/grapesjs/pptx-template-reader.ts'),module:base.module,resolve:base.resolve,
  output:{path:path.join(root,'pipeline/monthly-service/ui'),filename:'pptx-reader.js',publicPath:'/ui/'},
  plugins:[new webpack.optimize.LimitChunkCountPlugin({maxChunks:1})],performance:{hints:false}},(error,stats)=>{
  if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;return;}
  console.log(stats.toString({all:false,assets:true,timings:true}));
});

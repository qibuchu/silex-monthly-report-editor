// Private report editor: no SaaS dashboard, onboarding, FTP or external accounts.
const path=require('node:path');
const StaticPlugin=require('../../dist/server/server/plugins/StaticPlugin').default;
const DownloadConnector=require('../../dist/server/server/plugins/DownloadConnector').default;
const {FsStorage}=require('../../dist/server/server/connectors/FsStorage');
module.exports=async config=>{
 await config.addPlugin(StaticPlugin,{routes:[{route:'/',path:path.resolve(__dirname,'../../dist/client')}]});
 config.addStorageConnector(new FsStorage(config,{path:process.env.SILEX_FS_ROOT}));
 config.addHostingConnector(new DownloadConnector(config));
 return {};
};

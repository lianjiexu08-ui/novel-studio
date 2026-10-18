// Serve saved review evidence through the same repository as the reviewer.
// The caller owns the repository and must close this host before disconnecting.
export async function startSharedReviewHost({createApiServer,repository,modelSettingsPath,port, status,onResponse}) {
  const unavailable=()=>{throw new Error('The review session owns model execution');};
  const {app}=createApiServer({repository,provider:{generateChapter:unavailable},
    designProvider:{generateWorld:unavailable,generateBible:unavailable,reviewDesignContent:unavailable},
    planProvider:{generatePlan:unavailable,generateOutlines:unavailable},
    manageModelSettings:Boolean(modelSettingsPath),modelSettingsPath,writeProcessEnvironment:false,allowBatchRuns:false});
  app.addHook('onRequest',async(request,reply)=>{
    if(!['GET','HEAD','OPTIONS'].includes(request.method))return reply.code(409).send({error:{code:'REVIEW_SESSION_ACTIVE',
      message:'设计评审正在执行，可查看已保存的进度与原文；本段结束后再修改或启动其他生成任务。'}});
  });
  app.get('/design-review-session',async()=>({readOnly:true,...status()}));
  if(onResponse)app.addHook('onResponse',async(request,reply)=>{
    onResponse({method:request.method,url:request.url,statusCode:reply.statusCode,elapsedMs:reply.elapsedTime});
  });
  try{await app.listen({port,host:'127.0.0.1'});}catch(error){await app.close();throw error;}
  return {app,close:()=>app.close()};
}

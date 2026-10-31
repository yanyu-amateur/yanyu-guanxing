// 作者：dz
(function(root){
    'use strict';
    const STAGES=Object.freeze([{limit:100,depth:10},{limit:200,depth:15},{limit:300,depth:20}].map(Object.freeze));
    const MAX_ROUTES=3;
    const rank=(a,b)=>a.cost-b.cost||a.exchanges-b.exchanges||a.pad-b.pad;
    function routeKey(r){
        return [r.source?.key,r.pad,JSON.stringify(r.steps.map(a=>[a.type,a.keepIds,a.count,a.position,a.to,a.toZi]))].join('|');
    }
    function run(request,emit=()=>{},planner=root.AnchorRoutePlanner){
        const {raw,anchors,options={}}=request;
        const automatic=request.mode==='auto';
        const sources=automatic?planner.usableSources(raw,anchors,request.purples||[]):[request.source];
        const stages=automatic?STAGES:[{limit:request.pads.length,depth:options.depth}];
        const routes=[],reports=[],stats=[],fixedSources=new Set();
        let checked=0,expanded=0;
        function meta(){return {automatic,checked,expanded,sourceCount:sources.length,stages:stats.map(s=>({...s})),reportCount:checked};}
        function add(route){
            if(!route.verified)return false;
            const key=routeKey(route);
            if(routes.some(r=>routeKey(r)===key))return false;
            routes.push(route);routes.sort(rank);routes.splice(MAX_ROUTES);return true;
        }
        function packet(type,extra={}){emit({type,routes:routes.slice(),reports:reports.slice(-60),meta:meta(),...extra});}
        if(!sources.length){
            reports.push({error:'首个锚点及其之前没有可用于置换的起点。请调整锚点。'});
            packet('done');return {routes,reports,meta:meta()};
        }
        searchStages: for(let stage=0;stage<stages.length;stage++){
            const scope=stages[stage];
            const pads=automatic?Array.from({length:scope.limit},(_,n)=>n):request.pads;
            const stat={stage,limit:scope.limit,depth:scope.depth,total:sources.length*pads.length,checked:0,
                filtered:0,bounded:0,failed:0,fixedSkipped:0,expanded:0,found:0};
            stats.push(stat);packet('stage',{stage,depth:scope.depth,limit:scope.limit});
            for(const source of sources)for(const pad of pads){
                const job={stage,depth:scope.depth,limit:scope.limit,source,pad,index:stat.checked,total:stat.total};
                let result;
                if(automatic&&pad>0&&fixedSources.has(source.key)){
                    stat.fixedSkipped++;stat.checked++;checked++;
                    if(stat.checked%5===0)packet('partial',job);
                    continue;
                }
                emit({type:'progress',...job,expanded:0,meta:meta()});
                try{
                    result=planner.search(raw,anchors,source,pad,{...options,depth:scope.depth},p=>{
                        if(p.candidate){
                            if(add(p.candidate))packet('candidate',{...job,candidate:p.candidate});
                        }else emit({type:'progress',...job,expanded:p.expanded,meta:meta()});
                    });
                    result={...result,source,stage};
                    if(result.sequence?.fixedLuck)fixedSources.add(source.key);
                    if(result.filtered)stat.filtered++;
                    if(result.bounded)stat.bounded++;
                    expanded+=result.expanded||0;stat.expanded+=result.expanded||0;
                    if(result.routes.length)stat.found++;
                    result.routes.forEach(add);
                }catch(err){result={source,pad,stage,error:err.message};stat.failed++;}
                reports.push({...result,routes:undefined});if(reports.length>60)reports.shift();
                stat.checked++;checked++;
                if(stat.checked%5===0||result.routes?.length||stat.checked===stat.total)packet('partial',job);
                if(routes.length>=MAX_ROUTES)break searchStages;
            }
            packet('stageDone',{stage,depth:scope.depth,limit:scope.limit});
            if(automatic&&routes.length&&!options.exhaustive)break;
        }
        packet('done');return {routes,reports,meta:meta()};
    }
    root.AnchorRouteSearch=Object.freeze({STAGES,run,rank,routeKey});
})(typeof window!=='undefined'?window:globalThis);

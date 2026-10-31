// 作者：dz
'use strict';
importScripts('data.js','wash_source_engine.js','anchor_route_planner.js','anchor_route_search.js');
self.onmessage=function(event){
    try{AnchorRouteSearch.run(event.data,packet=>self.postMessage(packet));}
    catch(err){self.postMessage({type:'error',message:err.message});}
};

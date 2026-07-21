const THRESHOLD=5;
const COOLDOWN_MS=30000;

async function getBreakerState(redis,subscriberId){
    const key=`breaker:${subscriberId}`;
    const data=await redis.hgetall(key);
    if (Object.keys(data).length==0) return {state:'CLOSED',failureCount:0,openedAt:null};
    return {
        state:data.state || 'CLOSED',
        failureCount:Number(data.failureCount) || 0,
        openedAt:data.openedAt ? Number(data.openedAt) : null,
    };
}

async function recordSuccess(redis,subscriberId){
    const key=`breaker:${subscriberId}`;
    await redis.hset(key,'state','CLOSED','failureCount',0,'openedAt',Date.now());
}

async function recordFailure(redis,subscriberId){
    const key=`breaker:${subscriberId}`;
    const breaker=await getBreakerState(redis,subscriberId);
    if(breaker.state==='HALF_OPEN'){
        await redis.hset(key,'state','OPEN','openedAt',Date.now());
    }else{
        breaker.failureCount+=1;
        if (breaker.failureCount>=THRESHOLD){
            await redis.hset(key,'state','OPEN','failureCount',breaker.failureCount,'openedAt',Date.now());
        }else{
            await redis.hset(key,'state','CLOSED','failureCount',breaker.failureCount);
        }
    }
}

async function canAttempt(redis,subscriberId){
    const key=`breaker:${subscriberId}`;
    const breaker=await getBreakerState(redis,subscriberId);
    if(breaker.state=='HALF_OPEN' || breaker.state=='CLOSED') return true;
    else if(breaker.state=='OPEN'){
        if((Date.now()-breaker.openedAt)>=COOLDOWN_MS){
            await redis.hset(key,'state','HALF_OPEN');
            return true;
        }
        else{
            return false;
        }
    }
    return true;
}
module.exports={getBreakerState,recordSuccess,recordFailure,canAttempt};
const Redis=require('ioredis');
async function tryConsumeToken(redis,subscriberId,maxTokens=10,refillRatePerSec=5){
    const now=Date.now();
    let lastRefill=Number(await redis.get(`lastRefill:${subscriberId}`));
    if (!lastRefill){
        lastRefill=now;
    }
    let currentTokens=Number(await redis.get(`tokens:${subscriberId}`));
    if(!currentTokens){
        currentTokens=maxTokens;
    }
    const elapsedTime=(Date.now()-lastRefill)/1000;
    const tokensToAdd=elapsedTime*refillRatePerSec;
    let newTokenCount=Math.min(currentTokens+tokensToAdd,maxTokens);
    if (newTokenCount>=1){
        newTokenCount-=1;
        await redis.set(`tokens:${subscriberId}`,newTokenCount);
        await redis.set(`lastRefill:${subscriberId}`,now);
        return true;
    }else{
        await redis.set(`lastRefill:${subscriberId}`,now);
        return false;
    }
}
module.exports={tryConsumeToken};
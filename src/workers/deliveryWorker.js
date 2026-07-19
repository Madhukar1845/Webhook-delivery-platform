const axios=require('axios');
const {recordSuccess,recordFailure,canAttempt}=require('../utils/circuitBreaker');
const {tryConsumeToken}=require('../utils/rateLimiter');
const {calculateBackoff,scheduleRetry}=require('../utils/backoff');
const {signPayload}=require('../utils/hmac');
const DeliveryJob=require('../models/DeliveryJob.model');
const Subscription=require('../models/Subscription.model');
const Event=require('../models/Event.model');
const mongoose=require('mongoose');
const Redis=require('ioredis');
const { getIdempotencyKey } = require('../utils/idempotency');
require('dotenv').config();

const redis=new Redis(process.env.REDIS_URL);
async function attemptDelivery(deliveryJobId){
    const job=await DeliveryJob.findById(deliveryJobId);
    const subscription=await Subscription.findById(job.subscriptionId);
    const event=await Event.findById(job.eventId);
    const subscriberId=subscription._id.toString();
    const attempt=await canAttempt(redis,subscriberId);
    if (!attempt){
        console.log('Circuit Open, Skipping..');
        return;
    }
    const consumerToken=await tryConsumeToken(redis,subscriberId);
    if (!consumerToken){
        console.log('Rate Limited, Skipping...');
        return;
    }
    const payload=JSON.stringify({type:event.type,payload:event.payload});
    const sign=signPayload(payload,subscription.secret);
    const start=Date.now();
    try{
    const res=await axios.post(subscription.url,payload,{
        headers:{
        'Content-Type':'application/json',
        'X-Signature':sign,
        'X-Event-Id':getIdempotencyKey(job)
    },
        timeout:5000
    });
    const end=Date.now();
    const latencyMs=end-start;
    await recordSuccess(redis,subscriberId);
    job.status='delivered';
    job.latencyMs=latencyMs;
    job.responseCode=res.status;
    job.lastAttemptAt=new Date();
    await job.save();
    }catch(err){
        console.log('Delivery failed!',err.message);
        await recordFailure(redis,subscriberId);
        scheduleRetry(job);
        job.lastAttemptAt=new Date()
        await job.save();
    }
}

async function startup(){
    try{
        await mongoose.connect(process.env.MONGO_URI)
        console.log('MongoDB Connected');
    }catch(err){
        console.log(err);
    }
    try{
        await redis.xgroup('CREATE','deliveries:stream','delivery-group','$','MKSTREAM');
        console.log('Delivery group created')
    }catch(err){
        if(err.message.includes('BUSYGROUP')){
            console.log('Group already exists, Continuing...')
        }else{
            throw err;
        }
    }
}
async function mainLoop(){
    while(true){
        try{
            const result=await redis.xreadgroup('GROUP','delivery-group','worker-1','COUNT',10,'BLOCK',5000,'STREAMS','deliveries:stream','>');
            if(!result){
                continue;
            }
            const [streamData]=result;
            const [streamName,deliveryJobs]=streamData;
            for(let job of deliveryJobs){
                const [jobId,data]=job;
                const deliveryJobId=parseStreamFields(data).deliveryJobId;
                await attemptDelivery(deliveryJobId);
                await redis.xack('deliveries:stream','delivery-group',jobId);
            }
        }catch(err){
            console.log(err);
        }
    }
}

function parseStreamFields(data){
    const obj={};
    for(let i=0;i<data.length;i+=2){
        obj[data[i]]=data[i+1];
    }
    return obj;
}

async function recoveryLoop(){
    setInterval(async ()=>{
        try{
            const claim=await redis.xautoclaim('deliveries:stream','delivery-group','worker-1',60000,0);
            const [cursor,claimedEntries,deletedIds]=claim;
            for (let claimedEntry of claimedEntries){
                const [jobId,data]=claimedEntry
                const deliveryJobId=parseStreamFields(data).deliveryJobId;
                await attemptDelivery(deliveryJobId);
                await redis.xack('deliveries:stream','delivery-group',jobId);
            }
            console.log(`${claimedEntries.length} entries were claimed.`)
        }catch(err){
            console.log(err);
        }
    },30000);
}
async function run(){
    await startup();
    recoveryLoop();
    await mainLoop();
}
run();

module.exports={attemptDelivery,mainLoop,recoveryLoop,startup};


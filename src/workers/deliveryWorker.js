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
    console.log('--- attemptDelivery START for', deliveryJobId);
    const job=await DeliveryJob.findById(deliveryJobId);
    if (!job) {
        console.log('EXIT: job not found');
        return;
    }
    console.log('job status at start:', job.status, 'attempts:', job.attempts);

    if(job.status=='delivered' || job.status=='dead_letter'){
        console.log('EXIT: already finalized');
        return;
    }
    const subscription=await Subscription.findById(job.subscriptionId);
    const event=await Event.findById(job.eventId);
    const subscriberId=subscription._id.toString();
    const attempt=await canAttempt(redis,subscriberId);
    console.log('canAttempt result:', attempt);
    if (!attempt){
        console.log('EXIT: circuit open');
        scheduleRetry(job);
        job.lastAttemptAt=new Date();
        await job.save();
        console.log('after save, job status:', job.status);
        return;
    }
    const consumerToken=await tryConsumeToken(redis,subscriberId);
    console.log('tryConsumeToken result:', consumerToken);
    if (!consumerToken){
        console.log('EXIT: rate limited');
        scheduleRetry(job);
        job.lastAttemptAt=new Date();
        await job.save();
        console.log('after save, job status:', job.status);
        return;
    }
    const payload=JSON.stringify({type:event.type,payload:event.payload});
    const sign=signPayload(payload,subscription.secret);
    const start=Date.now();
    job.attempts+=1;
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
        job.nextRetryAt=null;
        job.latencyMs=latencyMs;
        job.responseCode=res.status;
        job.lastAttemptAt=new Date();
        await job.save();
        console.log('EXIT: delivered successfully');
    }catch(err){
        console.log('EXIT: catch block, error:', err.message);
        await recordFailure(redis,subscriberId);
        scheduleRetry(job);
        job.lastAttemptAt=new Date()
        await job.save();
        console.log('after save, job status:', job.status);
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
                console.log('>>> Processing deliveryJobId:', deliveryJobId);
                try {
                    await attemptDelivery(deliveryJobId);
                } catch (err) {
                    console.log('>>> attemptDelivery THREW:', err.message);
                }
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


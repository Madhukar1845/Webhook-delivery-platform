require('dotenv').config();
const Redis=require('ioredis');
const mongoose=require('mongoose');
const Event=require('../models/Event.model');
const Subscription=require('../models/Subscription.model');
const DeliveryJob=require('../models/DeliveryJob.model');

const redis=new Redis(process.env.REDIS_URL);

async function startup(){
    try{
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected');
    }catch(err){
    console.log(err);
    };

    try{
        await redis.xgroup('CREATE','events:stream','fanout-group','$','MKSTREAM');
        console.log('Consumer Group created');
}catch(err){
    if(err.message.includes('BUSYGROUP')){
        console.log('Group already exists, continuing');
    }else{
        throw err;
    }
}
} 

async function processEntry(id,data){
    const eventData={}
    const length=data.length;
    for(let i=0;i<length;i+=2){
        eventData[data[i]]=data[i+1];
    }
    const event=await Event.create({type:eventData.type,payload:eventData.payload});
    const sub=await Subscription.find({eventTypes:eventData.type,status:'active'})
    for(let subscriber of sub){
        try{
            const deliveryJob=await DeliveryJob.create({eventId:event._id,subscriptionId:subscriber._id});
            await redis.xadd('deliveries:stream','*','deliveryJobId',deliveryJob._id.toString());
        }catch(err){
            if (err.code==11000){
                console.log('Duplicate Key-already processed, skipping..');
            }else{
                throw err;
            }
        }
    };
    await redis.xack('events:stream','fanout-group',id);
}

async function recoveryLoop(){
    setInterval(async()=>{
        try{
            const result=await redis.xautoclaim('events:stream','fanout-group','fanout-worker-1',60000,0);
            const [cursor,claimedEntries,deletedIds]=result;
            for(let entry of claimedEntries){
                const [id,data]=entry;
                await processEntry(id,data);
            }
            console.log(`${claimedEntries.length} Entries were claimed.`)

        }catch(err){
            console.log(err)
        }
    },30000);
}
async function mainLoop(){
    while(true){
    try{
        const result=await redis.xreadgroup('GROUP','fanout-group','worker-1','COUNT',10,'BLOCK',5000,'STREAMS','events:stream','>');
        if(!result){
            continue;
        }
        const [streamData]=result;
        const [streamName,entries]=streamData;
        for(let entry of entries){
            const [id,data]=entry;
            await processEntry(id,data);
        }
    }catch(err){
        console.log(err);
        
    }
    }
}

async function run(){
    await startup();
    recoveryLoop();
    await mainLoop();
}

run();

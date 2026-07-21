require('dotenv').config();
const mongoose=require('mongoose');
const Redis=require('ioredis');
const redis=new Redis(process.env.REDIS_URL);
const DeliveryJob=require('../models/DeliveryJob.model');

async function startup(){
    try{
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected');
    }catch(err){
        throw err;
    }
}

async function checkForRetries(){
    try{
    const retries=await DeliveryJob.find({
        status: {$in: ['failed','pending']},
        nextRetryAt: {$lte: new Date()}
    });
    for(let retry of retries){
        if (retry.status === 'delivered' || retry.status === 'dead_letter') {
            continue;
        }
        await redis.xadd('deliveries:stream','*','deliveryJobId',retry._id.toString());
        retry.status='pending';
        retry.nextRetryAt=null;
        await retry.save();
    }
    console.log(`${retries.length} jobs were re-queued`);
    }catch(err){
        throw err;
    }
}

async function run(){
    await startup();
    async function loop(){
        await checkForRetries();
        setTimeout(loop,10000)
    };
    loop();
}
run();

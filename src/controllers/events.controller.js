const redis=require('../redisClient');
async function createEvent(req,res){
    try{
        const {type,payload}=req.body;
        await redis.xadd('events:stream','*','type',type,'payload',JSON.stringify(payload));
        return res.status(202).json({message:'Event accepted'});
    }catch(err){
        return res.status(500).json({error:err.message})
    }
};
module.exports={createEvent};
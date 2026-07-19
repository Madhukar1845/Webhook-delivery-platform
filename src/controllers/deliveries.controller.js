const DeliveryJob=require('../models/DeliveryJob.model');

async function getDeliveries(req,res){
    try{
    const subscriptionId=req.query.subscriptionId;
    const filter = subscriptionId ? {subscriptionId} : {};
    const deliveries=await DeliveryJob.find(filter).sort({createdAt:-1}).limit(50);
    return res.status(200).json({deliveries});
    }catch(err){
        res.status(500).json({error:err.message})
    }
}

module.exports={getDeliveries};

const Subscription=require('../models/Subscription.model');
const crypto=require('crypto');
async function createSubscription(req,res){
    try{
    const {url,eventTypes}=req.body;
    const secret=crypto.randomBytes(32).toString('hex');
    const subscription=await Subscription.create({url,eventTypes,secret});
    return res.status(201).json({text:'Subscription created',subscription});
    }catch(err){
        res.status(500).json({error:err})
    }
}
async function getSubscription(req,res){
    try{
        const id=req.params.id;
        const subscription=await Subscription.findById(id);
        if(!subscription){
            return res.status(404).json({text:'Subscription Not Found'});
        }
        res.status(200).json({text:'Subscription',subscription});
    }catch(err){
        res.status(500).json({error:err})
    }
}
async function deleteSubscription(req,res){
    try{
        const id=req.params.id;
        const subscription=await Subscription.findByIdAndDelete(id);
        if(!subscription){
            return res.status(404).json({text:'Subscription Not Found'});
        }
        return res.status(200).json({text:'Subscription Deleted'})
    }catch(err){
        res.status(500).json({error:err});
    }
}
module.exports={createSubscription,getSubscription,deleteSubscription};


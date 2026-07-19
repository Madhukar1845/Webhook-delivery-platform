const mongoose=require('mongoose');

const subscriptionSchema=new mongoose.Schema({
    url:{type:String,required:true},
    eventTypes:{type:[String],required:true,index:true},
    secret:{type:String,required:true},
    status:{type:String,enum:['active','paused'],default:'active'},   
},{timestamps:true});
module.exports=mongoose.model('Subscription',subscriptionSchema);
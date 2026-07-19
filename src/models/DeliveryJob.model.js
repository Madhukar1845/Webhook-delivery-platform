const mongoose=require('mongoose');
const deliveryJobSchema=new mongoose.Schema({
    eventId:{type:mongoose.Schema.Types.ObjectId,required:true,ref:'Event'},
    subscriptionId:{type:mongoose.Schema.Types.ObjectId,required:true,ref:'Subscription'},
    status:{type:String,enum:['pending','delivered','failed','dead_letter'],default:'pending'},
    attempts:{type:Number,default:0},
    lastAttemptAt:{type:Date,default:null},
    nextRetryAt:{type:Date,default:null},
    latencyMs:{type:Number,default:null},
    responseCode:{type:Number,default:null}
},{timestamps:true});
deliveryJobSchema.index({eventId:1,subscriptionId:1},{unique:true});

module.exports=mongoose.model('DeliveryJob',deliveryJobSchema);
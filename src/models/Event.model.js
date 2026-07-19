const mongoose=require('mongoose');

const eventModel=new mongoose.Schema({
    type:{type:String,required:true},
    payload:{type:mongoose.Schema.Types.Mixed,required:true},
},{timestamps:true});

module.exports=mongoose.model('Event',eventModel);
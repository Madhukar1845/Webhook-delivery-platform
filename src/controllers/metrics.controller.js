const DeliveryJob=require('../models/DeliveryJob.model');
const LatencyTracker=require('../utils/metrics');

async function getMetrics(req,res){
    try{
        const delivered=await DeliveryJob.find({status:'delivered',latencyMs:{$ne:null}});
        const latencytracker=new LatencyTracker();
        for(let job of delivered){
            latencytracker.record(job.latencyMs);
        }
        const delivered_count=delivered.length;
        const failed_count=await DeliveryJob.countDocuments({status:{$in:['failed','dead_letter']}});
        res.json({
            totalDelivered:delivered_count,
            totalFailed:failed_count,
            p50:latencytracker.percentile(50),
            p95:latencytracker.percentile(95),
            p99:latencytracker.percentile(99),
        })
    }catch(err){
        res.status(500).json({error:err})
    }
}
module.exports={getMetrics};
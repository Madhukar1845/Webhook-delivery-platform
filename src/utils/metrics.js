class LatencyTracker{
    constructor(){
        this.samples=[];
    }
    record(latencyMs){
        this.samples.push(latencyMs);
    }
    percentile(p){
        if(this.samples.length==0) return 0;
        const sorted_copy=[...this.samples].sort((a,b)=>a-b);
        const ind=Math.ceil((p/100)*sorted_copy.length)-1;
        return sorted_copy[ind];
    }
}

module.exports=LatencyTracker;
function calculateBackoff(attemptNumber,baseDelayMs=1000,maxDelayMs=300000){
    const expDelay=Math.min(baseDelayMs*(2**(attemptNumber-1)),maxDelayMs);
    const finalDelay=expDelay*(0.5+Math.random()*0.5);
    return finalDelay;
}

function scheduleRetry(deliveryJob){
    const MAX_ATTEMPTS=8;
    if (deliveryJob.attempts>=MAX_ATTEMPTS){
        deliveryJob.status='dead_letter';
    }else{
        const delay=calculateBackoff(deliveryJob.attempts);
        deliveryJob.nextRetryAt=new Date(Date.now()+delay);
        deliveryJob.status='failed';
    }
}

module.exports={calculateBackoff,scheduleRetry};
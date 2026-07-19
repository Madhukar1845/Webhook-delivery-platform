function getIdempotencyKey(deliveryJob){
    return deliveryJob._id.toString();
}

module.exports={getIdempotencyKey};
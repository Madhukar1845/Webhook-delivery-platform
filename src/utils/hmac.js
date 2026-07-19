const crypto=require('crypto');

function signPayload(payload,secret){
    const data=JSON.stringify(payload);
    const hmac=crypto.createHmac('sha256',secret).update(data).digest('hex')
    return hmac;
}

function verifySignature(payload,secret,receivedSignature){
    const expsign=signPayload(payload,secret);
    return expsign==receivedSignature;
}

module.exports={signPayload,verifySignature};
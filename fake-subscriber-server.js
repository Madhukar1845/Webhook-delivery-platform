const express=require('express');
const app=express();
app.use(express.json());
let shouldFail=false;
app.post('/webhook',(req,res)=>{
    if(shouldFail){
        console.log('Simulating failure for:',req.body);
        return res.status(500).send('simulated failure');
    }
    console.log('Received webhook:',req.body);
    res.status(200).send('ok');
})

app.post('/toggle-failure',(req,res)=>{
    shouldFail=!shouldFail;
    console.log('ShouldFail is now:',shouldFail);
    res.json({shouldFail});
});
app.listen(4000,()=>console.log('Fake subscriber listening on 4000'));
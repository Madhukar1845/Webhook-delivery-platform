require('dotenv').config();
const express=require('express');
const mongoose=require('mongoose');
const cors=require('cors');
const app=express();

app.use(express.json());
app.use(cors());
const deliveriesRoutes=require('./routes/deliveries.routes');
const subscriptionRoutes=require('./routes/subscription.routes');
const eventRoutes=require('./routes/events.routes');
const metricsRoutes=require('./routes/metrics.routes');
app.use('/subscriptions',subscriptionRoutes);
app.use('/events',eventRoutes);
app.use('/deliveries',deliveriesRoutes);
app.use('/metrics',metricsRoutes);
const PORT=process.env.PORT || 3000;
async function start(){
    try{
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDb Connected')
    app.listen(PORT,()=>{
        console.log('Server is Running on ',PORT);
    })
    }catch(err){
        console.log('Failed to connect to MongoDB:',err);
    }
}
start();
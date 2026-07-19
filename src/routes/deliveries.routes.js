const deliveriesController=require('../controllers/deliveries.controller');
const express=require('express');
const router=express.Router();

router.get('/',deliveriesController.getDeliveries);

module.exports=router;
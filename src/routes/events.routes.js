const eventsController=require('../controllers/events.controller');
const express=require('express');

const router=express.Router();
router.post('/',eventsController.createEvent);
module.exports=router;

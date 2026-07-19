const express=require('express');
const router=express.Router();

const subscriptionsController=require('../controllers/subscriptions.controller');

router.post('/',subscriptionsController.createSubscription);
router.get('/:id',subscriptionsController.getSubscription);
router.delete('/:id',subscriptionsController.deleteSubscription);

module.exports=router;
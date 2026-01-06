const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/leaveController');

router.get('/types', leaveController.getAllLeaveTypes);
router.get('/requests', leaveController.getAllLeaveRequests);
router.get('/requests/:id', leaveController.getLeaveRequestById);
router.post('/requests', leaveController.createLeaveRequest);
router.put('/requests/:id', leaveController.updateLeaveRequest);

module.exports = router;








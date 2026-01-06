const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');

router.get('/attendance', reportsController.getAttendanceReport);
router.get('/payroll', reportsController.getPayrollReport);
router.get('/departments', reportsController.getDepartmentReport);

module.exports = router;








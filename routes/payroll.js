const express = require('express');
const router = express.Router();
const payrollController = require('../controllers/payrollController');

router.get('/employees', payrollController.getEmployeesForPayroll);
router.post('/entries', payrollController.bulkUpdatePayrollEntries);
router.get('/entries/:id', payrollController.getPayrollEntryById);
router.post('/runs', payrollController.createPayrollRun);
router.get('/runs', payrollController.getAllPayrollRuns);
router.put('/runs/:id/approve', payrollController.approvePayrollRun);
router.post('/pay-individual', payrollController.payIndividualEmployee);
router.post('/pay-all', payrollController.payAllUnpaidEmployees);
router.get('/deduction-types', payrollController.getDeductionTypes);

module.exports = router;

const express = require('express');
const router = express.Router();
const departmentsController = require('../controllers/departmentsController');

router.get('/', departmentsController.getAllDepartments);
router.get('/:id/employees', departmentsController.getDepartmentEmployees);
router.get('/:id', departmentsController.getDepartmentById);
router.post('/', departmentsController.createDepartment);
router.put('/:id', departmentsController.updateDepartment);

module.exports = router;




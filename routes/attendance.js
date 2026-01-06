const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

// List / query attendance
router.get('/', attendanceController.getAllAttendance);

// Excel import endpoint
// Expects form-data with field name "file" containing the Excel file
router.post(
  '/import',
  attendanceController.upload.single('file'),
  attendanceController.importAttendance
);

// CRUD endpoints
router.get('/:id', attendanceController.getAttendanceById);
router.post('/', attendanceController.createAttendance);
router.put('/:id', attendanceController.updateAttendance);
router.delete('/:id', attendanceController.deleteAttendance);

module.exports = router;


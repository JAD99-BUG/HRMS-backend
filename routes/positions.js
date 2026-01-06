const express = require('express');
const router = express.Router();
const positionsController = require('../controllers/positionsController');

router.get('/', positionsController.getAllPositions);
router.post('/', positionsController.createPosition);

module.exports = router;




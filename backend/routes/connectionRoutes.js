const express = require('express');
const router = express.Router();
const connectionController = require('../controllers/connectionController');

// Middleware to check auth could be added here later
// const authMiddleware = require('../middleware/auth'); 

router.get('/', connectionController.getAll);
router.post('/', connectionController.create);
router.put('/:id', connectionController.update);
router.delete('/:id', connectionController.delete);
router.patch('/:id/toggle-internet', connectionController.toggleInternet);

module.exports = router;

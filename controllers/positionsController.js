const pool = require('../db/connection');

const getAllPositions = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM `position` ORDER BY title');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createPosition = async (req, res) => {
  try {
    const { title, description } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Position title is required' });
    }

    const [result] = await pool.execute(
      'INSERT INTO `position` (title, description) VALUES (?, ?)',
      [title, description || null]
    );

    res.status(201).json({ position_id: result.insertId, message: 'Position created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllPositions,
  createPosition
};




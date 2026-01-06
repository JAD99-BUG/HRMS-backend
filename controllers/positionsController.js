const pool = require('../db/connection');

const getAllPositions = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "position" ORDER BY title');
    res.json(result.rows);
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

    const result = await pool.query(
      'INSERT INTO "position" (title, description) VALUES ($1, $2) RETURNING position_id',
      [title, description || null]
    );

    res.status(201).json({ position_id: result.rows[0].position_id, message: 'Position created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllPositions,
  createPosition
};

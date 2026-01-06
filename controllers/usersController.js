const pool = require('../db/connection');
const bcrypt = require('bcryptjs');

const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ua.user_id, ua.username, ua.email, ua.status, ua.last_login,
        STRING_AGG(r.name, ',') as roles
      FROM user_account ua
      LEFT JOIN user_role ur ON ua.user_id = ur.user_id AND ur.revoked_on IS NULL
      LEFT JOIN role r ON ur.role_id = r.role_id
      GROUP BY ua.user_id
      ORDER BY ua.username
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT ua.*,
        STRING_AGG(r.name, ',') as roles
      FROM user_account ua
      LEFT JOIN user_role ur ON ua.user_id = ur.user_id AND ur.revoked_on IS NULL
      LEFT JOIN role r ON ur.role_id = r.role_id
      WHERE ua.user_id = $1
      GROUP BY ua.user_id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createUser = async (req, res) => {
  const client = await pool.connect();
  try {
    const { username, email, password, employee_id, role_id } = req.body;

    const hashedPassword = await bcrypt.hash(password || 'password123', 10);

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO user_account (username, email, password_hash, employee_id, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE') RETURNING user_id`,
      [username, email, hashedPassword, employee_id || null]
    );

    const userId = result.rows[0].user_id;

    if (role_id) {
      await client.query(
        'INSERT INTO user_role (user_id, role_id, assigned_on) VALUES ($1, $2, CURRENT_DATE)',
        [userId, role_id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ user_id: userId, message: 'User created successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, status, role_id } = req.body;

    await pool.query(
      'UPDATE user_account SET username = $1, email = $2, status = $3 WHERE user_id = $4',
      [username, email, status, id]
    );

    if (role_id) {
      await pool.query(
        'UPDATE user_role SET revoked_on = CURRENT_DATE WHERE user_id = $1 AND revoked_on IS NULL',
        [id]
      );
      await pool.query(
        'INSERT INTO user_role (user_id, role_id, assigned_on) VALUES ($1, $2, CURRENT_DATE)',
        [id, role_id]
      );
    }

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE user_account SET status = $1 WHERE user_id = $2', ['INACTIVE', id]);
    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getAllRoles = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM role ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getAllRoles
};

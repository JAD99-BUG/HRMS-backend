const pool = require('../db/connection');
const bcrypt = require('bcryptjs');

const getAllUsers = async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT ua.user_id, ua.username, ua.email, ua.status, ua.last_login,
        GROUP_CONCAT(r.name) as roles
      FROM user_account ua
      LEFT JOIN user_role ur ON ua.user_id = ur.user_id AND ur.revoked_on IS NULL
      LEFT JOIN role r ON ur.role_id = r.role_id
      GROUP BY ua.user_id
      ORDER BY ua.username
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      `SELECT ua.*,
        GROUP_CONCAT(r.name) as roles
      FROM user_account ua
      LEFT JOIN user_role ur ON ua.user_id = ur.user_id AND ur.revoked_on IS NULL
      LEFT JOIN role r ON ur.role_id = r.role_id
      WHERE ua.user_id = ?
      GROUP BY ua.user_id`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createUser = async (req, res) => {
  try {
    const { username, email, password, employee_id, role_id } = req.body;
    
    const hashedPassword = await bcrypt.hash(password || 'password123', 10);
    
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [result] = await connection.execute(
        `INSERT INTO user_account (username, email, password_hash, employee_id, status)
         VALUES (?, ?, ?, ?, 'ACTIVE')`,
        [username, email, hashedPassword, employee_id || null]
      );

      const userId = result.insertId;

      if (role_id) {
        await connection.execute(
          'INSERT INTO user_role (user_id, role_id, assigned_on) VALUES (?, ?, CURDATE())',
          [userId, role_id]
        );
      }

      await connection.commit();
      res.status(201).json({ user_id: userId, message: 'User created successfully' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, status, role_id } = req.body;
    
    await pool.execute(
      'UPDATE user_account SET username = ?, email = ?, status = ? WHERE user_id = ?',
      [username, email, status, id]
    );

    if (role_id) {
      await pool.execute(
        'UPDATE user_role SET revoked_on = CURDATE() WHERE user_id = ? AND revoked_on IS NULL',
        [id]
      );
      await pool.execute(
        'INSERT INTO user_role (user_id, role_id, assigned_on) VALUES (?, ?, CURDATE())',
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
    await pool.execute('UPDATE user_account SET status = ? WHERE user_id = ?', ['INACTIVE', id]);
    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getAllRoles = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM role ORDER BY name');
    res.json(rows);
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








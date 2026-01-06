const pool = require('../db/connection');
const bcrypt = require('bcryptjs');

const login = async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;

    const result = await pool.query(
      `SELECT 
        ua.user_id, 
        ua.username, 
        ua.email, 
        ua.password_hash, 
        ua.status,
        STRING_AGG(DISTINCT r.name, ',') as roles,
        ea.department_id
      FROM user_account ua
      LEFT JOIN user_role ur ON ua.user_id = ur.user_id AND ur.revoked_on IS NULL
      LEFT JOIN role r ON ur.role_id = r.role_id
      LEFT JOIN employee e ON ua.employee_id = e.employee_id
      LEFT JOIN employment_assignment ea ON e.employee_id = ea.employee_id AND ea.status = 'ACTIVE'
      WHERE (ua.username = $1 OR ua.email = $2) AND ua.status = 'ACTIVE'
      GROUP BY ua.user_id, ea.department_id`,
      [usernameOrEmail, usernameOrEmail]
    );
    const rows = result.rows;

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];

    if (password) {
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    await pool.query(
      'UPDATE user_account SET last_login = NOW() WHERE user_id = $1',
      [user.user_id]
    );

    const roles = user.roles ? user.roles.split(',') : [];
    const primaryRole = roles[0] || 'HR_MANAGER';

    res.json({
      user_id: user.user_id,
      username: user.username,
      email: user.email,
      role: primaryRole,
      roles: roles,
      status: user.status,
      department_id: user.department_id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  login
};








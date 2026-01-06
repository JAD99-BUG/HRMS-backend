const pool = require('../db/connection');

const getAllLeaveRequests = async (req, res) => {
  try {
    const { status, employee_id } = req.query;
    let query = `
      SELECT lr.*,
        CONCAT(e.first_name, ' ', e.last_name) as employee_name,
        lt.name as leave_type_name,
        TO_CHAR(lr.start_date, 'YYYY-MM-DD') as start_date,
        TO_CHAR(lr.end_date, 'YYYY-MM-DD') as end_date,
        TO_CHAR(lr.submitted_on, 'YYYY-MM-DD') as submitted_on
      FROM leave_request lr
      INNER JOIN employee e ON lr.employee_id = e.employee_id
      INNER JOIN leave_type lt ON lr.leave_type_id = lt.leave_type_id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND lr.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (employee_id) {
      query += ` AND lr.employee_id = $${paramIndex}`;
      params.push(employee_id);
      paramIndex++;
    }

    query += ' ORDER BY lr.submitted_on DESC, lr.status';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getLeaveRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT lr.*,
        CONCAT(e.first_name, ' ', e.last_name) as employee_name,
        lt.name as leave_type_name,
        TO_CHAR(lr.start_date, 'YYYY-MM-DD') as start_date,
        TO_CHAR(lr.end_date, 'YYYY-MM-DD') as end_date,
        TO_CHAR(lr.submitted_on, 'YYYY-MM-DD') as submitted_on
      FROM leave_request lr
      INNER JOIN employee e ON lr.employee_id = e.employee_id
      INNER JOIN leave_type lt ON lr.leave_type_id = lt.leave_type_id
      WHERE lr.leave_request_id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createLeaveRequest = async (req, res) => {
  try {
    const { employee_id, leave_type_id, start_date, end_date, reason } = req.body;
    const result = await pool.query(
      `INSERT INTO leave_request (employee_id, leave_type_id, start_date, end_date, reason, submitted_on, status)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'PENDING') RETURNING leave_request_id`,
      [employee_id, leave_type_id, start_date, end_date, reason]
    );
    res.status(201).json({ leave_request_id: result.rows[0].leave_request_id, message: 'Leave request created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateLeaveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, approved_by_user_id, reason } = req.body;

    let query = 'UPDATE leave_request SET status = $1';
    const params = [status];
    let paramIndex = 2;

    if (approved_by_user_id !== undefined && approved_by_user_id !== null) {
      query += `, approved_by_user_id = $${paramIndex}`;
      params.push(approved_by_user_id);
      paramIndex++;
    }

    if (reason !== undefined && reason !== null) {
      query += `, reason = $${paramIndex}`;
      params.push(reason);
      paramIndex++;
    }

    query += ` WHERE leave_request_id = $${paramIndex}`;
    params.push(id);

    await pool.query(query, params);
    res.json({ message: 'Leave request updated successfully' });
  } catch (error) {
    console.error('Error updating leave request:', error);
    res.status(500).json({ error: error.message });
  }
};

const getAllLeaveTypes = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM leave_type ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllLeaveRequests,
  getLeaveRequestById,
  createLeaveRequest,
  updateLeaveRequest,
  getAllLeaveTypes
};

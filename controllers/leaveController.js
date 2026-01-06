const pool = require('../db/connection');

const getAllLeaveRequests = async (req, res) => {
  try {
    const { status, employee_id } = req.query;
    let query = `
      SELECT lr.*,
        CONCAT(e.first_name, ' ', e.last_name) as employee_name,
        lt.name as leave_type_name,
        DATE_FORMAT(lr.start_date, '%Y-%m-%d') as start_date,
        DATE_FORMAT(lr.end_date, '%Y-%m-%d') as end_date,
        DATE_FORMAT(lr.submitted_on, '%Y-%m-%d') as submitted_on
      FROM leave_request lr
      INNER JOIN employee e ON lr.employee_id = e.employee_id
      INNER JOIN leave_type lt ON lr.leave_type_id = lt.leave_type_id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND lr.status = ?';
      params.push(status);
    }
    if (employee_id) {
      query += ' AND lr.employee_id = ?';
      params.push(employee_id);
    }

    query += ' ORDER BY lr.submitted_on DESC, lr.status';

    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getLeaveRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      `SELECT lr.*,
        CONCAT(e.first_name, ' ', e.last_name) as employee_name,
        lt.name as leave_type_name,
        DATE_FORMAT(lr.start_date, '%Y-%m-%d') as start_date,
        DATE_FORMAT(lr.end_date, '%Y-%m-%d') as end_date,
        DATE_FORMAT(lr.submitted_on, '%Y-%m-%d') as submitted_on
      FROM leave_request lr
      INNER JOIN employee e ON lr.employee_id = e.employee_id
      INNER JOIN leave_type lt ON lr.leave_type_id = lt.leave_type_id
      WHERE lr.leave_request_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createLeaveRequest = async (req, res) => {
  try {
    const { employee_id, leave_type_id, start_date, end_date, reason } = req.body;
    const [result] = await pool.execute(
      `INSERT INTO leave_request (employee_id, leave_type_id, start_date, end_date, reason, submitted_on, status)
       VALUES (?, ?, ?, ?, ?, CURDATE(), 'PENDING')`,
      [employee_id, leave_type_id, start_date, end_date, reason]
    );
    res.status(201).json({ leave_request_id: result.insertId, message: 'Leave request created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateLeaveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, approved_by_user_id, reason } = req.body;
    
    let query = 'UPDATE leave_request SET status = ?';
    const params = [status];
    
    if (approved_by_user_id !== undefined && approved_by_user_id !== null) {
      query += ', approved_by_user_id = ?';
      params.push(approved_by_user_id);
    }
    
    if (reason !== undefined && reason !== null) {
      query += ', reason = ?';
      params.push(reason);
    }
    
    query += ' WHERE leave_request_id = ?';
    params.push(id);
    
    await pool.execute(query, params);
    res.json({ message: 'Leave request updated successfully' });
  } catch (error) {
    console.error('Error updating leave request:', error);
    res.status(500).json({ error: error.message });
  }
};

const getAllLeaveTypes = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM leave_type ORDER BY name');
    res.json(rows);
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


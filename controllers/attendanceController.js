const pool = require('../db/connection');
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `attendance_${Date.now()}${path.extname(file.originalname)}`);
  }
});

// Note: we already validate the Excel content in importAttendance; file extension
// checks can be added here via fileFilter if needed.
const upload = multer({ storage });

const getAllAttendance = async (req, res) => {
  try {
    const { date, employee_id, month, year } = req.query;
    let query = `
      SELECT ar.*, 
        CONCAT(e.first_name, ' ', e.last_name) as employee_name
      FROM attendance_record ar
      INNER JOIN employee e ON ar.employee_id = e.employee_id
      WHERE 1=1
    `;
    const params = [];

    // Month/year filtering similar to payroll
    if (month && year) {
      query += ' AND MONTH(ar.attendance_date) = ? AND YEAR(ar.attendance_date) = ?';
      params.push(parseInt(month, 10), parseInt(year, 10));
    } else if (date) {
      query += ' AND ar.attendance_date = ?';
      params.push(date);
    }
    if (employee_id) {
      query += ' AND ar.employee_id = ?';
      params.push(employee_id);
    }

    query += ' ORDER BY ar.attendance_date DESC, e.last_name, e.first_name';

    const [rows] = await pool.execute(query, params);
    
    const formatted = rows.map(row => {
      // Normalize time to HH:MM format (24-hour, no seconds)
      const normalizeTimeDisplay = (timeStr) => {
        if (!timeStr) return null;
        
        // Convert to string if not already
        const str = String(timeStr).trim();
        
        // Handle ISO format like "T22:00:00.000Z" or "2024-01-01T22:00:00.000Z"
        const isoTimeMatch = str.match(/T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?/i);
        if (isoTimeMatch) {
          const hours = isoTimeMatch[1];
          const minutes = isoTimeMatch[2];
          return `${hours}:${minutes}`;
        }
        
        // If already in HH:MM format, return as is
        if (/^\d{2}:\d{2}$/.test(str)) {
          return str;
        }
        
        // If in HH:MM:SS format, extract HH:MM
        if (/^\d{2}:\d{2}:\d{2}/.test(str)) {
          return str.substring(0, 5);
        }
        
        // Try to parse and format
        const parts = str.split(':');
        if (parts.length >= 2) {
          return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
        }
        
        return str;
      };
      
      const checkIn = normalizeTimeDisplay(row.check_in);
      const checkOut = normalizeTimeDisplay(row.check_out);
      let workingHours = 0;
      let hourVariance = 0;

      if (checkIn && checkOut) {
        const [inHour, inMin] = checkIn.split(':').map(Number);
        const [outHour, outMin] = checkOut.split(':').map(Number);
        const inTime = inHour * 60 + inMin;
        const outTime = outHour * 60 + outMin;
        workingHours = (outTime - inTime) / 60;
        hourVariance = workingHours - 8;
      }

      return {
        ...row,
        check_in: checkIn,
        check_out: checkOut,
        working_hours: Math.round(workingHours * 100) / 100,
        hour_variance: Math.round(hourVariance) // Round to whole number, no decimals
      };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getAttendanceById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      `SELECT ar.*, 
        CONCAT(e.first_name, ' ', e.last_name) as employee_name
      FROM attendance_record ar
      INNER JOIN employee e ON ar.employee_id = e.employee_id
      WHERE ar.attendance_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createAttendance = async (req, res) => {
  try {
    const { employee_id, attendance_date, check_in, check_out, mark, notes } = req.body;
    const [result] = await pool.execute(
      `INSERT INTO attendance_record (employee_id, attendance_date, check_in, check_out, mark, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       check_in = VALUES(check_in),
       check_out = VALUES(check_out),
       mark = VALUES(mark),
       notes = VALUES(notes)`,
      [employee_id, attendance_date, check_in, check_out, mark || 'PRESENT', notes]
    );
    res.status(201).json({ attendance_id: result.insertId, message: 'Attendance record created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { check_in, check_out, mark, notes } = req.body;
    await pool.execute(
      'UPDATE attendance_record SET check_in = ?, check_out = ?, mark = ?, notes = ? WHERE attendance_id = ?',
      [check_in, check_out, mark, notes, id]
    );
    res.json({ message: 'Attendance record updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('DELETE FROM attendance_record WHERE attendance_id = ?', [id]);
    res.json({ message: 'Attendance record deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const importAttendance = async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    filePath = req.file.path;
    
    // Read Excel file
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // First try with raw: false to get formatted values (better for dates/times)
    let data = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1, 
      defval: null,
      raw: false, // Get formatted string values instead of raw numbers
      dateNF: 'yyyy-mm-dd' // Date format
    });
    
    // Also get raw values as backup
    const rawData = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1, 
      defval: null,
      raw: true // Get raw numeric values
    });
    
    // Merge raw values where formatted values might be missing
    for (let i = 0; i < data.length && i < rawData.length; i++) {
      for (let j = 0; j < data[i].length && j < rawData[i].length; j++) {
        // If formatted value is empty/null but raw value exists, use raw value
        if ((data[i][j] === null || data[i][j] === undefined || data[i][j] === '') && 
            rawData[i][j] !== null && rawData[i][j] !== undefined) {
          data[i][j] = rawData[i][j];
        }
      }
    }
    
    console.log('[ImportAttendance] Sample first 3 rows (formatted):', JSON.stringify(data.slice(0, 3), null, 2));
    console.log('[ImportAttendance] Sample first 3 rows (raw):', JSON.stringify(rawData.slice(0, 3), null, 2));
    
    // Statistics
    let totalRowsRead = 0;
    let validRows = 0;
    let insertedRecords = 0;
    let updatedRecords = 0;
    let skippedInvalidEmployee = 0;
    let skippedEmptyRows = 0;
    
    // Skip header row (first row)
    const dataRows = data.slice(1);
    
    // Process each row
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      totalRowsRead++;
      
      // Check if row is empty (all cells are null/empty)
      const isEmptyRow = !row || row.every(cell => cell === null || cell === undefined || String(cell).trim() === '');
      if (isEmptyRow) {
        skippedEmptyRows++;
        continue;
      }
      
      // Extract data from columns
      // Column A (index 0) → Employee ID
      // Column C (index 2) → Date
      // Column D (index 3) → Time In
      // Column E (index 4) → Time Out
      
      const employeeId = row[0] ? String(row[0]).trim() : null;
      const dateValue = row[2];
      const timeInRaw = row[3];
      const timeOutRaw = row[4];
      
      console.log(`[ImportAttendance] Row ${i + 2}: EmployeeID=${employeeId}, Date=${dateValue}, TimeIn=${timeInRaw} (type: ${typeof timeInRaw}), TimeOut=${timeOutRaw} (type: ${typeof timeOutRaw})`);
      
      // Skip if no employee ID
      if (!employeeId) {
        skippedEmptyRows++;
        continue;
      }
      
      // Verify employee exists
      const [employeeCheck] = await pool.execute(
        'SELECT employee_id FROM employee WHERE employee_id = ?',
        [employeeId]
      );
      
      if (employeeCheck.length === 0) {
        skippedInvalidEmployee++;
        continue;
      }
      
      validRows++;
      
      // Normalize date - handle formats like "11/1/2025", "11/01/2025", etc.
      let attendanceDate = null;
      if (dateValue) {
        if (dateValue instanceof Date) {
          attendanceDate = dateValue.toISOString().split('T')[0];
        } else if (typeof dateValue === 'number') {
          // Excel date serial number
          const excelEpoch = new Date(1899, 11, 30);
          const date = new Date(excelEpoch.getTime() + dateValue * 86400000);
          attendanceDate = date.toISOString().split('T')[0];
        } else {
          const dateStr = String(dateValue).trim();
          
          // Handle MM/DD/YYYY format (like "11/1/2025", "11/01/2025")
          const mmddyyyyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (mmddyyyyMatch) {
            const month = parseInt(mmddyyyyMatch[1], 10);
            const day = parseInt(mmddyyyyMatch[2], 10);
            const year = parseInt(mmddyyyyMatch[3], 10);
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
              attendanceDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              console.log(`[ImportAttendance] Row ${i + 2}: Parsed MM/DD/YYYY format "${dateStr}" to ${attendanceDate}`);
            }
          } else {
            // Try to parse various date formats using Date constructor
            const parsedDate = new Date(dateStr);
            if (!isNaN(parsedDate.getTime())) {
              attendanceDate = parsedDate.toISOString().split('T')[0];
              console.log(`[ImportAttendance] Row ${i + 2}: Parsed date "${dateStr}" to ${attendanceDate}`);
            } else {
              // Try YYYY-MM-DD format
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                attendanceDate = dateStr;
              } else {
                console.log(`[ImportAttendance] Row ${i + 2}: Could not parse date: "${dateStr}"`);
              }
            }
          }
        }
      }
      
      if (!attendanceDate) {
        skippedEmptyRows++;
        continue;
      }
      
      // Normalize time values to HH:MM format (24-hour, no seconds)
      const normalizeTime = (timeValue, rowNum) => {
        if (timeValue === null || timeValue === undefined) {
          return null;
        }
        
        // Convert to string first to handle all cases
        const timeStr = String(timeValue).trim();
        
        if (timeStr === '' || timeStr === 'NULL' || timeStr === 'N/A' || timeStr === 'null' || timeStr === 'undefined') {
          return null;
        }
        
        const timeStrUpper = timeStr.toUpperCase();
        
        // Check for "OFF" or "off" (case-insensitive)
        if (timeStrUpper === 'OFF' || timeStrUpper === 'OFF') {
          return 'OFF';
        }
        
        // Handle Excel time serial numbers (decimal between 0 and 1)
        if (typeof timeValue === 'number') {
          // Excel time is stored as fraction of day (0.0 = midnight, 0.5 = noon, 1.0 = next midnight)
          if (timeValue >= 0 && timeValue < 1) {
            const totalMinutes = Math.floor(timeValue * 24 * 60);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            const result = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            console.log(`[ImportAttendance] Row ${rowNum}: Converted Excel time serial ${timeValue} to ${result}`);
            return result;
          }
          // If it's a larger number, might be a date-time serial, try to extract time part
          if (timeValue >= 1) {
            // Excel date-time serial: integer part is date, decimal part is time
            const timePart = timeValue % 1;
            if (timePart > 0) {
              const totalMinutes = Math.floor(timePart * 24 * 60);
              const hours = Math.floor(totalMinutes / 60);
              const minutes = totalMinutes % 60;
              const result = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
              console.log(`[ImportAttendance] Row ${rowNum}: Extracted time from date-time serial ${timeValue} to ${result}`);
              return result;
            }
          }
        }
        
        // Handle Date objects
        if (timeValue instanceof Date) {
          const hours = String(timeValue.getHours()).padStart(2, '0');
          const minutes = String(timeValue.getMinutes()).padStart(2, '0');
          const result = `${hours}:${minutes}`;
          console.log(`[ImportAttendance] Row ${rowNum}: Converted Date object to ${result}`);
          return result;
        }
        
        // Handle string formats - prioritize simple HH:MM format first
        if (typeof timeValue === 'string') {
          // FIRST: Handle ISO format like "T22:00:00.000Z" or "2024-01-01T22:00:00.000Z"
          const isoTimeMatch = timeStr.match(/T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?/i);
          if (isoTimeMatch) {
            const hours = isoTimeMatch[1];
            const minutes = isoTimeMatch[2];
            const result = `${hours}:${minutes}`;
            console.log(`[ImportAttendance] Row ${rowNum}: Extracted time from ISO format "${timeStr}" to ${result}`);
            return result;
          }
          
          // Remove any date part if present (e.g., "2024-01-01 08:30:00" -> "08:30:00")
          let timeOnly = timeStr.split(' ').pop().trim();
          
          // FIRST: Handle simple HH:MM format (like "8:12", "18:48", "6:32", "7:59")
          // This is the most common format in the user's Excel file
          const simpleTimeMatch = timeOnly.match(/^(\d{1,2}):(\d{2})$/);
          if (simpleTimeMatch) {
            let hours = parseInt(simpleTimeMatch[1], 10);
            const minutes = simpleTimeMatch[2];
            // Validate hours (0-23) and minutes (0-59)
            if (hours >= 0 && hours <= 23 && parseInt(minutes, 10) >= 0 && parseInt(minutes, 10) <= 59) {
              const result = `${String(hours).padStart(2, '0')}:${minutes}`;
              console.log(`[ImportAttendance] Row ${rowNum}: Parsed simple HH:MM format "${timeOnly}" to ${result}`);
              return result;
            }
          }
          
          // SECOND: Handle 24-hour format with seconds (HH:MM:SS)
          const time24Match = timeOnly.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
          if (time24Match) {
            const hours = parseInt(time24Match[1], 10);
            const minutes = time24Match[2];
            // Validate hours (0-23) and minutes (0-59)
            if (hours >= 0 && hours <= 23 && parseInt(minutes, 10) >= 0 && parseInt(minutes, 10) <= 59) {
              const result = `${String(hours).padStart(2, '0')}:${minutes}`;
              console.log(`[ImportAttendance] Row ${rowNum}: Parsed 24-hour format "${timeOnly}" to ${result}`);
              return result;
            }
          }
          
          // THIRD: Handle 12-hour format with AM/PM (e.g., "8:30 AM", "2:45 PM")
          const amPmMatch = timeOnly.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i);
          if (amPmMatch) {
            let hours = parseInt(amPmMatch[1], 10);
            const minutes = amPmMatch[2];
            const period = amPmMatch[4].toUpperCase();
            
            if (period === 'PM' && hours !== 12) {
              hours += 12;
            } else if (period === 'AM' && hours === 12) {
              hours = 0;
            }
            const result = `${String(hours).padStart(2, '0')}:${minutes}`;
            console.log(`[ImportAttendance] Row ${rowNum}: Converted 12-hour format "${timeOnly}" to ${result}`);
            return result;
          }
          
          // FOURTH: Try to extract time from various formats with different separators
          const anyTimeMatch = timeOnly.match(/(\d{1,2})[:.](\d{2})/);
          if (anyTimeMatch) {
            const hours = parseInt(anyTimeMatch[1], 10);
            const minutes = anyTimeMatch[2];
            if (hours >= 0 && hours <= 23 && parseInt(minutes, 10) >= 0 && parseInt(minutes, 10) <= 59) {
              const result = `${String(hours).padStart(2, '0')}:${minutes}`;
              console.log(`[ImportAttendance] Row ${rowNum}: Extracted time from "${timeOnly}" to ${result}`);
              return result;
            }
          }
          
          console.log(`[ImportAttendance] Row ${rowNum}: Could not parse time string: "${timeStr}"`);
        }
        
        console.log(`[ImportAttendance] Row ${rowNum}: Unknown time format: ${typeof timeValue} = ${timeValue}`);
        return null;
      };
      
      const timeIn = normalizeTime(timeInRaw, i + 2);
      const timeOut = normalizeTime(timeOutRaw, i + 2);
      
      console.log(`[ImportAttendance] Row ${i + 2}: Normalized TimeIn=${timeIn}, TimeOut=${timeOut}`);
      
      // Determine status based on rules
      let status = null;
      let finalTimeIn = null;
      let finalTimeOut = null;
      
      // Rule 1: OFF
      if (timeIn === 'OFF' || timeOut === 'OFF') {
        status = 'OFF';
        finalTimeIn = null;
        finalTimeOut = null;
      }
      // Rule 2: NO_SIGN_OUT (time_in exists but time_out is empty/null)
      else if (timeIn && !timeOut) {
        status = 'NO_SIGN_OUT';
        finalTimeIn = timeIn;
        finalTimeOut = null;
      }
      // Rule 3: ABSENT (both time_in and time_out are empty/null)
      else if (!timeIn && !timeOut) {
        status = 'ABSENT';
        finalTimeIn = null;
        finalTimeOut = null;
      }
      // Rule 4: PRESENT (both time_in and time_out exist)
      else if (timeIn && timeOut) {
        status = 'PRESENT';
        finalTimeIn = timeIn;
        finalTimeOut = timeOut;
      }
      // Fallback: if we can't determine, skip
      else {
        skippedEmptyRows++;
        continue;
      }
      
      // Check if attendance already exists for this employee and date
      const [existing] = await pool.execute(
        'SELECT attendance_id FROM attendance_record WHERE employee_id = ? AND attendance_date = ?',
        [employeeId, attendanceDate]
      );
      
      if (existing.length > 0) {
        // Update existing record instead of skipping
        const attendanceId = existing[0].attendance_id;
        console.log(`[ImportAttendance] Row ${i + 2}: Updating existing record - AttendanceID=${attendanceId}, EmployeeID=${employeeId}, Date=${attendanceDate}, CheckIn=${finalTimeIn}, CheckOut=${finalTimeOut}, Status=${status}`);
        
        await pool.execute(
          `UPDATE attendance_record 
           SET check_in = ?, check_out = ?, mark = ?
           WHERE attendance_id = ?`,
          [finalTimeIn, finalTimeOut, status, attendanceId]
        );
        
        console.log(`[ImportAttendance] Row ${i + 2}: Successfully updated attendance record`);
        updatedRecords++;
      } else {
        // Insert new attendance record
        // Map: time_in → check_in, time_out → check_out, status → mark
        console.log(`[ImportAttendance] Row ${i + 2}: Inserting new record - EmployeeID=${employeeId}, Date=${attendanceDate}, CheckIn=${finalTimeIn}, CheckOut=${finalTimeOut}, Status=${status}`);
        
        await pool.execute(
          `INSERT INTO attendance_record (employee_id, attendance_date, check_in, check_out, mark)
           VALUES (?, ?, ?, ?, ?)`,
          [employeeId, attendanceDate, finalTimeIn, finalTimeOut, status]
        );
        
        console.log(`[ImportAttendance] Row ${i + 2}: Successfully inserted attendance record`);
        insertedRecords++;
      }
    }
    
    // Clean up uploaded file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.json({
      total_rows_read: totalRowsRead,
      valid_rows: validRows,
      inserted_records: insertedRecords,
      updated_records: updatedRecords,
      skipped_invalid_employee: skippedInvalidEmployee,
      skipped_empty_rows: skippedEmptyRows
    });
    
  } catch (error) {
    // Clean up uploaded file on error
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
    
    console.error('Error importing attendance:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllAttendance,
  getAttendanceById,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  importAttendance,
  upload
};





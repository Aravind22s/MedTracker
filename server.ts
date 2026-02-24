import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("medtrack.db");
db.pragma('foreign_keys = ON');
const JWT_SECRET = process.env.JWT_SECRET || "medtrack-secret-key-123";

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    name TEXT,
    reminder_sound TEXT DEFAULT 'default',
    custom_sound_data TEXT,
    language TEXT DEFAULT 'en'
  );

  CREATE TABLE IF NOT EXISTS medicines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    dosage TEXT,
    frequency TEXT,
    time_of_day TEXT,
    start_date TEXT,
    end_date TEXT,
    instructions TEXT,
    snoozed_until TEXT,
    reminder_time TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER,
    user_id INTEGER,
    taken_at TEXT,
    status TEXT,
    FOREIGN KEY(medicine_id) REFERENCES medicines(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Run Migrations (Add columns if they don't exist)
const migrate = () => {
  const tables = {
    users: ['reminder_sound', 'custom_sound_data'],
    medicines: ['snoozed_until', 'reminder_time']
  };

  for (const [table, columns] of Object.entries(tables)) {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    const existingColumns = info.map(c => c.name);
    
    for (const column of columns) {
      if (!existingColumns.includes(column)) {
        console.log(`Migrating: Adding ${column} to ${table}`);
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`).run();
      }
    }
  }
};
migrate();

// Seed Database
async function seedDatabase() {
  const demoUser = db.prepare("SELECT * FROM users WHERE email = ?").get("demo@example.com") as any;
  if (!demoUser) {
    console.log("Seeding database: Creating demo user...");
    const hashedPassword = await bcrypt.hash("password123", 10);
    const userResult = db.prepare("INSERT INTO users (email, password, name) VALUES (?, ?, ?)")
      .run("demo@example.com", hashedPassword, "Demo User");
    
    const userId = userResult.lastInsertRowid;

    const meds = [
      { name: "Lisinopril", dosage: "10mg", frequency: "Daily", time_of_day: "Morning", instructions: "Take with water", reminder_time: "08:00" },
      { name: "Metformin", dosage: "500mg", frequency: "Twice a day", time_of_day: "Morning, Evening", instructions: "Take with food", reminder_time: "19:00" },
      { name: "Atorvastatin", dosage: "20mg", frequency: "Daily", time_of_day: "Night", instructions: "Avoid grapefruit juice", reminder_time: "21:00" }
    ];

    for (const med of meds) {
      const medResult = db.prepare(`
        INSERT INTO medicines (user_id, name, dosage, frequency, time_of_day, start_date, instructions, reminder_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, med.name, med.dosage, med.frequency, med.time_of_day, new Date().toISOString(), med.instructions, med.reminder_time);

      // Add some logs for the past 7 days
      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        db.prepare("INSERT INTO logs (user_id, medicine_id, taken_at, status) VALUES (?, ?, ?, ?)")
          .run(userId, medResult.lastInsertRowid, date.toISOString(), "taken");
      }
    }
    console.log("Database seeded successfully!");
  } else {
    console.log("Demo user already exists, skipping seed.");
  }
}

async function startServer() {
  await seedDatabase();
  const app = express();
  app.use(express.json());

  // Request logging
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      
      // Verify user still exists in DB
      const dbUser = db.prepare("SELECT id FROM users WHERE id = ?").get(user.id);
      if (!dbUser) {
        return res.status(401).json({ error: "User no longer exists" });
      }
      
      req.user = user;
      next();
    });
  };

  // Auth Routes
  app.post("/api/auth/signup", async (req, res) => {
    const { email, password, name } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const stmt = db.prepare("INSERT INTO users (email, password, name) VALUES (?, ?, ?)");
      const result = stmt.run(email, hashedPassword, name);
      const userId = Number(result.lastInsertRowid);
      const token = jwt.sign({ id: userId, email, name, reminder_sound: 'default' }, JWT_SECRET);
      res.json({ token, user: { id: userId, email, name, reminder_sound: 'default', custom_sound_data: null } });
    } catch (e) {
      res.status(400).json({ error: "Email already exists" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    console.log(`Login attempt for: ${email}`);
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    if (!user) {
      console.log("User not found");
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("Password mismatch");
      return res.status(401).json({ error: "Invalid credentials" });
    }
    console.log("Login successful");
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, reminder_sound: user.reminder_sound, language: user.language }, JWT_SECRET);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, reminder_sound: user.reminder_sound, custom_sound_data: user.custom_sound_data, language: user.language } });
  });

  app.put("/api/user/settings", authenticateToken, (req: any, res) => {
    const { reminder_sound, custom_sound_data, language } = req.body;
    
    if (language) {
      db.prepare("UPDATE users SET language = ? WHERE id = ?").run(language, req.user.id);
    }

    if (reminder_sound) {
      if (custom_sound_data !== undefined) {
        db.prepare("UPDATE users SET reminder_sound = ?, custom_sound_data = ? WHERE id = ?")
          .run(reminder_sound, custom_sound_data, req.user.id);
      } else {
        db.prepare("UPDATE users SET reminder_sound = ? WHERE id = ?")
          .run(reminder_sound, req.user.id);
      }
    }
    res.json({ success: true });
  });

  app.get("/api/user/me", authenticateToken, (req: any, res) => {
    const user = db.prepare("SELECT id, email, name, reminder_sound, custom_sound_data, language FROM users WHERE id = ?").get(req.user.id);
    res.json(user);
  });

  // Medicine Routes
  app.get("/api/medicines", authenticateToken, (req: any, res) => {
    const medicines = db.prepare("SELECT * FROM medicines WHERE user_id = ?").all(req.user.id);
    res.json(medicines);
  });

  app.post("/api/medicines", authenticateToken, (req: any, res) => {
    try {
      const { name, dosage, frequency, time_of_day, start_date, end_date, instructions, reminder_time } = req.body;
      const stmt = db.prepare(`
        INSERT INTO medicines (user_id, name, dosage, frequency, time_of_day, start_date, end_date, instructions, reminder_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(req.user.id, name, dosage, frequency, time_of_day, start_date, end_date, instructions, reminder_time);
      res.json({ id: Number(result.lastInsertRowid), ...req.body });
    } catch (error: any) {
      console.error("Error adding medicine:", error);
      res.status(500).json({ error: error.message || "Failed to add medicine" });
    }
  });

  app.put("/api/medicines/:id", authenticateToken, (req: any, res) => {
    const { name, dosage, frequency, time_of_day, start_date, end_date, instructions, reminder_time } = req.body;
    const stmt = db.prepare(`
      UPDATE medicines 
      SET name = ?, dosage = ?, frequency = ?, time_of_day = ?, start_date = ?, end_date = ?, instructions = ?, reminder_time = ?
      WHERE id = ? AND user_id = ?
    `);
    stmt.run(name, dosage, frequency, time_of_day, start_date, end_date, instructions, reminder_time, req.params.id, req.user.id);
    res.json({ success: true });
  });

  app.delete("/api/medicines/:id", authenticateToken, (req: any, res) => {
    const medId = Number(req.params.id);
    const userId = Number(req.user.id);
    
    console.log(`[SERVER] DELETE request: medId=${medId}, userId=${userId}`);
    
    if (isNaN(medId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    try {
      const deleteLogs = db.prepare("DELETE FROM logs WHERE medicine_id = ? AND user_id = ?");
      const deleteMed = db.prepare("DELETE FROM medicines WHERE id = ? AND user_id = ?");
      
      const transaction = db.transaction((mId, uId) => {
        deleteLogs.run(mId, uId);
        return deleteMed.run(mId, uId);
      });
      
      const info = transaction(medId, userId);
      console.log(`[SERVER] DELETE result: ${info.changes} rows affected`);

      if (info.changes > 0) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Medicine not found" });
      }
    } catch (error: any) {
      console.error(`[SERVER] DELETE error:`, error);
      res.status(500).json({ error: error.message || "Server error" });
    }
  });

  app.post("/api/medicines/:id/snooze", authenticateToken, (req: any, res) => {
    const { minutes } = req.body;
    const snoozedUntil = new Date(Date.now() + minutes * 60000).toISOString();
    db.prepare("UPDATE medicines SET snoozed_until = ? WHERE id = ? AND user_id = ?")
      .run(snoozedUntil, req.params.id, req.user.id);
    res.json({ success: true, snoozed_until: snoozedUntil });
  });

  // Log Routes
  app.get("/api/logs", authenticateToken, (req: any, res) => {
    const logs = db.prepare(`
      SELECT l.*, m.name as medicine_name 
      FROM logs l 
      JOIN medicines m ON l.medicine_id = m.id 
      WHERE l.user_id = ?
      ORDER BY l.taken_at DESC
    `).all(req.user.id);
    res.json(logs);
  });

  app.post("/api/logs", authenticateToken, (req: any, res) => {
    try {
      const { medicine_id, taken_at, status } = req.body;
      const stmt = db.prepare("INSERT INTO logs (user_id, medicine_id, taken_at, status) VALUES (?, ?, ?, ?)");
      const result = stmt.run(req.user.id, medicine_id, taken_at, status);
      res.json({ id: Number(result.lastInsertRowid), ...req.body });
    } catch (error: any) {
      console.error("Error logging dose:", error);
      res.status(500).json({ error: error.message || "Failed to log dose" });
    }
  });

  // Analytics Route
  app.get("/api/analytics", authenticateToken, (req: any, res) => {
    const stats = db.prepare(`
      SELECT 
        date(taken_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'taken' THEN 1 ELSE 0 END) as taken
      FROM logs
      WHERE user_id = ?
      GROUP BY date(taken_at)
      ORDER BY date ASC
      LIMIT 30
    `).all(req.user.id);
    res.json(stats);
  });

  app.get("/api/behavior-analysis", authenticateToken, (req: any, res) => {
    try {
      // 1. Adherence by Day of Week
      const dayOfWeekStats = db.prepare(`
        SELECT 
          strftime('%w', taken_at) as day_index,
          COUNT(*) as total,
          SUM(CASE WHEN status = 'taken' THEN 1 ELSE 0 END) as taken
        FROM logs
        WHERE user_id = ?
        GROUP BY day_index
      `).all(req.user.id);

      // 2. Adherence by Medicine
      const medicineStats = db.prepare(`
        SELECT 
          m.name,
          COUNT(l.id) as total,
          SUM(CASE WHEN l.status = 'taken' THEN 1 ELSE 0 END) as taken
        FROM medicines m
        LEFT JOIN logs l ON m.id = l.medicine_id
        WHERE m.user_id = ?
        GROUP BY m.id
      `).all(req.user.id);

      // 3. Average Delay (if reminder_time exists)
      // We calculate delay as the difference between taken_at time and reminder_time
      const delayStats = db.prepare(`
        SELECT 
          m.name,
          l.taken_at,
          m.reminder_time
        FROM logs l
        JOIN medicines m ON l.medicine_id = m.id
        WHERE l.user_id = ? AND l.status = 'taken' AND m.reminder_time IS NOT NULL
      `).all(req.user.id) as any[];

      const delays = delayStats.map(stat => {
        const takenTime = new Date(stat.taken_at);
        const [remH, remM] = stat.reminder_time.split(':').map(Number);
        const reminderTime = new Date(takenTime);
        reminderTime.setHours(remH, remM, 0, 0);
        
        // If taken early morning but reminder was night before, or vice versa, this might be tricky
        // But for simplicity, we assume same day
        let diffMinutes = (takenTime.getTime() - reminderTime.getTime()) / 60000;
        
        // Handle cases where medicine is taken slightly before reminder (negative delay)
        return { name: stat.name, delay: diffMinutes };
      });

      res.json({
        dayOfWeekStats,
        medicineStats,
        delays: delays.slice(-50) // Last 50 doses for trend
      });
    } catch (error: any) {
      console.error("Error in behavior analysis:", error);
      res.status(500).json({ error: "Failed to generate behavior analysis" });
    }
  });

  // Catch-all for undefined API routes
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Unhandled Error:", err);
    res.status(500).json({ 
      error: "Internal Server Error", 
      message: process.env.NODE_ENV === 'production' ? "Something went wrong" : err.message 
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

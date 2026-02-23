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
const JWT_SECRET = process.env.JWT_SECRET || "medtrack-secret-key-123";

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    name TEXT,
    reminder_sound TEXT DEFAULT 'default',
    custom_sound_data TEXT
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

  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
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
      const token = jwt.sign({ id: result.lastInsertRowid, email, name, reminder_sound: 'default' }, JWT_SECRET);
      res.json({ token, user: { id: result.lastInsertRowid, email, name, reminder_sound: 'default', custom_sound_data: null } });
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
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, reminder_sound: user.reminder_sound }, JWT_SECRET);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, reminder_sound: user.reminder_sound, custom_sound_data: user.custom_sound_data } });
  });

  app.put("/api/user/settings", authenticateToken, (req: any, res) => {
    const { reminder_sound, custom_sound_data } = req.body;
    if (custom_sound_data !== undefined) {
      db.prepare("UPDATE users SET reminder_sound = ?, custom_sound_data = ? WHERE id = ?")
        .run(reminder_sound, custom_sound_data, req.user.id);
    } else {
      db.prepare("UPDATE users SET reminder_sound = ? WHERE id = ?")
        .run(reminder_sound, req.user.id);
    }
    res.json({ success: true });
  });

  // Medicine Routes
  app.get("/api/medicines", authenticateToken, (req: any, res) => {
    const medicines = db.prepare("SELECT * FROM medicines WHERE user_id = ?").all(req.user.id);
    res.json(medicines);
  });

  app.post("/api/medicines", authenticateToken, (req: any, res) => {
    const { name, dosage, frequency, time_of_day, start_date, end_date, instructions, reminder_time } = req.body;
    const stmt = db.prepare(`
      INSERT INTO medicines (user_id, name, dosage, frequency, time_of_day, start_date, end_date, instructions, reminder_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(req.user.id, name, dosage, frequency, time_of_day, start_date, end_date, instructions, reminder_time);
    res.json({ id: result.lastInsertRowid, ...req.body });
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
    db.prepare("DELETE FROM medicines WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ success: true });
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
    const { medicine_id, taken_at, status } = req.body;
    const stmt = db.prepare("INSERT INTO logs (user_id, medicine_id, taken_at, status) VALUES (?, ?, ?, ?)");
    const result = stmt.run(req.user.id, medicine_id, taken_at, status);
    res.json({ id: result.lastInsertRowid, ...req.body });
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

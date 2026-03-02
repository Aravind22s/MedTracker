import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONGODB_URI = process.env.MONGODB_URI;
let isDbConnected = false;

const JWT_SECRET = process.env.JWT_SECRET || "medtrack-secret-key-123";

// MongoDB Connection
async function connectToDatabase() {
  if (!MONGODB_URI) {
    console.error("⚠️ WARNING: MONGODB_URI is not defined. Database features will not work.");
    return;
  }
  try {
    await mongoose.connect(MONGODB_URI);
    isDbConnected = true;
    console.log("Connected to MongoDB successfully");
  } catch (err: any) {
    console.error("❌ CRITICAL: MongoDB connection failed!");
    console.error("Error details:", err.message);
    if (err.message.includes("authentication failed")) {
      console.error("\nTIP: Your MongoDB password or username is incorrect.");
      console.error("If your password contains special characters (like @, #, $), you MUST URL-encode them.");
      console.error("Example: '@' becomes '%40', '#' becomes '%23'\n");
    }
  }
}

// Define Schemas
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  reminder_sound: { type: String, default: 'default' },
  custom_sound_data: { type: String },
  language: { type: String, default: 'en' }
});

const medicineSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  dosage: { type: String, required: true },
  frequency: { type: String, required: true },
  time_of_day: { type: String },
  start_date: { type: String },
  end_date: { type: String },
  instructions: { type: String },
  snoozed_until: { type: String },
  reminder_time: { type: String }
});

const logSchema = new mongoose.Schema({
  medicine_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  taken_at: { type: String, required: true },
  status: { type: String, required: true }
});

// Helper to map _id to id for frontend compatibility
const mapId = (doc: any) => {
  if (!doc) return null;
  const { _id, ...rest } = doc.toObject ? doc.toObject() : doc;
  return { id: _id.toString(), ...rest };
};

const User = mongoose.model("User", userSchema);
const Medicine = mongoose.model("Medicine", medicineSchema);
const Log = mongoose.model("Log", logSchema);

// Seed Database
async function seedDatabase() {
  const demoUser = await User.findOne({ email: "demo@example.com" });
  if (!demoUser) {
    console.log("Seeding database: Creating demo user...");
    const hashedPassword = await bcrypt.hash("password123", 10);
    const newUser = await User.create({
      email: "demo@example.com",
      password: hashedPassword,
      name: "Demo User"
    });
    
    const userId = newUser._id;

    const meds = [
      { name: "Lisinopril", dosage: "10mg", frequency: "Daily", time_of_day: "Morning", instructions: "Take with water", reminder_time: "08:00" },
      { name: "Metformin", dosage: "500mg", frequency: "Twice a day", time_of_day: "Morning, Evening", instructions: "Take with food", reminder_time: "19:00" },
      { name: "Atorvastatin", dosage: "20mg", frequency: "Daily", time_of_day: "Night", instructions: "Avoid grapefruit juice", reminder_time: "21:00" }
    ];

    for (const med of meds) {
      const newMed = await Medicine.create({
        user_id: userId,
        ...med,
        start_date: new Date().toISOString()
      });

      // Add some logs for the past 7 days
      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        await Log.create({
          user_id: userId,
          medicine_id: newMed._id,
          taken_at: date.toISOString(),
          status: "taken"
        });
      }
    }
    console.log("Database seeded successfully!");
  } else {
    console.log("Demo user already exists, skipping seed.");
  }
}

async function startServer() {
  await connectToDatabase();
  if (isDbConnected) {
    await seedDatabase();
  }
  const app = express();
  app.use(express.json());

  // Database status middleware
  app.use("/api", (req, res, next) => {
    if (!isDbConnected && req.path !== "/health") {
      return res.status(503).json({ 
        error: "Database not connected", 
        message: "The application is waiting for a valid MongoDB connection. Please check your MONGODB_URI environment variable." 
      });
    }
    next();
  });

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

    jwt.verify(token, JWT_SECRET, async (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      
      // Verify user still exists in DB
      const dbUser = await User.findById(user.id);
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
      const newUser = await User.create({ email, password: hashedPassword, name });
      const token = jwt.sign({ id: newUser._id, email, name, reminder_sound: 'default' }, JWT_SECRET);
      res.json({ token, user: mapId(newUser) });
    } catch (e) {
      res.status(400).json({ error: "Email already exists" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    console.log(`Login attempt for: ${email}`);
    const user = await User.findOne({ email });
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
    const token = jwt.sign({ id: user._id, email: user.email, name: user.name, reminder_sound: user.reminder_sound, language: user.language }, JWT_SECRET);
    res.json({ token, user: mapId(user) });
  });

  app.put("/api/user/settings", authenticateToken, async (req: any, res) => {
    const { reminder_sound, custom_sound_data, language } = req.body;
    const update: any = {};
    if (language) update.language = language;
    if (reminder_sound) update.reminder_sound = reminder_sound;
    if (custom_sound_data !== undefined) update.custom_sound_data = custom_sound_data;

    await User.findByIdAndUpdate(req.user.id, update);
    res.json({ success: true });
  });

  app.get("/api/user/me", authenticateToken, async (req: any, res) => {
    const user = await User.findById(req.user.id).select("-password");
    res.json(mapId(user));
  });

  // Medicine Routes
  app.get("/api/medicines", authenticateToken, async (req: any, res) => {
    const medicines = await Medicine.find({ user_id: req.user.id });
    res.json(medicines.map(mapId));
  });

  app.post("/api/medicines", authenticateToken, async (req: any, res) => {
    try {
      const newMed = await Medicine.create({ ...req.body, user_id: req.user.id });
      res.json(mapId(newMed));
    } catch (error: any) {
      console.error("Error adding medicine:", error);
      res.status(500).json({ error: error.message || "Failed to add medicine" });
    }
  });

  app.put("/api/medicines/:id", authenticateToken, async (req: any, res) => {
    await Medicine.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user.id },
      req.body
    );
    res.json({ success: true });
  });

  app.delete("/api/medicines/:id", authenticateToken, async (req: any, res) => {
    const medId = req.params.id;
    const userId = req.user.id;
    
    try {
      await Log.deleteMany({ medicine_id: medId, user_id: userId });
      const result = await Medicine.deleteOne({ _id: medId, user_id: userId });
      
      if (result.deletedCount > 0) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Medicine not found" });
      }
    } catch (error: any) {
      console.error(`[SERVER] DELETE error:`, error);
      res.status(500).json({ error: error.message || "Server error" });
    }
  });

  app.post("/api/medicines/:id/snooze", authenticateToken, async (req: any, res) => {
    const { minutes } = req.body;
    const snoozedUntil = new Date(Date.now() + minutes * 60000).toISOString();
    await Medicine.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user.id },
      { snoozed_until: snoozedUntil }
    );
    res.json({ success: true, snoozed_until: snoozedUntil });
  });

  // Log Routes
  app.get("/api/logs", authenticateToken, async (req: any, res) => {
    const logs = await Log.find({ user_id: req.user.id }).sort({ taken_at: -1 });
    // We need to join with medicine name for the frontend
    const medicines = await Medicine.find({ user_id: req.user.id });
    const medMap = new Map(medicines.map(m => [m._id.toString(), m.name]));
    
    const logsWithNames = logs.map(l => {
      const logObj = mapId(l);
      return {
        ...logObj,
        medicine_name: medMap.get(l.medicine_id.toString()) || "Unknown"
      };
    });
    
    res.json(logsWithNames);
  });

  app.post("/api/logs", authenticateToken, async (req: any, res) => {
    try {
      const newLog = await Log.create({ ...req.body, user_id: req.user.id });
      res.json(mapId(newLog));
    } catch (error: any) {
      console.error("Error logging dose:", error);
      res.status(500).json({ error: error.message || "Failed to log dose" });
    }
  });

  // Analytics Route
  app.get("/api/analytics", authenticateToken, async (req: any, res) => {
    const logs = await Log.find({ user_id: req.user.id });
    
    // Group by date in JS since MongoDB aggregation is more complex for simple date strings
    const statsMap = new Map();
    logs.forEach(log => {
      const date = log.taken_at.split('T')[0];
      if (!statsMap.has(date)) {
        statsMap.set(date, { date, total: 0, taken: 0 });
      }
      const stat = statsMap.get(date);
      stat.total++;
      if (log.status === 'taken') stat.taken++;
    });
    
    const stats = Array.from(statsMap.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
    res.json(stats);
  });

  app.get("/api/behavior-analysis", authenticateToken, async (req: any, res) => {
    try {
      const logs = await Log.find({ user_id: req.user.id });
      const medicines = await Medicine.find({ user_id: req.user.id });
      
      // 1. Adherence by Day of Week
      const dayOfWeekMap = new Map();
      logs.forEach(log => {
        const dayIndex = new Date(log.taken_at).getDay().toString();
        if (!dayOfWeekMap.has(dayIndex)) {
          dayOfWeekMap.set(dayIndex, { day_index: dayIndex, total: 0, taken: 0 });
        }
        const stat = dayOfWeekMap.get(dayIndex);
        stat.total++;
        if (log.status === 'taken') stat.taken++;
      });

      // 2. Adherence by Medicine
      const medicineStats = medicines.map(m => {
        const medLogs = logs.filter(l => l.medicine_id.toString() === m._id.toString());
        return {
          name: m.name,
          total: medLogs.length,
          taken: medLogs.filter(l => l.status === 'taken').length
        };
      });

      // 3. Average Delay
      const delays = [];
      for (const log of logs) {
        if (log.status !== 'taken') continue;
        const med = medicines.find(m => m._id.toString() === log.medicine_id.toString());
        if (med && med.reminder_time) {
          const takenTime = new Date(log.taken_at);
          const [remH, remM] = med.reminder_time.split(':').map(Number);
          const reminderTime = new Date(takenTime);
          reminderTime.setHours(remH, remM, 0, 0);
          const diffMinutes = (takenTime.getTime() - reminderTime.getTime()) / 60000;
          delays.push({ name: med.name, delay: diffMinutes });
        }
      }

      res.json({
        dayOfWeekStats: Array.from(dayOfWeekMap.values()),
        medicineStats,
        delays: delays.slice(-50)
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

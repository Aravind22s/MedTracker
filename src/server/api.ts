import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/medtrack";
const JWT_SECRET = process.env.JWT_SECRET || "medtrack-secret-key-123";

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

const mapId = (doc: any) => {
  if (!doc) return null;
  const { _id, ...rest } = doc.toObject ? doc.toObject() : doc;
  return { id: _id.toString(), ...rest };
};

const User = (mongoose.models.User as any) || mongoose.model("User", userSchema);
const Medicine = (mongoose.models.Medicine as any) || mongoose.model("Medicine", medicineSchema);
const Log = (mongoose.models.Log as any) || mongoose.model("Log", logSchema);

async function seedDatabase() {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const demoUser = await User.findOne({ email: "demo@example.com" });
    if (!demoUser) {
      const hashedPassword = await bcrypt.hash("password123", 10);
      const newUser = await User.create({ email: "demo@example.com", password: hashedPassword, name: "Demo User" });
      const userId = newUser._id;
      const meds = [
        { name: "Lisinopril", dosage: "10mg", frequency: "Daily", time_of_day: "Morning", instructions: "Take with water", reminder_time: "08:00" },
        { name: "Metformin", dosage: "500mg", frequency: "Twice a day", time_of_day: "Morning, Evening", instructions: "Take with food", reminder_time: "19:00" },
        { name: "Atorvastatin", dosage: "20mg", frequency: "Daily", time_of_day: "Night", instructions: "Avoid grapefruit juice", reminder_time: "21:00" }
      ];
      for (const med of meds) {
        const newMed = await Medicine.create({ user_id: userId, ...med, start_date: new Date().toISOString() });
        for (let i = 0; i < 7; i++) {
          const date = new Date();
          date.setDate(date.getDate() - i);
          await Log.create({ user_id: userId, medicine_id: newMed._id, taken_at: date.toISOString(), status: "taken" });
        }
      }
    }
  } catch (error) {}
}

export const apiRouter = express.Router();
apiRouter.use(express.json());

// MongoDB Connection (Non-blocking)
mongoose.set('bufferCommands', false); // Disable buffering to fail fast if not connected
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 2000 })
  .then(() => seedDatabase())
  .catch(() => {});

const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, async (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    const dbUser = await User.findById(user.id);
    if (!dbUser) return res.status(401).json({ error: "User no longer exists" });
    req.user = user;
    next();
  });
};

apiRouter.get("/health", (req, res) => res.json({ status: "ok" }));

// Connection check middleware
apiRouter.use((req, res, next) => {
  if (mongoose.connection.readyState !== 1 && req.path !== '/health') {
    return res.status(503).json({
      error: "Database Connection Error",
      message: "MongoDB is not connected. Please ensure MONGODB_URI is correctly configured in your environment variables (e.g. MongoDB Atlas).",
      state: mongoose.connection.readyState
    });
  }
  next();
});

apiRouter.post("/auth/signup", async (req, res) => {
  const { email, password, name } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ email, password: hashedPassword, name });
    const token = jwt.sign({ id: newUser._id, email, name, reminder_sound: 'default' }, JWT_SECRET);
    res.json({ token, user: mapId(newUser) });
  } catch (e) { res.status(400).json({ error: "Email already exists" }); }
});

apiRouter.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user._id, email: user.email, name: user.name, reminder_sound: user.reminder_sound, language: user.language }, JWT_SECRET);
  res.json({ token, user: mapId(user) });
});

apiRouter.put("/user/settings", authenticateToken, async (req: any, res) => {
  const { reminder_sound, custom_sound_data, language } = req.body;
  const update: any = {};
  if (language) update.language = language;
  if (reminder_sound) update.reminder_sound = reminder_sound;
  if (custom_sound_data !== undefined) update.custom_sound_data = custom_sound_data;
  await User.findByIdAndUpdate(req.user.id, update);
  res.json({ success: true });
});

apiRouter.get("/user/me", authenticateToken, async (req: any, res) => {
  const user = await User.findById(req.user.id).select("-password");
  res.json(mapId(user));
});

apiRouter.get("/medicines", authenticateToken, async (req: any, res) => {
  const medicines = await Medicine.find({ user_id: req.user.id });
  res.json(medicines.map(mapId));
});

apiRouter.post("/medicines", authenticateToken, async (req: any, res) => {
  try {
    const newMed = await Medicine.create({ ...req.body, user_id: req.user.id });
    res.json(mapId(newMed));
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

apiRouter.put("/medicines/:id", authenticateToken, async (req: any, res) => {
  await Medicine.findOneAndUpdate({ _id: req.params.id, user_id: req.user.id }, req.body);
  res.json({ success: true });
});

apiRouter.delete("/medicines/:id", authenticateToken, async (req: any, res) => {
  try {
    await Log.deleteMany({ medicine_id: req.params.id, user_id: req.user.id });
    const result = await Medicine.deleteOne({ _id: req.params.id, user_id: req.user.id });
    if (result.deletedCount > 0) res.json({ success: true });
    else res.status(404).json({ error: "Medicine not found" });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

apiRouter.post("/medicines/:id/snooze", authenticateToken, async (req: any, res) => {
  const { minutes } = req.body;
  const snoozedUntil = new Date(Date.now() + minutes * 60000).toISOString();
  await Medicine.findOneAndUpdate({ _id: req.params.id, user_id: req.user.id }, { snoozed_until: snoozedUntil });
  res.json({ success: true, snoozed_until: snoozedUntil });
});

apiRouter.get("/logs", authenticateToken, async (req: any, res) => {
  const logs = await Log.find({ user_id: req.user.id }).sort({ taken_at: -1 });
  const medicines = await Medicine.find({ user_id: req.user.id });
  const medMap = new Map(medicines.map(m => [m._id.toString(), m.name]));
  res.json(logs.map(l => ({ ...mapId(l), medicine_name: medMap.get(l.medicine_id.toString()) || "Unknown" })));
});

apiRouter.post("/logs", authenticateToken, async (req: any, res) => {
  try {
    const newLog = await Log.create({ ...req.body, user_id: req.user.id });
    res.json(mapId(newLog));
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

apiRouter.get("/analytics", authenticateToken, async (req: any, res) => {
  const logs = await Log.find({ user_id: req.user.id });
  const statsMap = new Map();
  logs.forEach(log => {
    const date = log.taken_at.split('T')[0];
    if (!statsMap.has(date)) statsMap.set(date, { date, total: 0, taken: 0 });
    const stat = statsMap.get(date);
    stat.total++;
    if (log.status === 'taken') stat.taken++;
  });
  res.json(Array.from(statsMap.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-30));
});

apiRouter.get("/behavior-analysis", authenticateToken, async (req: any, res) => {
  try {
    const logs = await Log.find({ user_id: req.user.id });
    const medicines = await Medicine.find({ user_id: req.user.id });
    const dayOfWeekMap = new Map();
    logs.forEach(log => {
      const dayIndex = new Date(log.taken_at).getDay().toString();
      if (!dayOfWeekMap.has(dayIndex)) dayOfWeekMap.set(dayIndex, { day_index: dayIndex, total: 0, taken: 0 });
      const stat = dayOfWeekMap.get(dayIndex);
      stat.total++;
      if (log.status === 'taken') stat.taken++;
    });
    const medicineStats = medicines.map(m => ({
      name: m.name,
      total: logs.filter(l => l.medicine_id.toString() === m._id.toString()).length,
      taken: logs.filter(l => l.medicine_id.toString() === m._id.toString() && l.status === 'taken').length
    }));
    const delays = logs.filter(l => l.status === 'taken').map(log => {
      const med = medicines.find(m => m._id.toString() === log.medicine_id.toString());
      if (med && med.reminder_time) {
        const takenTime = new Date(log.taken_at);
        const [remH, remM] = med.reminder_time.split(':').map(Number);
        const reminderTime = new Date(takenTime);
        reminderTime.setHours(remH, remM, 0, 0);
        return { name: med.name, delay: (takenTime.getTime() - reminderTime.getTime()) / 60000 };
      }
      return null;
    }).filter(Boolean);
    res.json({ dayOfWeekStats: Array.from(dayOfWeekMap.values()), medicineStats, delays: delays.slice(-50) });
  } catch (error: any) { res.status(500).json({ error: "Failed" }); }
});
